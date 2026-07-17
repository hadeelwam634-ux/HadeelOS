import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../../src/observability/withRetry";

describe("withRetry", () => {
  it("returns the result immediately on first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(operation, { maxAttempts: 3, baseDelayMs: 10, sleep });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on failure and succeeds on a later attempt", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let attempts = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`fail ${attempts}`);
      return "recovered";
    });

    const result = await withRetry(operation, { maxAttempts: 5, baseDelayMs: 10, sleep });

    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff between attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(withRetry(operation, { maxAttempts: 4, baseDelayMs: 100, sleep })).rejects.toThrow(
      "always fails",
    );

    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(sleep).toHaveBeenNthCalledWith(3, 400);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"));

    await expect(withRetry(operation, { maxAttempts: 3, baseDelayMs: 1, sleep })).rejects.toThrow("third");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("never retries when maxAttempts is 1", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("fail once"));

    await expect(withRetry(operation, { maxAttempts: 1, baseDelayMs: 10, sleep })).rejects.toThrow(
      "fail once",
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
