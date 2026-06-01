import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH ordered_threads AS (
      SELECT
        thread_id,
        ((ROW_NUMBER() OVER (
          ORDER BY created_at ASC, thread_id ASC
        ) - 1) % 7) AS identity_index
      FROM projection_threads
      WHERE deleted_at IS NULL
    )
    UPDATE projection_threads
    SET
      identity_preset = CASE (
        SELECT identity_index
        FROM ordered_threads
        WHERE ordered_threads.thread_id = projection_threads.thread_id
      )
        WHEN 0 THEN 'af_sky'
        WHEN 1 THEN 'af_alloy'
        WHEN 2 THEN 'af_sarah'
        WHEN 3 THEN 'am_adam'
        WHEN 4 THEN 'am_echo'
        WHEN 5 THEN 'am_onyx'
        ELSE 'bm_fable'
      END,
      identity_icon = CASE (
        SELECT identity_index
        FROM ordered_threads
        WHERE ordered_threads.thread_id = projection_threads.thread_id
      )
        WHEN 0 THEN 'cloud'
        WHEN 1 THEN 'diamond'
        WHEN 2 THEN 'heart'
        WHEN 3 THEN 'leaf'
        WHEN 4 THEN 'waveform'
        WHEN 5 THEN 'shield'
        ELSE 'book'
      END,
      identity_color = CASE (
        SELECT identity_index
        FROM ordered_threads
        WHERE ordered_threads.thread_id = projection_threads.thread_id
      )
        WHEN 0 THEN '#3A86FF'
        WHEN 1 THEN '#E67E22'
        WHEN 2 THEN '#E63946'
        WHEN 3 THEN '#2ECC71'
        WHEN 4 THEN '#9B59B6'
        WHEN 5 THEN '#7F8C8D'
        ELSE '#F1C40F'
      END
    WHERE thread_id IN (
      SELECT thread_id
      FROM ordered_threads
    )
  `;
});
