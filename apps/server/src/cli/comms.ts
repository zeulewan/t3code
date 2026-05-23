import {
  CommsActor,
  CommsActorKind,
  CommsDeliveryStatus,
  CommsMessageType,
  CommandId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type CommsActorId,
  type CommsDelivery,
  type CommsMessageWithDelivery,
  type CommsMessageType as CommsMessageTypeValue,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { makeThreadCommsHandle } from "../commsHandles.ts";
import {
  readAutoCommsSenderEnv,
  T3_COMMS_HANDLE_ENV,
  T3_THREAD_ID_ENV,
} from "../commsEnvironment.ts";
import { projectLocationFlags } from "./config.ts";
import {
  OrchestrationCliError,
  runWithOrchestrationCli,
  type OrchestrationCliContext,
} from "./orchestrationCli.ts";

const DEFAULT_INBOX_LIMIT = 25;

const kindFlag = Flag.choice("kind", CommsActorKind.literals).pipe(
  Flag.withDescription("Actor kind."),
  Flag.withDefault("agent" as const),
);
const displayNameFlag = Flag.string("display-name").pipe(
  Flag.withDescription("Human-readable actor display name."),
  Flag.optional,
);
const threadFlag = Flag.string("thread").pipe(
  Flag.withDescription("Thread id/title attached to this actor."),
  Flag.optional,
);
const projectFlag = Flag.string("project").pipe(
  Flag.withDescription("Project id/title/workspace root attached to this actor."),
  Flag.optional,
);
const providerFlag = Flag.string("provider").pipe(
  Flag.withDescription("Provider instance id for this actor."),
  Flag.optional,
);
const modelFlag = Flag.string("model").pipe(
  Flag.withDescription("Model slug for this actor."),
  Flag.optional,
);
const messageTypeFlag = Flag.choice("type", CommsMessageType.literals).pipe(
  Flag.withDescription("Delivery behavior: direct, notify, or defer."),
  Flag.withDefault("direct" as const),
);
const noDeliverFlag = Flag.boolean("no-deliver").pipe(
  Flag.withDescription("Only write the inbox record; do not inject into live target threads."),
  Flag.withDefault(false),
);
const developerFromFlag = Flag.string("from").pipe(
  Flag.withDescription(
    "Developer-only sender override. Normal agent-to-agent comms must rely on autodetect.",
  ),
  Flag.optional,
);
const developerOverrideFlag = Flag.boolean("developer-override").pipe(
  Flag.withDescription("Required for developer-only comms sender override operations."),
  Flag.withDefault(false),
);
const statusFlag = Flag.choice("status", CommsDeliveryStatus.literals).pipe(
  Flag.withDescription("Optional delivery status filter."),
  Flag.optional,
);
const limitFlag = Flag.integer("limit").pipe(
  Flag.withDescription("Maximum rows to print."),
  Flag.withDefault(DEFAULT_INBOX_LIMIT),
);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const newCommandId = () => CommandId.make(crypto.randomUUID());
const newMessageId = () => MessageId.make(crypto.randomUUID());

function resolveThread(snapshot: OrchestrationReadModel, identifier: string): OrchestrationThread {
  const trimmed = identifier.trim();
  const thread = snapshot.threads.find(
    (entry) =>
      entry.deletedAt === null &&
      (entry.id === trimmed || entry.title.toLowerCase() === trimmed.toLowerCase()),
  );
  if (!thread) {
    throw new OrchestrationCliError({ message: `No active thread found for '${identifier}'.` });
  }
  return thread;
}

function resolveProjectId(snapshot: OrchestrationReadModel, identifier: string) {
  const trimmed = identifier.trim();
  const project = snapshot.projects.find(
    (entry) =>
      entry.deletedAt === null &&
      (entry.id === trimmed ||
        entry.workspaceRoot === trimmed ||
        entry.title.toLowerCase() === trimmed.toLowerCase()),
  );
  if (!project) {
    throw new OrchestrationCliError({ message: `No active project found for '${identifier}'.` });
  }
  return project.id;
}

const getActorByHandle = (context: OrchestrationCliContext, handle: string) =>
  Effect.gen(function* () {
    const normalizedHandle = handle.replace(/^@/, "").trim();
    const actor = yield* context.commsRepository.getActorByHandle({ handle: normalizedHandle });
    if (Option.isNone(actor)) {
      const inactiveThread = context.snapshot.threads.find(
        (thread) =>
          (thread.deletedAt !== null || thread.archivedAt !== null) &&
          makeThreadCommsHandle({ title: thread.title, threadId: thread.id }).toLowerCase() ===
            normalizedHandle.toLowerCase(),
      );
      if (inactiveThread) {
        const state = inactiveThread.deletedAt !== null ? "deleted" : "archived";
        return yield* new OrchestrationCliError({
          message: `Comms actor @${normalizedHandle} points to ${state} thread ${inactiveThread.id} (${inactiveThread.title}). Rename or unarchive the intended live thread before sending.`,
        });
      }
      return yield* new OrchestrationCliError({
        message: `No comms actor found for @${normalizedHandle}.`,
      });
    }
    return actor.value;
  });

const requireActiveActorThread = (
  context: OrchestrationCliContext,
  actor: CommsActor,
  role: "sender" | "recipient",
) =>
  Effect.gen(function* () {
    if (actor.status !== "active") {
      return yield* new OrchestrationCliError({
        message: `Cannot send comms with inactive ${role} @${actor.handle}.`,
      });
    }
    if (actor.kind !== "agent" || actor.threadId === null) {
      return;
    }

    const thread = context.snapshot.threads.find((entry) => entry.id === actor.threadId) ?? null;
    if (!thread) {
      return yield* new OrchestrationCliError({
        message: `Cannot send comms with ${role} @${actor.handle}: backing thread ${actor.threadId} is missing.`,
      });
    }
    if (thread.deletedAt !== null) {
      return yield* new OrchestrationCliError({
        message: `Cannot send comms with ${role} @${actor.handle}: backing thread ${actor.threadId} is deleted.`,
      });
    }
    if (thread.archivedAt !== null) {
      return yield* new OrchestrationCliError({
        message: `Cannot send comms with ${role} @${actor.handle}: backing thread ${actor.threadId} is archived.`,
      });
    }
  });

function inactiveThreadDeliveryError(threadId: string, thread: OrchestrationThread | null): string {
  if (!thread) return `Target thread ${threadId} is missing.`;
  if (thread.deletedAt !== null) return `Target thread ${threadId} is deleted.`;
  if (thread.archivedAt !== null) return `Target thread ${threadId} is archived.`;
  return `Target thread ${threadId} is unavailable.`;
}

function parseRecipientHandles(raw: string): ReadonlyArray<string> {
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter((entry) => entry.length > 0);
}

const getActorByThreadId = (context: OrchestrationCliContext, rawThreadId: string) =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(rawThreadId.trim());
    const actors = yield* context.commsRepository.listActors({
      projectId: null,
      includeInactive: false,
    });
    const actor = actors.find((entry) => entry.kind === "agent" && entry.threadId === threadId);
    if (actor) {
      return actor;
    }

    const thread = context.snapshot.threads.find((entry) => entry.id === threadId) ?? null;
    if (thread !== null && thread.deletedAt !== null) {
      return yield* new OrchestrationCliError({
        message: `Cannot autodetect comms sender from ${T3_THREAD_ID_ENV}: thread ${threadId} is deleted.`,
      });
    }
    if (thread !== null && thread.archivedAt !== null) {
      return yield* new OrchestrationCliError({
        message: `Cannot autodetect comms sender from ${T3_THREAD_ID_ENV}: thread ${threadId} is archived.`,
      });
    }
    return yield* new OrchestrationCliError({
      message: `Cannot autodetect comms sender from ${T3_THREAD_ID_ENV}: no active comms actor is registered for thread ${threadId}.`,
    });
  });

const detectSenderActor = (context: OrchestrationCliContext) =>
  Effect.gen(function* () {
    const detected = readAutoCommsSenderEnv();
    if (detected.threadId) {
      return yield* getActorByThreadId(context, detected.threadId);
    }
    if (detected.handle) {
      return yield* getActorByHandle(context, detected.handle.replace(/^@/, ""));
    }
    return yield* new OrchestrationCliError({
      message: `Cannot autodetect comms sender. Run this from an agent session with ${T3_THREAD_ID_ENV} set, set ${T3_COMMS_HANDLE_ENV}, or use the developer override: comms send --from <handle> --developer-override <target-handle> '<message>'.`,
    });
  });

interface CommsSendInput {
  readonly target: string;
  readonly message: string;
}

function parseCommsSendArgs(parts: ReadonlyArray<string>): CommsSendInput | null {
  if (parts.length === 2) {
    return {
      target: parts[0] ?? "",
      message: parts[1] ?? "",
    };
  }
  return null;
}

function formatActors(actors: ReadonlyArray<CommsActor>): string {
  if (actors.length === 0) return "No comms actors registered.";
  const lines = ["HANDLE\tKIND\tTHREAD\tPROJECT\tMODEL\tSTATUS"];
  for (const actor of actors) {
    lines.push(
      [
        `@${actor.handle}`,
        actor.kind,
        actor.threadId ?? "",
        actor.projectId ?? "",
        actor.model ?? "",
        actor.status,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function formatInbox(items: ReadonlyArray<CommsMessageWithDelivery>): string {
  if (items.length === 0) return "Inbox is empty.";
  const lines = ["CREATED\tSTATUS\tTYPE\tFROM\tMESSAGE"];
  for (const item of items) {
    lines.push(
      [
        item.message.createdAt,
        item.delivery.status,
        item.message.messageType,
        `@${item.sender.handle}`,
        item.message.body.replace(/\s+/g, " ").slice(0, 180),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function deliveryPrompt(input: {
  readonly sender: CommsActor;
  readonly recipient: CommsActor;
  readonly messageType: CommsMessageTypeValue;
  readonly body: string;
}): string {
  if (input.messageType === "notify") {
    return `T3 comms notify from @${input.sender.handle}: you have a new inbox message. Run \`t3 comms inbox ${input.recipient.handle}\` when you want to read it.`;
  }
  return `T3 comms direct from @${input.sender.handle}:\n\n${input.body}`;
}

function senderEchoPrompt(input: {
  readonly recipients: ReadonlyArray<CommsActor>;
  readonly messageType: CommsMessageTypeValue;
  readonly body: string;
}): string {
  const recipientList = input.recipients.map((recipient) => `@${recipient.handle}`).join(", ");
  return `T3 comms ${input.messageType} to ${recipientList}:\n\n${input.body}`;
}

const echoToSenderThread = (
  context: OrchestrationCliContext,
  input: {
    readonly sender: CommsActor;
    readonly recipients: ReadonlyArray<CommsActor>;
    readonly messageType: CommsMessageTypeValue;
    readonly body: string;
  },
) =>
  Effect.gen(function* () {
    if (
      context.mode !== "live" ||
      input.sender.kind !== "agent" ||
      input.sender.threadId === null
    ) {
      return false;
    }

    const thread =
      context.snapshot.threads.find((entry) => entry.id === input.sender.threadId) ?? null;
    if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
      return false;
    }

    const createdAt = yield* nowIso;
    yield* context.dispatch({
      type: "thread.message.import",
      commandId: newCommandId(),
      threadId: input.sender.threadId,
      message: {
        messageId: newMessageId(),
        role: "assistant",
        text: senderEchoPrompt(input),
        turnId: null,
        createdAt,
      },
      createdAt,
    });
    return true;
  });

const deliverToThreads = (
  context: OrchestrationCliContext,
  input: {
    readonly sender: CommsActor;
    readonly recipientsById: ReadonlyMap<CommsActorId, CommsActor>;
    readonly deliveries: ReadonlyArray<CommsDelivery>;
    readonly messageType: CommsMessageTypeValue;
    readonly body: string;
  },
) =>
  Effect.gen(function* () {
    if (context.mode !== "live") {
      return {
        attempted: 0,
        delivered: 0,
        failed: 0,
        skipped: input.deliveries.length,
        deliveredRecipientIds: [] as CommsActorId[],
      };
    }

    let attempted = 0;
    let delivered = 0;
    let failed = 0;
    let skipped = 0;
    const deliveredRecipientIds: CommsActorId[] = [];

    for (const delivery of input.deliveries) {
      const recipient = input.recipientsById.get(delivery.recipientActorId);
      const threadId = delivery.targetThreadId;
      if (!recipient || threadId === null) {
        skipped += 1;
        continue;
      }
      const thread = context.snapshot.threads.find((entry) => entry.id === threadId) ?? null;
      if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
        failed += 1;
        yield* context.commsRepository.setDeliveryStatus({
          deliveryId: delivery.deliveryId,
          status: "failed",
          error: inactiveThreadDeliveryError(threadId, thread),
        });
        continue;
      }

      attempted += 1;
      const result = yield* Effect.exit(
        context.dispatch({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: deliveryPrompt({
              sender: input.sender,
              recipient,
              messageType: input.messageType,
              body: input.body,
            }),
            attachments: [],
          },
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          createdAt: yield* nowIso,
        }),
      );

      if (result._tag === "Success") {
        delivered += 1;
        deliveredRecipientIds.push(delivery.recipientActorId);
        yield* context.commsRepository.setDeliveryStatus({
          deliveryId: delivery.deliveryId,
          status: "delivered",
        });
      } else {
        failed += 1;
        yield* context.commsRepository.setDeliveryStatus({
          deliveryId: delivery.deliveryId,
          status: "failed",
          error: "Failed to inject into target thread.",
        });
      }
    }

    return { attempted, delivered, failed, skipped, deliveredRecipientIds };
  });

const commsRegisterCommand = Command.make("register", {
  ...projectLocationFlags,
  handle: Argument.string("handle").pipe(Argument.withDescription("Unique actor handle.")),
  kind: kindFlag,
  displayName: displayNameFlag,
  thread: threadFlag,
  project: projectFlag,
  provider: providerFlag,
  model: modelFlag,
}).pipe(
  Command.withDescription("Register or update a local comms actor."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const maybeThread = Option.isSome(flags.thread)
          ? resolveThread(context.snapshot, flags.thread.value)
          : null;
        const actor = yield* context.commsRepository.upsertActor({
          kind: flags.kind,
          handle: flags.handle.replace(/^@/, ""),
          displayName: Option.getOrUndefined(flags.displayName) ?? flags.handle.replace(/^@/, ""),
          projectId:
            maybeThread?.projectId ??
            (Option.isSome(flags.project)
              ? resolveProjectId(context.snapshot, flags.project.value)
              : null),
          threadId: maybeThread?.id ?? null,
          providerInstanceId: Option.isSome(flags.provider)
            ? ProviderInstanceId.make(flags.provider.value)
            : (maybeThread?.modelSelection.instanceId ?? null),
          model: Option.getOrUndefined(flags.model) ?? maybeThread?.modelSelection.model ?? null,
        });
        return `Registered @${actor.handle} (${actor.kind}).`;
      }),
    ),
  ),
);

const commsActorsCommand = Command.make("actors", {
  ...projectLocationFlags,
  project: projectFlag,
}).pipe(
  Command.withDescription("List registered comms actors."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const actors = yield* context.commsRepository.listActors({
          projectId: Option.isSome(flags.project)
            ? resolveProjectId(context.snapshot, flags.project.value)
            : null,
          includeInactive: false,
        });
        return formatActors(actors);
      }),
    ),
  ),
);

const commsSendCommand = Command.make("send", {
  ...projectLocationFlags,
  args: Argument.string("target-message").pipe(
    Argument.withDescription(
      "<target-handle> <message>. Do not include a sender; use --from <handle> --developer-override only for developer overrides.",
    ),
    Argument.between(2, Number.MAX_SAFE_INTEGER),
  ),
  from: developerFromFlag,
  developerOverride: developerOverrideFlag,
  type: messageTypeFlag,
  noDeliver: noDeliverFlag,
}).pipe(
  Command.withDescription("Send an actor-to-actor message."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const input = parseCommsSendArgs(flags.args);
        if (input === null) {
          return yield* new OrchestrationCliError({
            message:
              "Usage: comms send <target-handle> '<message>'. Do not pass a positional sender; developer sender override requires --from <handle> --developer-override.",
          });
        }
        if (Option.isSome(flags.from) && !flags.developerOverride) {
          return yield* new OrchestrationCliError({
            message:
              "Developer sender override requires --developer-override. Normal agent usage is: comms send <target-handle> '<message>'.",
          });
        }
        const sender = Option.isSome(flags.from)
          ? yield* getActorByHandle(context, flags.from.value.replace(/^@/, ""))
          : yield* detectSenderActor(context);
        yield* requireActiveActorThread(context, sender, "sender");
        const recipientHandles = parseRecipientHandles(input.target);
        if (recipientHandles.length === 0) {
          return yield* new OrchestrationCliError({
            message: "At least one recipient is required.",
          });
        }

        const recipients = yield* Effect.all(
          recipientHandles.map((handle) => getActorByHandle(context, handle)),
        );
        yield* Effect.all(
          recipients.map((recipient) => requireActiveActorThread(context, recipient, "recipient")),
          { concurrency: 1 },
        );
        const [firstRecipient, ...restRecipients] = recipients.map((actor) => actor.actorId);
        if (!firstRecipient) {
          return yield* new OrchestrationCliError({
            message: "At least one recipient is required.",
          });
        }

        const shouldDeliver = !flags.noDeliver && flags.type !== "defer";
        if (shouldDeliver && context.mode !== "live") {
          return yield* new OrchestrationCliError({
            message: `Comms ${flags.type} delivery requires a running T3 server. Start T3, or use --no-deliver/--type defer to only write inbox records.`,
          });
        }

        const sent = yield* context.commsRepository.sendMessage({
          senderActorId: sender.actorId,
          recipientActorIds: [firstRecipient, ...restRecipients],
          messageType: flags.type,
          body: input.message,
          projectId: sender.projectId,
          metadata: {
            source: "t3 comms send",
          },
        });

        const deliveryResult = shouldDeliver
          ? yield* deliverToThreads(context, {
              sender,
              recipientsById: new Map(recipients.map((actor) => [actor.actorId, actor] as const)),
              deliveries: sent.deliveries,
              messageType: flags.type,
              body: input.message,
            })
          : {
              attempted: 0,
              delivered: 0,
              failed: 0,
              skipped: sent.deliveries.length,
              deliveredRecipientIds: [] as CommsActorId[],
            };
        const deliveredRecipients = recipients.filter((recipient) =>
          deliveryResult.deliveredRecipientIds.includes(recipient.actorId),
        );
        if (deliveredRecipients.length > 0) {
          yield* echoToSenderThread(context, {
            sender,
            recipients: deliveredRecipients,
            messageType: flags.type,
            body: input.message,
          });
        }

        return [
          `Sent ${flags.type} message ${sent.message.messageId} to ${sent.deliveries.length} recipient(s).`,
          `Delivery: ${deliveryResult.delivered} delivered, ${deliveryResult.failed} failed, ${deliveryResult.skipped} pending/skipped.`,
        ].join("\n");
      }),
    ),
  ),
);

const commsInboxCommand = Command.make("inbox", {
  ...projectLocationFlags,
  actor: Argument.string("actor").pipe(Argument.withDescription("Actor handle.")),
  status: statusFlag,
  limit: limitFlag,
}).pipe(
  Command.withDescription("Read an actor inbox."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const actor = yield* getActorByHandle(context, flags.actor.replace(/^@/, ""));
        const status = Option.getOrUndefined(flags.status);
        const items = yield* context.commsRepository.listInbox({
          actorId: actor.actorId,
          ...(status ? { statuses: [status] } : {}),
          limit: Math.max(1, flags.limit),
        });
        return formatInbox(items);
      }),
    ),
  ),
);

export const commsCommand = Command.make("comms").pipe(
  Command.withDescription("Local actor-to-actor messaging tools."),
  Command.withSubcommands([
    commsRegisterCommand,
    commsActorsCommand,
    commsSendCommand,
    commsInboxCommand,
  ]),
);
