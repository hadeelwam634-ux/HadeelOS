/**
 * API-layer error hierarchy (PR #9).
 *
 * Route handlers never construct raw HTTP responses for failure cases
 * themselves — they throw one of these (or let an underlying
 * Application/domain error from src/{application,twin,memory,
 * knowledge-graph,learning,counterfactual}/errors.ts propagate), and
 * mapErrorToHttpResponse() in this same file is the single place that
 * decides the resulting status code and response body. This keeps the
 * "structured errors, no stack traces to the client" rule enforced in
 * exactly one place instead of scattered across every route.
 */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** No usable AuthContext could be resolved for this request. */
export class UnauthenticatedError extends ApiError {
  constructor(message = "Authentication is required for this endpoint.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * An AuthContext was resolved, but it is not allowed to perform this
 * action. Reserved for future use once cross-resource authorization
 * rules exist beyond per-user container isolation (see container.ts) —
 * v1 does not throw this itself, since every repository/service in a
 * user's AppContainer only ever contains that user's own data, so a
 * request for another user's resource id structurally 404s instead of
 * needing an explicit ownership check.
 */
export class ForbiddenError extends ApiError {
  constructor(message = "You are not allowed to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** No route matched the request's method + path. */
export class RouteNotFoundError extends ApiError {
  constructor(method: string, path: string) {
    super(`No route matches ${method} ${path}.`);
    this.name = "RouteNotFoundError";
  }
}

/** The request body was not valid JSON. */
export class InvalidJsonBodyError extends ApiError {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export interface HttpErrorResponse {
  status: number;
  body: {
    error: {
      name: string;
      message: string;
      requestId: string;
      /** Only populated for Zod validation failures — field-level detail. */
      issues?: Array<{ path: string; message: string }>;
    };
  };
}

/**
 * Maps any thrown value to an HTTP status + structured body. Order
 * matters: checked from most specific to least specific. Domain error
 * base classes (ApplicationError, DigitalTwinError, MemoryError,
 * KnowledgeGraphError, LearningError, CounterfactualError) are
 * recognized by their `name` ending in "Error" and matched via the
 * "Unknown*"/"Duplicate*" prefixes their subclasses consistently use
 * throughout the codebase — see each module's errors.ts — rather than
 * importing every subclass individually here, which would recreate a
 * long, easily-stale switch statement.
 *
 * Never includes `.stack` or `.cause` in the response body — only a
 * human-readable message and, for validation errors, per-field issues.
 */
export function mapErrorToHttpResponse(err: unknown, requestId: string): HttpErrorResponse {
  const name = err instanceof Error ? err.name : "UnknownError";
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";

  if (isZodError(err)) {
    return {
      status: 400,
      body: {
        error: {
          name: "ValidationError",
          message: "The request did not match the expected shape.",
          requestId,
          issues: err.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  if (err instanceof UnauthenticatedError) {
    return { status: 401, body: { error: { name, message, requestId } } };
  }

  if (err instanceof ForbiddenError) {
    return { status: 403, body: { error: { name, message, requestId } } };
  }

  if (err instanceof RouteNotFoundError || name.startsWith("Unknown")) {
    return { status: 404, body: { error: { name, message, requestId } } };
  }

  if (name.startsWith("Duplicate")) {
    return { status: 409, body: { error: { name, message, requestId } } };
  }

  if (err instanceof InvalidJsonBodyError) {
    return { status: 400, body: { error: { name, message, requestId } } };
  }

  if (isKnownDomainError(err)) {
    return { status: 422, body: { error: { name, message, requestId } } };
  }

  // Unexpected/unhandled failure: never leak internals, never a stack trace.
  return {
    status: 500,
    body: {
      error: {
        name: "InternalServerError",
        message: "An unexpected error occurred.",
        requestId,
      },
    },
  };
}

function isZodError(err: unknown): err is { name: string; issues: Array<{ path: (string | number)[]; message: string }> } {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "ZodError" &&
    "issues" in err
  );
}

const DOMAIN_ERROR_BASE_NAMES = new Set([
  "ApplicationError",
  "DigitalTwinError",
  "MemoryError",
  "KnowledgeGraphError",
  "LearningError",
  "CounterfactualError",
]);

function isKnownDomainError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Walk the prototype chain looking for one of the module base error
  // classes by name, since instanceof against every imported subclass
  // would require importing all of them here.
  let proto: unknown = Object.getPrototypeOf(err);
  while (proto) {
    const ctorName = (proto as { constructor?: { name?: string } }).constructor?.name;
    if (ctorName && DOMAIN_ERROR_BASE_NAMES.has(ctorName)) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

/** No POST /api/today/recalculate has ever been run for this user yet. */
export class UnknownTodayResultError extends ApiError {
  constructor() {
    super("No Today recalculation has been run for this user yet.");
    this.name = "UnknownTodayResultError";
  }
}
