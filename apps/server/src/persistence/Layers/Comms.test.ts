import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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

  it.effect("lists conversation summaries with participants and latest message", () =>
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

      const first = yield* repository.sendMessage({
        senderActorId: bob.actorId,
        recipientActorIds: [joe.actorId],
        messageType: "direct",
        body: "First message",
      });
      yield* repository.sendMessage({
        conversationId: first.conversation.conversationId,
        senderActorId: joe.actorId,
        recipientActorIds: [bob.actorId],
        messageType: "direct",
        body: "Latest message",
      });

      const summaries = yield* repository.listConversations({ kind: "dm" });
      const summary = summaries.find(
        (item) => item.conversation.conversationId === first.conversation.conversationId,
      );

      assert.ok(summary);
      assert.equal(summary.conversation.kind, "dm");
      assert.equal(summary.lastMessage?.body, "Latest message");
      assert.equal(summary.lastSender?.handle, "joe");
      assert.deepEqual(summary.participants.map((participant) => participant.handle).toSorted(), [
        "bob",
        "joe",
      ]);
    }),
  );

  it.effect("resolves projected thread titles as comms actors before registration", () =>
    Effect.gen(function* () {
      const repository = yield* CommsRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-sky',
          'Sky Project',
          '/tmp/sky-project',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          '[]',
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at,
          archived_at
        )
        VALUES (
          'thread-sky',
          'project-sky',
          'Sky',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL,
          NULL
        )
      `;

      const listedActors = yield* repository.listActors({});
      const listedSky = listedActors.find((actor) => actor.handle === "sky");
      assert.equal(listedSky?.threadId, "thread-sky");
      assert.equal(listedSky?.projectId, "project-sky");

      const resolvedSky = yield* repository.getActorByHandle({ handle: "sky" });
      assert.equal(Option.getOrNull(resolvedSky)?.threadId, "thread-sky");

      const listedAfterResolve = yield* repository.listActors({});
      assert.equal(listedAfterResolve.filter((actor) => actor.handle === "sky").length, 1);
    }),
  );

  it.effect("does not resolve archived projected thread titles as comms actors", () =>
    Effect.gen(function* () {
      const repository = yield* CommsRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-archived-river',
          'Archived River Project',
          '/tmp/archived-river-project',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          '[]',
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at,
          archived_at
        )
        VALUES (
          'thread-archived-river',
          'project-archived-river',
          'River',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL,
          '2026-05-20T01:00:00.000Z'
        )
      `;

      const listedActors = yield* repository.listActors({});
      assert.isFalse(listedActors.some((actor) => actor.handle === "river"));

      const resolvedRiver = yield* repository.getActorByHandle({ handle: "river" });
      assert.isTrue(Option.isNone(resolvedRiver));
    }),
  );

  it.effect("marks stored actors inactive when their backing thread is archived", () =>
    Effect.gen(function* () {
      const repository = yield* CommsRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-stale-river',
          'Stale River Project',
          '/tmp/stale-river-project',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          '[]',
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          deleted_at,
          archived_at
        )
        VALUES (
          'thread-stale-river',
          'project-stale-river',
          'River',
          '{"instanceId":"codex","model":"gpt-5.5"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z',
          NULL,
          '2026-05-20T01:00:00.000Z'
        )
      `;

      yield* sql`
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
          'actor-stale-river',
          'agent',
          'river',
          'river',
          'active',
          'project-stale-river',
          'thread-stale-river',
          'codex',
          'gpt-5.5',
          '{}',
          '2026-05-20T00:00:00.000Z',
          '2026-05-20T00:00:00.000Z'
        )
      `;

      const resolvedRiver = yield* repository.getActorByHandle({ handle: "river" });
      assert.isTrue(Option.isNone(resolvedRiver));

      const listedActors = yield* repository.listActors({});
      assert.isFalse(listedActors.some((actor) => actor.handle === "river"));

      const inactiveActors = yield* repository.listActors({ includeInactive: true });
      const staleRiver = inactiveActors.find((actor) => actor.actorId === "actor-stale-river");
      assert.equal(staleRiver?.status, "inactive");
    }),
  );
});
