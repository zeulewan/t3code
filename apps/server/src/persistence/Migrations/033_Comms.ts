import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS comms_actors (
      actor_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT,
      thread_id TEXT,
      provider_instance_id TEXT,
      model TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS comms_conversations (
      conversation_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT,
      project_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS comms_conversation_participants (
      conversation_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      last_read_message_id TEXT,
      PRIMARY KEY (conversation_id, actor_id)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS comms_messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_actor_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS comms_deliveries (
      delivery_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      recipient_actor_id TEXT NOT NULL,
      target_thread_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      UNIQUE (message_id, recipient_actor_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_actors_project
    ON comms_actors(project_id, status, handle)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_actors_thread
    ON comms_actors(thread_id)
    WHERE thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_conversations_project
    ON comms_conversations(project_id, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_participants_actor
    ON comms_conversation_participants(actor_id, conversation_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_messages_conversation_created
    ON comms_messages(conversation_id, created_at, message_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_comms_deliveries_recipient_status
    ON comms_deliveries(recipient_actor_id, status, updated_at)
  `;
});
