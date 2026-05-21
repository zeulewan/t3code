import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Remove bulky Codex command output from the projected activity read model.
 *
 * The raw provider event log still keeps the original payload. The projection
 * only needs compact metadata for chat timeline summaries; carrying full
 * `aggregatedOutput` strings makes reload backfill unnecessarily large.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_thread_activities
    SET payload_json = json_remove(payload_json, '$.data.item.aggregatedOutput')
    WHERE json_type(payload_json, '$.data.item.aggregatedOutput') IS NOT NULL
  `;
});
