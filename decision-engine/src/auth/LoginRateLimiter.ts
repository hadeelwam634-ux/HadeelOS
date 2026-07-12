import { Clock } from "../application/types";

/**
 * A minimal fixed-window rate limiter for login attempts, keyed by
 * normalized email. This is the "security baseline" half of PR #12:
 * without it, InvalidCredentialsError alone still lets a client retry
 * a password guess as fast as the network allows.
 *
 * Injectable Clock (same interface every other module in this codebase
 * already uses) so tests don't depend on real wall-clock timing.
 */
export class LoginRateLimiter {
  private attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly maxAttempts: number = 5,
    private readonly windowMs: number = 15 * 60 * 1000,
  ) {}

  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (this.windowExpired(entry.windowStart)) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = Date.parse(this.clock.now());
    const entry = this.attempts.get(key);
    if (!entry || this.windowExpired(entry.windowStart)) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private windowExpired(windowStart: number): boolean {
    return Date.parse(this.clock.now()) - windowStart > this.windowMs;
  }
}
