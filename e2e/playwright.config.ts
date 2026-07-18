import { defineConfig } from "@playwright/test";
import { BACKEND_URL, FRONTEND_PORT, FRONTEND_URL } from "./ports";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
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
    command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
    cwd: "../frontend",
    url: FRONTEND_URL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_API_PROXY_TARGET: BACKEND_URL,
    },
  },
});
