import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { AppContainer } from "../../src/api/container";
import { FakeGmailProvider } from "../../src/gmail/FakeGmailProvider";
import { FakeGoogleOAuthTokenExchanger } from "../../src/security/googleOAuth";

let userCounter = 0;
async function authHeaderFor(app: ReturnType<typeof createApp>): Promise<{ Authorization: string }> {
  const email = `gmailoauth-${userCounter++}@example.test`;
  const password = "Sup3rSecret!42";
  await request(app).post("/api/auth/register").send({ email, password });
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { Authorization: `Bearer ${login.body.token}` };
}

describe("API layer — gmail OAuth code exchange (MVP Hardening)", () => {
  it("requires auth", async () => {
    const container = new AppContainer(undefined, undefined, undefined, new FakeGmailProvider());
    const app = createApp({ container });
    const res = await request(app).post("/api/gmail/oauth/exchange").send({});
    expect(res.status).toBe(401);
  });

  it("exchanges a code server-side and connects, without the request ever carrying a refresh token", async () => {
    const exchanger = new FakeGoogleOAuthTokenExchanger({
      accessToken: "server-fetched-gmail-access-token",
      refreshToken: "server-fetched-gmail-refresh-token",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    const container = new AppContainer(undefined, undefined, undefined, new FakeGmailProvider(), undefined, exchanger);
    const app = createApp({ container });
    const auth = await authHeaderFor(app);

    const res = await request(app)
      .post("/api/gmail/oauth/exchange")
      .set(auth)
      .send({ code: "one-time-auth-code", redirectUri: "https://app.example.test/oauth/callback" });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("server-fetched-gmail-access-token");
    expect(JSON.stringify(res.body)).not.toContain("server-fetched-gmail-refresh-token");
    expect(exchanger.lastCode).toBe("one-time-auth-code");
  });

  it("surfaces a failed exchange as 502 and never creates a connection", async () => {
    const exchanger = new FakeGoogleOAuthTokenExchanger(undefined, true);
    const container = new AppContainer(undefined, undefined, undefined, new FakeGmailProvider(), undefined, exchanger);
    const app = createApp({ container });
    const auth = await authHeaderFor(app);

    const res = await request(app)
      .post("/api/gmail/oauth/exchange")
      .set(auth)
      .send({ code: "bad-code", redirectUri: "https://app.example.test/oauth/callback" });
    expect(res.status).toBe(502);

    const getRes = await request(app).get("/api/gmail/connection").set(auth);
    expect(getRes.body.connection).toBeNull();
  });
});
