import { describe, expect, it } from "vitest";
import { RequestRateLimiter } from "../../src/security/RequestRateLimiter";
import { RateLimitExceededError } from "../../src/security/errors";
import { Clock } from "../../src/application/types";

function fixedClock(iso: string): Clock {
  return { now: () => iso };
}

describe("RequestRateLimiter", () => {
  it("allows requests under the budget", () => {
    const limiter = new RequestRateLimiter(fixedClock("2026-07-01T00:00:00.000Z"), 3, 60_000);
    expect(() => limiter.assertNotExceeded("1.2.3.4")).not.toThrow();
    expect(() => limiter.assertNotExceeded("1.2.3.4")).not.toThrow();
    expect(() => limiter.assertNotExceeded("1.2.3.4")).not.toThrow();
  });

  it("throws RateLimitExceededError once the budget is exceeded", () => {
    const limiter = new RequestRateLimiter(fixedClock("2026-07-01T00:00:00.000Z"), 2, 60_000);
    limiter.assertNotExceeded("1.2.3.4");
    limiter.assertNotExceeded("1.2.3.4");
    expect(() => limiter.assertNotExceeded("1.2.3.4")).toThrow(RateLimitExceededError);
  });

  it("tracks each key independently", () => {
    const limiter = new RequestRateLimiter(fixedClock("2026-07-01T00:00:00.000Z"), 1, 60_000);
    limiter.assertNotExceeded("1.2.3.4");
    expect(() => limiter.assertNotExceeded("5.6.7.8")).not.toThrow();
  });

  it("resets the budget once the window has passed", () => {
    let now = "2026-07-01T00:00:00.000Z";
    const clock: Clock = { now: () => now };
    const limiter = new RequestRateLimiter(clock, 1, 60_000);
    limiter.assertNotExceeded("1.2.3.4");
    expect(() => limiter.assertNotExceeded("1.2.3.4")).toThrow(RateLimitExceededError);

    now = "2026-07-01T00:02:00.000Z";
    expect(() => limiter.assertNotExceeded("1.2.3.4")).not.toThrow();
  });
});
