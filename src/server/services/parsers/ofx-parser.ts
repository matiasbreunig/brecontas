import { generateEntryHash, type ParsedEntry } from "./csv-parser";

interface OfxTransaction {
  TRNTYPE: string;
  DTPOSTED: string;
  TRNAMT: string;
  FITID: string;
  MEMO?: string;
  NAME?: string;
  CHECKNUM?: string;
}

export interface OfxMetadata {
  bankId: string | null;      // "0341" → Itaú
  accountId: string | null;   // "4092047531"
  accountType: string | null; // "CHECKING" | "CREDITCARD" | etc
  currency: string | null;    // "BRL"
}

// Map BANKID to institution name
const BANK_ID_MAP: Record<string, string> = {
  "0001": "bb",
  "0033": "santander",
  "0041": "banrisul",
  "0070": "brb",
  "0077": "inter",
  "0104": "caixa",
  "0237": "bradesco",
  "0260": "nubank",
  "0341": "itau",
  "0422": "safra",
  "0745": "citibank",
  "0756": "sicoob",
};

function parseOfxDate(dateStr: string): string {
  // OFX dates: YYYYMMDDHHMMSS or YYYYMMDD with optional timezone
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function parseOfxAmount(amountStr: string): number {
  const value = parseFloat(amountStr.trim());
  return Math.round(value * 100);
}

function extractTag(content: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i");
  const match = regex.exec(content);
  return match ? match[1].trim() : null;
}

// Simple OFX parser — OFX is SGML-like, not XML
function extractOfxTransactions(content: string): OfxTransaction[] {
  const transactions: OfxTransaction[] = [];

  // Find all STMTTRN blocks
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  while ((match = trnRegex.exec(content)) !== null) {
    const block = match[1];
    const trn: Record<string, string> = {};

    // Extract tag values
    const tagRegex = /<(\w+)>([^<\r\n]+)/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(block)) !== null) {
      trn[tagMatch[1]] = tagMatch[2].trim();
    }

    if (trn.DTPOSTED && trn.TRNAMT) {
      transactions.push({
        TRNTYPE: trn.TRNTYPE || "OTHER",
        DTPOSTED: trn.DTPOSTED,
        TRNAMT: trn.TRNAMT,
        FITID: trn.FITID || "",
        MEMO: trn.MEMO,
        NAME: trn.NAME,
        CHECKNUM: trn.CHECKNUM,
      });
    }
  }

  return transactions;
}

function extractBalanceInfo(content: string): { balance?: number; date?: string } {
  const balRegex = /<BALAMT>([^<\r\n]+)/i;
  const dateRegex = /<DTASOF>([^<\r\n]+)/i;

  const balMatch = balRegex.exec(content);
  const dateMatch = dateRegex.exec(content);

  return {
    balance: balMatch ? parseOfxAmount(balMatch[1]) : undefined,
    date: dateMatch ? parseOfxDate(dateMatch[1]) : undefined,
  };
}

export function extractOfxMetadata(content: string): OfxMetadata {
  // Try BANKACCTFROM first (bank accounts), then CCACCTFROM (credit cards)
  const bankId = extractTag(content, "BANKID");
  const accountId = extractTag(content, "ACCTID");
  const accountType = extractTag(content, "ACCTTYPE");
  const currency = extractTag(content, "CURDEF");

  return { bankId, accountId, accountType, currency };
}

export function resolveInstitutionFromBankId(bankId: string | null): string | undefined {
  if (!bankId) return undefined;
  // Normalize: remove leading zeros except last 4 chars
  const normalized = bankId.replace(/^0+/, "0");
  return BANK_ID_MAP[bankId] || BANK_ID_MAP[normalized] || undefined;
}

export function parseOfx(content: string): {
  entries: ParsedEntry[];
  balance?: number;
  balanceDate?: string;
  metadata: OfxMetadata;
} {
  const ofxTransactions = extractOfxTransactions(content);
  const balanceInfo = extractBalanceInfo(content);
  const metadata = extractOfxMetadata(content);

  const entries: ParsedEntry[] = ofxTransactions.map((trn, index) => {
    const description = [trn.NAME, trn.MEMO].filter(Boolean).join(" - ") || trn.TRNTYPE;
    const entryDate = parseOfxDate(trn.DTPOSTED);
    const amount = parseOfxAmount(trn.TRNAMT);

    return {
      entryDate,
      amount,
      rawDescription: description,
      rawData: trn as unknown as Record<string, string>,
      rowNumber: index + 1,
    };
  });

  return {
    entries,
    balance: balanceInfo.balance,
    balanceDate: balanceInfo.date,
    metadata,
  };
}
