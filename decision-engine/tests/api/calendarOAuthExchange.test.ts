import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { AppContainer } from "../../src/api/container";
import { FakeCalendarProvider } from "../../src/calendar/FakeCalendarProvider";
import { FakeGoogleOAuthTokenExchanger } from "../../src/security/googleOAuth";

let userCounter = 0;
async function authHeaderFor(app: ReturnType<typeof createApp>): Promise<{ Authorization: string }> {
  const email = `caloauth-${userCounter++}@example.test`;
  const password = "Sup3rSecret!42";
  await request(app).post("/api/auth/register").send({ email, password });
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { Authorization: `Bearer ${login.body.token}` };
}

describe("API layer — calendar OAuth code exchange (MVP Hardening)", () => {
  it("requires auth", async () => {
    const container = new AppContainer(undefined, undefined, new FakeCalendarProvider());
    const app = createApp({ container });
    const res = await request(app).post("/api/calendar/oauth/exchange").send({});
    expect(res.status).toBe(401);
  });

  it("exchanges a code server-side and connects, without the request ever carrying a refresh token", async () => {
    const exchanger = new FakeGoogleOAuthTokenExchanger({
      accessToken: "server-fetched-access-token",
      refreshToken: "server-fetched-refresh-token",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    const container = new AppContainer(undefined, undefined, new FakeCalendarProvider(), undefined, undefined, exchanger);
    const app = createApp({ container });
    const auth = await authHeaderFor(app);

    const res = await request(app)
      .post("/api/calendar/oauth/exchange")
      .set(auth)
      .send({ code: "one-time-auth-code", redirectUri: "https://app.example.test/oauth/callback", calendarId: "primary" });

    expect(res.status).toBe(200);
    // The request body never contained an access/refresh token, and the
    // response — like connectCalendarRoute — never echoes one back.
    expect(JSON.stringify(res.body)).not.toContain("server-fetched-access-token");
    expect(JSON.stringify(res.body)).not.toContain("server-fetched-refresh-token");
    expect(res.body.connection.calendarId).toBe("primary");

    // The exchanger received exactly the short-lived code, not a token.
    expect(exchanger.lastCode).toBe("one-time-auth-code");
  });

  it("surfaces a failed exchange as 502 and never creates a connection", async () => {
    const exchanger = new FakeGoogleOAuthTokenExchanger(undefined, true);
    const container = new AppContainer(undefined, undefined, new FakeCalendarProvider(), undefined, undefined, exchanger);
    const app = createApp({ container });
    const auth = await authHeaderFor(app);

    const res = await request(app)
      .post("/api/calendar/oauth/exchange")
      .set(auth)
      .send({ code: "bad-code", redirectUri: "https://app.example.test/oauth/callback", calendarId: "primary" });
    expect(res.status).toBe(502);

    const getRes = await request(app).get("/api/calendar/connection").set(auth);
    expect(getRes.body.connection).toBeNull();
  });

  it("rejects a malformed body with 400", async () => {
    const container = new AppContainer(undefined, undefined, new FakeCalendarProvider());
    const app = createApp({ container });
    const auth = await authHeaderFor(app);
    const res = await request(app).post("/api/calendar/oauth/exchange").set(auth).send({});
    expect(res.status).toBe(400);
  });
});
