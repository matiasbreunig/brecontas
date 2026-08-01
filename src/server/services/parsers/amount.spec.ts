import { describe, expect, it } from "vitest";
import { parseAmount } from "@/server/services/parsers/amount";

// Every parser used to carry its own amount parser: the CSV one detected BR/US
// by the last separator, the XLS one stripped the sign with Math.abs, and the
// OFX one was a bare parseFloat. This is the single implementation they share,
// and the sign is always the one printed in the file.
describe("parseAmount", () => {
  it("reads BR format (comma decimal, dot thousands)", () => {
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("-1.234,56")).toBe(-123456);
    expect(parseAmount("49,90")).toBe(4990);
    expect(parseAmount("-49,90")).toBe(-4990);
  });

  it("reads US format (dot decimal, comma thousands)", () => {
    expect(parseAmount("355.05")).toBe(35505);
    expect(parseAmount("-16,570.90")).toBe(-1657090);
  });

  it("ignores currency symbols and whitespace", () => {
    expect(parseAmount("R$ 355.05")).toBe(35505);
    expect(parseAmount("-BRL 16.570,90")).toBe(-1657090);
    expect(parseAmount("  49,90  ")).toBe(4990);
  });

  it("reads plain integers as reais, not centavos", () => {
    expect(parseAmount("1234")).toBe(123400);
    expect(parseAmount("-7")).toBe(-700);
  });

  it("returns 0 for empty input instead of NaN", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("   ")).toBe(0);
  });

  // The OFX parser used parseFloat directly, so "-49,90" became -49 and
  // "-1.234,56" became -1.234 — a value a thousand times too small, written
  // into an immutable bank record with no error.
  it("never truncates at the comma the way parseFloat did", () => {
    expect(parseAmount("-49,90")).not.toBe(-4900);
    expect(parseAmount("-1.234,56")).not.toBe(-123);
  });
});
