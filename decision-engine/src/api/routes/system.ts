import { MetricsCollector } from "../../observability";
import { Route } from "../router";

/**
 * The only route in this module that does not require authentication —
 * used by uptime checks / load balancers, which have no user context.
 * Deliberately reveals nothing about internal state (no signal counts,
 * no user data) — just enough for a liveness probe to know the process
 * is up and how long it has been running.
 */
export function createHealthRoute(startedAt: number): Route {
  return {
    method: "GET",
    pattern: "/api/system/health",
    public: true,
    handler: async () => ({
      status: 200,
      body: { status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) },
    }),
  };
}

/**
 * Operational metrics (PR #15): request counts, error rate, and
 * latency percentiles since process start. Public and read-only,
 * matching healthRoute — this exposes aggregate operational data only,
 * never per-user or per-request content (no paths with ids, no bodies,
 * no tokens). Intended for dashboards/alerting, not for end users.
 */
export function createMetricsRoute(metricsCollector: MetricsCollector): Route {
  return {
    method: "GET",
    pattern: "/api/system/metrics",
    public: true,
    handler: async () => ({ status: 200, body: metricsCollector.snapshot() }),
  };
}

/**
 * Public, read-only client configuration. Exposes only the Google
 * OAuth client_id (never a secret — client_id is meant to be public;
 * it just identifies this app to Google's consent screen, the same
 * value that appears in the browser's address bar during the OAuth
 * redirect) so the frontend can build a real "Connect Google account"
 * flow without needing its own copy of GOOGLE_CLIENT_ID baked in at
 * frontend build time. null when Google OAuth isn't configured, so
 * the frontend can hide the real-connect button and fall back to the
 * mock connector only (see ConnectorsPanel.tsx).
 */
export function createClientConfigRoute(): Route {
  return {
    method: "GET",
    pattern: "/api/system/config",
    public: true,
    handler: async () => ({
      status: 200,
      body: { googleClientId: process.env.GOOGLE_CLIENT_ID ?? null },
    }),
  };
}
