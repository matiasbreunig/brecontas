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

function parseOfxDate(dateStr: string): string {
  // OFX dates: YYYYMMDDHHMMSS or YYYYMMDD
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return `${year}-${month}-${day}`;
}

function parseOfxAmount(amountStr: string): number {
  const value = parseFloat(amountStr.trim());
  return Math.round(value * 100);
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

export function parseOfx(content: string): {
  entries: ParsedEntry[];
  balance?: number;
  balanceDate?: string;
} {
  const ofxTransactions = extractOfxTransactions(content);
  const balanceInfo = extractBalanceInfo(content);

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
  };
}
