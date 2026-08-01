import { PDFExtract, type PDFExtractResult, type PDFExtractText } from "pdf.js-extract";
import type { ParsedEntry } from "./csv-parser";

/**
 * Parse Itaú credit card invoice PDFs using positional text extraction.
 *
 * The PDF uses a two-column layout for transactions. Each transaction is:
 *   Line 1: [DATE DD/MM] [ESTABLISHMENT + installment info] [AMOUNT]
 *   Line 2: [category city] (optional — only Visa Azul cards have this)
 *
 * Column separation is done by X coordinate (threshold ~350px).
 * Text often comes fragmented ("re sta urante" → "restaurante") and needs cleanup.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PdfParseResult {
  entries: ParsedEntry[];
  institution: string;
  metadata: PdfInvoiceMetadata;
}

export interface PdfInvoiceMetadata {
  cardNumber?: string;
  cardholderName?: string;
  dueDate?: string;        // ISO date
  totalAmount?: number;     // centavos
  creditLimit?: number;     // centavos
  closingDate?: string;     // ISO date
}

interface TextItem {
  x: number;
  y: number;
  str: string;
  width: number;
  height: number;
}

interface TextLine {
  y: number;
  items: TextItem[];
}

// ============================================================================
// TEXT CLEANUP
// ============================================================================

/** Remove fragmented spaces inserted by pdf.js-extract */
function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Clean up PDF text fragmentation.
 * pdf.js-extract often inserts spaces in the middle of words: "ORA L SIN" → "ORAL SIN"
 *
 * Strategy: iteratively join word fragments. A "fragment" is a short piece of text
 * that is likely part of a larger word. We join aggressively when:
 * - Either neighbor is ≤ 3 chars (definitely fragmented)
 * - Both neighbors are ALL CAPS and combined ≤ 15 chars (credit card descriptions)
 * - A lowercase start connects to a lowercase continuation ("iles" after "Sm")
 */
function cleanDescription(s: string): string {
  let result = s.replace(/\s+/g, " ").trim();

  const ALPHA = "[A-Za-záéíóúàâãõçÁÉÍÓÚÀÂÃÕÇ*]";

  // Pass 1: Join when either fragment is very short (1-3 chars)
  for (let i = 0; i < 8; i++) {
    const prev = result;
    // Short left (1-3) + anything
    result = result.replace(new RegExp(`(${ALPHA}{1,3}) (${ALPHA}{1,})`, "g"), (_, a, b) => {
      // Don't join if both are standalone words (>= 3 chars each) — too aggressive
      if (a.length >= 3 && b.length >= 3) return `${a} ${b}`;
      return `${a}${b}`;
    });
    // Anything + short right (1-3)
    result = result.replace(new RegExp(`(${ALPHA}{1,}) (${ALPHA}{1,3})\\b`, "g"), (_, a, b) => {
      if (a.length >= 3 && b.length >= 3) return `${a} ${b}`;
      return `${a}${b}`;
    });
    if (result === prev) break;
  }

  // Pass 2: Join ALL-CAPS fragments that are likely one word
  // "ORINT ERTO URA" → "ORINTERT OURA" → need to join 4-5 char caps fragments
  for (let i = 0; i < 5; i++) {
    const prev = result;
    result = result.replace(/([A-Z*]{2,6}) ([A-Z*]{2,6})\b/g, (match, a, b) => {
      // If combined <= 15 chars, likely one word
      if (a.length + b.length <= 15) return `${a}${b}`;
      return match;
    });
    if (result === prev) break;
  }

  // Pass 3: Join mixed-case fragments ("Sm iles" → "Smiles")
  result = result.replace(/([A-Z][a-záéíóúàâãõç]{0,2}) ([a-záéíóúàâãõç]{2,})/g, "$1$2");

  return result.trim();
}

/** Collapse all spaces for pattern matching (e.g., "re sta urante" → "restaurante") */
function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, "");
}

// ============================================================================
// AMOUNT PARSING
// ============================================================================

function parseAmountBR(raw: string): number | null {
  let cleaned = collapseSpaces(raw).replace(/^-/, "");
  const isNegative = raw.trim().startsWith("-");

  // BR format: 1.234,56
  cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return Math.round(n * 100) * (isNegative ? -1 : 1);
}

// ============================================================================
// DATE PARSING
// ============================================================================

/** Extract installment info from description for date calculation */
function extractInstallmentFromDesc(desc: string): { current: number; total: number } | null {
  const collapsed = collapseSpaces(desc);
  const m = collapsed.match(/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const current = parseInt(m[1]);
  const total = parseInt(m[2]);
  if (current < 1 || current > total || total < 2 || total > 60) return null;
  return { current, total };
}

/**
 * Resolve the year for a DD/MM date from a credit card invoice PDF.
 *
 * For transactions WITH installment info: back-calculate from the installment number
 * to determine the original purchase year. This handles multi-year plans correctly.
 *
 * For transactions WITHOUT installment info: use the simpler heuristic that
 * transactions in months >= invoice month must be from the previous year.
 */
function parseDateDDMM(
  ddmm: string,
  invoiceYear: number,
  invoiceMonth: number,
  installmentCurrent?: number,
): string {
  const clean = collapseSpaces(ddmm);
  const m = clean.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return "";

  const day = parseInt(m[1]);
  const month = parseInt(m[2]);

  let year: number;

  if (installmentCurrent && installmentCurrent > 1) {
    // Calculate when the first installment appeared on an invoice
    // by going back (current - 1) months from this invoice
    const monthsBack = installmentCurrent - 1;
    let firstMonth = invoiceMonth - monthsBack;
    let firstYear = invoiceYear;
    while (firstMonth <= 0) {
      firstMonth += 12;
      firstYear--;
    }
    // The purchase happened before or during the month of the first installment
    year = firstYear;
    if (month > firstMonth) {
      year = firstYear - 1;
    }
  } else {
    // Simple heuristic: month >= invoiceMonth means previous year
    // (invoice closing is before the due date month)
    year = invoiceYear;
    if (month >= invoiceMonth) {
      year = invoiceYear - 1;
    }
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ============================================================================
// CATEGORY DETECTION
// ============================================================================

const KNOWN_CATEGORIES = [
  "restaurante", "supermercado", "vestuário", "vestuario",
  "saúde", "saude", "transporte", "educação", "educacao",
  "lazer", "eletrônicos", "eletronicos", "serviços", "servicos",
  "outros", "viagem", "casa", "pet", "combustível", "combustivel",
];

function detectCategory(text: string): { category: string; city: string } | null {
  const collapsed = collapseSpaces(text).toLowerCase();

  for (const cat of KNOWN_CATEGORIES) {
    if (collapsed.startsWith(cat)) {
      const rest = collapsed.slice(cat.length).trim();
      // Normalize category name
      const normalized = cat
        .replace("vestuario", "vestuário")
        .replace("saude", "saúde")
        .replace("educacao", "educação")
        .replace("eletronicos", "eletrônicos")
        .replace("servicos", "serviços")
        .replace("combustivel", "combustível");
      return { category: normalized, city: rest.toUpperCase() || "" };
    }
  }
  return null;
}

// ============================================================================
// SECTION DETECTION
// ============================================================================

type Section = "none" | "payments" | "purchases" | "services" | "future_installments" | "charges" | "limits";

function detectSection(text: string): Section | null {
  const collapsed = collapseSpaces(text).toLowerCase();

  if (collapsed.includes("pagamentosefetuados") || collapsed.includes("pagamentosdebautomatico")) return "payments";
  if (collapsed.includes("lançamentos:comprasesaques") || collapsed.includes("lancamentos:comprasesaques")) return "purchases";
  if (collapsed.includes("lançamentos:produtoseserviços") || collapsed.includes("lancamentos:produtoseservicos")) return "services";
  if (collapsed.includes("comprasparceladas") && collapsed.includes("próximasfaturas")) return "future_installments";
  if (collapsed.includes("encargoscobrados")) return "charges";
  if (collapsed.includes("limitesdecr")) return "limits";

  return null;
}

// ============================================================================
// METADATA EXTRACTION (Page 1)
// ============================================================================

function extractMetadata(items: TextItem[]): PdfInvoiceMetadata {
  const metadata: PdfInvoiceMetadata = {};
  const allText = items.map(i => i.str).join(" ");
  const collapsed = collapseSpaces(allText);

  // Card number: 4220.XXXX.XXXX.3978 or 5536.XXXX.XXXX.0073
  const cardMatch = collapsed.match(/(\d{4})[.\s]*X+[.\s]*X+[.\s]*(\d{4})/i);
  if (cardMatch) {
    metadata.cardNumber = `${cardMatch[1]}.XXXX.XXXX.${cardMatch[2]}`;
  }

  // Cardholder name: "Titular MATIAS BREUNIG" or "MATIAS BREUNIG"
  const nameMatch = collapsed.match(/Titular\s*([A-Z\s]+?)(?:Cartão|Cart)/);
  if (nameMatch) {
    metadata.cardholderName = nameMatch[1].trim();
  }

  // Due date: "Vencimento: DD/MM/YYYY" or "vencim ento.*DD/MM/YYYY"
  const dueMatch = collapsed.match(/[Vv]encimento[:\s]*(\d{2})\/(\d{2})\/(\d{4})/);
  if (dueMatch) {
    metadata.dueDate = `${dueMatch[3]}-${dueMatch[2]}-${dueMatch[1]}`;
  }

  // Total: "Total desta fatura 20.194,28"
  const totalMatch = collapsed.match(/Totaldestafatura[:\s]*([\d.,]+)/);
  if (totalMatch) {
    metadata.totalAmount = parseAmountBR(totalMatch[1]) ?? undefined;
  }

  // Credit limit: "Limite total de crédito: R$ 68.265,00"
  // Search in original items for items near "Limite total" text
  for (let i = 0; i < items.length; i++) {
    const itemCollapsed = collapseSpaces(items[i].str).toLowerCase();
    if (itemCollapsed.includes("limitetotaldecr") || itemCollapsed.includes("limitetotaldecrédito")) {
      // Look for a number in nearby items
      for (let j = i; j < Math.min(i + 5, items.length); j++) {
        const val = parseAmountBR(collapseSpaces(items[j].str));
        if (val && val > 100000) { // Limit is typically > R$ 1.000
          metadata.creditLimit = val;
          break;
        }
      }
      if (metadata.creditLimit) break;
    }
  }

  // Closing date: "Previsão próx. Fechamento: DD/MM/YYYY"
  const closingMatch = collapsed.match(/[Ff]echamento[:\s]*(\d{2})\/(\d{2})\/(\d{4})/);
  if (closingMatch) {
    metadata.closingDate = `${closingMatch[3]}-${closingMatch[2]}-${closingMatch[1]}`;
  }

  return metadata;
}

// ============================================================================
// LINE GROUPING
// ============================================================================

/** Group text items into lines by Y coordinate (±3px = same line) */
function groupIntoLines(items: TextItem[], column: "left" | "right"): TextLine[] {
  const threshold = 350;
  const filtered = items.filter(i => {
    if (column === "left") return i.x < threshold;
    return i.x >= threshold;
  });

  if (filtered.length === 0) return [];

  // Sort by Y then X
  filtered.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: TextLine[] = [];
  let currentLine: TextLine = { y: filtered[0].y, items: [filtered[0]] };

  for (let i = 1; i < filtered.length; i++) {
    const item = filtered[i];
    if (Math.abs(item.y - currentLine.y) <= 3) {
      currentLine.items.push(item);
    } else {
      lines.push(currentLine);
      currentLine = { y: item.y, items: [item] };
    }
  }
  lines.push(currentLine);

  return lines;
}

/** Concatenate all text in a line */
function lineText(line: TextLine): string {
  return line.items.map(i => i.str).join(" ");
}

/** Get the first item's X position */
function lineStartX(line: TextLine): number {
  return line.items[0]?.x ?? 0;
}

// ============================================================================
// TRANSACTION EXTRACTION
// ============================================================================

function isDatePattern(text: string): boolean {
  return /^\d{2}\/\s?\d{2}$/.test(collapseSpaces(text));
}

function extractTransactionsFromColumn(
  lines: TextLine[],
  invoiceYear: number,
  invoiceMonth: number,
): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let section: Section = "none";
  let rowNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = lineText(line);
    const cleanedText = cleanText(text);

    // Check for section headers
    const newSection = detectSection(cleanedText);
    if (newSection) {
      section = newSection;
      continue;
    }

    // Skip sections we don't want
    if (section === "future_installments" || section === "charges" || section === "limits" || section === "none") {
      continue;
    }

    // Skip headers like "DATA ESTABELECIMENTO VALOR EM R$"
    if (collapseSpaces(cleanedText).toLowerCase().includes("dataestabelecimento")) continue;
    if (collapseSpaces(cleanedText).toLowerCase().includes("dataprodutos")) continue;
    if (collapseSpaces(cleanedText).toLowerCase().includes("datavaloremr")) continue;

    // Skip "MATIAS BREUNIG" name headers
    if (/^[A-Z\s]+BREUNIG/.test(cleanedText)) continue;

    // Skip total lines
    if (/^total|^lançamentos\s*(no|do)/i.test(collapseSpaces(cleanedText).toLowerCase())) continue;
    if (collapseSpaces(cleanedText).toLowerCase().startsWith("total")) continue;

    // Skip "continua..." and "P" bullet markers
    if (cleanedText === "continua..." || cleanedText === "P") continue;

    // Check if first item is a date DD/MM
    const firstItem = line.items[0];
    if (!firstItem) continue;

    const firstText = collapseSpaces(firstItem.str);
    if (!isDatePattern(firstText)) continue;

    // This is a transaction line — extract amount, description, then resolve date
    const dateStr = firstText;

    // 1. Find amount (rightmost numeric item)
    let amount: number | null = null;
    let amountItemIdx = -1;

    for (let j = line.items.length - 1; j >= 1; j--) {
      const itemText = collapseSpaces(line.items[j].str);
      const parsed = parseAmountBR(itemText);
      if (parsed !== null) {
        amount = parsed;
        amountItemIdx = j;
        break;
      }
    }

    if (amount === null) continue;

    // 2. Build description (items between date and amount)
    const descParts: string[] = [];
    for (let j = 1; j < amountItemIdx; j++) {
      descParts.push(line.items[j].str);
    }
    const description = cleanDescription(descParts.join(" "));
    if (!description) continue;

    // 3. Extract installment info from description for date year calculation
    const installment = extractInstallmentFromDesc(description);

    // 4. NOW resolve date using installment info for correct year
    const date = parseDateDDMM(dateStr, invoiceYear, invoiceMonth, installment?.current);
    if (!date) continue;

    // Skip payment lines
    if (collapseSpaces(description).toLowerCase().includes("pagamento")) {
      if (section === "payments") continue;
    }

    // Look ahead for category line (next line, lowercase, starting with known category)
    let category: string | undefined;
    let city: string | undefined;

    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextText = lineText(nextLine);
      const catInfo = detectCategory(nextText);
      if (catInfo) {
        category = catInfo.category;
        city = catInfo.city;
        i++; // Skip category line
      }
    }

    rowNumber++;

    // As printed on the invoice: purchases positive, refunds negative. The
    // convention is applied once, in the parser-factory's finalizeEntries.
    entries.push({
      entryDate: date,
      amount,
      rawDescription: description,
      rawData: {
        date: dateStr,
        description,
        section: section === "services" ? "produtos_servicos" : "compras",
        ...(category ? { pdfCategory: category } : {}),
        ...(city ? { city } : {}),
      },
      rowNumber,
    });
  }

  return entries;
}

// ============================================================================
// MAIN PARSER
// ============================================================================

export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const pdfExtract = new PDFExtract();
  const data: PDFExtractResult = await pdfExtract.extractBuffer(buffer, {});

  // Extract metadata from page 1
  const page1Items: TextItem[] = data.pages[0]?.content
    .filter((i: PDFExtractText) => i.str.trim())
    .map((i: PDFExtractText) => ({
      x: i.x, y: i.y, str: i.str, width: i.width, height: i.height,
    })) ?? [];

  const metadata = extractMetadata(page1Items);

  // Determine invoice year and month from metadata
  let invoiceYear = new Date().getFullYear();
  let invoiceMonth = new Date().getMonth() + 1;

  if (metadata.dueDate) {
    const [y, m] = metadata.dueDate.split("-").map(Number);
    invoiceYear = y;
    invoiceMonth = m;
  }

  // Extract transactions from all pages (skip page 1 which is header)
  const allEntries: ParsedEntry[] = [];

  for (let p = 1; p < data.pages.length; p++) {
    const pageItems: TextItem[] = data.pages[p].content
      .filter((i: PDFExtractText) => i.str.trim())
      .map((i: PDFExtractText) => ({
        x: i.x, y: i.y, str: i.str, width: i.width, height: i.height,
      }));

    // Process left column
    const leftLines = groupIntoLines(pageItems, "left");
    const leftEntries = extractTransactionsFromColumn(leftLines, invoiceYear, invoiceMonth);
    allEntries.push(...leftEntries);

    // Process right column
    const rightLines = groupIntoLines(pageItems, "right");
    const rightEntries = extractTransactionsFromColumn(rightLines, invoiceYear, invoiceMonth);
    allEntries.push(...rightEntries);
  }

  // Re-number rows sequentially
  allEntries.forEach((e, i) => { e.rowNumber = i + 1; });

  return {
    entries: allEntries,
    institution: "itau",
    metadata,
  };
}
