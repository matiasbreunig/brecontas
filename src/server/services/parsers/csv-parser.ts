import Papa from "papaparse";
import { createHash } from "crypto";

export interface ParsedEntry {
  entryDate: string; // ISO date
  amount: number; // centavos (positive=credit, negative=debit)
  rawDescription: string;
  balanceAfter?: number; // centavos
  rawData: Record<string, string>;
  rowNumber: number;
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

function parseDateToISO(dateStr: string, format: string): string {
  dateStr = dateStr.trim();

  if (format === "yyyy-MM-dd") {
    return dateStr;
  }

  if (format === "dd/MM/yyyy") {
    const [d, m, y] = dateStr.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (format === "MM/dd/yyyy") {
    const [m, d, y] = dateStr.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (format === "dd-MM-yyyy") {
    const [d, m, y] = dateStr.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Fallback: try to parse as ISO
  return dateStr;
}

function parseAmount(value: string): number {
  if (!value || value.trim() === "") return 0;

  let cleaned = value.replace(/[R$\s]/g, "").trim();

  // Detect format by looking at the last separator:
  // BR format: "1.234,56" → last separator is comma → decimal
  // US format: "1,234.56" or "355.05" → last separator is dot → decimal
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // BR format: dots are thousands, comma is decimal
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // US format: commas are thousands, dot is decimal
    cleaned = cleaned.replace(/,/g, "");
  }
  // If neither exists, it's a plain integer

  return Math.round(parseFloat(cleaned) * 100);
}

export function generateEntryHash(date: string, amount: number, description: string): string {
  const input = `${date}|${amount}|${description}`;
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
      amount = parseAmount(row[config.amountColumn]);
      if (!config.amountIsNegativeForDebit) {
        // If positive always, need to figure from context — default to negative (expense)
        amount = -Math.abs(amount);
      }
    }

    const entryDate = parseDateToISO(dateStr, config.dateFormat);
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
}

const SPECIAL_ENTRIES: Record<string, SpecialEntryInfo> = {
  "MULTA": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "JUROS DE MORA": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "ENCARGOS REFINANCIAMENTO": { isSpecial: true, suggestedCategory: "Encargos Bancários", type: "expense", isCharge: true },
  "IOF": { isSpecial: true, suggestedCategory: "Impostos", type: "expense", isCharge: true },
  "PAGAMENTO EFETUADO": { isSpecial: true, suggestedCategory: "Pagamento Fatura", type: "income", isCharge: false },
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
