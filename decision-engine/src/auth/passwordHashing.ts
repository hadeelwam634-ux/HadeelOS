import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/** Hashes a password with a fresh random salt. Format: `${saltHex}:${derivedKeyHex}`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a password against a stored hash using a timing-safe
 * comparison (never a plain `===` on the derived key, which would leak
 * how many leading bytes matched via response-time differences).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derivedKey = await scryptAsync(password, salt, expected.length);
  if (derivedKey.length !== expected.length) return false;
  return timingSafeEqual(derivedKey, expected);
}

/**
 * A precomputed hash of a fixed dummy password, used so that "email
 * not found" and "email found but password wrong" take the same amount
 * of time in AuthService.login() — without this, a client could time
 * responses to enumerate which emails have accounts.
 */
export const DUMMY_PASSWORD_HASH: string = (() => {
  const salt = Buffer.alloc(16, 0);
  const key = scryptSync("dummy-password-for-timing-safety", salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
})();
