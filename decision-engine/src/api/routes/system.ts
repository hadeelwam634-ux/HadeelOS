import { Route } from "../router";

/**
 * The only route in this module that does not require authentication —
 * used by uptime checks / load balancers, which have no user context.
 * Deliberately reveals nothing about internal state (no signal counts,
 * no user data) — see PR #15 for the fuller readiness endpoint.
 */
export const healthRoute: Route = {
  method: "GET",
  pattern: "/api/system/health",
  public: true,
  handler: async () => ({ status: 200, body: { status: "ok" } }),
};
