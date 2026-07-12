import { describe, expect, it } from "vitest";
import { Clock, IdGenerator } from "../../src/application/types";
import { AuthService } from "../../src/auth/AuthService";
import { InMemoryUserRepository } from "../../src/auth/InMemoryUserRepository";
import { InMemorySessionRepository } from "../../src/auth/InMemorySessionRepository";
import { LoginRateLimiter } from "../../src/auth/LoginRateLimiter";
import {
  DuplicateEmailError,
  InvalidCredentialsError,
  TooManyLoginAttemptsError,
} from "../../src/auth/errors";
import { UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `user-${this.counter}`;
  }
}

/** A Clock whose `now()` can be advanced explicitly, for testing session/rate-limit expiry. */
class FakeClock implements Clock {
  private current = Date.parse("2026-07-12T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

function buildAuthService(clock: FakeClock = new FakeClock()) {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const rateLimiter = new LoginRateLimiter(clock, 3, 15 * 60 * 1000);
  const authService = new AuthService(users, sessions, new FakeIdGenerator(), clock, rateLimiter);
  return { authService, users, sessions, clock };
}

const PASSWORD = "Sup3rSecret!42";

describe("AuthService.register", () => {
  it("creates a user and returns a public user (no passwordHash) plus a session token", async () => {
    const { authService } = buildAuthService();
    const { user, token } = await authService.register("alice@example.test", PASSWORD);
    expect(user.email).toBe("alice@example.test");
    expect(user).not.toHaveProperty("passwordHash");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("normalizes email casing/whitespace before storing", async () => {
    const { authService, users } = buildAuthService();
    await authService.register("  Alice@Example.Test  ", PASSWORD);
    expect(await users.findByEmail("alice@example.test")).toBeDefined();
  });

  it("rejects a second registration with the same (normalized) email", async () => {
    const { authService } = buildAuthService();
    await authService.register("bob@example.test", PASSWORD);
    await expect(authService.register("Bob@Example.test", PASSWORD)).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });
});

describe("AuthService.login", () => {
  it("returns a valid token for correct credentials", async () => {
    const { authService } = buildAuthService();
    await authService.register("carol@example.test", PASSWORD);
    const { token } = await authService.login("carol@example.test", PASSWORD);
    const resolved = await authService.resolveSession(token);
    expect(resolved).not.toBeNull();
  });

  it("rejects a wrong password without revealing whether the email exists", async () => {
    const { authService } = buildAuthService();
    await authService.register("dave@example.test", PASSWORD);
    await expect(authService.login("dave@example.test", "wrongPassword1")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(
      authService.login("never-registered@example.test", "wrongPassword1"),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("blocks further attempts after the rate limit is exceeded", async () => {
    const { authService } = buildAuthService();
    await authService.register("erin@example.test", PASSWORD);

    for (let i = 0; i < 3; i++) {
      await expect(authService.login("erin@example.test", "wrongPassword1")).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    }

    await expect(authService.login("erin@example.test", PASSWORD)).rejects.toBeInstanceOf(
      TooManyLoginAttemptsError,
    );
  });

  it("resets the rate limit after a successful login", async () => {
    const { authService } = buildAuthService();
    await authService.register("frank@example.test", PASSWORD);
    await expect(authService.login("frank@example.test", "wrongPassword1")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await authService.login("frank@example.test", PASSWORD);
    // Two more failures shouldn't trip the (maxAttempts=3) limiter, since
    // the successful login above reset the counter.
    await expect(authService.login("frank@example.test", "wrongPassword1")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(authService.login("frank@example.test", "wrongPassword1")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await authService.login("frank@example.test", PASSWORD);
  });
});

describe("AuthService.resolveSession", () => {
  it("returns null for an unknown token", async () => {
    const { authService } = buildAuthService();
    expect(await authService.resolveSession("not-a-real-token")).toBeNull();
  });

  it("returns null and revokes the session once it has expired", async () => {
    const clock = new FakeClock();
    const { authService, sessions } = buildAuthService(clock);
    await authService.register("grace@example.test", PASSWORD);
    const { token } = await authService.login("grace@example.test", PASSWORD);

    clock.advanceMs(1000 * 60 * 60 * 24 * 8); // past the 7-day session TTL

    expect(await authService.resolveSession(token)).toBeNull();
    expect(await sessions.findByToken(token)).toBeUndefined();
  });
});

describe("AuthService.logout", () => {
  it("revokes the token so it no longer resolves", async () => {
    const { authService } = buildAuthService();
    await authService.register("heidi@example.test", PASSWORD);
    const { token } = await authService.login("heidi@example.test", PASSWORD);
    expect(await authService.resolveSession(token)).not.toBeNull();

    await authService.logout(token);
    expect(await authService.resolveSession(token)).toBeNull();
  });

  it("logging out an unknown token is a no-op, not an error", async () => {
    const { authService } = buildAuthService();
    await expect(authService.logout("never-issued")).resolves.toBeUndefined();
  });
});
