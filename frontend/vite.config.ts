/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev/preview-server proxy so the frontend's relative fetch("/api/...")
// calls (see src/api/client.ts) reach the real decision-engine backend
// instead of 404ing against Vite's own static server. Target is
// configurable via VITE_API_PROXY_TARGET for E2E runs that spawn the
// backend on a non-default port (see e2e/playwright.config.ts) —
// defaults to the backend's own default PORT (see decision-engine/src/main.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
  preview: {
    proxy: {
      "/api": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
