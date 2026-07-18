import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import EmbeddedPostgresImport from "embedded-postgres";
const EmbeddedPostgres = (EmbeddedPostgresImport as unknown as { default: typeof EmbeddedPostgresImport }).default ?? EmbeddedPostgresImport;

/**
 * The one test in this suite that proves — end to end, through a real
 * OS process boundary — that PostgreSQL as the default storage backend
 * actually delivers on "data and sessions survive a restart" (MVP
 * Hardening requirement #7), not just that the Postgres repository
 * classes behave correctly against pg-mem (see the other Postgres
 * repository contract tests elsewhere in this tests/ tree, which use
 * pg-mem and never leave the test process).
 *
 * What this test actually does:
 *   1. Boots a real, embedded PostgreSQL server (no Docker/root needed
 *      — see devDependency "embedded-postgres") on a scratch port.
 *   2. Spawns `tsx src/main.ts` — the real production entrypoint — as
 *      a child process pointed at that database via DATABASE_URL.
 *   3. Registers a user, logs in, ingests a signal, and connects a
 *      (fake-token) calendar connection over real HTTP.
 *   4. Kills that child process (SIGTERM — same signal a real
 *      deployment's process manager sends).
 *   5. Spawns a BRAND NEW child process against the SAME database.
 *   6. Proves, using the SAME session token from step 3, that the
 *      session, the signal, and the calendar connection are all still
 *      there — i.e. neither the login nor the data was lost by the
 *      restart.
 *
 * This is slow by test-suite standards (two real process boots + a
 * real Postgres boot) — that cost buys a guarantee no in-process test
 * can: that main.ts, AppContainer's default wiring, and the Postgres
 * repositories all compose correctly for a real deployment, not just
 * in isolation.
 */
describe("Restart survival (real embedded Postgres + real child process)", () => {
  let pg: InstanceType<typeof EmbeddedPostgres>;
  let connectionString: string;
  const port = 15532;
  const appPort = 45631;
  const tokenKey = randomBytes(32).toString("base64");

  beforeAll(async () => {
    pg = new EmbeddedPostgres({
      databaseDir: `/tmp/hadeelos-restart-test-pgdata-${Date.now()}`,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    connectionString = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  }, 60_000);

  afterAll(async () => {
    await pg.stop();
  });

  function spawnApp(): ChildProcess {
    return spawn(process.execPath, ["--import", "tsx/esm", "src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: connectionString,
        TOKEN_ENCRYPTION_KEY: tokenKey,
        PORT: String(appPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async function waitForHealth(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${appPort}/api/system/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("App did not become healthy in time");
  }

  async function killAndWaitExit(child: ChildProcess): Promise<void> {
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  }

  it(
    "keeps a session and previously-written data alive across a full process restart",
    { timeout: 90_000 },
    async () => {
      const first = spawnApp();
      let firstStderr = "";
      first.stderr?.on("data", (d) => (firstStderr += d.toString()));
      try {
        await waitForHealth();

        const email = `restart-${Date.now()}@example.test`;
        const password = "Sup3rSecret!42";
        const registerRes = await fetch(`http://127.0.0.1:${appPort}/api/auth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        expect(registerRes.status).toBe(201);
        const { token } = (await registerRes.json()) as { token: string };
        expect(token).toBeTruthy();

        const signalRes = await fetch(`http://127.0.0.1:${appPort}/api/signals`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            signals: [
              {
                signalType: "sleep_duration",
                latestValue: 7.5,
                latestTimestamp: new Date().toISOString(),
                reliabilityScore: 0.9,
                syncConsistencyDays: 3,
              },
            ],
          }),
        });
        expect(signalRes.status).toBe(200);

        const connectRes = await fetch(`http://127.0.0.1:${appPort}/api/calendar/connect`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            calendarId: "primary",
            accessToken: "restart-test-access-token",
            refreshToken: "restart-test-refresh-token",
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        });
        expect(connectRes.status).toBe(200);

        await killAndWaitExit(first);

        const second = spawnApp();
        try {
          await waitForHealth();

          // Same session token, brand-new process: proves
          // PostgresSessionRepository (not InMemorySessionRepository)
          // is what's actually backing auth by default when
          // DATABASE_URL is set.
          const signalsAfterRestart = await fetch(`http://127.0.0.1:${appPort}/api/signals/current`, {
            headers: { authorization: `Bearer ${token}` },
          });
          expect(signalsAfterRestart.status).toBe(200);
          const body = (await signalsAfterRestart.json()) as { signalStore: Record<string, unknown> };
          expect(body.signalStore.sleep_duration).toBeTruthy();

          const connectionAfterRestart = await fetch(`http://127.0.0.1:${appPort}/api/calendar/connection`, {
            headers: { authorization: `Bearer ${token}` },
          });
          expect(connectionAfterRestart.status).toBe(200);
          const connBody = (await connectionAfterRestart.json()) as { connection: { calendarId: string } | null };
          expect(connBody.connection?.calendarId).toBe("primary");
        } finally {
          await killAndWaitExit(second);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("first process stderr:\n", firstStderr);
        throw err;
      }
    },
  );
});
