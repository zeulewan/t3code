import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CommsRepository } from "../Services/Comms.ts";
import { CommsRepositoryLive } from "./Comms.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(CommsRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("CommsRepository", (it) => {
  it.effect("stores actor-to-actor messages and recipient deliveries", () =>
    Effect.gen(function* () {
      const repository = yield* CommsRepository;

      const bob = yield* repository.upsertActor({
        kind: "agent",
        handle: "bob",
        displayName: "Bob",
      });
      const joe = yield* repository.upsertActor({
        kind: "agent",
        handle: "joe",
        displayName: "Joe",
      });

      const sent = yield* repository.sendMessage({
        senderActorId: bob.actorId,
        recipientActorIds: [joe.actorId],
        messageType: "direct",
        body: "Can you review the reconnect patch?",
      });

      assert.equal(sent.deliveries.length, 1);
      assert.equal(sent.message.senderActorId, bob.actorId);
      assert.equal(sent.deliveries[0]?.recipientActorId, joe.actorId);

      const joeInbox = yield* repository.listInbox({
        actorId: joe.actorId,
      });
      assert.equal(joeInbox.length, 1);
      assert.equal(joeInbox[0]?.sender.handle, "bob");
      assert.equal(joeInbox[0]?.message.body, "Can you review the reconnect patch?");
      assert.equal(joeInbox[0]?.delivery.status, "pending");

      const delivery = joeInbox[0]?.delivery;
      assert.ok(delivery);
      const updated = yield* repository.setDeliveryStatus({
        deliveryId: delivery.deliveryId,
        status: "read",
      });
      assert.equal(updated.status, "read");
      assert.ok(updated.readAt);

      const persisted = yield* repository.getDeliveryById({ deliveryId: delivery.deliveryId });
      assert.equal(Option.getOrNull(persisted)?.status, "read");
    }),
  );
});
