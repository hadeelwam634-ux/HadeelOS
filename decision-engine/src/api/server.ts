import { randomUUID } from "crypto";
import { IncomingMessage, ServerResponse, createServer as createHttpServer, Server } from "http";
import { AppContainer } from "./container";
import { AuthResolver, SessionTokenAuthResolver } from "./auth";
import { HttpMethod, RequestContext, Router } from "./router";
import { InvalidJsonBodyError, mapErrorToHttpResponse } from "./errors";
import { createHealthRoute, createMetricsRoute } from "./routes/system";
import { createAuthRoutes } from "./routes/auth";
import { getCurrentSignalsRoute, postSignalsRoute } from "./routes/signals";
import { getTodayRoute, recalculateTodayRoute } from "./routes/today";
import {
  getDecisionHistoryRoute,
  recordDecisionOutcomeRoute,
  respondToDecisionRoute,
} from "./routes/decisions";
import { blockMemoryRoute, correctMemoryRoute, forgetMemoryRoute, getMemoryRoute } from "./routes/memory";
import {
  connectCalendarRoute,
  disconnectCalendarRoute,
  getCalendarConnectionRoute,
  syncCalendarRoute,
} from "./routes/calendar";
import {
  connectGmailRoute,
  disconnectGmailRoute,
  getGmailConnectionRoute,
  syncGmailRoute,
} from "./routes/gmail";
import {
  AuthService,
  InMemorySessionRepository,
  InMemoryUserRepository,
  LoginRateLimiter,
} from "../auth";
import { RandomIdGenerator, SystemClock } from "../application/types";
import {
  InMemoryMetricsCollector,
  Logger,
  MetricsCollector,
  NullLogger,
} from "../observability";

function buildRouter(authService: AuthService, metricsCollector: MetricsCollector, startedAt: number): Router {
  const router = new Router();
  for (const route of [
    createHealthRoute(startedAt),
    createMetricsRoute(metricsCollector),
    ...createAuthRoutes(authService),
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
    connectCalendarRoute,
    getCalendarConnectionRoute,
    disconnectCalendarRoute,
    syncCalendarRoute,
    connectGmailRoute,
    getGmailConnectionRoute,
    disconnectGmailRoute,
    syncGmailRoute,
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

/**
 * Builds a fresh AuthService with its own (in-memory, v1) user and
 * session repositories. One call to createApp() == one isolated user
 * directory + session store, same lifetime as the AppContainer it's
 * paired with — this is what lets every test file start from a clean
 * slate just by calling createApp() again.
 */
function createDefaultAuthService(): AuthService {
  return new AuthService(
    new InMemoryUserRepository(),
    new InMemorySessionRepository(),
    new RandomIdGenerator(),
    new SystemClock(),
    new LoginRateLimiter(new SystemClock()),
  );
}

export interface CreateAppOptions {
  container?: AppContainer;
  authResolver?: AuthResolver;
  /**
   * The AuthService backing register/login/logout routes. If you pass
   * a custom `authResolver` that is NOT built from this same
   * AuthService instance, tokens issued by /api/auth/login will not
   * resolve — the resolver and the routes must share one AuthService.
   */
  authService?: AuthService;
  /**
   * Structured request logger (PR #15). Defaults to NullLogger so
   * tests stay silent by default; real usage should pass a
   * ConsoleLogger (or any other Logger implementation).
   */
  logger?: Logger;
  /**
   * Records per-request method/path/status/duration so
   * GET /api/system/metrics has something to report. Defaults to a
   * fresh InMemoryMetricsCollector per createApp() call, same lifetime
   * as the AppContainer/AuthService it's paired with.
   */
  metricsCollector?: MetricsCollector;
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
  const authService = options.authService ?? createDefaultAuthService();
  const authResolver = options.authResolver ?? new SessionTokenAuthResolver(authService);
  const logger = options.logger ?? new NullLogger();
  const metricsCollector = options.metricsCollector ?? new InMemoryMetricsCollector();
  const startedAt = Date.now();
  const router = buildRouter(authService, metricsCollector, startedAt);

  return async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    res.setHeader("x-request-id", requestId);
    res.setHeader("content-type", "application/json");

    const url = new URL(req.url ?? "/", "http://localhost");
    const method = (req.method ?? "GET").toUpperCase() as HttpMethod;

    // Finalizes the response, then records the observability side
    // effects (metrics + structured log) exactly once per request,
    // regardless of which branch below produced the status — this is
    // the single seam PR #15 adds to the request lifecycle; no route
    // handler needs to know observability exists.
    const finish = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
      const durationMs = Date.now() - requestStartedAt;
      metricsCollector.record({ method, path: url.pathname, status, durationMs });
      logger.log(status >= 500 ? "error" : "info", "http_request", {
        requestId,
        method,
        path: url.pathname,
        status,
        durationMs,
      });
    };

    try {
      const { route, params } = router.match(method, url.pathname);

      const body = await readJsonBody(req);
      const authContext = route.public ? null : await authResolver.resolve(req.headers);

      const ctx: RequestContext = {
        requestId,
        authContext,
        params,
        query: url.searchParams,
        body,
      };

      const result = await route.handler(ctx, container);
      finish(result.status, result.body);
    } catch (err) {
      const mapped = mapErrorToHttpResponse(err, requestId);
      finish(mapped.status, mapped.body);
    }
  };
}

/** Real usage entry point — wraps createApp()'s listener in an actual http.Server. */
export function createHttpApiServer(options: CreateAppOptions = {}): Server {
  return createHttpServer(createApp(options));
}
