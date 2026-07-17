import { describe, expect, it } from "vitest";
import { Clock } from "../../src/application/types";
import { CircuitBreaker } from "../../src/observability/CircuitBreaker";
import { CircuitOpenError } from "../../src/observability/errors";

class FakeClock implements Clock {
  private current = Date.parse("2026-07-17T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

function buildBreaker(clock: FakeClock, failureThreshold = 3, cooldownMs = 1000) {
  return new CircuitBreaker({ name: "test-circuit", failureThreshold, cooldownMs, clock });
}

describe("CircuitBreaker", () => {
  it("starts closed and allows calls through", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock);
    expect(breaker.getState()).toBe("closed");
    const result = await breaker.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after reaching the consecutive-failure threshold", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock, 3);
    const failing = async () => {
      throw new Error("upstream down");
    };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow("upstream down");
    }

    expect(breaker.getState()).toBe("open");
  });

  it("fails fast with CircuitOpenError while open, without calling the operation", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock, 1);
    await expect(
      breaker.execute(async () => {
        throw new Error("first failure trips it");
      }),
    ).rejects.toThrow("first failure trips it");

    let called = false;
    await expect(
      breaker.execute(async () => {
        called = true;
        return "should not run";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  it("moves to half-open after the cooldown and closes again on success", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock, 1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error("trip it");
      }),
    ).rejects.toThrow("trip it");
    expect(breaker.getState()).toBe("open");

    clock.advanceMs(1000);
    expect(breaker.getState()).toBe("half-open");

    const result = await breaker.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens immediately if the half-open trial call fails", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock, 1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error("trip it");
      }),
    ).rejects.toThrow("trip it");

    clock.advanceMs(1000);
    expect(breaker.getState()).toBe("half-open");

    await expect(
      breaker.execute(async () => {
        throw new Error("still down");
      }),
    ).rejects.toThrow("still down");
    expect(breaker.getState()).toBe("open");
  });

  it("resets the consecutive-failure count on any success", async () => {
    const clock = new FakeClock();
    const breaker = buildBreaker(clock, 3);
    await expect(
      breaker.execute(async () => {
        throw new Error("fail 1");
      }),
    ).rejects.toThrow();
    await expect(
      breaker.execute(async () => {
        throw new Error("fail 2");
      }),
    ).rejects.toThrow();
    // Success in between should reset the streak.
    await breaker.execute(async () => "ok");

    await expect(
      breaker.execute(async () => {
        throw new Error("fail 3");
      }),
    ).rejects.toThrow();
    // Only one consecutive failure since the reset — still closed.
    expect(breaker.getState()).toBe("closed");
  });
});
