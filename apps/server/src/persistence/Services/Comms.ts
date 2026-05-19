import {
  CommsActor,
  CommsActorId,
  CommsDelivery,
  CommsDeliveryId,
  CommsListActorsInput,
  CommsListConversationMessagesInput,
  CommsListInboxInput,
  CommsMessageWithDelivery,
  CommsSendMessageInput,
  CommsSendMessageResult,
  CommsSetDeliveryStatusInput,
  CommsUpsertActorInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetCommsActorByIdInput = Schema.Struct({
  actorId: CommsActorId,
});
export type GetCommsActorByIdInput = typeof GetCommsActorByIdInput.Type;

export const GetCommsActorByHandleInput = Schema.Struct({
  handle: CommsActor.fields.handle,
});
export type GetCommsActorByHandleInput = typeof GetCommsActorByHandleInput.Type;

export const GetCommsActorByThreadIdInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetCommsActorByThreadIdInput = typeof GetCommsActorByThreadIdInput.Type;

export interface CommsRepositoryShape {
  readonly upsertActor: (
    input: CommsUpsertActorInput,
  ) => Effect.Effect<CommsActor, ProjectionRepositoryError>;

  readonly getActorById: (
    input: GetCommsActorByIdInput,
  ) => Effect.Effect<Option.Option<CommsActor>, ProjectionRepositoryError>;

  readonly getActorByHandle: (
    input: GetCommsActorByHandleInput,
  ) => Effect.Effect<Option.Option<CommsActor>, ProjectionRepositoryError>;

  readonly listActors: (
    input: CommsListActorsInput,
  ) => Effect.Effect<ReadonlyArray<CommsActor>, ProjectionRepositoryError>;

  readonly sendMessage: (
    input: CommsSendMessageInput,
  ) => Effect.Effect<CommsSendMessageResult, ProjectionRepositoryError>;

  readonly listInbox: (
    input: CommsListInboxInput,
  ) => Effect.Effect<ReadonlyArray<CommsMessageWithDelivery>, ProjectionRepositoryError>;

  readonly listConversationMessages: (
    input: CommsListConversationMessagesInput,
  ) => Effect.Effect<ReadonlyArray<CommsMessageWithDelivery>, ProjectionRepositoryError>;

  readonly setDeliveryStatus: (
    input: CommsSetDeliveryStatusInput,
  ) => Effect.Effect<CommsDelivery, ProjectionRepositoryError>;

  readonly getDeliveryById: (input: {
    readonly deliveryId: CommsDeliveryId;
  }) => Effect.Effect<Option.Option<CommsDelivery>, ProjectionRepositoryError>;
}

export class CommsRepository extends Context.Service<CommsRepository, CommsRepositoryShape>()(
  "t3/persistence/Services/Comms/CommsRepository",
) {}
