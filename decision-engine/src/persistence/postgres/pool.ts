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

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));

/**
 * Every migration file, in the order they must be applied. Add new
 * filenames here as new migrations/NNN_*.sql files are created — this
 * list, not directory globbing, is the source of truth for ordering.
 */
const MIGRATION_FILES = ["001_init.sql", "002_hardening.sql"];

/** The raw contents of a given migration file, read fresh each call. */
export function loadMigrationSql(filename: string): string {
  return readFileSync(MIGRATIONS_DIR + filename, "utf-8");
}

/**
 * Applies every file in MIGRATION_FILES, in order, against the given
 * connection. Every statement in every migration file is idempotent
 * (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / guarded
 * `ALTER`s), so calling this more than once against an already-migrated
 * database is safe and a no-op.
 */
export async function runMigrations(db: Queryable): Promise<void> {
  for (const file of MIGRATION_FILES) {
    await db.query(loadMigrationSql(file));
  }
}
