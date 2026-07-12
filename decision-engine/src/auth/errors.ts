/**
 * Auth-domain error hierarchy (PR #12). Follows the same
 * "Unknown" / "Duplicate" prefix naming convention as every other
 * bounded context's errors.ts (see twin/errors.ts, memory/errors.ts,
 * etc.) so the API layer's generic mapErrorToHttpResponse() keeps
 * working without needing to know about this module specifically for
 * the cases that convention already covers.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Registration attempted with an email that already has an account. */
export class DuplicateEmailError extends AuthError {
  constructor(email: string) {
    super(`An account with email "${email}" already exists.`);
    this.name = "DuplicateEmailError";
  }
}

/**
 * Login failed. Deliberately does not distinguish "no such email" from
 * "wrong password" in its message — telling a client which one it was
 * would let an attacker enumerate registered emails.
 */
export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("Email or password is incorrect.");
    this.name = "InvalidCredentialsError";
  }
}

/** Login rate limit (LoginRateLimiter) tripped for this email. */
export class TooManyLoginAttemptsError extends AuthError {
  constructor() {
    super("Too many failed login attempts. Try again later.");
    this.name = "TooManyLoginAttemptsError";
  }
}
