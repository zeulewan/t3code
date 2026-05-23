import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const makeCommsId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const CommsActorId = makeCommsId("CommsActorId");
export type CommsActorId = typeof CommsActorId.Type;
export const CommsConversationId = makeCommsId("CommsConversationId");
export type CommsConversationId = typeof CommsConversationId.Type;
export const CommsMessageId = makeCommsId("CommsMessageId");
export type CommsMessageId = typeof CommsMessageId.Type;
export const CommsDeliveryId = makeCommsId("CommsDeliveryId");
export type CommsDeliveryId = typeof CommsDeliveryId.Type;

export const CommsActorKind = Schema.Literals(["human", "agent", "system", "remote"]);
export type CommsActorKind = typeof CommsActorKind.Type;
export const CommsActorStatus = Schema.Literals(["active", "inactive"]);
export type CommsActorStatus = typeof CommsActorStatus.Type;
export const CommsConversationKind = Schema.Literals(["dm", "group", "announcement"]);
export type CommsConversationKind = typeof CommsConversationKind.Type;
export const CommsMessageType = Schema.Literals(["direct", "notify", "defer"]);
export type CommsMessageType = typeof CommsMessageType.Type;
export const CommsDeliveryStatus = Schema.Literals([
  "pending",
  "delivered",
  "read",
  "failed",
  "ignored",
]);
export type CommsDeliveryStatus = typeof CommsDeliveryStatus.Type;
export const CommsParticipantRole = Schema.Literals(["owner", "member"]);
export type CommsParticipantRole = typeof CommsParticipantRole.Type;

export const CommsMetadata = Schema.Record(Schema.String, Schema.Unknown);
export type CommsMetadata = typeof CommsMetadata.Type;

export const CommsActor = Schema.Struct({
  actorId: CommsActorId,
  kind: CommsActorKind,
  handle: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  status: CommsActorStatus,
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  model: Schema.NullOr(TrimmedNonEmptyString),
  metadata: CommsMetadata,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CommsActor = typeof CommsActor.Type;

export const CommsConversation = Schema.Struct({
  conversationId: CommsConversationId,
  kind: CommsConversationKind,
  title: Schema.NullOr(TrimmedNonEmptyString),
  projectId: Schema.NullOr(ProjectId),
  metadata: CommsMetadata,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CommsConversation = typeof CommsConversation.Type;

export const CommsConversationParticipant = Schema.Struct({
  conversationId: CommsConversationId,
  actorId: CommsActorId,
  role: CommsParticipantRole,
  joinedAt: IsoDateTime,
  leftAt: Schema.NullOr(IsoDateTime),
  lastReadMessageId: Schema.NullOr(CommsMessageId),
});
export type CommsConversationParticipant = typeof CommsConversationParticipant.Type;

export const CommsMessage = Schema.Struct({
  messageId: CommsMessageId,
  conversationId: CommsConversationId,
  senderActorId: CommsActorId,
  messageType: CommsMessageType,
  body: TrimmedNonEmptyString,
  metadata: CommsMetadata,
  createdAt: IsoDateTime,
});
export type CommsMessage = typeof CommsMessage.Type;

export const CommsDelivery = Schema.Struct({
  deliveryId: CommsDeliveryId,
  messageId: CommsMessageId,
  recipientActorId: CommsActorId,
  targetThreadId: Schema.NullOr(ThreadId),
  status: CommsDeliveryStatus,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  readAt: Schema.NullOr(IsoDateTime),
});
export type CommsDelivery = typeof CommsDelivery.Type;

export const CommsMessageWithDelivery = Schema.Struct({
  message: CommsMessage,
  sender: CommsActor,
  delivery: CommsDelivery,
  conversation: CommsConversation,
});
export type CommsMessageWithDelivery = typeof CommsMessageWithDelivery.Type;

export const CommsConversationSummary = Schema.Struct({
  conversation: CommsConversation,
  participants: Schema.Array(CommsActor),
  lastMessage: Schema.NullOr(CommsMessage),
  lastSender: Schema.NullOr(CommsActor),
  updatedAt: IsoDateTime,
});
export type CommsConversationSummary = typeof CommsConversationSummary.Type;

export const CommsUpsertActorInput = Schema.Struct({
  actorId: Schema.optional(CommsActorId),
  kind: CommsActorKind,
  handle: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  status: Schema.optional(CommsActorStatus),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  threadId: Schema.optional(Schema.NullOr(ThreadId)),
  providerInstanceId: Schema.optional(Schema.NullOr(ProviderInstanceId)),
  model: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  metadata: Schema.optional(CommsMetadata),
});
export type CommsUpsertActorInput = typeof CommsUpsertActorInput.Type;

export const CommsListActorsInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  includeInactive: Schema.optional(Schema.Boolean),
});
export type CommsListActorsInput = typeof CommsListActorsInput.Type;

export const CommsSendMessageInput = Schema.Struct({
  messageId: Schema.optional(CommsMessageId),
  senderActorId: CommsActorId,
  recipientActorIds: Schema.NonEmptyArray(CommsActorId),
  messageType: CommsMessageType,
  body: TrimmedNonEmptyString,
  conversationId: Schema.optional(CommsConversationId),
  conversationKind: Schema.optional(CommsConversationKind),
  title: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  metadata: Schema.optional(CommsMetadata),
});
export type CommsSendMessageInput = typeof CommsSendMessageInput.Type;

export const CommsSendMessageResult = Schema.Struct({
  conversation: CommsConversation,
  participants: Schema.Array(CommsConversationParticipant),
  message: CommsMessage,
  deliveries: Schema.Array(CommsDelivery),
});
export type CommsSendMessageResult = typeof CommsSendMessageResult.Type;

export const CommsListInboxInput = Schema.Struct({
  actorId: CommsActorId,
  statuses: Schema.optional(Schema.Array(CommsDeliveryStatus)),
  limit: Schema.optional(PositiveInt),
});
export type CommsListInboxInput = typeof CommsListInboxInput.Type;

export const CommsListConversationsInput = Schema.Struct({
  projectId: Schema.optional(Schema.NullOr(ProjectId)),
  kind: Schema.optional(Schema.NullOr(CommsConversationKind)),
  limit: Schema.optional(PositiveInt),
});
export type CommsListConversationsInput = typeof CommsListConversationsInput.Type;

export const CommsListConversationMessagesInput = Schema.Struct({
  conversationId: CommsConversationId,
  limit: Schema.optional(PositiveInt),
});
export type CommsListConversationMessagesInput = typeof CommsListConversationMessagesInput.Type;

export const CommsSetDeliveryStatusInput = Schema.Struct({
  deliveryId: CommsDeliveryId,
  status: CommsDeliveryStatus,
  error: Schema.optional(Schema.NullOr(Schema.String)),
});
export type CommsSetDeliveryStatusInput = typeof CommsSetDeliveryStatusInput.Type;

export class CommsError extends Schema.TaggedErrorClass<CommsError>()("CommsError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
