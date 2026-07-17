import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { AppContainer } from "../../src/api/container";
import { FakeCalendarProvider } from "../../src/calendar/FakeCalendarProvider";
import { FakeGmailProvider } from "../../src/gmail/FakeGmailProvider";

let userCounter = 0;
async function authHeaderFor(
  app: ReturnType<typeof createApp>,
  label: string,
): Promise<{ Authorization: string }> {
  const email = `${label}-${userCounter++}@example.test`;
  const password = "Sup3rSecret!42";
  await request(app).post("/api/auth/register").send({ email, password });
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { Authorization: `Bearer ${login.body.token}` };
}

function appWithUnreadCount(unreadCount = 0) {
  const container = new AppContainer(undefined, undefined, new FakeCalendarProvider(), new FakeGmailProvider(unreadCount));
  return createApp({ container });
}

describe("API layer — gmail routes (PR #14)", () => {
  it("requires auth on every gmail route", async () => {
    const app = appWithUnreadCount();
    expect((await request(app).post("/api/gmail/connect").send({})).status).toBe(401);
    expect((await request(app).get("/api/gmail/connection")).status).toBe(401);
    expect((await request(app).delete("/api/gmail/connection")).status).toBe(401);
    expect((await request(app).post("/api/gmail/sync")).status).toBe(401);
  });

  it("GET connection is null before connecting", async () => {
    const app = appWithUnreadCount();
    const auth = await authHeaderFor(app, "gmail");
    const res = await request(app).get("/api/gmail/connection").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
  });

  it("connect stores a connection and never echoes back the access/refresh token", async () => {
    const app = appWithUnreadCount();
    const auth = await authHeaderFor(app, "gmail");
    const res = await request(app)
      .post("/api/gmail/connect")
      .set(auth)
      .send({
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.connection.accessToken).toBeUndefined();
    expect(res.body.connection.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("secret-access-token");
    expect(JSON.stringify(res.body)).not.toContain("secret-refresh-token");
  });

  it("rejects an invalid connect body with 400", async () => {
    const app = appWithUnreadCount();
    const auth = await authHeaderFor(app, "gmail");
    const res = await request(app).post("/api/gmail/connect").set(auth).send({ accessToken: "" });
    expect(res.status).toBe(400);
  });

  it("sync returns 404-style UnknownGmailConnectionError when not connected", async () => {
    const app = appWithUnreadCount();
    const auth = await authHeaderFor(app, "gmail");
    const res = await request(app).post("/api/gmail/sync").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownGmailConnectionError");
  });

  it("connect then sync returns the unread count derived from the provider", async () => {
    const app = appWithUnreadCount(4);
    const auth = await authHeaderFor(app, "gmail");
    await request(app)
      .post("/api/gmail/connect")
      .set(auth)
      .send({ accessToken: "access-1", refreshToken: null, expiresAt: "2099-01-01T00:00:00.000Z" });

    const res = await request(app).post("/api/gmail/sync").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(4);
  });

  it("disconnect removes the connection", async () => {
    const app = appWithUnreadCount();
    const auth = await authHeaderFor(app, "gmail");
    await request(app)
      .post("/api/gmail/connect")
      .set(auth)
      .send({ accessToken: "access-1", refreshToken: null, expiresAt: "2099-01-01T00:00:00.000Z" });

    const del = await request(app).delete("/api/gmail/connection").set(auth);
    expect(del.status).toBe(200);
    expect(del.body.disconnected).toBe(true);

    const get = await request(app).get("/api/gmail/connection").set(auth);
    expect(get.body.connection).toBeNull();
  });

  it("isolates gmail connections per user", async () => {
    const app = appWithUnreadCount();
    const authA = await authHeaderFor(app, "gmail-a");
    const authB = await authHeaderFor(app, "gmail-b");

    await request(app)
      .post("/api/gmail/connect")
      .set(authA)
      .send({ accessToken: "access-a", refreshToken: null, expiresAt: "2099-01-01T00:00:00.000Z" });

    const getB = await request(app).get("/api/gmail/connection").set(authB);
    expect(getB.body.connection).toBeNull();
  });
});
