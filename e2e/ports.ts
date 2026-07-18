/**
 * Shared port/config constants for the E2E harness. Centralized here
 * (rather than duplicated between global-setup.ts and
 * playwright.config.ts) so the backend, the Postgres instance it talks
 * to, and Vite's dev-server proxy target are always in agreement about
 * which port is which — a mismatch here is a classic source of "E2E
 * tests hang waiting for a server that's listening on the wrong port."
 */
export const BACKEND_PORT = 3900;
export const FRONTEND_PORT = 4300;
export const PG_PORT = 15533;
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
