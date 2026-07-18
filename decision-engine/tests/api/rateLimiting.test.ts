import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { RequestRateLimiter } from "../../src/security/RequestRateLimiter";
import { SystemClock } from "../../src/application/types";

describe("API layer — global rate limiting (MVP Hardening)", () => {
  it("429s once a client exceeds its per-IP request budget", async () => {
    const app = createApp({ rateLimiter: new RequestRateLimiter(new SystemClock(), 3, 60_000) });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get("/api/system/health");
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it("does not rate-limit a generously-configured default within normal test usage", async () => {
    const app = createApp();
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get("/api/system/health");
      expect(res.status).toBe(200);
    }
  });
});
