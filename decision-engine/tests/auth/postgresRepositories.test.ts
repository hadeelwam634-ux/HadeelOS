import { describe, expect, it } from "vitest";
import { PostgresUserRepository } from "../../src/auth/PostgresUserRepository";
import { PostgresSessionRepository } from "../../src/auth/PostgresSessionRepository";
import { User, Session } from "../../src/auth/types";
import { createPgMemDb } from "../persistence/postgres/pgMemHarness";

function user(id: string, email: string): User {
  return { id: id as any, email, passwordHash: "salt:hash", createdAt: "2026-07-01T00:00:00.000Z" };
}

describe("PostgresUserRepository (pg-mem)", () => {
  it("round-trips create/findByEmail/findById", async () => {
    const db = createPgMemDb();
    const repo = new PostgresUserRepository(db);
    const u = user("11111111-1111-4111-8111-111111111115", "hadeel@example.com");
    await repo.create(u);

    expect(await repo.findByEmail("hadeel@example.com")).toEqual(u);
    expect(await repo.findById(u.id)).toEqual(u);
    expect(await repo.findByEmail("nobody@example.com")).toBeUndefined();
  });

  it("enforces email uniqueness at the database level", async () => {
    const db = createPgMemDb();
    const repo = new PostgresUserRepository(db);
    await repo.create(user("22222222-2222-4222-8222-222222222226", "dup@example.com"));
    await expect(repo.create(user("33333333-3333-4333-8333-333333333337", "dup@example.com"))).rejects.toThrow();
  });
});

describe("PostgresSessionRepository (pg-mem)", () => {
  it("round-trips create/findByToken/revoke", async () => {
    const db = createPgMemDb();
    const repo = new PostgresSessionRepository(db);
    const session: Session = {
      token: "opaque-session-token",
      userId: "11111111-1111-4111-8111-111111111115" as any,
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-07-08T00:00:00.000Z",
    };
    await repo.create(session);
    expect(await repo.findByToken("opaque-session-token")).toEqual(session);

    await repo.revoke("opaque-session-token");
    expect(await repo.findByToken("opaque-session-token")).toBeUndefined();
  });

  it("revoking an unknown token is a no-op", async () => {
    const db = createPgMemDb();
    const repo = new PostgresSessionRepository(db);
    await expect(repo.revoke("nonexistent")).resolves.toBeUndefined();
  });
});
