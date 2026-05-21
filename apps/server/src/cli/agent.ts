import {
  CommandId,
  MessageId,
  ModelSelection,
  ProviderInstanceId,
  ProviderInteractionMode,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  RuntimeMode,
  ThreadId,
  type UploadChatAttachment,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import Mime from "@effect/platform-node/Mime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { makeThreadCommsHandle } from "../commsHandles.ts";
import {
  isSupportedProviderImageInputMimeType,
  supportedProviderImageInputMimeTypesLabel,
} from "../provider/imageAttachmentSupport.ts";
import { projectLocationFlags } from "./config.ts";
import {
  OrchestrationCliError,
  requireLiveServer,
  runWithOrchestrationCli,
  type OrchestrationCliContext,
} from "./orchestrationCli.ts";

const DEFAULT_AGENT_PROVIDER = "codex";
const DEFAULT_AGENT_MODEL = "gpt-5.4";
const DEFAULT_AGENT_EFFORT = "low";

const providerFlag = Flag.string("provider").pipe(
  Flag.withDescription("Provider instance id to use."),
  Flag.withDefault(DEFAULT_AGENT_PROVIDER),
);
const optionalProviderFlag = Flag.string("provider").pipe(
  Flag.withDescription("Provider instance id override."),
  Flag.optional,
);
const modelFlag = Flag.string("model").pipe(
  Flag.withDescription("Model slug to use."),
  Flag.withDefault(DEFAULT_AGENT_MODEL),
);
const optionalModelFlag = Flag.string("model").pipe(
  Flag.withDescription("Model slug override."),
  Flag.optional,
);
const effortFlag = Flag.string("effort").pipe(
  Flag.withDescription("Reasoning effort provider option."),
  Flag.withDefault(DEFAULT_AGENT_EFFORT),
);
const optionalEffortFlag = Flag.string("effort").pipe(
  Flag.withDescription("Reasoning effort override."),
  Flag.optional,
);
const handleFlag = Flag.string("handle").pipe(
  Flag.withDescription("Comms handle to register for the spawned agent."),
  Flag.optional,
);
const projectFilterFlag = Flag.string("project").pipe(
  Flag.withDescription("Optional project id, title, or workspace root filter."),
  Flag.optional,
);
const runtimeModeFlag = Flag.choice("runtime-mode", RuntimeMode.literals).pipe(
  Flag.withDescription("Runtime mode for the provider session."),
  Flag.withDefault("full-access" as const),
);
const interactionModeFlag = Flag.choice("interaction-mode", ProviderInteractionMode.literals).pipe(
  Flag.withDescription("Interaction mode for the provider session."),
  Flag.withDefault("default" as const),
);
const attachFlag = Flag.string("attach").pipe(
  Flag.withDescription("Image file to attach to the turn. Repeat for multiple images."),
  Flag.between(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const newCommandId = () => CommandId.make(crypto.randomUUID());
const newMessageId = () => MessageId.make(crypto.randomUUID());
const newThreadId = () => ThreadId.make(crypto.randomUUID());

function modelSelection(input: {
  readonly provider: string;
  readonly model: string;
  readonly effort?: string | undefined;
}): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make(input.provider),
    model: input.model,
    ...(input.effort
      ? {
          options: [
            {
              id: "reasoningEffort",
              value: input.effort,
            },
          ],
        }
      : {}),
  };
}

function resolveProject(
  snapshot: OrchestrationReadModel,
  identifier: string,
): OrchestrationProject {
  const trimmed = identifier.trim();
  const activeProjects = snapshot.projects.filter((project) => project.deletedAt === null);
  const project = activeProjects.find(
    (entry) =>
      entry.id === trimmed ||
      entry.workspaceRoot === trimmed ||
      entry.title.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!project) {
    throw new OrchestrationCliError({ message: `No active project found for '${identifier}'.` });
  }
  return project;
}

function resolveThreadFromSnapshot(
  snapshot: OrchestrationReadModel,
  identifier: string,
): OrchestrationThread | null {
  const trimmed = identifier.trim();
  return (
    snapshot.threads.find(
      (entry) =>
        entry.deletedAt === null &&
        (entry.id === trimmed || entry.title.toLowerCase() === trimmed.toLowerCase()),
    ) ?? null
  );
}

const resolveThread = (context: OrchestrationCliContext, identifier: string) =>
  Effect.gen(function* () {
    const directThread = resolveThreadFromSnapshot(context.snapshot, identifier);
    if (directThread) {
      return directThread;
    }

    const handle = identifier.trim().replace(/^@/, "");
    const actor = yield* context.commsRepository.getActorByHandle({ handle });
    if (Option.isSome(actor) && actor.value.threadId !== null) {
      const actorThread = context.snapshot.threads.find(
        (entry) => entry.deletedAt === null && entry.id === actor.value.threadId,
      );
      if (actorThread) {
        return actorThread;
      }
    }

    return yield* new OrchestrationCliError({
      message: `No active thread or comms actor found for '${identifier}'.`,
    });
  });

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cliCommandPrefix(): string {
  const scriptPath = process.argv[1] ?? "t3";
  return `${shellQuote(process.execPath)} ${shellQuote(scriptPath)}`;
}

function commsSendInstruction(input: {
  readonly context: OrchestrationCliContext;
  readonly handle: string;
}): string {
  const devUrlPart = input.context.devUrl
    ? ` --dev-url ${shellQuote(input.context.devUrl.href)}`
    : "";
  return [
    cliCommandPrefix(),
    "--log-level error comms send",
    input.handle,
    "<target-handle>",
    "'<message>'",
    "--base-dir",
    shellQuote(input.context.baseDir),
    devUrlPart.trim(),
    "--type direct",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

function withAgentCommsInstructions(input: {
  readonly message: string;
  readonly context: OrchestrationCliContext;
  readonly handle: string;
}): string {
  return [
    input.message.trim(),
    "",
    "T3 agent comms:",
    `- You are registered as @${input.handle}.`,
    "- When asked to message another agent, run the comms CLI instead of saying you cannot message them.",
    `- Command template: ${commsSendInstruction({
      context: input.context,
      handle: input.handle,
    })}`,
    "- Handles are written without the @ in the command, for example: bob or joe.",
  ].join("\n");
}

function withModelOverride(
  thread: OrchestrationThread,
  input: {
    readonly provider?: string | undefined;
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
  },
): ModelSelection {
  return modelSelection({
    provider: input.provider ?? thread.modelSelection.instanceId,
    model: input.model ?? thread.modelSelection.model,
    effort: input.effort,
  });
}

const readAttachmentFile = (rawPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.resolve(rawPath);
    const name = path.basename(filePath);
    const mimeType = (Mime.getType(filePath) ?? "").toLowerCase();
    if (!mimeType.startsWith("image/")) {
      return yield* new OrchestrationCliError({
        message: `Only image attachments are supported by agent attachment commands. '${rawPath}' resolved to '${mimeType || "unknown"}'.`,
      });
    }
    if (!isSupportedProviderImageInputMimeType(mimeType)) {
      return yield* new OrchestrationCliError({
        message: `Unsupported image attachment type '${mimeType}'. Supported image types: ${supportedProviderImageInputMimeTypesLabel()}.`,
      });
    }

    const bytes = yield* fileSystem.readFile(filePath).pipe(
      Effect.mapError(
        (error) =>
          new OrchestrationCliError({
            message: `Could not read attachment '${rawPath}': ${String(error.message)}`,
          }),
      ),
    );
    if (bytes.byteLength === 0) {
      return yield* new OrchestrationCliError({
        message: `Attachment '${rawPath}' is empty.`,
      });
    }
    if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return yield* new OrchestrationCliError({
        message: `Attachment '${rawPath}' is ${bytes.byteLength} bytes, which exceeds the ${PROVIDER_SEND_TURN_MAX_IMAGE_BYTES} byte image limit.`,
      });
    }

    return {
      type: "image",
      name,
      mimeType,
      sizeBytes: bytes.byteLength,
      dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    } satisfies UploadChatAttachment;
  });

const readAttachmentFiles = (
  attachmentPaths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<UploadChatAttachment>, OrchestrationCliError> =>
  Effect.forEach(attachmentPaths, readAttachmentFile, { concurrency: 1 }).pipe(
    Effect.provide(NodeServices.layer),
  );

function formatAgentList(snapshot: OrchestrationReadModel, projectFilter?: string): string {
  const project =
    projectFilter && projectFilter.trim().length > 0
      ? resolveProject(snapshot, projectFilter)
      : null;
  const threads = snapshot.threads
    .filter(
      (entry) =>
        entry.deletedAt === null &&
        entry.archivedAt === null &&
        (project === null || entry.projectId === project.id),
    )
    .toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt));

  if (threads.length === 0) {
    return "No active agents/threads found.";
  }

  const lines = ["THREAD\tPROJECT\tMODEL\tSTATUS\tTITLE"];
  for (const thread of threads) {
    const status = thread.session?.status ?? "idle";
    lines.push(
      [
        thread.id,
        thread.projectId,
        `${thread.modelSelection.instanceId}/${thread.modelSelection.model}`,
        status,
        thread.title,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

const agentListCommand = Command.make("list", {
  ...projectLocationFlags,
  project: projectFilterFlag,
}).pipe(
  Command.withDescription("List active agent threads."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, ({ snapshot }) =>
      Effect.succeed(formatAgentList(snapshot, Option.getOrUndefined(flags.project))),
    ),
  ),
);

const agentSpawnCommand = Command.make("spawn", {
  ...projectLocationFlags,
  project: Argument.string("project").pipe(
    Argument.withDescription("Project id, title, or workspace root."),
  ),
  name: Argument.string("name").pipe(Argument.withDescription("Agent/thread display name.")),
  message: Argument.string("message").pipe(Argument.withDescription("Initial prompt.")),
  provider: providerFlag,
  model: modelFlag,
  effort: effortFlag,
  handle: handleFlag,
  runtimeMode: runtimeModeFlag,
  interactionMode: interactionModeFlag,
}).pipe(
  Command.withDescription("Create a thread, start its first turn, and register a comms actor."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        yield* requireLiveServer(context.mode, "Agent spawn");
        const project = resolveProject(context.snapshot, flags.project);
        const createdAt = yield* nowIso;
        const threadId = newThreadId();
        const selection = modelSelection({
          provider: flags.provider,
          model: flags.model,
          effort: flags.effort,
        });
        const handle = makeThreadCommsHandle({ title: flags.name, threadId });
        const requestedHandle = Option.getOrUndefined(flags.handle);
        if (requestedHandle !== undefined && requestedHandle !== handle) {
          return yield* new OrchestrationCliError({
            message:
              "Custom agent handles are no longer supported. Rename the thread to change its comms handle.",
          });
        }
        const initialMessage = withAgentCommsInstructions({
          message: flags.message,
          context,
          handle,
        });

        yield* context.dispatch({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: project.id,
          title: flags.name,
          modelSelection: selection,
          runtimeMode: flags.runtimeMode,
          interactionMode: flags.interactionMode,
          branch: null,
          worktreePath: null,
          createdAt,
        });

        yield* context.dispatch({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: initialMessage,
            attachments: [],
          },
          modelSelection: selection,
          runtimeMode: flags.runtimeMode,
          interactionMode: flags.interactionMode,
          createdAt,
        });

        const actor = yield* context.commsRepository.upsertActor({
          kind: "agent",
          handle,
          displayName: flags.name,
          projectId: project.id,
          threadId,
          providerInstanceId: selection.instanceId,
          model: selection.model,
          metadata: {
            source: "t3 agent spawn",
          },
        });

        return `Spawned ${actor.handle} as thread ${threadId}.`;
      }),
    ),
  ),
);

const agentSendCommand = Command.make("send", {
  ...projectLocationFlags,
  thread: Argument.string("thread").pipe(Argument.withDescription("Thread id or title.")),
  message: Argument.string("message").pipe(Argument.withDescription("Message to send.")),
  provider: optionalProviderFlag,
  model: optionalModelFlag,
  effort: optionalEffortFlag,
  attach: attachFlag,
}).pipe(
  Command.withDescription("Send a user turn to an existing agent thread."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        yield* requireLiveServer(context.mode, "Agent send");
        const thread = yield* resolveThread(context, flags.thread);
        const attachments = yield* readAttachmentFiles(flags.attach);
        const createdAt = yield* nowIso;
        const provider = Option.getOrUndefined(flags.provider);
        const model = Option.getOrUndefined(flags.model);
        const effort = Option.getOrUndefined(flags.effort);
        const selection =
          provider || model || effort
            ? withModelOverride(thread, { provider, model, effort })
            : undefined;

        yield* context.dispatch({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: thread.id,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: flags.message,
            attachments,
          },
          ...(selection ? { modelSelection: selection } : {}),
          titleSeed: thread.title,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          createdAt,
        });

        return attachments.length === 0
          ? `Sent turn to ${thread.id}.`
          : `Sent turn to ${thread.id} with ${attachments.length} attachment(s).`;
      }),
    ),
  ),
);

const agentPostCommand = Command.make("post", {
  ...projectLocationFlags,
  thread: Argument.string("thread").pipe(Argument.withDescription("Thread id or title.")),
  message: Argument.string("message").pipe(
    Argument.withDescription("Assistant-authored message to post."),
  ),
  attach: attachFlag,
}).pipe(
  Command.withDescription("Post an assistant-authored message to an existing agent thread."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        yield* requireLiveServer(context.mode, "Agent post");
        const thread = yield* resolveThread(context, flags.thread);
        const attachments = yield* readAttachmentFiles(flags.attach);
        const createdAt = yield* nowIso;

        yield* context.dispatch({
          type: "thread.message.import",
          commandId: newCommandId(),
          threadId: thread.id,
          message: {
            messageId: newMessageId(),
            role: "assistant",
            text: flags.message,
            ...(attachments.length > 0 ? { attachments } : {}),
            turnId: null,
            createdAt,
          },
          createdAt,
        });

        return attachments.length === 0
          ? `Posted assistant message to ${thread.id}.`
          : `Posted assistant message to ${thread.id} with ${attachments.length} attachment(s).`;
      }),
    ),
  ),
);

const agentStopCommand = Command.make("stop", {
  ...projectLocationFlags,
  thread: Argument.string("thread").pipe(Argument.withDescription("Thread id or title.")),
}).pipe(
  Command.withDescription("Stop an agent provider session."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        yield* requireLiveServer(context.mode, "Agent stop");
        const thread = yield* resolveThread(context, flags.thread);
        yield* context.dispatch({
          type: "thread.session.stop",
          commandId: newCommandId(),
          threadId: thread.id,
          createdAt: yield* nowIso,
        });
        return `Stopped session for ${thread.id}.`;
      }),
    ),
  ),
);

const agentRenameCommand = Command.make("rename", {
  ...projectLocationFlags,
  thread: Argument.string("thread").pipe(
    Argument.withDescription("Thread id, title, or comms handle."),
  ),
  title: Argument.string("title").pipe(Argument.withDescription("New thread display name.")),
}).pipe(
  Command.withDescription("Rename an agent thread."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        yield* requireLiveServer(context.mode, "Agent rename");
        const thread = yield* resolveThread(context, flags.thread);
        yield* context.dispatch({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          title: flags.title,
        });
        return `Renamed ${thread.id} to ${flags.title}.`;
      }),
    ),
  ),
);

const agentModelCommand = Command.make("model", {
  ...projectLocationFlags,
  thread: Argument.string("thread").pipe(Argument.withDescription("Thread id or title.")),
  provider: providerFlag,
  model: modelFlag,
  effort: optionalEffortFlag,
}).pipe(
  Command.withDescription("Update the model selection stored on a thread."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const thread = yield* resolveThread(context, flags.thread);
        const selection = modelSelection({
          provider: flags.provider,
          model: flags.model,
          effort: Option.getOrUndefined(flags.effort),
        });
        yield* context.dispatch({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          modelSelection: selection,
        });
        yield* context.commsRepository.upsertActor({
          kind: "agent",
          handle: makeThreadCommsHandle({ title: thread.title, threadId: thread.id }),
          displayName: thread.title,
          projectId: thread.projectId,
          threadId: thread.id,
          providerInstanceId: selection.instanceId,
          model: selection.model,
        });
        return `Updated ${thread.id} model to ${selection.instanceId}/${selection.model}.`;
      }),
    ),
  ),
);

export const agentCommand = Command.make("agent").pipe(
  Command.withDescription("Developer tools for agent threads."),
  Command.withSubcommands([
    agentListCommand,
    agentSpawnCommand,
    agentSendCommand,
    agentPostCommand,
    agentStopCommand,
    agentRenameCommand,
    agentModelCommand,
  ]),
);
