/**
 * Single amount parser shared by every format.
 *
 * The sign returned is always the one printed in the file. Applying a
 * convention ("a purchase is a debit") is the parser-factory's job — see
 * finalizeEntries there. Parsers stay faithful to their input.
 */
export function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Math.round(value * 100);

  let cleaned = value.replace(/[^\d,.\-+]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return 0;

  const negative = cleaned.startsWith("-");
  cleaned = cleaned.replace(/^[-+]/, "");

  // The last separator is the decimal one:
  // BR "1.234,56" → comma last; US "1,234.56" and "355.05" → dot last.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    cleaned = cleaned.replace(/,/g, "");
  }

  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;

  const centavos = Math.round(parsed * 100);
  return negative ? -centavos : centavos;
}
