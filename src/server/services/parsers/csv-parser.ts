import Papa from "papaparse";
import { createHash } from "crypto";
import { parseAmount } from "./amount";

export interface ParsedEntry {
  entryDate: string; // ISO date
  amount: number; // centavos (positive=credit, negative=debit)
  rawDescription: string;
  balanceAfter?: number; // centavos
  rawData: Record<string, string>;
  rowNumber: number;
  /**
   * Stable identifier the institution itself assigned to the line — the OFX
   * FITID. When present it is what makes the entry unique, so two genuinely
   * distinct movements with the same date, amount and text never collide.
   */
  externalId?: string;
  /** Filled by finalizeEntries in the parser-factory. */
  hash?: string;
}

export interface CsvTemplateConfig {
  dateColumn: string;
  dateFormat: string; // "dd/MM/yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy"
  amountColumn: string;
  descriptionColumn: string;
  balanceColumn?: string;
  amountIsNegativeForDebit: boolean; // true = negative means debit
  creditColumn?: string; // separate credit column
  debitColumn?: string; // separate debit column
  skipRows?: number;
  delimiter?: string;
  encoding?: string;
}

/**
 * Build a date from day/month/year parts, or return null when the pieces are
 * not a real date.
 *
 * Returning null rather than a malformed string matters: a footer row like
 * "Total;;1.234,56" used to reach `.padStart` on `undefined` and throw, and the
 * exception took the whole import down — every line lost because of one line of
 * summary text. Two-digit years were also interpolated raw, producing dates
 * like "25-03-05" that sorted before every real date.
 */
function buildISODate(day?: string, month?: string, year?: string): string | null {
  if (!day || !month || !year) return null;

  const d = Number(day);
  const m = Number(month);
  let y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;

  if (year.trim().length === 2) {
    // Bank exports with 2-digit years: 70-99 are 1900s, everything else 2000s.
    y = y >= 70 ? 1900 + y : 2000 + y;
  }
  if (y < 1900 || y > 2999) return null;

  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateToISO(dateStr: string, format: string): string | null {
  dateStr = dateStr.trim();
  if (!dateStr) return null;

  if (format === "yyyy-MM-dd") {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
  }

  if (format === "dd/MM/yyyy") {
    const [d, m, y] = dateStr.split("/");
    return buildISODate(d, m, y);
  }

  if (format === "MM/dd/yyyy") {
    const [m, d, y] = dateStr.split("/");
    return buildISODate(d, m, y);
  }

  if (format === "dd-MM-yyyy") {
    const [d, m, y] = dateStr.split("-");
    return buildISODate(d, m, y);
  }

  // Fallback: only accept something already ISO-shaped.
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
}

/**
 * Identity of a statement line, for deduplication.
 *
 * `discriminator` is what keeps two legitimate identical movements apart — the
 * institution's own id (FITID) when the format provides one, otherwise the
 * occurrence index within the file. Without it, two R$ 5,00 bus fares on the
 * same day collapsed into one and the second was silently dropped.
 */
export function generateEntryHash(
  date: string,
  amount: number,
  description: string,
  discriminator = "",
): string {
  const input = `${date}|${amount}|${description}|${discriminator}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function parseCsv(
  content: string,
  config: CsvTemplateConfig
): ParsedEntry[] {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: config.delimiter || ",",
  });

  if (result.errors.length > 0) {
    const criticalErrors = result.errors.filter((e) => e.type === "Delimiter");
    if (criticalErrors.length > 0) {
      throw new Error(`Erro de parsing CSV: ${criticalErrors[0].message}`);
    }
  }

  const entries: ParsedEntry[] = [];
  const startRow = config.skipRows || 0;

  for (let i = startRow; i < result.data.length; i++) {
    const row = result.data[i];
    const dateStr = row[config.dateColumn];
    const description = row[config.descriptionColumn];

    if (!dateStr || !description) continue;

    let amount: number;

    if (config.creditColumn && config.debitColumn) {
      const credit = parseAmount(row[config.creditColumn] || "0");
      const debit = parseAmount(row[config.debitColumn] || "0");
      amount = credit > 0 ? credit : -debit;
    } else {
      // Faithful to the file. `amountIsNegativeForDebit` declares the file's
      // convention; applying it is finalizeEntries' job in the parser-factory.
      amount = parseAmount(row[config.amountColumn]);
    }

    const entryDate = parseDateToISO(dateStr, config.dateFormat);
    // Not a date: a footer, a subtotal, a section header. Skip the line instead
    // of throwing, which used to abort the whole file.
    if (!entryDate) continue;

    const balanceAfter = config.balanceColumn
      ? parseAmount(row[config.balanceColumn])
      : undefined;

    entries.push({
      entryDate,
      amount,
      rawDescription: description.trim(),
      balanceAfter,
      rawData: row,
      rowNumber: i + 1,
    });
  }

  return entries;
}

// Auto-detect CSV columns from header
export function detectCsvColumns(content: string): {
  headers: string[];
  sampleRows: Record<string, string>[];
  suggestedConfig: Partial<CsvTemplateConfig>;
} {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    preview: 5,
  });

  const headers = result.meta.fields || [];
  const sampleRows = result.data;
  const suggestedConfig: Partial<CsvTemplateConfig> = {};

  // Try to auto-detect columns
  const lowerHeaders = headers.map((h) => h.toLowerCase());

  // Date column detection
  const datePatterns = ["data", "date", "dt", "data lançamento", "data lancamento"];
  for (const pattern of datePatterns) {
    const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (idx >= 0) {
      suggestedConfig.dateColumn = headers[idx];
      break;
    }
  }

  // Amount column detection
  const amountPatterns = ["valor", "amount", "value", "vlr"];
  for (const pattern of amountPatterns) {
    const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (idx >= 0) {
      suggestedConfig.amountColumn = headers[idx];
      break;
    }
  }

  // Description column detection
  const descPatterns = ["descrição", "descricao", "description", "desc", "histórico", "historico", "lançamento", "lancamento"];
  for (const pattern of descPatterns) {
    const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (idx >= 0) {
      suggestedConfig.descriptionColumn = headers[idx];
      break;
    }
  }

  // Balance column detection
  const balancePatterns = ["saldo", "balance", "saldo final"];
  for (const pattern of balancePatterns) {
    const idx = lowerHeaders.findIndex((h) => h.includes(pattern));
    if (idx >= 0) {
      suggestedConfig.balanceColumn = headers[idx];
      break;
    }
  }

  // Default configs
  suggestedConfig.dateFormat = "dd/MM/yyyy";
  suggestedConfig.amountIsNegativeForDebit = true;

  return { headers, sampleRows, suggestedConfig };
}

// ============================================================================
// INSTALLMENT PARSER
// ============================================================================

export interface InstallmentInfo {
  current: number;
  total: number;
  cleanDescription: string;
}

/**
 * Parse installment info from credit card descriptions.
 * Examples: "ZARA BRASIL LTDA 01/03" → current=1, total=3
 */
export function parseInstallments(description: string): InstallmentInfo | null {
  const match = description.match(/^(.+?)\s+(\d{2})\/(\d{2})$/);
  if (!match) return null;

  const current = parseInt(match[2], 10);
  const total = parseInt(match[3], 10);

  // Sanity: installment numbers should make sense
  if (current < 1 || total < 2 || current > total || total > 60) return null;

  return {
    current,
    total,
    cleanDescription: match[1].trim(),
  };
}

// ============================================================================
// MERCHANT NAME CLEANER
// ============================================================================

// Common Brazilian city names found in Itaú credit card statements
const CITY_SUFFIXES = [
  "SAO PAULOBR", "RIO DE JANEIRBR", "CURITIBABR", "BELO HORIZONTBR",
  "BRASILIABR", "SALVADORBR", "FORTALEZABR", "RECIFEBR",
  "PORTO ALEGREBR", "MARINGABR", "CAMPINAS BR", "CAMPINASBR",
  "CONTAGEMBR", "OSASCOBR", "BARUERIBR", "TABOAO DA SERBR",
  "SANTO ANDREBR", "GUARULHOSBR", "ITAPEMABR", "TIJUCAS DO SUBR",
  "PIEDADE DOS GBR", "FRANCABR",
];

/**
 * Clean merchant names from credit card CSVs.
 * Itaú concatenates city+country: "NETFLIX.COMSAO PAULOBR" → "NETFLIX.COM"
 */
export function cleanMerchantName(rawDescription: string): string {
  let desc = rawDescription.trim();

  // Try known city suffixes first (longest match)
  for (const suffix of CITY_SUFFIXES.sort((a, b) => b.length - a.length)) {
    if (desc.toUpperCase().endsWith(suffix)) {
      desc = desc.slice(0, -suffix.length).trim();
      break;
    }
  }

  // Fallback: generic pattern — 2+ uppercase chars followed by "BR" at end
  // Match patterns like "SAO PAULOBR", "OSASCOBR", etc.
  if (desc.toUpperCase().endsWith("BR") && desc.length > 10) {
    const brPattern = /[A-Z\s]{4,}BR$/i;
    if (brPattern.test(desc)) {
      desc = desc.replace(brPattern, "").trim();
    }
  }

  return desc || rawDescription;
}

// ============================================================================
// SPECIAL ENTRY CLASSIFICATION (credit card)
// ============================================================================

export interface SpecialEntryInfo {
  isSpecial: boolean;
  suggestedCategory?: string; // category name hint
  type: "expense" | "income";
  isCharge: boolean; // fees, interest, etc.
  /**
   * Line exists in the file but must not become a transaction. The invoice
   * payment is the case: its purchases are already booked individually, so
   * importing the payment too would double-count the month.
   */
  skip?: boolean;
}

const SPECIAL_ENTRIES: Record<string, SpecialEntryInfo> = {
  "MULTA": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "JUROS DE MORA": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "ENCARGOS REFINANCIAMENTO": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "IOF": { isSpecial: true, suggestedCategory: "Impostos", type: "expense", isCharge: true },
  "PAGAMENTO EFETUADO": { isSpecial: true, suggestedCategory: "Pagamento Fatura", type: "expense", isCharge: false, skip: true },
};

export function classifySpecialEntry(description: string): SpecialEntryInfo | null {
  const upper = description.trim().toUpperCase();

  // Exact match first
  if (SPECIAL_ENTRIES[upper]) return SPECIAL_ENTRIES[upper];

  // Partial match for known patterns
  if (upper.startsWith("MULTA")) return SPECIAL_ENTRIES["MULTA"];
  if (upper.includes("JUROS DE MORA")) return SPECIAL_ENTRIES["JUROS DE MORA"];
  if (upper.includes("ENCARGOS")) return SPECIAL_ENTRIES["ENCARGOS REFINANCIAMENTO"];
  if (upper === "IOF" || upper.startsWith("IOF ")) return SPECIAL_ENTRIES["IOF"];
  if (upper.includes("PAGAMENTO EFETUADO")) return SPECIAL_ENTRIES["PAGAMENTO EFETUADO"];
  if (upper.includes("REDUÇÃO") || upper.includes("REDUCAO")) {
    return { isSpecial: true, suggestedCategory: "Descontos", type: "income", isCharge: false };
  }

  return null;
}

// ============================================================================
// PRE-BUILT TEMPLATES
// ============================================================================

// Pre-built templates for Brazilian banks
export const BANK_TEMPLATES: Record<string, CsvTemplateConfig> = {
  nubank: {
    dateColumn: "Data",
    dateFormat: "dd/MM/yyyy",
    amountColumn: "Valor",
    descriptionColumn: "Descrição",
    amountIsNegativeForDebit: true,
    delimiter: ",",
  },
  inter: {
    dateColumn: "Data Lançamento",
    dateFormat: "dd/MM/yyyy",
    amountColumn: "Valor",
    descriptionColumn: "Descrição",
    balanceColumn: "Saldo",
    amountIsNegativeForDebit: true,
    delimiter: ";",
  },
  itau: {
    dateColumn: "data",
    dateFormat: "dd/MM/yyyy",
    amountColumn: "valor",
    descriptionColumn: "lancamento",
    amountIsNegativeForDebit: true,
    delimiter: ";",
  },
  itau_fatura: {
    dateColumn: "data",
    dateFormat: "yyyy-MM-dd",
    amountColumn: "valor",
    descriptionColumn: "lançamento",
    amountIsNegativeForDebit: false, // positive = expense on invoice
    delimiter: ",",
  },
  bradesco: {
    dateColumn: "Data",
    dateFormat: "dd/MM/yyyy",
    amountColumn: "Valor",
    descriptionColumn: "Histórico",
    balanceColumn: "Saldo",
    amountIsNegativeForDebit: true,
    delimiter: ";",
  },
};
