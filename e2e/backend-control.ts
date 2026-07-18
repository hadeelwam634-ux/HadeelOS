import { spawn, ChildProcess } from "node:child_process";
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
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
