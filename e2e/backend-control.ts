import { spawn, execSync, ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_PORT, BACKEND_URL } from "./ports";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECISION_ENGINE_DIR = path.resolve(__dirname, "../decision-engine");
export const ENV_FILE = path.join(__dirname, ".e2e-backend-env.json");

export interface BackendEnv {
  connectionString: string;
  tokenKey: string;
}

export function writeBackendEnv(env: BackendEnv): void {
  writeFileSync(ENV_FILE, JSON.stringify(env), "utf-8");
}

export function readBackendEnv(): BackendEnv {
  return JSON.parse(readFileSync(ENV_FILE, "utf-8")) as BackendEnv;
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/system/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms`);
}

/**
 * Spawns the real production entrypoint (src/main.ts — same file
 * main.ts, same "npm run start" path a real deployment uses) pointed
 * at the SAME Postgres database global-setup.ts already migrated and
 * seeded, on the same BACKEND_PORT the frontend's Vite dev-server proxy
 * is wired to. Used both by global-setup.ts (initial boot) and by
 * tests/full-journey.spec.ts (the mid-test "kill and restart" step
 * that proves session/data survival across a real process restart, at
 * the browser level this time — not just decision-engine's own
 * process-restart integration test).
 */
export async function spawnBackend(): Promise<ChildProcess> {
  const env = readBackendEnv();
  const child = spawn(process.execPath, ["--import", "tsx/esm", "src/main.ts"], {
    cwd: DECISION_ENGINE_DIR,
    env: {
      ...process.env,
      DATABASE_URL: env.connectionString,
      TOKEN_ENCRYPTION_KEY: env.tokenKey,
      PORT: String(BACKEND_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth(30_000);
  return child;
}

export async function killBackend(child: ChildProcess): Promise<void> {
  // If the process has already exited — e.g. it's the ORIGINAL handle
  // from global-setup.ts, and full-journey.spec.ts's "backend restart"
  // test already SIGTERM'd it and spawned a replacement — its "exit"
  // event already fired once and will never fire again. Awaiting a
  // fresh listener for it here would hang forever: this is exactly
  // what made the E2E job in CI run 37+ minutes past all 5 tests
  // passing, never completing, until manually cancelled. Guard against
  // that by checking exitCode/signalCode (both non-null only once the
  // process has actually exited) before waiting on anything.
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

/**
 * Kills whatever process is currently bound to BACKEND_PORT, regardless
 * of which ChildProcess handle spawned it. Used by global-setup.ts's
 * teardown instead of killBackend(originalHandle): after
 * full-journey.spec.ts's mid-suite restart, the process actually
 * serving BACKEND_PORT is a different OS process than the one
 * global-setup.ts originally spawned, and no in-process handle to it
 * is available across the setup/worker process boundary (they
 * communicate only via the ENV_FILE, same as DATABASE_URL/tokenKey
 * above). Finding-by-port is the same technique the restart step
 * itself already uses, and works correctly whether or not a restart
 * ever happened.
 */
export function killBackendOnPort(): void {
  try {
    const pid = execSync(`lsof -t -i:${BACKEND_PORT}`).toString().trim().split("\n")[0];
    if (pid) process.kill(Number(pid), "SIGTERM");
  } catch {
    // lsof unavailable or nothing bound - already stopped, or never
    // started; nothing to do.
  }
}
