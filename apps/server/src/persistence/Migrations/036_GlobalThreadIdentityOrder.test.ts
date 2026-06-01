import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_GlobalThreadIdentityOrder", (it) => {
  it.effect("rebalances active thread identities globally instead of per project", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          (
            'thread-a',
            'project-a',
            'A',
            '{"provider":"codex","model":"gpt-5"}',
            NULL, NULL, NULL,
            '2026-06-01T00:00:00.000Z',
            '2026-06-01T00:00:00.000Z',
            NULL, NULL, 0, 0, 0, NULL,
            'full-access', 'default'
          ),
          (
            'thread-b',
            'project-b',
            'B',
            '{"provider":"codex","model":"gpt-5"}',
            NULL, NULL, NULL,
            '2026-06-01T00:01:00.000Z',
            '2026-06-01T00:01:00.000Z',
            NULL, NULL, 0, 0, 0, NULL,
            'full-access', 'default'
          ),
          (
            'thread-c',
            'project-c',
            'C',
            '{"provider":"codex","model":"gpt-5"}',
            NULL, NULL, NULL,
            '2026-06-01T00:02:00.000Z',
            '2026-06-01T00:02:00.000Z',
            NULL, NULL, 0, 0, 0, NULL,
            'full-access', 'default'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const perProjectRows = yield* sql<{ readonly identityIcon: string }>`
        SELECT identity_icon AS "identityIcon"
        FROM projection_threads
        ORDER BY created_at ASC
      `;
      assert.deepEqual(
        perProjectRows.map((row) => row.identityIcon),
        ["cloud", "cloud", "cloud"],
      );

      yield* runMigrations({ toMigrationInclusive: 36 });

      const globalRows = yield* sql<{
        readonly identityColor: string;
        readonly identityIcon: string;
        readonly identityPreset: string;
      }>`
        SELECT
          identity_preset AS "identityPreset",
          identity_icon AS "identityIcon",
          identity_color AS "identityColor"
        FROM projection_threads
        ORDER BY created_at ASC
      `;

      assert.deepEqual(globalRows, [
        {
          identityPreset: "af_sky",
          identityIcon: "cloud",
          identityColor: "#3A86FF",
        },
        {
          identityPreset: "af_alloy",
          identityIcon: "diamond",
          identityColor: "#E67E22",
        },
        {
          identityPreset: "af_sarah",
          identityIcon: "heart",
          identityColor: "#E63946",
        },
      ]);
    }),
  );
});
