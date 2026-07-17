import { describe, expect, it } from "vitest";
import { InMemoryLogger } from "../../src/observability/Logger";

describe("InMemoryLogger", () => {
  it("captures log entries with level, message, and fields", () => {
    const logger = new InMemoryLogger();
    logger.log("info", "http_request", { status: 200, method: "GET" });
    logger.log("error", "http_request", { status: 500, method: "POST" });

    expect(logger.entries).toHaveLength(2);
    expect(logger.entries[0]).toEqual({
      level: "info",
      message: "http_request",
      fields: { status: 200, method: "GET" },
    });
    expect(logger.entries[1].level).toBe("error");
  });

  it("defaults fields to an empty object when omitted", () => {
    const logger = new InMemoryLogger();
    logger.log("debug", "no fields");
    expect(logger.entries[0].fields).toEqual({});
  });
});
