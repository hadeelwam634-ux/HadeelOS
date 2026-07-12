import { describe, expect, it } from "vitest";
import { InMemoryUserRepository } from "../../src/auth/InMemoryUserRepository";
import { InMemorySessionRepository } from "../../src/auth/InMemorySessionRepository";
import { Session, User } from "../../src/auth/types";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "a@example.test",
    passwordHash: "salt:hash",
    createdAt: "2026-07-12T06:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    token: "tok-1",
    userId: "u1",
    createdAt: "2026-07-12T06:00:00.000Z",
    expiresAt: "2026-07-19T06:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryUserRepository", () => {
  it("finds a created user by id and by email", async () => {
    const repo = new InMemoryUserRepository();
    const user = makeUser();
    await repo.create(user);
    expect(await repo.findById("u1")).toEqual(user);
    expect(await repo.findByEmail("a@example.test")).toEqual(user);
  });

  it("returns undefined for unknown id/email", async () => {
    const repo = new InMemoryUserRepository();
    expect(await repo.findById("nope")).toBeUndefined();
    expect(await repo.findByEmail("nope@example.test")).toBeUndefined();
  });

  it("mutating a returned user does not affect stored state", async () => {
    const repo = new InMemoryUserRepository();
    await repo.create(makeUser());
    const read = await repo.findById("u1");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    read!.email = "mutated@example.test";
    expect((await repo.findById("u1"))?.email).toBe("a@example.test");
  });
});

describe("InMemorySessionRepository", () => {
  it("finds a created session by token", async () => {
    const repo = new InMemorySessionRepository();
    const session = makeSession();
    await repo.create(session);
    expect(await repo.findByToken("tok-1")).toEqual(session);
  });

  it("revoke removes the session; revoking an unknown token is a no-op", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create(makeSession());
    await repo.revoke("tok-1");
    expect(await repo.findByToken("tok-1")).toBeUndefined();
    await expect(repo.revoke("never-existed")).resolves.toBeUndefined();
  });
});
