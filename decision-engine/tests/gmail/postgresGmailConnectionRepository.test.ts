import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PostgresGmailConnectionRepository } from "../../src/gmail/PostgresGmailConnectionRepository";
import { GmailConnection } from "../../src/gmail/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";

function connection(): GmailConnection {
  return {
    userId: DEFAULT_TEST_USER_ID as any,
    accessToken: "ya29.gmail-secret-access-token",
    refreshToken: "1//gmail-secret-refresh-token",
    expiresAt: "2026-08-01T00:00:00.000Z",
    connectedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("PostgresGmailConnectionRepository (pg-mem)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a connection through upsert/findByUserId", async () => {
    const db = createPgMemDb();
    const repo = new PostgresGmailConnectionRepository(db);
    const conn = connection();
    await repo.upsert(conn);
    expect(await repo.findByUserId(DEFAULT_TEST_USER_ID)).toEqual(conn);
  });

  it("stores tokens encrypted, never in plaintext, in the underlying table", async () => {
    const db: any = createPgMemDb();
    const repo = new PostgresGmailConnectionRepository(db);
    const conn = connection();
    await repo.upsert(conn);

    const raw = await db.query(`SELECT access_token_encrypted, refresh_token_encrypted FROM gmail_connections WHERE user_id = $1`, [
      DEFAULT_TEST_USER_ID,
    ]);
    expect(raw.rows[0].access_token_encrypted).not.toContain(conn.accessToken);
    expect(raw.rows[0].refresh_token_encrypted).not.toContain(conn.refreshToken);
  });

  it("delete removes the connection", async () => {
    const db = createPgMemDb();
    const repo = new PostgresGmailConnectionRepository(db);
    await repo.upsert(connection());
    await repo.delete(DEFAULT_TEST_USER_ID);
    expect(await repo.findByUserId(DEFAULT_TEST_USER_ID)).toBeNull();
  });
});
