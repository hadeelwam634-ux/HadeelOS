import { Clock } from "../application/types";
import { RateLimitExceededError } from "./errors";

/**
 * General-purpose per-key fixed-window rate limiter — the same
 * algorithm as auth/LoginRateLimiter.ts, generalized beyond login so
 * every route (not just /api/auth/login) has SOME protection against a
 * client hammering the API. Keyed by client IP by default (see
 * server.ts's handleRequest), but the key is caller-supplied so it
 * could be scoped differently (e.g. per-user) if a future need arises.
 *
 * Generous defaults (300 requests / 60s per key) are deliberately
 * chosen so a single legitimate user's browser (Today Cockpit polling,
 * a burst of memory-panel actions, etc.) never trips it, while a
 * scripted abuse pattern eventually does. Injectable Clock, same
 * pattern as every other module in this codebase, so tests don't
 * depend on real wall-clock timing.
 */
export class RequestRateLimiter {
  private hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly maxRequests: number = 300,
    private readonly windowMs: number = 60_000,
  ) {}

  /** Throws RateLimitExceededError if `key` has exceeded its budget for the current window. */
  assertNotExceeded(key: string): void {
    const now = Date.parse(this.clock.now());
    const entry = this.hits.get(key);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: now });
      return;
    }

    if (entry.count >= this.maxRequests) {
      throw new RateLimitExceededError();
    }

    entry.count += 1;
  }
}
