import {
  parseCsv,
  detectCsvColumns,
  BANK_TEMPLATES,
  generateEntryHash,
  parseInstallments,
  cleanMerchantName,
  classifySpecialEntry,
  type ParsedEntry,
  type CsvTemplateConfig,
} from "./csv-parser";
import { parseOfx, extractOfxMetadata, resolveInstitutionFromBankId, type OfxMetadata } from "./ofx-parser";
import { parseXls } from "./xls-parser";
import { parsePdf } from "./pdf-parser";

export type ImportFormat = "csv" | "ofx" | "xls" | "pdf";
export type ImportMode = "bank_statement" | "card_invoice";

export interface ParseResult {
  entries: ParsedEntry[];
  format: ImportFormat;
  mode: ImportMode;
  detectedInstitution?: string;
  balance?: number;
  balanceDate?: string;
  ofxMetadata?: OfxMetadata;
  dateRange?: { start: string; end: string };
  /** Parsed installment/merchant enrichment per entry index */
  enrichments?: EntryEnrichment[];
}

export interface EntryEnrichment {
  rowNumber: number;
  cleanDescription?: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  specialCategory?: string;
  suggestedType?: "income" | "expense";
  isCharge?: boolean;
}

export interface DetectionResult {
  format: ImportFormat;
  mode: ImportMode;
  institution?: string;
  ofxMetadata?: OfxMetadata;
  dateRange?: { start: string; end: string };
  totalEntries: number;
  balance?: number;
  balanceDate?: string;
}

// ============================================================================
// FORMAT DETECTION
// ============================================================================

function detectFormat(filename: string, content: string): ImportFormat {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "pdf";
  if (ext === "xls" || ext === "xlsx") return "xls";
  if (ext === "ofx" || ext === "qfx") return "ofx";
  if (content.includes("OFXHEADER") || content.includes("<OFX>")) return "ofx";
  return "csv";
}

// ============================================================================
// INSTITUTION DETECTION
// ============================================================================

function detectInstitution(content: string, filename: string, ofxMetadata?: OfxMetadata): string | undefined {
  // First: try OFX BANKID (most reliable)
  if (ofxMetadata?.bankId) {
    const fromBankId = resolveInstitutionFromBankId(ofxMetadata.bankId);
    if (fromBankId) return fromBankId;
  }

  // Then: content/filename heuristics
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

// ============================================================================
// MODE DETECTION (bank statement vs credit card invoice)
// ============================================================================

function detectMode(content: string, format: ImportFormat, ofxMetadata?: OfxMetadata): ImportMode {
  // OFX: check ACCTTYPE
  if (format === "ofx" && ofxMetadata?.accountType) {
    if (ofxMetadata.accountType.toUpperCase() === "CREDITCARD") return "card_invoice";
    return "bank_statement";
  }

  // CSV: check headers and data patterns
  if (format === "csv") {
    const firstLine = content.split("\n")[0]?.toLowerCase().trim() || "";

    // Itaú credit card CSV has: "data,lançamento,valor" with comma delimiter and ISO dates
    if (firstLine.includes("lançamento") || firstLine.includes("lancamento")) {
      const lines = content.split("\n").slice(1, 4);
      for (const line of lines) {
        if (/^\d{4}-\d{2}-\d{2}/.test(line.trim())) {
          return "card_invoice";
        }
      }
    }

    // If has typical credit card patterns in content
    const sample = content.slice(0, 3000).toUpperCase();
    if (sample.includes("PAGAMENTO EFETUADO") || sample.includes("ANUIDADE")) {
      return "card_invoice";
    }
  }

  return "bank_statement";
}

// ============================================================================
// CSV TEMPLATE SELECTION
// ============================================================================

function selectCsvTemplate(
  content: string,
  institution: string | undefined,
  mode: ImportMode,
): CsvTemplateConfig | null {
  // Itaú credit card invoice — specific template
  if (mode === "card_invoice") {
    const firstLine = content.split("\n")[0]?.trim().toLowerCase() || "";
    if (
      firstLine === "data,lançamento,valor" ||
      firstLine === "data,lancamento,valor" ||
      institution === "itau"
    ) {
      return BANK_TEMPLATES["itau_fatura"];
    }
  }

  // Known institution template for bank statement
  if (institution && BANK_TEMPLATES[institution]) {
    return BANK_TEMPLATES[institution];
  }

  return null;
}

// ============================================================================
// ENRICHMENT — Parse installments, clean merchants, classify special entries
// ============================================================================

function enrichEntries(entries: ParsedEntry[], mode: ImportMode): EntryEnrichment[] {
  if (mode !== "card_invoice") return [];

  const enrichments: EntryEnrichment[] = [];

  for (const entry of entries) {
    const enrichment: EntryEnrichment = { rowNumber: entry.rowNumber };
    const desc = entry.rawDescription;

    // Check for special entries (MULTA, IOF, etc.)
    const special = classifySpecialEntry(desc);
    if (special) {
      enrichment.specialCategory = special.suggestedCategory;
      enrichment.suggestedType = special.type;
      enrichment.isCharge = special.isCharge;
      enrichment.cleanDescription = desc;
    } else {
      // Parse installments
      const installment = parseInstallments(desc);
      if (installment) {
        enrichment.installmentCurrent = installment.current;
        enrichment.installmentTotal = installment.total;
        enrichment.cleanDescription = cleanMerchantName(installment.cleanDescription);
      } else {
        enrichment.cleanDescription = cleanMerchantName(desc);
      }
    }

    enrichments.push(enrichment);
  }

  return enrichments;
}

// ============================================================================
// DATE RANGE
// ============================================================================

function computeDateRange(entries: ParsedEntry[]): { start: string; end: string } | undefined {
  if (entries.length === 0) return undefined;
  const dates = entries.map((e) => e.entryDate).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

// ============================================================================
// DETECT (quick analysis for preview/auto-fill, no enrichment)
// ============================================================================

export async function detectImportSettings(content: string, filename: string): Promise<DetectionResult> {
  const format = detectFormat(filename, content);

  // PDF: content is base64 encoded binary
  if (format === "pdf") {
    try {
      const buffer = Buffer.from(content, "base64");
      const result = await parsePdf(buffer);
      const dateRange = computeDateRange(result.entries);
      return {
        format: "pdf",
        mode: "card_invoice",
        institution: result.institution,
        totalEntries: result.entries.length,
        dateRange,
        balance: result.metadata.totalAmount,
      };
    } catch {
      return { format: "pdf", mode: "card_invoice", institution: "itau", totalEntries: 0 };
    }
  }

  // XLS: content is base64 encoded binary
  if (format === "xls") {
    try {
      const buffer = Buffer.from(content, "base64");
      const result = parseXls(buffer);
      const dateRange = computeDateRange(result.entries);
      return {
        format: "xls",
        mode: "card_invoice",
        institution: result.institution,
        totalEntries: result.entries.length,
        dateRange,
      };
    } catch {
      return { format: "xls", mode: "card_invoice", institution: "itau", totalEntries: 0 };
    }
  }

  let ofxMetadata: OfxMetadata | undefined;

  if (format === "ofx") {
    ofxMetadata = extractOfxMetadata(content);
  }

  const institution = detectInstitution(content, filename, ofxMetadata);
  const mode = detectMode(content, format, ofxMetadata);

  // Quick parse to get entry count and date range
  let totalEntries = 0;
  let balance: number | undefined;
  let balanceDate: string | undefined;
  let dateRange: { start: string; end: string } | undefined;

  try {
    const result = await parseFile(content, filename);
    totalEntries = result.entries.length;
    balance = result.balance;
    balanceDate = result.balanceDate;
    dateRange = computeDateRange(result.entries);
  } catch {
    // Detection is best-effort
  }

  return {
    format,
    mode,
    institution,
    ofxMetadata,
    totalEntries,
    balance,
    balanceDate,
    dateRange,
  };
}

// ============================================================================
// PARSE (full parse with enrichment)
// ============================================================================

/**
 * The one place where the sign convention lives.
 *
 * Parsers emit the amount exactly as printed in the file. Here it is normalised
 * to the system convention — **negative means money leaves** — the skipped
 * lines are dropped, and only then is the hash computed, so it always reflects
 * the final amount.
 *
 * `debitPositive` describes the *file*: a credit card invoice prints purchases
 * as positive numbers and refunds as negative, the opposite of a bank
 * statement. Inverting it here, once, replaces the four near-identical tails
 * this function used to have — which is how the CSV path ended up inverting
 * twice and importing every purchase as income.
 */
function finalizeEntries(
  rawEntries: ParsedEntry[],
  opts: { mode: ImportMode; debitPositive: boolean },
): (ParsedEntry & { hash: string })[] {
  const finalized: (ParsedEntry & { hash: string })[] = [];

  for (const entry of rawEntries) {
    if (opts.mode === "card_invoice") {
      const special = classifySpecialEntry(entry.rawDescription);
      if (special?.skip) continue;
    }

    const amount = opts.debitPositive ? -entry.amount : entry.amount;

    finalized.push({
      ...entry,
      amount,
      hash: generateEntryHash(entry.entryDate, amount, entry.rawDescription),
    });
  }

  return finalized;
}

export async function parseFile(
  content: string,
  filename: string,
  templateConfig?: CsvTemplateConfig,
): Promise<ParseResult> {
  const format = detectFormat(filename, content);

  // PDF: content is base64 encoded binary
  if (format === "pdf") {
    const buffer = Buffer.from(content, "base64");
    const result = await parsePdf(buffer);
    // The invoice prints purchases as positive and refunds as negative.
    const entries = finalizeEntries(result.entries, {
      mode: "card_invoice",
      debitPositive: true,
    });
    const enrichments = enrichEntries(entries, "card_invoice");
    return {
      entries,
      format: "pdf",
      mode: "card_invoice",
      detectedInstitution: result.institution,
      dateRange: computeDateRange(entries),
      enrichments: enrichments.length > 0 ? enrichments : undefined,
    };
  }

  // XLS: content is base64 encoded binary
  if (format === "xls") {
    const buffer = Buffer.from(content, "base64");
    const result = parseXls(buffer);
    // Itaú prints invoice purchases as positive and refunds as negative.
    const entries = finalizeEntries(result.entries, {
      mode: "card_invoice",
      debitPositive: true,
    });
    const enrichments = enrichEntries(entries, "card_invoice");
    return {
      entries,
      format: "xls",
      mode: "card_invoice",
      detectedInstitution: result.institution,
      dateRange: computeDateRange(entries),
      enrichments: enrichments.length > 0 ? enrichments : undefined,
    };
  }

  let ofxMetadata: OfxMetadata | undefined;

  if (format === "ofx") {
    ofxMetadata = extractOfxMetadata(content);
  }

  const institution = detectInstitution(content, filename, ofxMetadata);
  const mode = detectMode(content, format, ofxMetadata);

  if (format === "ofx") {
    const result = parseOfx(content);
    // OFX TRNAMT is already signed per the spec.
    const entries = finalizeEntries(result.entries, {
      mode,
      debitPositive: false,
    });
    return {
      entries,
      format: "ofx",
      mode,
      detectedInstitution: institution,
      balance: result.balance,
      balanceDate: result.balanceDate,
      ofxMetadata: result.metadata,
      dateRange: computeDateRange(entries),
    };
  }

  // CSV
  let config: CsvTemplateConfig;

  if (templateConfig) {
    config = templateConfig;
  } else {
    const selected = selectCsvTemplate(content, institution, mode);
    if (selected) {
      config = selected;
    } else {
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
  }

  const rawEntries = parseCsv(content, config);

  const entries = finalizeEntries(rawEntries, {
    mode,
    debitPositive: !config.amountIsNegativeForDebit,
  });

  const enrichments = enrichEntries(entries, mode);

  return {
    entries,
    format: "csv",
    mode,
    detectedInstitution: institution || (mode === "card_invoice" ? "itau" : undefined),
    dateRange: computeDateRange(entries),
    enrichments: enrichments.length > 0 ? enrichments : undefined,
  };
}

export { detectCsvColumns, BANK_TEMPLATES, type CsvTemplateConfig, type ParsedEntry };
