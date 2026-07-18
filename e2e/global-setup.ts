import { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import EmbeddedPostgresImport from "embedded-postgres";
import { PG_PORT } from "./ports";
import { spawnBackend, writeBackendEnv } from "./backend-control";

const EmbeddedPostgres =
  (EmbeddedPostgresImport as unknown as { default: typeof EmbeddedPostgresImport }).default ??
  EmbeddedPostgresImport;

/**
 * Boots the two things Playwright's own `webServer` config (see
 * playwright.config.ts) cannot: a real Postgres instance and the
 * decision-engine backend pointed at it. This proves the E2E suite
 * exercises the SAME default wiring a real deployment uses (Postgres
 * as the default storage backend — see
 * decision-engine/src/persistence/postgres/StorageBackend.ts), not an
 * in-memory shortcut. The frontend (Vite dev server) is started
 * separately by Playwright's own `webServer` array, proxying /api to
 * BACKEND_URL (see ports.ts and vite.config.ts).
 *
 * The connection string + encryption key are also written to a small
 * JSON file (see backend-control.ts) so
 * tests/full-journey.spec.ts can restart the SAME backend against the
 * SAME database mid-test, to prove session/data survival across a
 * real process restart at the browser level.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const pg = new EmbeddedPostgres({
    databaseDir: `/tmp/hadeelos-e2e-pgdata-${Date.now()}`,
    user: "postgres",
    password: "postgres",
    port: PG_PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();

  const connectionString = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const tokenKey = randomBytes(32).toString("base64");
  writeBackendEnv({ connectionString, tokenKey });

  let backend: ChildProcess;
  try {
    backend = await spawnBackend();
  } catch (err) {
    await pg.stop();
    throw err;
  }

  return async () => {
    // Deliberately NOT killBackend(backend): `backend` here is the
    // handle to the process THIS function originally spawned, but
    // tests/full-journey.spec.ts's restart step may have since SIGTERM'd
    // it and spawned a replacement OS process to prove session/data
    // survival across a real restart. Awaiting killBackend(backend) in
    // that case hangs forever — its "exit" event already fired once for
    // the original process and won't fire again — which is exactly what
    // left the E2E job running 37+ minutes past all 5 tests passing.
    // killBackendOnPort() finds whichever process is actually bound to
    // BACKEND_PORT right now and kills that one, correctly handling
    // both the restarted-and-not-restarted cases.
    const { killBackendOnPort } = await import("./backend-control");
    killBackendOnPort();
    await pg.stop();
  };
}
