import {
  CommsActor,
  CommsActorId,
  CommsConversation,
  CommsConversationId,
  CommsConversationParticipant,
  CommsDelivery,
  CommsDeliveryId,
  CommsMessage,
  CommsMessageId,
  CommsMessageWithDelivery,
  ModelSelection,
  ProjectId,
  CommsSendMessageResult,
  ThreadId,
  type CommsActorStatus,
  type CommsConversationKind,
  type CommsMetadata,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Struct from "effect/Struct";

import { makeThreadCommsHandle } from "../../commsHandles.ts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  CommsRepository,
  GetCommsActorByHandleInput,
  GetCommsActorByIdInput,
  GetCommsActorByThreadIdInput,
  type CommsRepositoryShape,
} from "../Services/Comms.ts";

const CommsActorDbRow = CommsActor.mapFields(
  Struct.assign({
    metadata: Schema.fromJsonString(CommsActor.fields.metadata),
  }),
);
const CommsConversationDbRow = CommsConversation.mapFields(
  Struct.assign({
    metadata: Schema.fromJsonString(CommsConversation.fields.metadata),
  }),
);
const CommsMessageDbRow = CommsMessage.mapFields(
  Struct.assign({
    metadata: Schema.fromJsonString(CommsMessage.fields.metadata),
  }),
);
const CommsInboxRow = Schema.Struct({
  message: Schema.fromJsonString(CommsMessage),
  sender: Schema.fromJsonString(CommsActor),
  delivery: Schema.fromJsonString(CommsDelivery),
  conversation: Schema.fromJsonString(CommsConversation),
});
const ProjectionThreadActorSourceRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  modelSelection: Schema.fromJsonString(ModelSelection),
});

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const makeActorId = () => CommsActorId.make(crypto.randomUUID());
const makeConversationId = () => CommsConversationId.make(crypto.randomUUID());
const makeMessageId = () => CommsMessageId.make(crypto.randomUUID());
const makeDeliveryId = () => CommsDeliveryId.make(crypto.randomUUID());

const normalizeMetadata = (metadata: CommsMetadata | undefined) => metadata ?? {};

function deriveConversationKind(recipientCount: number): CommsConversationKind {
  return recipientCount > 1 ? "group" : "dm";
}

const makeCommsRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertActorRow = SqlSchema.findOne({
    Request: CommsActor,
    Result: CommsActorDbRow,
    execute: (actor) =>
      sql`
        INSERT INTO comms_actors (
          actor_id,
          kind,
          handle,
          display_name,
          status,
          project_id,
          thread_id,
          provider_instance_id,
          model,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (
          ${actor.actorId},
          ${actor.kind},
          ${actor.handle},
          ${actor.displayName},
          ${actor.status},
          ${actor.projectId},
          ${actor.threadId},
          ${actor.providerInstanceId},
          ${actor.model},
          ${JSON.stringify(actor.metadata)},
          ${actor.createdAt},
          ${actor.updatedAt}
        )
        ON CONFLICT (handle)
        DO UPDATE SET
          kind = excluded.kind,
          display_name = excluded.display_name,
          status = excluded.status,
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          provider_instance_id = excluded.provider_instance_id,
          model = excluded.model,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
        RETURNING
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
  });

  const getActorByIdRow = SqlSchema.findOneOption({
    Request: GetCommsActorByIdInput,
    Result: CommsActorDbRow,
    execute: ({ actorId }) =>
      sql`
        SELECT
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM comms_actors
        WHERE actor_id = ${actorId}
        LIMIT 1
      `,
  });

  const getActorByHandleRow = SqlSchema.findOneOption({
    Request: GetCommsActorByHandleInput,
    Result: CommsActorDbRow,
    execute: ({ handle }) =>
      sql`
        SELECT
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM comms_actors
        WHERE handle = ${handle}
        LIMIT 1
      `,
  });

  const getActorByThreadIdRow = SqlSchema.findOneOption({
    Request: GetCommsActorByThreadIdInput,
    Result: CommsActorDbRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM comms_actors
        WHERE thread_id = ${threadId}
          AND kind = 'agent'
        ORDER BY created_at ASC, actor_id ASC
        LIMIT 1
      `,
  });

  const getProjectionThreadActorSourceRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ threadId: ThreadId }),
    Result: ProjectionThreadActorSourceRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = ${threadId}
          AND deleted_at IS NULL
          AND archived_at IS NULL
        LIMIT 1
      `,
  });

  const listProjectionThreadActorSourceRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: CommsActor.fields.projectId,
    }),
    Result: ProjectionThreadActorSourceRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND deleted_at IS NULL
          AND archived_at IS NULL
        ORDER BY title ASC, thread_id ASC
      `,
  });

  const listActorRows = SqlSchema.findAll({
    Request: Schema.Struct({
      projectId: CommsActor.fields.projectId,
      includeInactive: Schema.Boolean,
    }),
    Result: CommsActorDbRow,
    execute: ({ projectId, includeInactive }) =>
      sql`
        SELECT
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM comms_actors
        WHERE (${projectId} IS NULL OR project_id = ${projectId})
          AND (${includeInactive ? 1 : 0} = 1 OR status = 'active')
        ORDER BY handle ASC, actor_id ASC
      `,
  });

  const updateActorByIdRow = SqlSchema.findOne({
    Request: CommsActor,
    Result: CommsActorDbRow,
    execute: (actor) =>
      sql`
        UPDATE comms_actors
        SET
          kind = ${actor.kind},
          handle = ${actor.handle},
          display_name = ${actor.displayName},
          status = ${actor.status},
          project_id = ${actor.projectId},
          thread_id = ${actor.threadId},
          provider_instance_id = ${actor.providerInstanceId},
          model = ${actor.model},
          metadata_json = ${JSON.stringify(actor.metadata)},
          updated_at = ${actor.updatedAt}
        WHERE actor_id = ${actor.actorId}
        RETURNING
          actor_id AS "actorId",
          kind,
          handle,
          display_name AS "displayName",
          status,
          project_id AS "projectId",
          thread_id AS "threadId",
          provider_instance_id AS "providerInstanceId",
          model,
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
  });

  const getConversationById = SqlSchema.findOneOption({
    Request: Schema.Struct({ conversationId: CommsConversationId }),
    Result: CommsConversationDbRow,
    execute: ({ conversationId }) =>
      sql`
        SELECT
          conversation_id AS "conversationId",
          kind,
          title,
          project_id AS "projectId",
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM comms_conversations
        WHERE conversation_id = ${conversationId}
        LIMIT 1
      `,
  });

  const upsertConversation = SqlSchema.findOne({
    Request: CommsConversation,
    Result: CommsConversationDbRow,
    execute: (conversation) =>
      sql`
        INSERT INTO comms_conversations (
          conversation_id,
          kind,
          title,
          project_id,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (
          ${conversation.conversationId},
          ${conversation.kind},
          ${conversation.title},
          ${conversation.projectId},
          ${JSON.stringify(conversation.metadata)},
          ${conversation.createdAt},
          ${conversation.updatedAt}
        )
        ON CONFLICT (conversation_id)
        DO UPDATE SET
          kind = excluded.kind,
          title = excluded.title,
          project_id = excluded.project_id,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
        RETURNING
          conversation_id AS "conversationId",
          kind,
          title,
          project_id AS "projectId",
          metadata_json AS "metadata",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
  });

  const upsertParticipant = SqlSchema.findOne({
    Request: CommsConversationParticipant,
    Result: CommsConversationParticipant,
    execute: (participant) =>
      sql`
        INSERT INTO comms_conversation_participants (
          conversation_id,
          actor_id,
          role,
          joined_at,
          left_at,
          last_read_message_id
        )
        VALUES (
          ${participant.conversationId},
          ${participant.actorId},
          ${participant.role},
          ${participant.joinedAt},
          ${participant.leftAt},
          ${participant.lastReadMessageId}
        )
        ON CONFLICT (conversation_id, actor_id)
        DO UPDATE SET
          role = excluded.role,
          left_at = excluded.left_at,
          last_read_message_id = excluded.last_read_message_id
        RETURNING
          conversation_id AS "conversationId",
          actor_id AS "actorId",
          role,
          joined_at AS "joinedAt",
          left_at AS "leftAt",
          last_read_message_id AS "lastReadMessageId"
      `,
  });

  const insertMessage = SqlSchema.findOne({
    Request: CommsMessage,
    Result: CommsMessageDbRow,
    execute: (message) =>
      sql`
        INSERT INTO comms_messages (
          message_id,
          conversation_id,
          sender_actor_id,
          message_type,
          body,
          metadata_json,
          created_at
        )
        VALUES (
          ${message.messageId},
          ${message.conversationId},
          ${message.senderActorId},
          ${message.messageType},
          ${message.body},
          ${JSON.stringify(message.metadata)},
          ${message.createdAt}
        )
        RETURNING
          message_id AS "messageId",
          conversation_id AS "conversationId",
          sender_actor_id AS "senderActorId",
          message_type AS "messageType",
          body,
          metadata_json AS "metadata",
          created_at AS "createdAt"
      `,
  });

  const insertDelivery = SqlSchema.findOne({
    Request: CommsDelivery,
    Result: CommsDelivery,
    execute: (delivery) =>
      sql`
        INSERT INTO comms_deliveries (
          delivery_id,
          message_id,
          recipient_actor_id,
          target_thread_id,
          status,
          error,
          created_at,
          updated_at,
          delivered_at,
          read_at
        )
        VALUES (
          ${delivery.deliveryId},
          ${delivery.messageId},
          ${delivery.recipientActorId},
          ${delivery.targetThreadId},
          ${delivery.status},
          ${delivery.error},
          ${delivery.createdAt},
          ${delivery.updatedAt},
          ${delivery.deliveredAt},
          ${delivery.readAt}
        )
        RETURNING
          delivery_id AS "deliveryId",
          message_id AS "messageId",
          recipient_actor_id AS "recipientActorId",
          target_thread_id AS "targetThreadId",
          status,
          error,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          delivered_at AS "deliveredAt",
          read_at AS "readAt"
      `,
  });

  const getDeliveryByIdRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ deliveryId: CommsDeliveryId }),
    Result: CommsDelivery,
    execute: ({ deliveryId }) =>
      sql`
        SELECT
          delivery_id AS "deliveryId",
          message_id AS "messageId",
          recipient_actor_id AS "recipientActorId",
          target_thread_id AS "targetThreadId",
          status,
          error,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          delivered_at AS "deliveredAt",
          read_at AS "readAt"
        FROM comms_deliveries
        WHERE delivery_id = ${deliveryId}
        LIMIT 1
      `,
  });

  const setDeliveryStatusRow = SqlSchema.findOne({
    Request: Schema.Struct({
      deliveryId: CommsDeliveryId,
      status: CommsDelivery.fields.status,
      error: Schema.NullOr(Schema.String),
      updatedAt: CommsDelivery.fields.updatedAt,
      deliveredAt: CommsDelivery.fields.deliveredAt,
      readAt: CommsDelivery.fields.readAt,
    }),
    Result: CommsDelivery,
    execute: ({ deliveryId, status, error, updatedAt, deliveredAt, readAt }) =>
      sql`
        UPDATE comms_deliveries
        SET
          status = ${status},
          error = ${error},
          updated_at = ${updatedAt},
          delivered_at = COALESCE(${deliveredAt}, delivered_at),
          read_at = COALESCE(${readAt}, read_at)
        WHERE delivery_id = ${deliveryId}
        RETURNING
          delivery_id AS "deliveryId",
          message_id AS "messageId",
          recipient_actor_id AS "recipientActorId",
          target_thread_id AS "targetThreadId",
          status,
          error,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          delivered_at AS "deliveredAt",
          read_at AS "readAt"
      `,
  });

  const listInboxRows = SqlSchema.findAll({
    Request: Schema.Struct({
      actorId: CommsActorId,
      statuses: Schema.Array(CommsDelivery.fields.status),
      limit: Schema.Number,
    }),
    Result: CommsInboxRow,
    execute: ({ actorId, statuses, limit }) =>
      sql`
        SELECT
          json_object(
            'messageId', m.message_id,
            'conversationId', m.conversation_id,
            'senderActorId', m.sender_actor_id,
            'messageType', m.message_type,
            'body', m.body,
            'metadata', json(m.metadata_json),
            'createdAt', m.created_at
          ) AS message,
          json_object(
            'actorId', sender.actor_id,
            'kind', sender.kind,
            'handle', sender.handle,
            'displayName', sender.display_name,
            'status', sender.status,
            'projectId', sender.project_id,
            'threadId', sender.thread_id,
            'providerInstanceId', sender.provider_instance_id,
            'model', sender.model,
            'metadata', json(sender.metadata_json),
            'createdAt', sender.created_at,
            'updatedAt', sender.updated_at
          ) AS sender,
          json_object(
            'deliveryId', d.delivery_id,
            'messageId', d.message_id,
            'recipientActorId', d.recipient_actor_id,
            'targetThreadId', d.target_thread_id,
            'status', d.status,
            'error', d.error,
            'createdAt', d.created_at,
            'updatedAt', d.updated_at,
            'deliveredAt', d.delivered_at,
            'readAt', d.read_at
          ) AS delivery,
          json_object(
            'conversationId', c.conversation_id,
            'kind', c.kind,
            'title', c.title,
            'projectId', c.project_id,
            'metadata', json(c.metadata_json),
            'createdAt', c.created_at,
            'updatedAt', c.updated_at
          ) AS conversation
        FROM comms_deliveries d
        JOIN comms_messages m ON m.message_id = d.message_id
        JOIN comms_actors sender ON sender.actor_id = m.sender_actor_id
        JOIN comms_conversations c ON c.conversation_id = m.conversation_id
        WHERE d.recipient_actor_id = ${actorId}
          AND (
            ${statuses.length} = 0
            OR d.status IN (SELECT value FROM json_each(${JSON.stringify(statuses)}))
          )
        ORDER BY m.created_at DESC, m.message_id DESC
        LIMIT ${limit}
      `,
  });

  const listConversationMessageRows = SqlSchema.findAll({
    Request: Schema.Struct({
      conversationId: CommsConversationId,
      limit: Schema.Number,
    }),
    Result: CommsInboxRow,
    execute: ({ conversationId, limit }) =>
      sql`
        SELECT
          json_object(
            'messageId', m.message_id,
            'conversationId', m.conversation_id,
            'senderActorId', m.sender_actor_id,
            'messageType', m.message_type,
            'body', m.body,
            'metadata', json(m.metadata_json),
            'createdAt', m.created_at
          ) AS message,
          json_object(
            'actorId', sender.actor_id,
            'kind', sender.kind,
            'handle', sender.handle,
            'displayName', sender.display_name,
            'status', sender.status,
            'projectId', sender.project_id,
            'threadId', sender.thread_id,
            'providerInstanceId', sender.provider_instance_id,
            'model', sender.model,
            'metadata', json(sender.metadata_json),
            'createdAt', sender.created_at,
            'updatedAt', sender.updated_at
          ) AS sender,
          json_object(
            'deliveryId', d.delivery_id,
            'messageId', d.message_id,
            'recipientActorId', d.recipient_actor_id,
            'targetThreadId', d.target_thread_id,
            'status', d.status,
            'error', d.error,
            'createdAt', d.created_at,
            'updatedAt', d.updated_at,
            'deliveredAt', d.delivered_at,
            'readAt', d.read_at
          ) AS delivery,
          json_object(
            'conversationId', c.conversation_id,
            'kind', c.kind,
            'title', c.title,
            'projectId', c.project_id,
            'metadata', json(c.metadata_json),
            'createdAt', c.created_at,
            'updatedAt', c.updated_at
          ) AS conversation
        FROM comms_messages m
        JOIN comms_actors sender ON sender.actor_id = m.sender_actor_id
        JOIN comms_conversations c ON c.conversation_id = m.conversation_id
        JOIN comms_deliveries d ON d.message_id = m.message_id
        WHERE m.conversation_id = ${conversationId}
        ORDER BY m.created_at DESC, m.message_id DESC
        LIMIT ${limit}
      `,
  });

  const deriveActorFromThread = (actor: CommsActor) =>
    Effect.gen(function* () {
      if (actor.kind !== "agent" || actor.threadId === null) {
        return actor;
      }

      const thread = yield* getProjectionThreadActorSourceRow({ threadId: actor.threadId });
      if (Option.isNone(thread)) {
        return {
          ...actor,
          status: "inactive" as const,
        };
      }

      return {
        ...actor,
        handle: makeThreadCommsHandle({
          title: thread.value.title,
          threadId: thread.value.threadId,
        }),
        displayName: thread.value.title,
        projectId: thread.value.projectId,
        providerInstanceId: thread.value.modelSelection.instanceId,
        model: thread.value.modelSelection.model,
      } satisfies CommsActor;
    });

  const actorFromProjectionThreadSource = (
    thread: Schema.Schema.Type<typeof ProjectionThreadActorSourceRow>,
    now: string,
  ): CommsActor => ({
    actorId: CommsActorId.make(`thread-${thread.threadId}`),
    kind: "agent",
    handle: makeThreadCommsHandle({
      title: thread.title,
      threadId: thread.threadId,
    }),
    displayName: thread.title,
    status: "active",
    projectId: thread.projectId,
    threadId: thread.threadId,
    providerInstanceId: thread.modelSelection.instanceId,
    model: thread.modelSelection.model,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });

  const findProjectionThreadActorSourceByHandle = (handle: string) =>
    Effect.gen(function* () {
      const normalizedHandle = handle.trim().toLowerCase();
      const threads = yield* listProjectionThreadActorSourceRows({ projectId: null });
      return (
        threads.find(
          (thread) =>
            makeThreadCommsHandle({
              title: thread.title,
              threadId: thread.threadId,
            }).toLowerCase() === normalizedHandle,
        ) ?? null
      );
    });

  const materializeProjectionThreadActor = (
    thread: Schema.Schema.Type<typeof ProjectionThreadActorSourceRow>,
  ) =>
    Effect.gen(function* () {
      const actor = yield* upsertActor({
        kind: "agent",
        handle: makeThreadCommsHandle({
          title: thread.title,
          threadId: thread.threadId,
        }),
        displayName: thread.title,
        projectId: thread.projectId,
        threadId: thread.threadId,
        providerInstanceId: thread.modelSelection.instanceId,
        model: thread.modelSelection.model,
        status: "active",
      });
      return actor;
    });

  const toMessageWithDelivery = (row: Schema.Schema.Type<typeof CommsInboxRow>) =>
    deriveActorFromThread(row.sender).pipe(
      Effect.map(
        (sender): CommsMessageWithDelivery => ({
          message: row.message,
          sender,
          delivery: row.delivery,
          conversation: row.conversation,
        }),
      ),
    );

  const upsertActor: CommsRepositoryShape["upsertActor"] = (input) =>
    Effect.gen(function* () {
      const existingByThread =
        input.kind === "agent" && input.threadId !== undefined && input.threadId !== null
          ? yield* getActorByThreadIdRow({ threadId: input.threadId })
          : Option.none<CommsActor>();
      const existingByHandle = yield* getActorByHandleRow({ handle: input.handle });
      const now = yield* nowIso;
      const isThreadBackedAgent =
        input.kind === "agent" && input.threadId !== undefined && input.threadId !== null;
      const existingActor =
        Option.getOrNull(existingByThread) ??
        (isThreadBackedAgent ? null : Option.getOrNull(existingByHandle));
      const actor: CommsActor = {
        actorId: input.actorId ?? existingActor?.actorId ?? makeActorId(),
        kind: input.kind,
        handle: isThreadBackedAgent ? `thread-${input.threadId}` : input.handle,
        displayName: input.displayName ?? existingActor?.displayName ?? input.handle,
        status: input.status ?? existingActor?.status ?? ("active" satisfies CommsActorStatus),
        projectId: input.projectId ?? existingActor?.projectId ?? null,
        threadId: input.threadId ?? existingActor?.threadId ?? null,
        providerInstanceId: input.providerInstanceId ?? existingActor?.providerInstanceId ?? null,
        model: input.model ?? existingActor?.model ?? null,
        metadata: input.metadata ?? existingActor?.metadata ?? {},
        createdAt: existingActor?.createdAt ?? now,
        updatedAt: now,
      };
      const saved =
        Option.isSome(existingByThread) ||
        (input.actorId !== undefined && existingActor?.actorId === input.actorId)
          ? yield* updateActorByIdRow(actor)
          : yield* upsertActorRow(actor);
      return yield* deriveActorFromThread(saved);
    }).pipe(Effect.mapError(toPersistenceSqlError("CommsRepository.upsertActor:query")));

  const getActorById: CommsRepositoryShape["getActorById"] = (input) =>
    getActorByIdRow(input).pipe(
      Effect.flatMap((actor) =>
        Option.isSome(actor)
          ? deriveActorFromThread(actor.value).pipe(Effect.map(Option.some))
          : Effect.succeed(Option.none<CommsActor>()),
      ),
      Effect.mapError(toPersistenceSqlError("CommsRepository.getActorById:query")),
    );

  const getActorByHandle: CommsRepositoryShape["getActorByHandle"] = (input) =>
    Effect.gen(function* () {
      const normalizedHandle = input.handle.trim().toLowerCase();
      const exactActor = Option.getOrNull(yield* getActorByHandleRow(input));
      if (exactActor !== null) {
        const actor = yield* deriveActorFromThread(exactActor);
        if (
          actor.status === "active" &&
          (actor.threadId === null || actor.handle.toLowerCase() === normalizedHandle)
        ) {
          return Option.some(actor);
        }
      }

      const actors = yield* listActorRows({ projectId: null, includeInactive: true });
      for (const candidate of actors) {
        const actor = yield* deriveActorFromThread(candidate);
        if (actor.status === "active" && actor.handle.toLowerCase() === normalizedHandle) {
          return Option.some(actor);
        }
      }

      const projectionThread = yield* findProjectionThreadActorSourceByHandle(input.handle);
      if (projectionThread !== null) {
        const actor = yield* materializeProjectionThreadActor(projectionThread);
        return Option.some(actor);
      }
      return Option.none<CommsActor>();
    }).pipe(Effect.mapError(toPersistenceSqlError("CommsRepository.getActorByHandle:query")));

  const listActors: CommsRepositoryShape["listActors"] = (input) =>
    Effect.gen(function* () {
      const projectId = input.projectId ?? null;
      const actorRows = yield* listActorRows({
        projectId,
        includeInactive: input.includeInactive ?? false,
      });
      const actors = yield* Effect.forEach(actorRows, deriveActorFromThread, { concurrency: 8 });
      const visibleActors =
        input.includeInactive === true
          ? actors
          : actors.filter((actor) => actor.status === "active");
      const existingThreadIds = new Set(
        visibleActors.flatMap((actor) =>
          actor.kind === "agent" && actor.threadId !== null ? [actor.threadId] : [],
        ),
      );
      const projectionThreads = yield* listProjectionThreadActorSourceRows({ projectId });
      const now = yield* nowIso;
      const projectedActors = projectionThreads
        .filter((thread) => !existingThreadIds.has(thread.threadId))
        .map((thread) => actorFromProjectionThreadSource(thread, now));

      return [...visibleActors, ...projectedActors].toSorted((left, right) =>
        left.handle.localeCompare(right.handle),
      );
    }).pipe(Effect.mapError(toPersistenceSqlError("CommsRepository.listActors:query")));

  const sendMessage: CommsRepositoryShape["sendMessage"] = (input) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const conversationId = input.conversationId ?? makeConversationId();
      const existingConversation = yield* getConversationById({ conversationId });
      const conversation =
        Option.getOrNull(existingConversation) ??
        (yield* upsertConversation({
          conversationId,
          kind: input.conversationKind ?? deriveConversationKind(input.recipientActorIds.length),
          title: input.title ?? null,
          projectId: input.projectId ?? null,
          metadata: normalizeMetadata(input.metadata),
          createdAt: now,
          updatedAt: now,
        }));

      const uniqueParticipantIds = Array.from(
        new Set([input.senderActorId, ...input.recipientActorIds]),
      );
      const participants = yield* Effect.all(
        uniqueParticipantIds.map((actorId) =>
          upsertParticipant({
            conversationId,
            actorId,
            role: actorId === input.senderActorId ? "owner" : "member",
            joinedAt: now,
            leftAt: null,
            lastReadMessageId: null,
          }),
        ),
      );

      const message = yield* insertMessage({
        messageId: input.messageId ?? makeMessageId(),
        conversationId,
        senderActorId: input.senderActorId,
        messageType: input.messageType,
        body: input.body,
        metadata: normalizeMetadata(input.metadata),
        createdAt: now,
      });

      const deliveries = yield* Effect.all(
        input.recipientActorIds.map((recipientActorId) =>
          Effect.gen(function* () {
            const recipient = yield* getActorByIdRow({ actorId: recipientActorId });
            return yield* insertDelivery({
              deliveryId: makeDeliveryId(),
              messageId: message.messageId,
              recipientActorId,
              targetThreadId: Option.getOrNull(recipient)?.threadId ?? null,
              status: "pending",
              error: null,
              createdAt: now,
              updatedAt: now,
              deliveredAt: null,
              readAt: null,
            });
          }),
        ),
      );

      yield* upsertConversation({
        ...conversation,
        updatedAt: now,
      });

      return {
        conversation,
        participants,
        message,
        deliveries,
      } satisfies CommsSendMessageResult;
    }).pipe(Effect.mapError(toPersistenceSqlError("CommsRepository.sendMessage:query")));

  const listInbox: CommsRepositoryShape["listInbox"] = (input) =>
    listInboxRows({
      actorId: input.actorId,
      statuses: [...(input.statuses ?? [])],
      limit: input.limit ?? 50,
    }).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toMessageWithDelivery, { concurrency: 8 })),
      Effect.mapError(toPersistenceSqlError("CommsRepository.listInbox:query")),
    );

  const listConversationMessages: CommsRepositoryShape["listConversationMessages"] = (input) =>
    listConversationMessageRows({
      conversationId: input.conversationId,
      limit: input.limit ?? 100,
    }).pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toMessageWithDelivery, { concurrency: 8 })),
      Effect.mapError(toPersistenceSqlError("CommsRepository.listConversationMessages:query")),
    );

  const setDeliveryStatus: CommsRepositoryShape["setDeliveryStatus"] = (input) =>
    Effect.gen(function* () {
      const updatedAt = yield* nowIso;
      return yield* setDeliveryStatusRow({
        deliveryId: input.deliveryId,
        status: input.status,
        error: input.error ?? null,
        updatedAt,
        deliveredAt: input.status === "delivered" ? updatedAt : null,
        readAt: input.status === "read" ? updatedAt : null,
      });
    }).pipe(Effect.mapError(toPersistenceSqlError("CommsRepository.setDeliveryStatus:query")));

  const getDeliveryById: CommsRepositoryShape["getDeliveryById"] = (input) =>
    getDeliveryByIdRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("CommsRepository.getDeliveryById:query")),
    );

  return {
    upsertActor,
    getActorById,
    getActorByHandle,
    listActors,
    sendMessage,
    listInbox,
    listConversationMessages,
    setDeliveryStatus,
    getDeliveryById,
  } satisfies CommsRepositoryShape;
});

export const CommsRepositoryLive = Layer.effect(CommsRepository, makeCommsRepository);
