import { requireAuth } from "../auth";
import { Route } from "../router";
import { blockMemoryBodySchema, correctMemoryBodySchema, idParamSchema } from "../schemas";

export const getMemoryRoute: Route = {
  method: "GET",
  pattern: "/api/memory",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const services = container.forUser(auth.userId);
    const memories = await services.memoryMapService.getMemoryMap(auth.userId);
    return { status: 200, body: { memories } };
  },
};

export const correctMemoryRoute: Route = {
  method: "POST",
  pattern: "/api/memory/:id/correct",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const { value } = correctMemoryBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    const memory = await services.memoryGovernanceService.correct(id, value);
    return { status: 200, body: { memory } };
  },
};

export const forgetMemoryRoute: Route = {
  method: "POST",
  pattern: "/api/memory/:id/forget",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const services = container.forUser(auth.userId);
    const memory = await services.memoryGovernanceService.forget(id);
    return { status: 200, body: { memory } };
  },
};

export const blockMemoryRoute: Route = {
  method: "POST",
  pattern: "/api/memory/:id/block",
  handler: async (ctx, container) => {
    const auth = requireAuth(ctx.authContext);
    const { id } = idParamSchema.parse(ctx.params);
    const { reason } = blockMemoryBodySchema.parse(ctx.body);
    const services = container.forUser(auth.userId);
    const memory = await services.memoryGovernanceService.blockInference(id, reason);
    return { status: 200, body: { memory } };
  },
};
