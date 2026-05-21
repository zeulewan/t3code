// @effect-diagnostics-next-line nodeBuiltinImport:off - NodeHttpServer.layer takes `NodeHttp.createServer` as arg
import * as NodeHttp from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as CliError from "effect/unstable/cli/CliError";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import * as DateTime from "effect/DateTime";

import { cli } from "./bin.ts";
import { deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer.ts";
import {
  orchestrationDispatchRouteLayer,
  orchestrationSnapshotRouteLayer,
} from "./orchestration/http.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import { RepositoryIdentityResolverLive } from "./project/Layers/RepositoryIdentityResolver.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "./serverRuntimeState.ts";
import { WorkspacePathsLive } from "./workspace/Layers/WorkspacePaths.ts";
import { ServerSecretStoreLive } from "./auth/Layers/ServerSecretStore.ts";
import { ServerAuthLive } from "./auth/Layers/ServerAuth.ts";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);
const runCliWithRuntime = (args: ReadonlyArray<string>) =>
  runCli(args).pipe(Effect.provide(CliRuntimeLayer));

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const output =
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      "";
    return { result, output };
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

const makeCliTestServerConfig = (baseDir: string, devUrl?: URL) =>
  Effect.gen(function* () {
    const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
    return {
      logLevel: "Info",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpExportIntervalMs: 10_000,
      otlpServiceName: "t3-server",
      mode: "web",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl,
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    } satisfies ServerConfigShape;
  });

const makeProjectPersistenceLayer = (config: ServerConfigShape) =>
  Layer.mergeAll(
    OrchestrationLayerLive.pipe(
      Layer.provideMerge(RepositoryIdentityResolverLive),
      Layer.provideMerge(SqlitePersistenceLayerLive),
    ),
    WorkspacePathsLive,
  ).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(Layer.succeed(ServerConfig, config)),
  );

const readPersistedSnapshot = (baseDir: string, devUrl?: URL) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir, devUrl);
    return yield* Effect.gen(function* () {
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      return yield* projectionSnapshotQuery.getSnapshot();
    }).pipe(Effect.provide(makeProjectPersistenceLayer(config)));
  });

const withLiveProjectCliServer = <A, E, R>(baseDir: string, run: () => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const config = yield* makeCliTestServerConfig(baseDir);
    const routesLayer = Layer.mergeAll(
      orchestrationSnapshotRouteLayer,
      orchestrationDispatchRouteLayer,
    );
    const appLayer = HttpRouter.serve(routesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(
        ServerAuthLive.pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerSecretStoreLive),
        ),
      ),
      Layer.provideMerge(makeProjectPersistenceLayer(config)),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, {
          host: "127.0.0.1",
          port: 0,
        }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(Layer.succeed(ServerConfig, config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          assert.fail(`Expected TCP address, got ${address}`);
        }
        yield* persistServerRuntimeState({
          path: config.serverRuntimeStatePath,
          state: yield* makePersistedServerRuntimeState({
            config,
            port: address.port,
          }),
        });
        return yield* run();
      }).pipe(Effect.provide(Layer.mergeAll(appLayer, NodeServices.layer))),
    );
  });

it.layer(NodeServices.layer)("bin cli parsing", (it) => {
  it.effect("accepts the built-in lowercase log-level flag values", () =>
    runCliWithRuntime(["--log-level", "debug", "--version"]),
  );

  it.effect("accepts canonical --no-<flag> boolean negation", () =>
    runCliWithRuntime(["--no-log-websocket-events", "--version"]),
  );

  it.effect("rejects invalid log-level casing before launching the server", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["--log-level", "Debug"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${error._tag}`);
      }
      assert.equal(error.option, "log-level");
      assert.equal(error.value, "Debug");
    }),
  );

  it.effect("executes auth pairing subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-auth-pairing-test-"));

      const createdOutput = yield* captureStdout(
        runCli(["auth", "pairing", "create", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const created = JSON.parse(createdOutput.output) as {
        readonly id: string;
        readonly credential: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly id: string;
        readonly credential?: string;
      }>;

      assert.equal(typeof created.id, "string");
      assert.equal(typeof created.credential, "string");
      assert.equal(created.credential.length > 0, true);
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.id, created.id);
      assert.equal("credential" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("executes auth session subcommands and redacts secrets from list output", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-auth-session-test-"));

      const issuedOutput = yield* captureStdout(
        runCli(["auth", "session", "issue", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const issued = JSON.parse(issuedOutput.output) as {
        readonly sessionId: string;
        readonly token: string;
        readonly role: string;
      };
      const listedOutput = yield* captureStdout(
        runCli(["auth", "session", "list", "--base-dir", baseDir, "--json"]),
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const listed = JSON.parse(listedOutput.output) as ReadonlyArray<{
        readonly sessionId: string;
        readonly token?: string;
        readonly role: string;
      }>;

      assert.equal(typeof issued.sessionId, "string");
      assert.equal(typeof issued.token, "string");
      assert.equal(issued.role, "owner");
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.sessionId, issued.sessionId);
      assert.equal(listed[0]?.role, "owner");
      assert.equal("token" in (listed[0] ?? {}), false);
    }),
  );

  it.effect("rejects invalid ttl values before running auth commands", () =>
    Effect.gen(function* () {
      const error = yield* runCliWithRuntime(["auth", "pairing", "create", "--ttl", "soon"]).pipe(
        Effect.flip,
      );

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }
      if (error._tag !== "ShowHelp") {
        assert.fail(`Expected ShowHelp, got ${error._tag}`);
      }
      assert.deepEqual(error.commandPath, ["t3", "auth", "pairing", "create"]);
      const ttlError = error.errors[0] as CliError.CliError | undefined;
      if (!ttlError || ttlError._tag !== "InvalidValue") {
        assert.fail(`Expected InvalidValue, got ${String(ttlError?._tag)}`);
      }
      assert.equal(ttlError.option, "ttl");
      assert.equal(ttlError.value, "soon");
      assert.isTrue(ttlError.message.includes("Invalid duration"));
      assert.isTrue(ttlError.message.includes("5m, 1h, 30d, or 15 minutes"));
    }),
  );

  it.effect("adds, renames, and removes projects offline through the orchestration engine", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-projects-offline-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-projects-workspace-"));

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Alpha",
        "--base-dir",
        baseDir,
      ]);
      const afterAdd = yield* readPersistedSnapshot(baseDir);
      const addedProject = afterAdd.projects.find(
        (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
      );
      assert.isTrue(addedProject !== undefined);
      assert.equal(addedProject?.title, "Alpha");

      yield* runCliWithRuntime(["project", "rename", workspaceRoot, "Beta", "--base-dir", baseDir]);
      const afterRename = yield* readPersistedSnapshot(baseDir);
      const renamedProject = afterRename.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.equal(renamedProject?.title, "Beta");
      assert.equal(renamedProject?.deletedAt, null);

      yield* runCliWithRuntime([
        "project",
        "remove",
        addedProject?.id ?? "",
        "--base-dir",
        baseDir,
      ]);
      const afterRemove = yield* readPersistedSnapshot(baseDir);
      const removedProject = afterRemove.projects.find(
        (project) => project.id === addedProject?.id,
      );
      assert.isTrue((removedProject?.deletedAt ?? null) !== null);
    }),
  );

  it.effect("routes project commands through a running server when runtime state is present", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-projects-live-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-projects-live-workspace-"));

      yield* withLiveProjectCliServer(baseDir, () =>
        Effect.gen(function* () {
          yield* runCliWithRuntime([
            "project",
            "add",
            workspaceRoot,
            "--title",
            "Live Project",
            "--base-dir",
            baseDir,
          ]);
          const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
          const readModel = yield* projectionSnapshotQuery.getSnapshot();
          const addedProject = readModel.projects.find(
            (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
          );
          assert.isTrue(addedProject !== undefined);
          assert.equal(addedProject?.title, "Live Project");
        }),
      );
    }),
  );

  it.effect("keeps runtime state when a live probe fails for a running pid", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-runtime-state-probe-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-runtime-state-workspace-"));
      const config = yield* makeCliTestServerConfig(baseDir);

      yield* persistServerRuntimeState({
        path: config.serverRuntimeStatePath,
        state: {
          version: 1,
          pid: process.pid,
          host: "127.0.0.1",
          port: 1,
          origin: "http://127.0.0.1:1",
          startedAt: yield* Effect.map(DateTime.now, DateTime.formatIso),
        },
      });

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Probe Fallback Project",
        "--base-dir",
        baseDir,
      ]);

      assert.isTrue(existsSync(config.serverRuntimeStatePath));
      const snapshot = yield* readPersistedSnapshot(baseDir);
      assert.isTrue(
        snapshot.projects.some(
          (project) =>
            project.workspaceRoot === workspaceRoot && project.title === "Probe Fallback Project",
        ),
      );
    }),
  );

  it.effect("spawns an agent through a running server and registers a comms actor", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-agent-live-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-agent-live-workspace-"));

      yield* withLiveProjectCliServer(baseDir, () =>
        Effect.gen(function* () {
          yield* runCliWithRuntime([
            "project",
            "add",
            workspaceRoot,
            "--title",
            "Agent Project",
            "--base-dir",
            baseDir,
          ]);

          yield* runCliWithRuntime([
            "agent",
            "spawn",
            "Agent Project",
            "Test Agent",
            "Reply exactly AGENT_READY and nothing else.",
            "--base-dir",
            baseDir,
            "--provider",
            "codex",
            "--model",
            "gpt-5.4",
            "--effort",
            "low",
            "--handle",
            "test-agent",
          ]);

          const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
          const readModel = yield* projectionSnapshotQuery.getSnapshot();
          const thread = readModel.threads.find((entry) => entry.title === "Test Agent");
          assert.isTrue(thread !== undefined);
          assert.equal(thread?.modelSelection.instanceId, "codex");
          assert.equal(thread?.modelSelection.model, "gpt-5.4");

          const actorsOutput = yield* captureStdout(
            runCli(["comms", "actors", "--base-dir", baseDir]),
          );
          assert.isTrue(actorsOutput.output.includes("@test-agent"));

          yield* runCliWithRuntime([
            "agent",
            "rename",
            "test-agent",
            "Renamed Agent",
            "--base-dir",
            baseDir,
          ]);

          const renamedActorsOutput = yield* captureStdout(
            runCli(["comms", "actors", "--base-dir", baseDir]),
          );
          assert.isTrue(renamedActorsOutput.output.includes("@renamed-agent"));
          assert.isFalse(renamedActorsOutput.output.includes("@test-agent"));

          const sendOutput = yield* captureStdout(
            runCli(["agent", "send", "renamed-agent", "Status?", "--base-dir", baseDir]),
          );
          assert.isTrue(sendOutput.output.includes(`Sent turn to ${thread?.id}.`));

          const imagePath = join(workspaceRoot, "cli-attachment.png");
          writeFileSync(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

          const attachmentOutput = yield* captureStdout(
            runCli([
              "agent",
              "send",
              "renamed-agent",
              "Image attached.",
              "--attach",
              imagePath,
              "--base-dir",
              baseDir,
            ]),
          );
          assert.isTrue(
            attachmentOutput.output.includes(`Sent turn to ${thread?.id} with 1 attachment(s).`),
          );

          const snapshot = yield* readPersistedSnapshot(baseDir);
          const updatedThread = snapshot.threads.find((entry) => entry.id === thread?.id);
          const imageMessage = updatedThread?.messages.find(
            (message) => message.role === "user" && message.text === "Image attached.",
          );
          const attachment = imageMessage?.attachments?.[0];
          assert.equal(attachment?.type, "image");
          assert.equal(attachment?.name, "cli-attachment.png");
          assert.equal(attachment?.mimeType, "image/png");
          assert.isTrue((attachment?.sizeBytes ?? 0) > 0);
          assert.isTrue((attachment?.id.length ?? 0) > 0);

          const postOutput = yield* captureStdout(
            runCli([
              "agent",
              "post",
              "renamed-agent",
              "Assistant image attached.",
              "--attach",
              imagePath,
              "--base-dir",
              baseDir,
            ]),
          );
          assert.isTrue(
            postOutput.output.includes(
              `Posted assistant message to ${thread?.id} with 1 attachment(s).`,
            ),
          );

          const snapshotAfterPost = yield* readPersistedSnapshot(baseDir);
          const postedThread = snapshotAfterPost.threads.find((entry) => entry.id === thread?.id);
          const assistantImageMessage = postedThread?.messages.find(
            (message) =>
              message.role === "assistant" && message.text === "Assistant image attached.",
          );
          const assistantAttachment = assistantImageMessage?.attachments?.[0];
          assert.equal(assistantAttachment?.type, "image");
          assert.equal(assistantAttachment?.name, "cli-attachment.png");
          assert.equal(assistantAttachment?.mimeType, "image/png");
          assert.isTrue((assistantAttachment?.sizeBytes ?? 0) > 0);
          assert.isTrue((assistantAttachment?.id.length ?? 0) > 0);

          const videoPath = join(workspaceRoot, "clip.mp4");
          writeFileSync(videoPath, Buffer.from("fake mp4 test payload"));
          const videoPostOutput = yield* captureStdout(
            runCli([
              "agent",
              "post",
              "renamed-agent",
              "Assistant video attached.",
              "--attach",
              videoPath,
              "--base-dir",
              baseDir,
            ]),
          );
          assert.isTrue(
            videoPostOutput.output.includes(
              `Posted assistant message to ${thread?.id} with 1 attachment(s).`,
            ),
          );

          const snapshotAfterVideoPost = yield* readPersistedSnapshot(baseDir);
          const videoThread = snapshotAfterVideoPost.threads.find(
            (entry) => entry.id === thread?.id,
          );
          const assistantVideoMessage = videoThread?.messages.find(
            (message) =>
              message.role === "assistant" && message.text === "Assistant video attached.",
          );
          const assistantVideoAttachment = assistantVideoMessage?.attachments?.[0];
          assert.equal(assistantVideoAttachment?.type, "video");
          assert.equal(assistantVideoAttachment?.name, "clip.mp4");
          assert.equal(assistantVideoAttachment?.mimeType, "video/mp4");
          assert.isTrue((assistantVideoAttachment?.sizeBytes ?? 0) > 0);
          assert.isTrue((assistantVideoAttachment?.id.length ?? 0) > 0);

          const textPath = join(workspaceRoot, "not-an-image.txt");
          writeFileSync(textPath, "not an image");
          const attachmentError = yield* runCliWithRuntime([
            "agent",
            "send",
            "renamed-agent",
            "This should fail.",
            "--attach",
            textPath,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          assert.isTrue(String(attachmentError).includes("Only image attachments are supported"));
        }),
      );
    }),
  );

  it.effect("rejects direct comms delivery when no live server is discoverable", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-comms-offline-test-"));

      yield* runCliWithRuntime(["comms", "register", "sender", "--base-dir", baseDir]);
      yield* runCliWithRuntime(["comms", "register", "receiver", "--base-dir", baseDir]);

      const error = yield* runCliWithRuntime([
        "comms",
        "send",
        "sender",
        "receiver",
        "hello",
        "--base-dir",
        baseDir,
      ]).pipe(Effect.flip);

      assert.isTrue(String(error).includes("requires a running T3 server"));

      const inboxOutput = yield* captureStdout(
        runCli(["comms", "inbox", "receiver", "--base-dir", baseDir]),
      );
      assert.equal(inboxOutput.output, "Inbox is empty.");
    }),
  );

  it.effect("accepts dev-url on project commands", () =>
    Effect.gen(function* () {
      const baseDir = mkdtempSync(join(tmpdir(), "t3-cli-projects-dev-url-test-"));
      const workspaceRoot = mkdtempSync(join(tmpdir(), "t3-cli-projects-dev-url-workspace-"));
      const devUrl = new URL("http://127.0.0.1:5173");

      yield* runCliWithRuntime([
        "project",
        "add",
        workspaceRoot,
        "--title",
        "Dev URL Project",
        "--base-dir",
        baseDir,
        "--dev-url",
        devUrl.href,
      ]);

      const snapshot = yield* readPersistedSnapshot(baseDir, devUrl);
      const addedProject = snapshot.projects.find(
        (project) => project.workspaceRoot === workspaceRoot && project.deletedAt === null,
      );
      assert.equal(addedProject?.title, "Dev URL Project");
    }),
  );
});
