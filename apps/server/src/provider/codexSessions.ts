import {
  CodexSessionError,
  type CodexSessionImportInput,
  type CodexSessionListInput,
  type CodexSessionSummary,
  CodexSettings as CodexSettingsSchema,
  type CodexSettings,
  CommandId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderService } from "./Services/ProviderService.ts";
import { mergeProviderInstanceEnvironment } from "./ProviderInstanceEnvironment.ts";
import { buildCodexInitializeParams } from "./Layers/CodexProvider.ts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { buildCodexThreadForkParams, type CodexServiceTier } from "./CodexAppServerThreadConfig.ts";

const CODEX = ProviderDriverKind.make("codex");
const DEFAULT_CODEX_INSTANCE = ProviderInstanceId.make("codex");
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const decodeCodexSettings = Schema.decodeUnknownEffect(CodexSettingsSchema);

type CodexClientShape = CodexClient.CodexAppServerClientShape;
type CodexThreadListItem = CodexSchema.V2ThreadListResponse["data"][number];
type CodexThreadRead = CodexSchema.V2ThreadReadResponse["thread"];
type CodexThreadItem = CodexThreadRead["turns"][number]["items"][number];

interface ResolvedCodexInstance {
  readonly settings: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
}

interface ImportedMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly turnId: TurnId | null;
  readonly createdAt: string;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return String(cause);
}

function toCodexSessionError(operation: string, cause: unknown): CodexSessionError {
  return new CodexSessionError({
    message: `${operation}: ${causeMessage(cause)}`,
    cause,
  });
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function unixSecondsToIso(seconds: number | null | undefined, fallback: string): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return fallback;
  return Option.match(DateTime.make(seconds * 1000), {
    onNone: () => fallback,
    onSome: DateTime.formatIso,
  });
}

function formatThreadSource(source: CodexThreadListItem["source"] | CodexThreadRead["source"]) {
  if (typeof source === "string") return source;
  if ("custom" in source) return source.custom;
  if ("subAgent" in source) return "subAgent";
  return "unknown";
}

function toSessionSummary(thread: CodexThreadListItem): CodexSessionSummary {
  return {
    providerThreadId: thread.id,
    sessionId: thread.sessionId,
    name: thread.name ?? null,
    preview: thread.preview,
    cwd: thread.cwd,
    source: formatThreadSource(thread.source),
    path: thread.path ?? null,
    createdAt: Math.max(0, thread.createdAt),
    updatedAt: Math.max(0, thread.updatedAt),
  };
}

function truncateTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function titleForThread(thread: CodexThreadRead, override: string | undefined): string {
  const candidates = [override, thread.name ?? undefined, thread.preview, thread.id];
  for (const candidate of candidates) {
    const normalized = candidate?.trim();
    if (normalized && normalized.length > 0) return truncateTitle(normalized);
  }
  return "Imported Codex session";
}

function normalizePathForCompare(path: Path.Path, value: string): string {
  return path.resolve(value.trim());
}

function isSameCwd(path: Path.Path, left: string, right: string): boolean {
  return normalizePathForCompare(path, left) === normalizePathForCompare(path, right);
}

function serviceTierForModelSelection(
  input: CodexSessionImportInput["modelSelection"],
): CodexServiceTier | undefined {
  return getModelSelectionBooleanOptionValue(input, "fastMode") === true ? "fast" : undefined;
}

function textFromUserContent(content: CodexThreadItem & { readonly type: "userMessage" }): string {
  return content.content
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.text;
        case "image":
          return `[image: ${item.url}]`;
        case "localImage":
          return `[local image: ${item.path}]`;
        case "skill":
          return `[$${item.name}]`;
        case "mention":
          return `[@${item.name}]`;
      }
    })
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function importedMessagesFromCodexThread(
  thread: CodexThreadRead,
  fallbackNow: string,
): ReadonlyArray<ImportedMessage> {
  const fallbackCreatedAt = unixSecondsToIso(thread.createdAt, fallbackNow);
  const messages: ImportedMessage[] = [];
  for (const turn of thread.turns) {
    const turnCreatedAt = unixSecondsToIso(turn.startedAt ?? turn.completedAt, fallbackCreatedAt);
    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const text = textFromUserContent(item).trim();
        if (text.length > 0) {
          messages.push({
            role: "user",
            text,
            turnId: null,
            createdAt: turnCreatedAt,
          });
        }
        continue;
      }
      if (item.type === "agentMessage") {
        const text = item.text.trim();
        if (text.length > 0) {
          messages.push({
            role: "assistant",
            text,
            turnId: TurnId.make(turn.id),
            createdAt: turnCreatedAt,
          });
        }
      }
    }
  }
  return messages;
}

const resolveCodexInstance = Effect.fn("resolveCodexInstance")(function* (
  providerInstanceId: ProviderInstanceId,
) {
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings.pipe(
    Effect.mapError((cause) => toCodexSessionError("Read server settings", cause)),
  );
  const configuredInstance = settings.providerInstances[providerInstanceId];

  if (configuredInstance !== undefined) {
    if (configuredInstance.driver !== CODEX) {
      return yield* new CodexSessionError({
        message: `Provider instance '${providerInstanceId}' is '${configuredInstance.driver}', not Codex.`,
      });
    }
    const decoded = yield* decodeCodexSettings(configuredInstance.config ?? {}).pipe(
      Effect.mapError((cause) => toCodexSessionError("Decode Codex provider settings", cause)),
    );
    if (configuredInstance.enabled === false || decoded.enabled === false) {
      return yield* new CodexSessionError({
        message: `Codex provider instance '${providerInstanceId}' is disabled.`,
      });
    }
    return {
      settings: decoded,
      environment: mergeProviderInstanceEnvironment(configuredInstance.environment),
    };
  }

  if (providerInstanceId !== DEFAULT_CODEX_INSTANCE) {
    return yield* new CodexSessionError({
      message: `Unknown Codex provider instance '${providerInstanceId}'.`,
    });
  }
  if (!settings.providers.codex.enabled) {
    return yield* new CodexSessionError({
      message: "Codex provider is disabled.",
    });
  }
  return {
    settings: settings.providers.codex,
    environment: process.env,
  };
});

const withCodexClient = <A, E, R>(
  instance: ResolvedCodexInstance,
  cwd: string,
  run: (client: CodexClientShape, settings: CodexSettings) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const layout = yield* resolveCodexHomeLayout(instance.settings);
      yield* materializeCodexShadowHome(layout).pipe(
        Effect.mapError((cause) => toCodexSessionError("Prepare Codex home", cause)),
      );
      const effectiveSettings = {
        ...instance.settings,
        homePath: layout.effectiveHomePath ?? "",
      } satisfies CodexSettings;
      const resolvedHomePath =
        effectiveSettings.homePath.trim().length > 0
          ? expandHomePath(effectiveSettings.homePath)
          : undefined;
      const clientContext = yield* Layer.build(
        CodexClient.layerCommand({
          command: effectiveSettings.binaryPath,
          args: ["app-server"],
          cwd,
          env: {
            ...instance.environment,
            ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
          },
        }),
      ).pipe(Effect.mapError((cause) => toCodexSessionError("Start Codex app-server", cause)));
      const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
        Effect.provide(clientContext),
      );
      yield* client
        .request("initialize", buildCodexInitializeParams())
        .pipe(
          Effect.mapError((cause) => toCodexSessionError("Initialize Codex app-server", cause)),
        );
      yield* client
        .notify("initialized", undefined)
        .pipe(
          Effect.mapError((cause) => toCodexSessionError("Initialize Codex app-server", cause)),
        );
      return yield* run(client, effectiveSettings);
    }),
  );

export const listCodexSessions = Effect.fn("listCodexSessions")(function* (
  input: CodexSessionListInput,
) {
  const instance = yield* resolveCodexInstance(input.providerInstanceId);
  const cwd = input.cwd && input.cwd.trim().length > 0 ? input.cwd : process.cwd();
  const response = yield* withCodexClient(instance, cwd, (client) =>
    client.request("thread/list", {
      limit: clampLimit(input.limit),
      sortKey: "updated_at",
      sortDirection: "desc",
      ...(input.allFolders === true ? {} : input.cwd ? { cwd: input.cwd } : {}),
      ...(input.searchTerm && input.searchTerm.trim().length > 0
        ? { searchTerm: input.searchTerm.trim() }
        : {}),
    }),
  ).pipe(Effect.mapError((cause) => toCodexSessionError("List Codex sessions", cause)));

  return {
    sessions: response.data.map(toSessionSummary),
    nextCursor: response.nextCursor ?? null,
  };
});

export const importCodexSession = Effect.fn("importCodexSession")(function* (
  input: CodexSessionImportInput,
) {
  const instance = yield* resolveCodexInstance(input.providerInstanceId);
  const path = yield* Path.Path;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const project = yield* projectionSnapshotQuery.getProjectShellById(input.projectId).pipe(
    Effect.map(Option.getOrUndefined),
    Effect.mapError((cause) => toCodexSessionError("Read target project", cause)),
  );
  if (!project) {
    return yield* new CodexSessionError({
      message: `Project '${input.projectId}' was not found.`,
    });
  }
  const targetCwd = project.workspaceRoot;
  const imported = yield* withCodexClient(instance, targetCwd, (client) =>
    Effect.gen(function* () {
      const readResponse = yield* client.request("thread/read", {
        threadId: input.providerThreadId,
        includeTurns: true,
      });
      const title = titleForThread(readResponse.thread, input.title);
      const providerThreadId = isSameCwd(path, readResponse.thread.cwd, targetCwd)
        ? input.providerThreadId
        : (yield* client.request(
            "thread/fork",
            buildCodexThreadForkParams({
              threadId: input.providerThreadId,
              cwd: targetCwd,
              runtimeMode: input.runtimeMode,
              model: input.modelSelection.model,
              serviceTier: serviceTierForModelSelection(input.modelSelection),
            }),
          )).thread.id;

      yield* client
        .request("thread/name/set", {
          threadId: providerThreadId,
          name: title,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to sync imported Codex thread name", {
              sourceProviderThreadId: input.providerThreadId,
              providerThreadId,
              title,
              cause: Cause.pretty(cause),
            }),
          ),
        );

      return {
        readResponse,
        providerThreadId,
        title,
      };
    }),
  ).pipe(Effect.mapError((cause) => toCodexSessionError("Read Codex session", cause)));

  const orchestration = yield* OrchestrationEngineService;
  const providerService = yield* ProviderService;
  const thread = imported.readResponse.thread;
  const threadId = ThreadId.make(crypto.randomUUID());
  const importId = crypto.randomUUID();
  const now = DateTime.formatIso(yield* DateTime.now);
  const createdAt = unixSecondsToIso(thread.createdAt, now);
  const title = imported.title;

  yield* orchestration
    .dispatch({
      type: "thread.create",
      commandId: CommandId.make(`codex-import-thread:${crypto.randomUUID()}`),
      threadId,
      projectId: input.projectId,
      title,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      branch: null,
      worktreePath: null,
      createdAt,
    })
    .pipe(Effect.mapError((cause) => toCodexSessionError("Create imported T3 thread", cause)));

  const importedMessages = importedMessagesFromCodexThread(thread, now);
  for (const [index, message] of importedMessages.entries()) {
    yield* orchestration
      .dispatch({
        type: "thread.message.import",
        commandId: CommandId.make(`codex-import-message:${crypto.randomUUID()}`),
        threadId,
        message: {
          messageId: MessageId.make(`codex-import:${importId}:${index}`),
          role: message.role,
          text: message.text,
          turnId: message.turnId,
          createdAt: message.createdAt,
        },
        createdAt: message.createdAt,
      })
      .pipe(Effect.mapError((cause) => toCodexSessionError("Import Codex messages", cause)));
  }

  const session = yield* providerService
    .startSession(threadId, {
      threadId,
      provider: CODEX,
      providerInstanceId: input.providerInstanceId,
      cwd: targetCwd,
      title,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      resumeCursor: { threadId: imported.providerThreadId },
    })
    .pipe(Effect.mapError((cause) => toCodexSessionError("Resume Codex session", cause)));
  const sessionUpdatedAt = DateTime.formatIso(yield* DateTime.now);
  yield* orchestration
    .dispatch({
      type: "thread.session.set",
      commandId: CommandId.make(`codex-import-session:${crypto.randomUUID()}`),
      threadId,
      session: {
        threadId,
        status:
          session.status === "running" ? "running" : session.status === "error" ? "error" : "ready",
        providerName: session.provider,
        ...(session.providerInstanceId ? { providerInstanceId: session.providerInstanceId } : {}),
        runtimeMode: input.runtimeMode,
        activeTurnId: session.activeTurnId ?? null,
        lastError: session.lastError ?? null,
        updatedAt: session.updatedAt ?? sessionUpdatedAt,
      },
      createdAt: sessionUpdatedAt,
    })
    .pipe(Effect.mapError((cause) => toCodexSessionError("Bind imported Codex session", cause)));

  return {
    threadId,
    providerThreadId: imported.providerThreadId,
    importedMessages: importedMessages.length,
  };
});
