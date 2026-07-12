import { Pool, PoolConfig } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Queryable } from "./Queryable";

/**
 * Thin factory around `pg.Pool` so nothing outside this file needs to
 * import `pg` directly. `connectionString` is the only required option;
 * everything else in PoolConfig (ssl, max, etc.) is passed straight
 * through for deployment-specific tuning.
 */
export function createPostgresPool(options: PoolConfig): Pool {
  return new Pool(options);
}

const MIGRATION_PATH = fileURLToPath(
  new URL("../../../migrations/001_init.sql", import.meta.url),
);

/** The raw contents of migrations/001_init.sql, read fresh each call. */
export function loadInitMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

/**
 * Applies migrations/001_init.sql against the given connection. Statements
 * are idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
 * EXISTS`), so calling this more than once against an already-migrated
 * database is safe and a no-op.
 */
export async function runMigrations(db: Queryable): Promise<void> {
  await db.query(loadInitMigrationSql());
}
