import { requireAuth } from "../auth";
import { Route } from "../router";
import { asValidatedSignalType, postSignalsBodySchema } from "../schemas";
import { SignalStoreEntry } from "../../types";

export const postSignalsRoute: Route = {
  method: "POST",
  pattern: "/api/signals",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const parsed = postSignalsBodySchema.parse(ctx.body);
    const entries: SignalStoreEntry[] = parsed.signals.map((s) => ({
      ...s,
      signalType: asValidatedSignalType(s.signalType),
    }));
    const services = container.forUser(auth.userId);
    const signalStore = await services.signalIngestionService.ingest(entries);
    return { status: 200, body: { signalStore } };
  },
};

export const getCurrentSignalsRoute: Route = {
  method: "GET",
  pattern: "/api/signals/current",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const signalStore = await services.signalIngestionService.getCurrent();
    return { status: 200, body: { signalStore } };
  },
};
