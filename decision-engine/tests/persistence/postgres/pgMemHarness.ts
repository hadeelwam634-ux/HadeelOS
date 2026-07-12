import { newDb } from "pg-mem";
import { Queryable } from "../../../src/persistence/postgres/Queryable";
import { loadInitMigrationSql } from "../../../src/persistence/postgres/pool";

/**
 * Builds a fresh, fully-migrated pg-mem instance and returns it wrapped
 * as a Queryable. pg-mem is an in-memory Postgres-wire-compatible engine
 * — it lets these tests exercise the exact SQL the Postgres adapters
 * send (including ON CONFLICT upserts and unique-constraint violations)
 * without a real Postgres server. No sandbox in this environment can
 * run a real Postgres instance, and CI is expected to have the same
 * constraint; production deployment still targets real Postgres via
 * `pg` — only these tests substitute pg-mem for the driver.
 */
export function createPgMemDb(): Queryable {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.none(loadInitMigrationSql());
  const { Pool } = db.adapters.createPg();
  return new Pool() as unknown as Queryable;
}
