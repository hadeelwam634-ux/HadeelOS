import { UUID } from "../types";
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
 * hard-coded implementation) so PR #12's real session/token
 * authentication can replace MockHeaderAuthResolver later without
 * touching a single route handler.
 */
export interface AuthResolver {
  resolve(headers: Record<string, string | string[] | undefined>): AuthContext | null;
}

/**
 * v1 mock auth: trusts an `x-user-id` header as-is. This is explicitly
 * NOT real authentication — there is no session, token, or password
 * involved, and it must not be used past local development / the
 * automated test suite. PR #12 ("Security baseline: authentication,
 * authorization, privacy, and audit controls") replaces this with real
 * session/token verification; every route handler already only depends
 * on the AuthResolver interface, so that swap requires no route
 * changes. Deliberately still requires *some* userId (never falls back
 * to a global/default user) so "no state sharing between users" holds
 * even in this mock form.
 */
export class MockHeaderAuthResolver implements AuthResolver {
  resolve(headers: Record<string, string | string[] | undefined>): AuthContext | null {
    const raw = headers["x-user-id"];
    const userId = Array.isArray(raw) ? raw[0] : raw;
    if (!userId || userId.trim().length === 0) return null;
    return { userId: userId.trim() };
  }
}

/** Throws UnauthenticatedError if no AuthContext could be resolved. */
export function requireAuth(authContext: AuthContext | null): AuthContext {
  if (authContext === null) {
    throw new UnauthenticatedError();
  }
  return authContext;
}
