import { UUID } from "../types";

/**
 * A registered account. `passwordHash` is `${saltHex}:${derivedKeyHex}`
 * (see passwordHashing.ts) — the plaintext password is never stored or
 * logged anywhere, and no response body ever includes this field (see
 * PublicUser).
 */
export interface User {
  id: UUID;
  email: string;
  passwordHash: string;
  createdAt: string;
}

/** What `register()` is allowed to hand back to a client — never passwordHash. */
export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

/**
 * A live login session. `token` is an opaque random string (see
 * AuthService.createSession) — never a JWT or anything decodable
 * client-side — so the only way to know what it grants is to look it
 * up here, which also makes `logout()`/revocation immediate rather
 * than "wait for expiry."
 */
export interface Session {
  token: string;
  userId: UUID;
  createdAt: string;
  expiresAt: string;
}
