/** Base class for every error this module throws. */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/** Thrown by GoogleTokenExchanger implementations when the code exchange fails. */
export class OAuthExchangeError extends SecurityError {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OAuthExchangeError";
  }
}

/**
 * Thrown by the global per-IP request rate limiter (see
 * RequestRateLimiter.ts) when a client exceeds the configured request
 * budget — defense in depth beyond LoginRateLimiter's login-specific
 * brute-force protection (PR #12), covering every route including
 * unauthenticated ones.
 */
export class RateLimitExceededError extends SecurityError {
  constructor() {
    super("Too many requests. Please slow down and try again shortly.");
    this.name = "RateLimitExceededError";
  }
}
