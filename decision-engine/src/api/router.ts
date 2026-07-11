import { AuthContext } from "./auth";
import { AppContainer } from "./container";
import { RouteNotFoundError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestContext {
  readonly requestId: string;
  readonly authContext: AuthContext | null;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export type RouteHandler = (ctx: RequestContext, container: AppContainer) => Promise<HandlerResult>;

export interface Route {
  method: HttpMethod;
  /** e.g. "/api/decisions/:id/respond" */
  pattern: string;
  /** Set true for endpoints that must work with no AuthContext (only /api/system/health). */
  public?: boolean;
  handler: RouteHandler;
}

interface CompiledRoute extends Route {
  segments: string[];
}

/**
 * Deliberately not a framework dependency (no Express etc. — PR #9's
 * spec only calls for installing zod and supertest) — this repository
 * has stayed dependency-light throughout, and a dozen routes with
 * simple `/segment/:param` patterns don't need one. Matching is a
 * straightforward segment-by-segment comparison; `:name` segments bind
 * to ctx.params.name.
 */
export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(route: Route): void {
    this.routes.push({ ...route, segments: route.pattern.split("/").filter((s) => s.length > 0) });
  }

  match(method: HttpMethod, pathname: string): { route: Route; params: Record<string, string> } {
    const pathSegments = pathname.split("/").filter((s) => s.length > 0);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSegment = route.segments[i];
        const pathSegment = decodeURIComponent(pathSegments[i]);
        if (routeSegment.startsWith(":")) {
          params[routeSegment.slice(1)] = pathSegment;
        } else if (routeSegment !== pathSegment) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }

    throw new RouteNotFoundError(method, pathname);
  }
}
