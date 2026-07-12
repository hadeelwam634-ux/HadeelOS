import { UUID } from "../types";
import { AuthService } from "../auth";
import { UnauthenticatedError } from "./errors";

/**
 * What every route handler gets instead of a raw request: which user
 * this request is acting as. Every AppContainer lookup and every
 * service call in a route handler is scoped by authContext.userId —
 * never by a userId read from the request body/params, which a client
 * could forge to act as another user.
 */
export interface AuthContext {
  userId: UUID;
}

/**
 * Resolves an AuthContext from raw request headers, or null if the
 * request is unauthenticated. Deliberately an interface (not a single
 * hard-coded implementation), and deliberately async: real session
 * verification (SessionTokenAuthResolver, PR #12) is a repository
 * lookup, not a synchronous header read.
 */
export interface AuthResolver {
  resolve(
    headers: Record<string, string | string[] | undefined>,
  ): AuthContext | null | Promise<AuthContext | null>;
}

/**
 * v1 mock auth: trusts an `x-user-id` header as-is, with no session,
 * token, or password involved. No longer wired as createApp()'s
 * default (see server.ts) — SessionTokenAuthResolver is real auth now
 * — but kept exported for local scripting/manual testing against a
 * pre-existing userId without going through register/login.
 */
export class MockHeaderAuthResolver implements AuthResolver {
  resolve(headers: Record<string, string | string[] | undefined>): AuthContext | null {
    const raw = headers["x-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId || userId.trim().length === 0) return null;
    return { userId: userId.trim() };
  }
}

/**
 * Real auth (PR #12): reads `Authorization: Bearer <token>` and asks
 * AuthService to look the token up. This is the only thing that
 * changed to go from "trust a header" to "verify a session" — no route
 * handler anywhere had to change, exactly as PR #9's original doc
 * comment on this interface promised.
 */
export class SessionTokenAuthResolver implements AuthResolver {
  constructor(private readonly authService: AuthService) {}

  async resolve(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthContext | null> {
    const raw = headers["authorization"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !value.startsWith("Bearer ")) return null;
    const token = value.slice("Bearer ".length).trim();
    if (!token) return null;
    const resolved = await this.authService.resolveSession(token);
    return resolved;
  }
}

/** Throws UnauthenticatedError if no AuthContext could be resolved. */
export function requireAuth(authContext: AuthContext | null): AuthContext {
  if (authContext === null) {
    throw new UnauthenticatedError();
  }
  return authContext;
}
