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
