import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("032_CompactProjectionThreadActivityPayloads", (it) => {
  it.effect("removes Codex aggregated output from projected activity payloads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 31 });

      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          turn_id,
          tone,
          kind,
          summary,
          payload_json,
          sequence,
          created_at
        )
        VALUES (
          'activity-1',
          'thread-1',
          NULL,
          'tool',
          'tool.completed',
          'Ran command',
          '{"itemType":"command_execution","data":{"item":{"command":"rg backfill","aggregatedOutput":"very large output"}}}',
          NULL,
          '2026-05-21T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 32 });

      const rows = yield* sql<{
        readonly aggregatedOutputType: string | null;
        readonly command: string | null;
      }>`
        SELECT
          json_type(payload_json, '$.data.item.aggregatedOutput') AS "aggregatedOutputType",
          json_extract(payload_json, '$.data.item.command') AS "command"
        FROM projection_thread_activities
        WHERE activity_id = 'activity-1'
      `;

      assert.deepEqual(rows, [
        {
          aggregatedOutputType: null,
          command: "rg backfill",
        },
      ]);
    }),
  );
});
