import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets-at-rest (Google Calendar/Gmail OAuth
 * access & refresh tokens — see CalendarConnection/GmailConnection's
 * SECURITY NOTE doc comments). The key is never hardcoded or committed:
 * it must be supplied via the TOKEN_ENCRYPTION_KEY environment variable
 * (see README "Secrets & Environment Variables"), a 32-byte key encoded
 * as base64. Losing this key makes every previously-encrypted token
 * permanently unrecoverable — back it up outside the repo/DB.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY environment variable is not set. Generate one " +
        "with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        "and set it as an environment variable — never commit it to the repository.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

export class InvalidEncryptionKeyError extends Error {
  constructor() {
    super(
      "TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key).",
    );
    this.name = "InvalidEncryptionKeyError";
  }
}

export class TokenDecryptionError extends Error {
  constructor() {
    super("Failed to decrypt token: ciphertext is malformed or was encrypted with a different key.");
    this.name = "TokenDecryptionError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new MissingEncryptionKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) throw new InvalidEncryptionKeyError();
  return key;
}

/**
 * Encrypts a plaintext token for storage. Output format is a single
 * string: `<ivBase64>:<authTagBase64>:<ciphertextBase64>` — self-contained,
 * so no separate column is needed for the IV/auth tag.
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Inverse of encryptToken(). Throws TokenDecryptionError on any tampering/corruption/wrong key. */
export function decryptToken(stored: string): string {
  const key = loadKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new TokenDecryptionError();
  const [ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf-8");
  } catch {
    throw new TokenDecryptionError();
  }
}

/** Encrypts a nullable token (refreshToken may legitimately be null). */
export function encryptNullableToken(plaintext: string | null): string | null {
  return plaintext === null ? null : encryptToken(plaintext);
}

/** Decrypts a nullable stored token. */
export function decryptNullableToken(stored: string | null): string | null {
  return stored === null ? null : decryptToken(stored);
}
