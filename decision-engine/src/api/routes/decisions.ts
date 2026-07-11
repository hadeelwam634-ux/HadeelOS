import { requireAuth } from "../auth";
import { Route } from "../router";
import { idParamSchema, outcomeBodySchema, respondBodySchema } from "../schemas";

export const respondToDecisionRoute: Route = {
  method: "POST",
  pattern: "/api/decisions/:id/respond",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const { action } = respondBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    const entry = await services.decisionLifecycleService.respond(id, action);
    return { status: 200, body: { entry } };
  },
};

export const recordDecisionOutcomeRoute: Route = {
  method: "POST",
  pattern: "/api/decisions/:id/outcome",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const { outcome } = outcomeBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    const entry = await services.decisionLifecycleService.recordOutcome(id, outcome);
    return { status: 200, body: { entry } };
  },
};

export const getDecisionHistoryRoute: Route = {
  method: "GET",
  pattern: "/api/decisions/:id/history",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const services = container.forUser(auth.userId);
    const history = await services.decisionLifecycleService.getHistory(id);
    return { status: 200, body: { history } };
  },
};
