import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(SqlitePersistenceMemory);

layer("SqlitePersistence", (it) => {
  it.effect("configures sqlite to wait briefly for busy writers", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const rows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout`;

      assert.equal(rows[0]?.timeout, 5_000);
    }),
  );
});
