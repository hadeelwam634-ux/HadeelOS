import { SignalStore } from "../../types";
import { requireAuth } from "../auth";
import { UnknownTodayResultError } from "../errors";
import { Route } from "../router";
import { asValidatedSignalType, recalculateTodayBodySchema } from "../schemas";

export const recalculateTodayRoute: Route = {
  method: "POST",
  pattern: "/api/today/recalculate",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const parsed = recalculateTodayBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);

    const signalStoreDelta: SignalStore = {};
    for (const entry of parsed.signalStoreDelta) {
      const signalType = asValidatedSignalType(entry.signalType);
      signalStoreDelta[signalType] = { ...entry, signalType };
    }

    const result = await services.todayDecisionApplicationService.runToday({
      userId: auth.userId,
      signalStoreDelta,
      candidateDecisions: parsed.candidateDecisions,
      previouslyAcceptedDecisions: parsed.previouslyAcceptedDecisions,
      accuracyByDecisionType: parsed.accuracyByDecisionType,
      baselineForecast: parsed.baselineForecast,
      sourceVersions: parsed.sourceVersions,
    });

    services.lastToday = result;
    return { status: 200, body: result };
  },
};

/**
 * Returns the most recent recalculation for this user (see the
 * `lastToday` cache documented on UserServices) — 404 if
 * /api/today/recalculate has never been called for this user yet,
 * rather than silently computing a stale/empty result.
 */
export const getTodayRoute: Route = {
  method: "GET",
  pattern: "/api/today",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    if (services.lastToday === null) {
      throw new UnknownTodayResultError();
    }
    return { status: 200, body: services.lastToday };
  },
};
