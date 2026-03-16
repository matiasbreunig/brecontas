/**
 * Stage 3: Merge inference results from multiple sources.
 * Takes text-parsed, history-matched, and OCR results, picks the
 * highest-confidence value per field.
 */

import type { ParsedField, TextParseResult } from "./text-parser";
import type { HistoryMatchResult } from "./history-matcher";

export interface InferenceResult {
  amount?: ParsedField<number>;
  date?: ParsedField<string>;
  type?: ParsedField<string>;
  paymentMethod?: ParsedField<string>;
  beneficiaryId?: ParsedField<string>;
  beneficiaryName?: ParsedField<string>;
  categoryId?: ParsedField<string>;
  accountId?: ParsedField<string>;
  description?: ParsedField<string>;
  tagIds?: ParsedField<string[]>;
}

function pickBest<T>(...sources: (ParsedField<T> | undefined)[]): ParsedField<T> | undefined {
  let best: ParsedField<T> | undefined;
  for (const s of sources) {
    if (s && (!best || s.confidence > best.confidence)) {
      best = s;
    }
  }
  return best;
}

/**
 * Merge text-parsed results, history-matched results, and optional OCR data.
 * Higher confidence wins per field.
 */
export function mergeInferences(
  textParsed: TextParseResult,
  historyMatch: HistoryMatchResult,
  ocrData?: {
    amount?: ParsedField<number>;
    date?: ParsedField<string>;
    type?: ParsedField<string>;
    paymentMethod?: ParsedField<string>;
    beneficiaryName?: ParsedField<string>;
    description?: ParsedField<string>;
  }
): InferenceResult {
  return {
    amount: pickBest(
      ocrData?.amount,
      textParsed.amount
    ),
    date: pickBest(
      ocrData?.date,
      textParsed.date
    ),
    type: pickBest(
      textParsed.type,
      historyMatch.type,
      ocrData?.type
    ),
    paymentMethod: pickBest(
      textParsed.paymentMethod,
      historyMatch.paymentMethod,
      ocrData?.paymentMethod
    ),
    beneficiaryId: historyMatch.beneficiaryId,
    beneficiaryName: pickBest(
      historyMatch.beneficiaryName,
      textParsed.beneficiaryName,
      ocrData?.beneficiaryName
    ),
    categoryId: historyMatch.categoryId,
    accountId: historyMatch.accountId,
    description: pickBest(
      ocrData?.description,
      textParsed.description
    ),
    tagIds: historyMatch.tagIds,
  };
}

/**
 * Convert OCR extracted data (from attachments.extractedText JSON) into
 * ParsedField format for merging.
 */
export function ocrToFields(ocr: {
  amount: number | null;
  type: string;
  description: string;
  date: string | null;
  beneficiaryName: string | null;
  paymentMethod: string | null;
  confidence: number;
}): {
  amount?: ParsedField<number>;
  date?: ParsedField<string>;
  type?: ParsedField<string>;
  paymentMethod?: ParsedField<string>;
  beneficiaryName?: ParsedField<string>;
  description?: ParsedField<string>;
} {
  const result: ReturnType<typeof ocrToFields> = {};
  const conf = ocr.confidence;

  if (ocr.amount != null && ocr.amount > 0) {
    // OCR amount is in reais (float), convert to centavos for the field
    result.amount = { value: Math.round(ocr.amount * 100), confidence: conf, source: "ocr" };
  }

  if (ocr.date) {
    result.date = { value: ocr.date, confidence: conf, source: "ocr" };
  }

  if (ocr.type) {
    result.type = { value: ocr.type, confidence: conf * 0.9, source: "ocr" };
  }

  if (ocr.paymentMethod) {
    result.paymentMethod = { value: ocr.paymentMethod, confidence: conf * 0.85, source: "ocr" };
  }

  if (ocr.beneficiaryName) {
    result.beneficiaryName = { value: ocr.beneficiaryName, confidence: conf * 0.9, source: "ocr" };
  }

  if (ocr.description) {
    result.description = { value: ocr.description, confidence: conf * 0.8, source: "ocr" };
  }

  return result;
}
