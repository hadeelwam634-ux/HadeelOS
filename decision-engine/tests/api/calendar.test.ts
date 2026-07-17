import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { AppContainer } from "../../src/api/container";
import { FakeCalendarProvider } from "../../src/calendar/FakeCalendarProvider";
import { CalendarEvent } from "../../src/calendar/types";

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

function appWithEvents(events: CalendarEvent[] = []) {
  const container = new AppContainer(undefined, undefined, new FakeCalendarProvider(events));
  return createApp({ container });
}

describe("API layer — calendar routes (PR #13)", () => {
  it("requires auth on every calendar route", async () => {
    const app = appWithEvents();
    expect((await request(app).post("/api/calendar/connect").send({})).status).toBe(401);
    expect((await request(app).get("/api/calendar/connection")).status).toBe(401);
    expect((await request(app).delete("/api/calendar/connection")).status).toBe(401);
    expect((await request(app).post("/api/calendar/sync")).status).toBe(401);
  });

  it("GET connection is null before connecting", async () => {
    const app = appWithEvents();
    const auth = await authHeaderFor(app, "cal");
    const res = await request(app).get("/api/calendar/connection").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
  });

  it("connect stores a connection and never echoes back the access/refresh token", async () => {
    const app = appWithEvents();
    const auth = await authHeaderFor(app, "cal");
    const res = await request(app)
      .post("/api/calendar/connect")
      .set(auth)
      .send({
        calendarId: "primary",
        accessToken: "secret-access-token",
        refreshToken: "secret-refresh-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

    expect(res.status).toBe(200);
    expect(res.body.connection.calendarId).toBe("primary");
    expect(res.body.connection.accessToken).toBeUndefined();
    expect(res.body.connection.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("secret-access-token");
    expect(JSON.stringify(res.body)).not.toContain("secret-refresh-token");
  });

  it("rejects an invalid connect body with 400", async () => {
    const app = appWithEvents();
    const auth = await authHeaderFor(app, "cal");
    const res = await request(app).post("/api/calendar/connect").set(auth).send({ calendarId: "" });
    expect(res.status).toBe(400);
  });

  it("sync returns 404-style UnknownCalendarConnectionError when not connected", async () => {
    const app = appWithEvents();
    const auth = await authHeaderFor(app, "cal");
    const res = await request(app).post("/api/calendar/sync").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownCalendarConnectionError");
  });

  it("connect then sync returns an event count derived from the provider", async () => {
    // Slightly in the future relative to "now" so it reliably falls inside
    // the sync window regardless of the few ms of real time that pass
    // between this line and the service computing its own windowStart.
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const events: CalendarEvent[] = [
      { id: "e1", title: "Standup", start: soon, end: soon, isAllDay: false },
    ];
    const app = appWithEvents(events);
    const auth = await authHeaderFor(app, "cal");
    await request(app)
      .post("/api/calendar/connect")
      .set(auth)
      .send({
        calendarId: "primary",
        accessToken: "access-1",
        refreshToken: null,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

    const res = await request(app).post("/api/calendar/sync").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(1);
  });

  it("disconnect removes the connection", async () => {
    const app = appWithEvents();
    const auth = await authHeaderFor(app, "cal");
    await request(app)
      .post("/api/calendar/connect")
      .set(auth)
      .send({
        calendarId: "primary",
        accessToken: "access-1",
        refreshToken: null,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

    const del = await request(app).delete("/api/calendar/connection").set(auth);
    expect(del.status).toBe(200);
    expect(del.body.disconnected).toBe(true);

    const get = await request(app).get("/api/calendar/connection").set(auth);
    expect(get.body.connection).toBeNull();
  });

  it("isolates calendar connections per user", async () => {
    const app = appWithEvents();
    const authA = await authHeaderFor(app, "cal-a");
    const authB = await authHeaderFor(app, "cal-b");

    await request(app)
      .post("/api/calendar/connect")
      .set(authA)
      .send({
        calendarId: "a-primary",
        accessToken: "access-a",
        refreshToken: null,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });

    const getB = await request(app).get("/api/calendar/connection").set(authB);
    expect(getB.body.connection).toBeNull();
  });
});
