import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PostgresCalendarConnectionRepository } from "../../src/calendar/PostgresCalendarConnectionRepository";
import { CalendarConnection } from "../../src/calendar/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";
import { Pool } from "pg";

function connection(): CalendarConnection {
  return {
    userId: DEFAULT_TEST_USER_ID as any,
    calendarId: "primary",
    accessToken: "ya29.super-secret-access-token",
    refreshToken: "1//secret-refresh-token",
    expiresAt: "2026-08-01T00:00:00.000Z",
    connectedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("PostgresCalendarConnectionRepository (pg-mem)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a connection through upsert/findByUserId", async () => {
    const db = createPgMemDb();
    const repo = new PostgresCalendarConnectionRepository(db);
    const conn = connection();
    await repo.upsert(conn);
    expect(await repo.findByUserId(DEFAULT_TEST_USER_ID)).toEqual(conn);
  });

  it("stores tokens encrypted, never in plaintext, in the underlying table", async () => {
    const db = createPgMemDb() as unknown as Pool;
    const repo = new PostgresCalendarConnectionRepository(db as any);
    const conn = connection();
    await repo.upsert(conn);

    const raw = await (db as any).query(`SELECT access_token_encrypted, refresh_token_encrypted FROM calendar_connections WHERE user_id = $1`, [
      DEFAULT_TEST_USER_ID,
    ]);
    expect(raw.rows[0].access_token_encrypted).not.toContain(conn.accessToken);
    expect(raw.rows[0].refresh_token_encrypted).not.toContain(conn.refreshToken);
    expect(raw.rows[0].access_token_encrypted).not.toEqual(conn.accessToken);
  });

  it("delete removes the connection", async () => {
    const db = createPgMemDb();
    const repo = new PostgresCalendarConnectionRepository(db);
    await repo.upsert(connection());
    await repo.delete(DEFAULT_TEST_USER_ID);
    expect(await repo.findByUserId(DEFAULT_TEST_USER_ID)).toBeNull();
  });

  it("upsert overwrites tokens for a re-connect", async () => {
    const db = createPgMemDb();
    const repo = new PostgresCalendarConnectionRepository(db);
    await repo.upsert(connection());
    const reconnected = { ...connection(), accessToken: "ya29.new-token" };
    await repo.upsert(reconnected);
    expect((await repo.findByUserId(DEFAULT_TEST_USER_ID))?.accessToken).toBe("ya29.new-token");
  });
});
