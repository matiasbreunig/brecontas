import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Password hashing shared by the auth provider and the seed.
 *
 * Both used to carry their own copy of a bare `sha256(password)` — unsalted,
 * unstretched, and compared with `!==`. Any copy of the database gave up the
 * passwords to a dictionary run in seconds.
 *
 * Format: `scrypt$<N>$<saltHex>$<hashHex>`. Keeping the cost in the string lets
 * it be raised later without invalidating existing hashes.
 */
const KEY_LENGTH = 64;
const COST = 16384; // scrypt N

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: COST });
  return `scrypt$${COST}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2], "hex");
    expected = Buffer.from(parts[3], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  const actual = scryptSync(password, salt, KEY_LENGTH, { N: cost });
  return timingSafeEqual(actual, expected);
}
