import { newDb } from "pg-mem";
import { Queryable } from "../../../src/persistence/postgres/Queryable";
import { loadMigrationSql } from "../../../src/persistence/postgres/pool";

/**
 * Builds a fresh, fully-migrated pg-mem instance and returns it wrapped
 * as a Queryable. pg-mem is an in-memory Postgres-wire-compatible engine
 * — it lets these tests exercise the exact SQL the Postgres adapters
 * send (including ON CONFLICT upserts and unique-constraint violations)
 * without a real Postgres server. Applies every migration file in order
 * (001_init.sql, then 002_hardening.sql), same as runMigrations()
 * against a real database, so pg-mem stays schema-identical to
 * production. No sandbox in this environment can run a real Postgres
 * instance for the full test suite; production deployment still
 * targets real Postgres via `pg` — only these tests substitute pg-mem
 * for the driver. See tests/persistence/postgres/restart.test.ts for
 * the one test suite that DOES exercise a real (embedded) Postgres
 * server, to prove restart-survival end to end.
 */
export function createPgMemDb(): Queryable {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.none(loadMigrationSql("001_init.sql"));
  db.public.none(loadMigrationSql("002_hardening.sql"));
  const { Pool } = db.adapters.createPg();
  return new Pool() as unknown as Queryable;
}

const DEFAULT_TEST_USER_ID = "11111111-1111-4111-8111-111111111111";

/** A second, distinct userId for cross-tenant isolation tests. */
export const OTHER_TEST_USER_ID = "22222222-2222-4222-8222-222222222222";

export { DEFAULT_TEST_USER_ID };
