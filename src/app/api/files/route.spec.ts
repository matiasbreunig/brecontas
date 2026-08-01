import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Mirrors the containment check in /api/files/[...path]/route.ts.
 *
 * The bug it locks down: ownership used to be checked on the raw joined path,
 * before path.normalize ran. A request for "<myId>/../<otherId>/receipt.pdf"
 * started with the caller's own id, so it passed — and only afterwards
 * collapsed into the other user's folder.
 */
function resolvesInsideUserFolder(segments: string[], userId: string): boolean {
  const uploadsRoot = path.resolve("/app", "data", "uploads");
  const userRoot = path.join(uploadsRoot, userId);
  const absPath = path.resolve(uploadsRoot, ...segments);
  return absPath === userRoot || absPath.startsWith(userRoot + path.sep);
}

const ME = "user_matias";
const OTHER = "user_esposa";

describe("/api/files containment", () => {
  it("serves the caller's own files", () => {
    expect(resolvesInsideUserFolder([ME, "2026", "07", "nota.pdf"], ME)).toBe(true);
  });

  it("blocks traversal into the other user's folder", () => {
    expect(
      resolvesInsideUserFolder([ME, "..", OTHER, "2026", "07", "nota.pdf"], ME)
    ).toBe(false);
  });

  it("blocks a path that merely starts with the caller's id", () => {
    expect(resolvesInsideUserFolder([`${ME}_outro`, "nota.pdf"], ME)).toBe(false);
  });

  it("blocks escaping the uploads root entirely", () => {
    expect(
      resolvesInsideUserFolder([ME, "..", "..", "..", "etc", "passwd"], ME)
    ).toBe(false);
  });

  it("blocks another user's folder asked for directly", () => {
    expect(resolvesInsideUserFolder([OTHER, "nota.pdf"], ME)).toBe(false);
  });
});
