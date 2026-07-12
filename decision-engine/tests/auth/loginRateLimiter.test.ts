import { describe, expect, it } from "vitest";
import { Clock } from "../../src/application/types";
import { LoginRateLimiter } from "../../src/auth/LoginRateLimiter";

class FakeClock implements Clock {
  private current = Date.parse("2026-07-12T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

describe("LoginRateLimiter", () => {
  it("is not blocked before maxAttempts failures", () => {
    const clock = new FakeClock();
    const limiter = new LoginRateLimiter(clock, 3, 1000);
    limiter.recordFailure("x@example.test");
    limiter.recordFailure("x@example.test");
    expect(limiter.isBlocked("x@example.test")).toBe(false);
  });

  it("blocks once maxAttempts failures are recorded within the window", () => {
    const clock = new FakeClock();
    const limiter = new LoginRateLimiter(clock, 3, 1000);
    limiter.recordFailure("x@example.test");
    limiter.recordFailure("x@example.test");
    limiter.recordFailure("x@example.test");
    expect(limiter.isBlocked("x@example.test")).toBe(true);
  });

  it("unblocks once the window has passed", () => {
    const clock = new FakeClock();
    const limiter = new LoginRateLimiter(clock, 2, 1000);
    limiter.recordFailure("x@example.test");
    limiter.recordFailure("x@example.test");
    expect(limiter.isBlocked("x@example.test")).toBe(true);
    clock.advanceMs(1001);
    expect(limiter.isBlocked("x@example.test")).toBe(false);
  });

  it("reset() clears the counter immediately", () => {
    const clock = new FakeClock();
    const limiter = new LoginRateLimiter(clock, 2, 1000);
    limiter.recordFailure("x@example.test");
    limiter.recordFailure("x@example.test");
    expect(limiter.isBlocked("x@example.test")).toBe(true);
    limiter.reset("x@example.test");
    expect(limiter.isBlocked("x@example.test")).toBe(false);
  });

  it("tracks each key independently", () => {
    const clock = new FakeClock();
    const limiter = new LoginRateLimiter(clock, 1, 1000);
    limiter.recordFailure("a@example.test");
    expect(limiter.isBlocked("a@example.test")).toBe(true);
    expect(limiter.isBlocked("b@example.test")).toBe(false);
  });
});
