import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptNullableToken,
  decryptToken,
  encryptNullableToken,
  encryptToken,
  InvalidEncryptionKeyError,
  MissingEncryptionKeyError,
  TokenDecryptionError,
} from "../../src/security/tokenCipher";

describe("tokenCipher", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a plaintext token", () => {
    const ciphertext = encryptToken("ya29.real-google-access-token");
    expect(ciphertext).not.toContain("ya29");
    expect(decryptToken(ciphertext)).toBe("ya29.real-google-access-token");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    const a = encryptToken("same-plaintext");
    const b = encryptToken("same-plaintext");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-plaintext");
    expect(decryptToken(b)).toBe("same-plaintext");
  });

  it("round-trips null through the nullable helpers", () => {
    expect(encryptNullableToken(null)).toBeNull();
    expect(decryptNullableToken(null)).toBeNull();
  });

  it("throws MissingEncryptionKeyError when TOKEN_ENCRYPTION_KEY is unset", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(MissingEncryptionKeyError);
  });

  it("throws InvalidEncryptionKeyError for a key that isn't 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x")).toThrow(InvalidEncryptionKeyError);
  });

  it("throws TokenDecryptionError for tampered ciphertext", () => {
    const ciphertext = encryptToken("secret");
    const tampered = ciphertext.slice(0, -4) + "XXXX";
    expect(() => decryptToken(tampered)).toThrow(TokenDecryptionError);
  });

  it("throws TokenDecryptionError when decrypting with the wrong key", () => {
    const ciphertext = encryptToken("secret");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(ciphertext)).toThrow(TokenDecryptionError);
  });

  it("throws TokenDecryptionError for a malformed stored value", () => {
    expect(() => decryptToken("not-the-right-format")).toThrow(TokenDecryptionError);
  });
});
