import * as XLSX from "xlsx";
import type { ParsedEntry } from "./csv-parser";
import { parseAmount as parseSignedAmount } from "./amount";

/**
 * Parse Itaú credit card invoice XLS files.
 *
 * Itaú exports card statements as XLS with irregular layout:
 * - Header rows (name, agency, account)
 * - Invoice summary (status, due date, total)
 * - Previous invoice payment
 * - National transactions section (per card)
 * - International transactions section (per card, with exchange rates)
 * - Charges section
 * - Totals
 *
 * This parser extracts individual transactions from both national and
 * international sections, ignoring totals, subtotals, and metadata rows.
 */

interface XlsParseResult {
  entries: ParsedEntry[];
  institution: string;
  cardNumbers: string[];
}

// ============================================================================
// AMOUNT PARSING
// ============================================================================

/**
 * Parse an amount cell to centavos, **keeping the sign printed in the file**.
 * A refund on an invoice comes in negative and must stay negative here; the
 * invoice-wide convention is applied once, in the parser-factory.
 * Handles: "R$ 355.05", "-BRL 16,570.90", "$ 1,851.20", "R$ 0,00"
 */
function parseAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;
  if (!raw.replace(/[^\d]/g, "")) return null;
  return parseSignedAmount(raw);
}

/**
 * Parse DD/MM/YYYY date to ISO format.
 */
function parseDateBR(dateStr: string): string | null {
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

// ============================================================================
// CELL HELPERS
// ============================================================================

function cellStr(row: unknown[], col: number): string {
  const val = row[col];
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

function isDateCell(s: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s.trim());
}

function isTotalRow(s: string): boolean {
  const lower = s.toLowerCase();
  return (
    lower.startsWith("total") ||
    lower.includes("total nacional") ||
    lower.includes("total internacional") ||
    lower.includes("total de lançamentos") ||
    lower.includes("total dos lançamentos") ||
    lower.includes("total de retirada") ||
    lower.includes("total encargos")
  );
}

function isHeaderRow(row: unknown[]): boolean {
  const c0 = cellStr(row, 0).toLowerCase();
  const c1 = cellStr(row, 1).toLowerCase();
  return c0 === "data" && (c1 === "lançamento" || c1 === "lancamento");
}

function isCardSection(s: string): string | null {
  // "MATIAS BREUNIG - final 5847 (titular)" → "5847"
  // "NATALIA L R BREUNIG - final 1963 (adicional)" → "1963"
  const m = s.match(/final\s+(\d{4})/i);
  return m ? m[1] : null;
}

// ============================================================================
// MAIN PARSER
// ============================================================================

export function parseXls(buffer: Buffer): XlsParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays (raw rows)
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const entries: ParsedEntry[] = [];
  const cardNumbers: string[] = [];

  let inTransactionSection = false;
  let inInternationalSection = false;
  let currentCard = "";
  let rowNumber = 0;

  // State for international multi-row blocks
  let pendingIntlDate: string | null = null;
  let pendingIntlExchangeRate: string | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const c0 = cellStr(row, 0);
    const c1 = cellStr(row, 1);
    const c3 = cellStr(row, 3);

    // Detect section boundaries
    if (c0.toLowerCase().includes("lançamentos nacionais")) {
      inTransactionSection = true;
      inInternationalSection = false;
      continue;
    }
    if (c0.toLowerCase().includes("lançamentos internacionais")) {
      inTransactionSection = true;
      inInternationalSection = true;
      continue;
    }
    if (c0.toLowerCase().includes("encargos e serviços") || c0.toLowerCase().includes("encargos")) {
      if (c0.toLowerCase() === "encargos" || c0.toLowerCase().includes("encargos e serviços")) {
        inTransactionSection = false;
        inInternationalSection = false;
        continue;
      }
    }

    if (!inTransactionSection) continue;

    // Detect card sub-sections
    const cardNum = isCardSection(c0);
    if (cardNum) {
      currentCard = cardNum;
      if (!cardNumbers.includes(cardNum)) cardNumbers.push(cardNum);
      continue;
    }

    // Skip header rows ("data", "lançamento", "valor")
    if (isHeaderRow(row)) continue;

    // Skip total/subtotal rows
    if (isTotalRow(c0) || isTotalRow(c1)) {
      continue;
    }

    // Skip IOF rows at section level
    if (c0.toLowerCase().startsWith("iof -")) continue;

    // Skip empty rows
    if (!c0 && !c1 && !c3) continue;

    // ── NATIONAL TRANSACTIONS ──
    if (!inInternationalSection) {
      if (isDateCell(c0) && c1 && c3) {
        const date = parseDateBR(c0);
        const amount = parseAmount(c3);

        if (date && amount !== null) {
          rowNumber++;
          entries.push({
            entryDate: date,
            amount, // as printed: the invoice convention is applied downstream
            rawDescription: c1,
            rawData: {
              date: c0,
              description: c1,
              value: c3,
              card: currentCard,
              section: "nacional",
            },
            rowNumber,
          });
        }
      }
      continue;
    }

    // ── INTERNATIONAL TRANSACTIONS ──
    // Multi-row format:
    // Row 1: date | "dólar de conversão" | "" | "R$ 5.48"
    // Row 2: ""   | description           | "" | "R$ 10,144.58" (BRL value)
    // Row 3: ""   | "valor em dólar"      | "" | "$ 1,851.20"
    // Row 4: ""   | country               | "" | original value

    if (isDateCell(c0) && c1.toLowerCase().includes("dólar de conversão")) {
      // Start of international block
      pendingIntlDate = parseDateBR(c0);
      pendingIntlExchangeRate = c3;
      continue;
    }

    if (pendingIntlDate && !c0 && c1) {
      const lower = c1.toLowerCase();

      if (lower.includes("valor em") || lower.includes("valor em dólar")) {
        // Skip: this is the USD value line
        continue;
      }

      // Check if this is a country name (short, no digits, no R$)
      if (c3 && !c3.startsWith("R$") && !c3.startsWith("$") && c1.length < 30 && !/\d/.test(c1.replace(/\s/g, ""))) {
        // Country row — skip
        continue;
      }

      // This should be the actual transaction description + BRL amount
      if (c3) {
        const amount = parseAmount(c3);
        if (amount !== null) {
          rowNumber++;
          entries.push({
            entryDate: pendingIntlDate,
            amount, // as printed: convention applied downstream
            rawDescription: c1,
            rawData: {
              date: pendingIntlDate,
              description: c1,
              value: c3,
              exchangeRate: pendingIntlExchangeRate ?? "",
              card: currentCard,
              section: "internacional",
            },
            rowNumber,
          });
          pendingIntlDate = null;
          pendingIntlExchangeRate = null;
        }
      }
      continue;
    }

    // IOF lines within international section (standalone, with date)
    if (isDateCell(c0) && c1 && c3 && !c1.toLowerCase().includes("dólar de conversão")) {
      const date = parseDateBR(c0);
      const amount = parseAmount(c3);
      if (date && amount !== null) {
        rowNumber++;
        entries.push({
          entryDate: date,
          amount, // as printed: convention applied downstream
          rawDescription: c1,
          rawData: {
            date: c0,
            description: c1,
            value: c3,
            card: currentCard,
            section: "internacional",
          },
          rowNumber,
        });
      }
    }
  }

  return {
    entries,
    institution: "itau",
    cardNumbers,
  };
}
