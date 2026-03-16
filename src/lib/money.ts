/**
 * All monetary values are stored as integers in centavos.
 * R$ 49,90 = 4990 centavos
 */

export function formatBRL(centavos: number): string {
  const value = centavos / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatBRLCompact(centavos: number): string {
  const value = centavos / 100;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function parseBRL(value: string): number {
  const cleaned = value
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Math.round(parseFloat(cleaned) * 100);
}

export function centavosToDecimal(centavos: number): number {
  return centavos / 100;
}

export function decimalToCentavos(decimal: number): number {
  return Math.round(decimal * 100);
}
