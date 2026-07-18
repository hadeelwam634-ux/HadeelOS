import { defineConfig } from "@playwright/test";
import { BACKEND_URL, FRONTEND_PORT, FRONTEND_URL } from "./ports";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    // --host 127.0.0.1 is required, not cosmetic: Vite's default "localhost"
    // bind can resolve to the IPv6 loopback (::1) depending on the host's
    // DNS/Node config, while FRONTEND_URL above (see ./ports.ts) polls
    // 127.0.0.1 explicitly. Without a matching explicit bind, Vite comes up
    // fine but Playwright's readiness poll never connects, and the
    // webServer wait times out even though the dev server is healthy.
    command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
    cwd: "../frontend",
    url: FRONTEND_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_PROXY_TARGET: BACKEND_URL,
    },
  },
});
