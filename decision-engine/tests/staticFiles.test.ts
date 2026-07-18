import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/api/server";

describe("Single-process static file serving (MVP Hardening item #11)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "hadeelos-static-"));
    writeFileSync(path.join(dir, "index.html"), "<html><body>Today Cockpit</body></html>");
    writeFileSync(path.join(dir, "app.js"), "console.log('hi');");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves index.html at the root when staticDir is configured", async () => {
    const app = createApp({ staticDir: dir });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Today Cockpit");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves a real static asset by path", async () => {
    const app = createApp({ staticDir: dir });
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("console.log");
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("falls back to index.html for an unknown client-side route (SPA fallback)", async () => {
    const app = createApp({ staticDir: dir });
    const res = await request(app).get("/some/deep/link");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Today Cockpit");
  });

  it("never intercepts /api routes even when staticDir is configured", async () => {
    const app = createApp({ staticDir: dir });
    const res = await request(app).get("/api/system/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("leaves API-only behavior unchanged when staticDir is not configured (every existing test's mode)", async () => {
    const app = createApp();
    const res = await request(app).get("/");
    // No static handler configured -> falls through to normal routing,
    // which 404s an unmatched path exactly as before this change.
    expect(res.status).toBe(404);
  });
});
