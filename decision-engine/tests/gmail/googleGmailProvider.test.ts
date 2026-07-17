import { describe, expect, it, vi } from "vitest";
import { GoogleGmailProvider } from "../../src/gmail/GoogleGmailProvider";
import { GmailProviderError } from "../../src/gmail/errors";
import { GmailConnection } from "../../src/gmail/types";
import { CircuitBreaker } from "../../src/observability/CircuitBreaker";
import { CircuitOpenError } from "../../src/observability/errors";
import { Clock } from "../../src/application/types";

class FakeClock implements Clock {
  private current = Date.parse("2026-07-17T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
}

const noSleepRetryOptions = { maxAttempts: 3, baseDelayMs: 1, sleep: async () => {} };

const connection: GmailConnection = {
  userId: "user-1",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  connectedAt: "2026-01-01T00:00:00.000Z",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("GoogleGmailProvider reliability (PR #15)", () => {
  it("retries a transient network failure and succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new Error("ECONNRESET");
      return jsonResponse({ resultSizeEstimate: 5 });
    });
    const provider = new GoogleGmailProvider(
      "client-id",
      "client-secret",
      fetchImpl as unknown as typeof fetch,
      undefined,
      noSleepRetryOptions,
    );

    const count = await provider.countUnread(connection);
    expect(count).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and throws GmailProviderError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("always down"));
    const provider = new GoogleGmailProvider(
      "client-id",
      "client-secret",
      fetchImpl as unknown as typeof fetch,
      undefined,
      noSleepRetryOptions,
    );

    await expect(provider.countUnread(connection)).rejects.toBeInstanceOf(GmailProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails fast via the circuit breaker once it is open, without calling fetch", async () => {
    const clock = new FakeClock();
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 1, cooldownMs: 60_000, clock });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const provider = new GoogleGmailProvider(
      "client-id",
      "client-secret",
      fetchImpl as unknown as typeof fetch,
      breaker,
      { maxAttempts: 1, baseDelayMs: 1, sleep: async () => {} },
    );

    await expect(provider.countUnread(connection)).rejects.toBeInstanceOf(GmailProviderError);
    const callsBeforeOpen = fetchImpl.mock.calls.length;

    await expect(provider.countUnread(connection)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeOpen);
  });
});
