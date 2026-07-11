import { randomUUID } from "crypto";
import { IncomingMessage, ServerResponse, createServer as createHttpServer, Server } from "http";
import { AppContainer } from "./container";
import { AuthResolver, MockHeaderAuthResolver } from "./auth";
import { HttpMethod, RequestContext, Router } from "./router";
import { InvalidJsonBodyError, mapErrorToHttpResponse } from "./errors";
import { healthRoute } from "./routes/system";
import { getCurrentSignalsRoute, postSignalsRoute } from "./routes/signals";
import { getTodayRoute, recalculateTodayRoute } from "./routes/today";
import {
  getDecisionHistoryRoute,
  recordDecisionOutcomeRoute,
  respondToDecisionRoute,
} from "./routes/decisions";
import { blockMemoryRoute, correctMemoryRoute, forgetMemoryRoute, getMemoryRoute } from "./routes/memory";

function buildRouter(): Router {
  const router = new Router();
  for (const route of [
    healthRoute,
    postSignalsRoute,
    getCurrentSignalsRoute,
    recalculateTodayRoute,
    getTodayRoute,
    respondToDecisionRoute,
    recordDecisionOutcomeRoute,
    getDecisionHistoryRoute,
    getMemoryRoute,
    correctMemoryRoute,
    forgetMemoryRoute,
    blockMemoryRoute,
  ]) {
    router.add(route);
  }
  return router;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export interface CreateAppOptions {
  container?: AppContainer;
  authResolver?: AuthResolver;
}

/**
 * Returns a plain Node request-listener function — not an http.Server —
 * so it can be used both with http.createServer() for real usage
 * (createHttpApiServer() below) and passed directly to supertest's
 * request(app) in tests, which accepts either.
 *
 * Every response carries an `x-request-id` header and, on success, no
 * internal object (repository, service, etc.) ever appears in the
 * body — route handlers only ever return the plain result objects
 * their Application Services already produce.
 */
export function createApp(options: CreateAppOptions = {}) {
  const container = options.container ?? new AppContainer();
  const authResolver = options.authResolver ?? new MockHeaderAuthResolver();
  const router = buildRouter();

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.setHeader("content-type", "application/json");

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = (req.method ?? "GET").toUpperCase() as HttpMethod;
      const { route, params } = router.match(method, url.pathname);

      const body = await readJsonBody(req);
      const authContext = route.public ? null : authResolver.resolve(req.headers);

      const ctx: RequestContext = {
        requestId,
        authContext,
        params,
        query: url.searchParams,
        body,
      };

      const result = await route.handler(ctx, container);
      res.statusCode = result.status;
      res.end(JSON.stringify(result.body));
    } catch (err) {
      const mapped = mapErrorToHttpResponse(err, requestId);
      res.statusCode = mapped.status;
      res.end(JSON.stringify(mapped.body));
    }
  };
}

/** Real usage entry point — wraps createApp()'s listener in an actual http.Server. */
export function createHttpApiServer(options: CreateAppOptions = {}): Server {
  return createHttpServer(createApp(options));
}
