import { randomBytes } from "node:crypto";
import { UUID } from "../types";
import { Clock, IdGenerator } from "../application/types";
import { UserRepository } from "./UserRepository";
import { SessionRepository } from "./SessionRepository";
import { LoginRateLimiter } from "./LoginRateLimiter";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./passwordHashing";
import { PublicUser, Session, User, toPublicUser } from "./types";
import { DuplicateEmailError, InvalidCredentialsError, TooManyLoginAttemptsError } from "./errors";

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * The only place account creation, login, logout, and session
 * verification happen — routes/auth.ts calls this and nothing else,
 * matching this codebase's "routes only call an Application Service"
 * rule (see application/errors.ts's doc comment).
 */
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly sessionTtlMs: number = DEFAULT_SESSION_TTL_MS,
  ) {}

  async register(email: string, password: string): Promise<{ user: PublicUser; token: string }> {
    const normalizedEmail = normalizeEmail(email);
    const existing = await this.users.findByEmail(normalizedEmail);
    if (existing) {
      throw new DuplicateEmailError(normalizedEmail);
    }
    const passwordHash = await hashPassword(password);
    const user: User = {
      id: this.idGenerator.next(),
      email: normalizedEmail,
      passwordHash,
      createdAt: this.clock.now(),
    };
    await this.users.create(user);
    const token = await this.createSession(user.id);
    return { user: toPublicUser(user), token };
  }

  async login(email: string, password: string): Promise<{ token: string }> {
    const normalizedEmail = normalizeEmail(email);

    if (this.rateLimiter.isBlocked(normalizedEmail)) {
      throw new TooManyLoginAttemptsError();
    }

    const user = await this.users.findByEmail(normalizedEmail);
    // Always run a scrypt verification, even when no such user exists,
    // against a fixed dummy hash — otherwise "no account" would return
    // faster than "wrong password" and leak which emails are registered.
    const passwordIsValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !passwordIsValid) {
      this.rateLimiter.recordFailure(normalizedEmail);
      throw new InvalidCredentialsError();
    }

    this.rateLimiter.reset(normalizedEmail);
    const token = await this.createSession(user.id);
    return { token };
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }

  /** Returns the resolved userId, or null if the token is missing/unknown/expired. */
  async resolveSession(token: string): Promise<{ userId: UUID } | null> {
    const session = await this.sessions.findByToken(token);
    if (!session) return null;
    if (this.isExpired(session)) {
      await this.sessions.revoke(token);
      return null;
    }
    return { userId: session.userId };
  }

  private isExpired(session: Session): boolean {
    return Date.parse(session.expiresAt) <= Date.parse(this.clock.now());
  }

  private async createSession(userId: UUID): Promise<string> {
    const token = randomToken();
    const now = this.clock.now();
    const expiresAt = new Date(Date.parse(now) + this.sessionTtlMs).toISOString();
    await this.sessions.create({ token, userId, createdAt: now, expiresAt });
    return token;
  }
}
