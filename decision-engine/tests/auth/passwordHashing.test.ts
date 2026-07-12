import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../../src/auth/passwordHashing";

describe("passwordHashing", () => {
  it("verifies a password against its own hash", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt), even for the same password", async () => {
    const first = await hashPassword("same-password-123");
    const second = await hashPassword("same-password-123");
    expect(first).not.toBe(second);
    expect(await verifyPassword("same-password-123", first)).toBe(true);
    expect(await verifyPassword("same-password-123", second)).toBe(true);
  });

  it("DUMMY_PASSWORD_HASH is a stable, well-formed hash usable for timing-safety comparisons", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword("anything", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
  });
});
