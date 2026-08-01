import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/password";

describe("password hashing", () => {
  it("accepts the right password and rejects the wrong one", () => {
    const stored = hashPassword("uma senha qualquer");
    expect(verifyPassword("uma senha qualquer", stored)).toBe(true);
    expect(verifyPassword("uma senha qualqver", stored)).toBe(false);
  });

  // Unsalted SHA-256 meant identical passwords produced identical hashes, so a
  // single rainbow-table lookup broke every account at once.
  it("salts, so the same password hashes differently each time", () => {
    const a = hashPassword("mesma senha");
    const b = hashPassword("mesma senha");
    expect(a).not.toBe(b);
    expect(verifyPassword("mesma senha", a)).toBe(true);
    expect(verifyPassword("mesma senha", b)).toBe(true);
  });

  it("no longer accepts a bare sha256 hash", () => {
    const legacy = createHash("sha256").update("admin123").digest("hex");
    expect(verifyPassword("admin123", legacy)).toBe(false);
  });

  it("rejects malformed stored values instead of throwing", () => {
    for (const bad of ["", "scrypt$", "scrypt$16384$zz$zz", "a$b$c$d"]) {
      expect(() => verifyPassword("x", bad)).not.toThrow();
      expect(verifyPassword("x", bad)).toBe(false);
    }
  });
});
