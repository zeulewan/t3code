import {
  ClientOrchestrationCommand,
  type OrchestrationCommand,
  OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { GlobalFlag } from "effect/unstable/cli";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { AuthControlPlaneRuntimeLive } from "../auth/Layers/AuthControlPlane.ts";
import { AuthControlPlane } from "../auth/Services/AuthControlPlane.ts";
import type { AuthControlPlaneShape } from "../auth/Services/AuthControlPlane.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { CommsRepositoryLive } from "../persistence/Layers/Comms.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { CommsRepository, type CommsRepositoryShape } from "../persistence/Services/Comms.ts";
import { RepositoryIdentityResolverLive } from "../project/Layers/RepositoryIdentityResolver.ts";
import {
  clearPersistedServerRuntimeState,
  readPersistedServerRuntimeState,
} from "../serverRuntimeState.ts";
import { WorkspacePathsLive } from "../workspace/Layers/WorkspacePaths.ts";
import { type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

export type OrchestrationCliMode = "live" | "offline";

export class OrchestrationCliError extends Data.TaggedError("OrchestrationCliError")<{
  readonly message: string;
}> {}

export interface OrchestrationCliContext {
  readonly mode: OrchestrationCliMode;
  readonly baseDir: string;
  readonly devUrl: URL | undefined;
  readonly snapshot: OrchestrationReadModel;
  readonly commsRepository: CommsRepositoryShape;
  readonly dispatch: (
    command: ClientOrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, Error>;
}

const OrchestrationCliRuntimeLive = Layer.mergeAll(
  CommsRepositoryLive,
  OrchestrationLayerLive.pipe(Layer.provideMerge(RepositoryIdentityResolverLive)),
).pipe(Layer.provideMerge(SqlitePersistenceLayerLive));

const OrchestrationHttpErrorResponse = Schema.Struct({
  error: Schema.String,
});

const decodeOrchestrationReadModelResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationReadModel)(response);

const decodeDispatchResultResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(Schema.Struct({ sequence: Schema.Number }))(response);

const readErrorMessageFromResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.schemaBodyJson(OrchestrationHttpErrorResponse)(response).pipe(
    Effect.map((body) => body.error),
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((body) => {
      if (typeof body === "string" && body.trim().length > 0) {
        return body;
      }
      return `Server request failed with status ${response.status}.`;
    }),
  );

const runLiveServerRequest = <A, E extends Error, R>(
  request: HttpClientRequest.HttpClientRequest,
  handle: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* httpClient.execute(request);
    return yield* handle(response);
  });

const withCliSessionToken = <A, E, R>(
  authControlPlane: AuthControlPlaneShape,
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    authControlPlane.issueSession({
      role: "owner",
      label: "t3 cli",
    }),
    (issued) => run(issued.token),
    (issued) => authControlPlane.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const fetchLiveOrchestrationSnapshot = (origin: string, bearerToken: string) =>
  runLiveServerRequest(
    HttpClientRequest.get(`${origin}/api/orchestration/snapshot`).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.bearerToken(bearerToken),
    ),
    HttpClientResponse.matchStatus({
      "2xx": decodeOrchestrationReadModelResponse,
      orElse: (failedResponse) =>
        readErrorMessageFromResponse(failedResponse).pipe(
          Effect.flatMap((message) => Effect.fail(new OrchestrationCliError({ message }))),
        ),
    }),
  );

const dispatchLiveOrchestrationCommand = (
  origin: string,
  bearerToken: string,
  command: ClientOrchestrationCommand,
) =>
  HttpClientRequest.post(`${origin}/api/orchestration/dispatch`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(bearerToken),
    HttpClientRequest.bodyJson(command),
    Effect.flatMap((request) =>
      runLiveServerRequest(
        request,
        HttpClientResponse.matchStatus({
          "2xx": decodeDispatchResultResponse,
          orElse: (failedResponse) =>
            readErrorMessageFromResponse(failedResponse).pipe(
              Effect.flatMap((message) => Effect.fail(new OrchestrationCliError({ message }))),
            ),
        }),
      ),
    ),
  );

const tryResolveLiveServer = (
  authControlPlane: AuthControlPlaneShape,
  serverRuntimeStatePath: string,
) =>
  Effect.gen(function* () {
    const runtimeState = yield* readPersistedServerRuntimeState(serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) {
      return Option.none<{ readonly origin: string }>();
    }

    const attempt = withCliSessionToken(authControlPlane, (token) =>
      fetchLiveOrchestrationSnapshot(runtimeState.value.origin, token).pipe(
        Effect.as({
          origin: runtimeState.value.origin,
        }),
      ),
    );

    const attempted = yield* Effect.exit(attempt);
    if (Exit.isSuccess(attempted)) {
      return Option.some(attempted.value);
    }

    yield* clearPersistedServerRuntimeState(serverRuntimeStatePath);
    return Option.none<{ readonly origin: string }>();
  });

export const runWithOrchestrationCli = (
  flags: CliAuthLocationFlags,
  run: (context: OrchestrationCliContext) => Effect.Effect<string, Error>,
) =>
  Effect.gen(function* () {
    const logLevel = yield* GlobalFlag.LogLevel;
    const config = yield* resolveCliAuthConfig(flags, logLevel);
    const minimumLogLevel = config.logLevel;

    const runtimeLayer = Layer.mergeAll(
      AuthControlPlaneRuntimeLive,
      OrchestrationCliRuntimeLive,
      WorkspacePathsLive,
      FetchHttpClient.layer,
    ).pipe(
      Layer.provide(Layer.succeed(ServerConfig, config)),
      Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
    );

    return yield* Effect.gen(function* () {
      const authControlPlane = yield* AuthControlPlane;
      const commsRepository = yield* CommsRepository;
      const liveMode = yield* tryResolveLiveServer(authControlPlane, config.serverRuntimeStatePath);

      if (Option.isSome(liveMode)) {
        const httpClient = yield* HttpClient.HttpClient;
        return yield* withCliSessionToken(authControlPlane, (token) =>
          Effect.gen(function* () {
            const snapshot = yield* fetchLiveOrchestrationSnapshot(liveMode.value.origin, token);
            const output = yield* run({
              mode: "live",
              baseDir: config.baseDir,
              devUrl: config.devUrl,
              snapshot,
              commsRepository,
              dispatch: (command) =>
                dispatchLiveOrchestrationCommand(liveMode.value.origin, token, command).pipe(
                  Effect.provideService(HttpClient.HttpClient, httpClient),
                ),
            });
            yield* Console.log(output);
          }),
        );
      }

      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const snapshot = yield* projectionSnapshotQuery.getSnapshot();
      const output = yield* run({
        mode: "offline",
        baseDir: config.baseDir,
        devUrl: config.devUrl,
        snapshot,
        commsRepository,
        dispatch: (command) => orchestrationEngine.dispatch(command as OrchestrationCommand),
      });
      yield* Console.log(output);
    }).pipe(Effect.provide(runtimeLayer));
  });

export const requireLiveServer = (mode: OrchestrationCliMode, action: string) =>
  mode === "live"
    ? Effect.void
    : Effect.fail(
        new OrchestrationCliError({
          message: `${action} requires a running T3 server. Start it with \`t3 serve\` or \`t3 start\`.`,
        }),
      );
