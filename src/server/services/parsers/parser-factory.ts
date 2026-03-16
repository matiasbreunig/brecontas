import { parseCsv, detectCsvColumns, BANK_TEMPLATES, generateEntryHash, type ParsedEntry, type CsvTemplateConfig } from "./csv-parser";
import { parseOfx } from "./ofx-parser";

export type ImportFormat = "csv" | "ofx";

export interface ParseResult {
  entries: ParsedEntry[];
  format: ImportFormat;
  detectedInstitution?: string;
  balance?: number;
  balanceDate?: string;
}

function detectFormat(filename: string, content: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "ofx" || ext === "qfx") return "ofx";
  if (content.includes("OFXHEADER") || content.includes("<OFX>")) return "ofx";
  return "csv";
}

function detectInstitution(content: string, filename: string): string | undefined {
  const lower = (content + filename).toLowerCase();

  if (lower.includes("nubank") || lower.includes("nu pagamentos")) return "nubank";
  if (lower.includes("inter") || lower.includes("banco inter")) return "inter";
  if (lower.includes("itaú") || lower.includes("itau")) return "itau";
  if (lower.includes("bradesco")) return "bradesco";
  if (lower.includes("caixa")) return "caixa";
  if (lower.includes("santander")) return "santander";
  if (lower.includes("bb") || lower.includes("banco do brasil")) return "bb";

  return undefined;
}

export function parseFile(
  content: string,
  filename: string,
  templateConfig?: CsvTemplateConfig
): ParseResult {
  const format = detectFormat(filename, content);
  const institution = detectInstitution(content, filename);

  if (format === "ofx") {
    const result = parseOfx(content);
    // Add hashes
    const entries = result.entries.map((e) => ({
      ...e,
      hash: generateEntryHash(e.entryDate, e.amount, e.rawDescription),
    }));
    return {
      entries,
      format: "ofx",
      detectedInstitution: institution,
      balance: result.balance,
      balanceDate: result.balanceDate,
    };
  }

  // CSV
  let config: CsvTemplateConfig;

  if (templateConfig) {
    config = templateConfig;
  } else if (institution && BANK_TEMPLATES[institution]) {
    config = BANK_TEMPLATES[institution];
  } else {
    // Try auto-detect
    const detected = detectCsvColumns(content);
    config = {
      dateColumn: detected.suggestedConfig.dateColumn || "",
      dateFormat: detected.suggestedConfig.dateFormat || "dd/MM/yyyy",
      amountColumn: detected.suggestedConfig.amountColumn || "",
      descriptionColumn: detected.suggestedConfig.descriptionColumn || "",
      balanceColumn: detected.suggestedConfig.balanceColumn,
      amountIsNegativeForDebit: true,
    };
  }

  const entries = parseCsv(content, config).map((e) => ({
    ...e,
    hash: generateEntryHash(e.entryDate, e.amount, e.rawDescription),
  }));

  return {
    entries,
    format: "csv",
    detectedInstitution: institution,
  };
}

export { detectCsvColumns, BANK_TEMPLATES, type CsvTemplateConfig, type ParsedEntry };
