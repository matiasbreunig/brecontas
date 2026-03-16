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
  // Brazilian format: 1.234,56 or -1.234,56
  const cleaned = value
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
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
