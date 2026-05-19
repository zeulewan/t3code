import {
  CommsActor,
  CommsActorKind,
  CommsDeliveryStatus,
  CommsMessageType,
  CommandId,
  MessageId,
  ProviderInstanceId,
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
    const actor = yield* context.commsRepository.getActorByHandle({ handle });
    if (Option.isNone(actor)) {
      return yield* new OrchestrationCliError({ message: `No comms actor found for @${handle}.` });
    }
    return actor.value;
  });

function parseRecipientHandles(raw: string): ReadonlyArray<string> {
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^@/, ""))
    .filter((entry) => entry.length > 0);
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
      };
    }

    let attempted = 0;
    let delivered = 0;
    let failed = 0;
    let skipped = 0;

    for (const delivery of input.deliveries) {
      const recipient = input.recipientsById.get(delivery.recipientActorId);
      const threadId = delivery.targetThreadId;
      if (!recipient || threadId === null) {
        skipped += 1;
        continue;
      }
      const thread = context.snapshot.threads.find((entry) => entry.id === threadId) ?? null;
      if (!thread || thread.deletedAt !== null) {
        skipped += 1;
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

    return { attempted, delivered, failed, skipped };
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
  from: Argument.string("from").pipe(Argument.withDescription("Sender handle.")),
  to: Argument.string("to").pipe(Argument.withDescription("Recipient handle or comma list.")),
  message: Argument.string("message").pipe(Argument.withDescription("Message body.")),
  type: messageTypeFlag,
  noDeliver: noDeliverFlag,
}).pipe(
  Command.withDescription("Send an actor-to-actor message."),
  Command.withHandler((flags) =>
    runWithOrchestrationCli(flags, (context: OrchestrationCliContext) =>
      Effect.gen(function* () {
        const sender = yield* getActorByHandle(context, flags.from.replace(/^@/, ""));
        const recipientHandles = parseRecipientHandles(flags.to);
        if (recipientHandles.length === 0) {
          return yield* new OrchestrationCliError({
            message: "At least one recipient is required.",
          });
        }

        const recipients = yield* Effect.all(
          recipientHandles.map((handle) => getActorByHandle(context, handle)),
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
          body: flags.message,
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
              body: flags.message,
            })
          : {
              attempted: 0,
              delivered: 0,
              failed: 0,
              skipped: sent.deliveries.length,
            };

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
