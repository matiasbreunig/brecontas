/**
 * Stage 1: Pure regex-based text parser for Brazilian Portuguese financial text.
 * Zero dependencies, runs in <1ms.
 */
import { toISODate } from "@/lib/date";

export interface ParsedField<T> {
  value: T;
  confidence: number;
  source: "parsed" | "history" | "ocr" | "ai" | "default";
}

export interface TextParseResult {
  amount?: ParsedField<number>;
  date?: ParsedField<string>;
  type?: ParsedField<string>;
  paymentMethod?: ParsedField<string>;
  beneficiaryName?: ParsedField<string>;
  description?: ParsedField<string>;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─── Amount Extraction ──────────────────────────────────────────────
function parseAmount(text: string): ParsedField<number> | undefined {
  const patterns: Array<{ regex: RegExp; confidence: number; parse: (m: RegExpMatchArray) => number }> = [
    // R$ 1.230,50 or R$1.230,50
    {
      regex: /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
      confidence: 0.95,
      parse: (m) => parseFloat(m[1].replace(/\./g, "").replace(",", ".")),
    },
    // R$ 45,90 or R$45,90
    {
      regex: /R\$\s*(\d+,\d{2})/i,
      confidence: 0.95,
      parse: (m) => parseFloat(m[1].replace(",", ".")),
    },
    // R$ 45 or R$45 (no cents)
    {
      regex: /R\$\s*(\d+)(?!\d|,|\.)(?!\s*[\.,]\d)/i,
      confidence: 0.85,
      parse: (m) => parseFloat(m[1]),
    },
    // 45,90 reais
    {
      regex: /(\d+,\d{2})\s*reais/i,
      confidence: 0.9,
      parse: (m) => parseFloat(m[1].replace(",", ".")),
    },
    // 45 reais
    {
      regex: /(\d+)\s*reais/i,
      confidence: 0.8,
      parse: (m) => parseFloat(m[1]),
    },
    // Bare number with comma: 45,90 (lower confidence)
    {
      regex: /(?:^|\s)(\d+,\d{2})(?:\s|$)/,
      confidence: 0.5,
      parse: (m) => parseFloat(m[1].replace(",", ".")),
    },
  ];

  for (const { regex, confidence, parse } of patterns) {
    const match = text.match(regex);
    if (match) {
      const value = parse(match);
      if (value > 0 && value < 10_000_000) {
        return { value, confidence, source: "parsed" };
      }
    }
  }

  return undefined;
}

// ─── Date Extraction ────────────────────────────────────────────────
function parseDate(text: string): ParsedField<string> | undefined {
  const norm = normalize(text);
  const today = new Date();

  // dd/mm/yyyy
  const fullDate = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (fullDate) {
    const [, d, m, y] = fullDate;
    return { value: `${y}-${m}-${d}`, confidence: 0.95, source: "parsed" };
  }

  // dd/mm (assume current year)
  const shortDate = text.match(/(\d{2})\/(\d{2})(?!\/)/);
  if (shortDate) {
    const [, d, m] = shortDate;
    const y = today.getFullYear();
    return { value: `${y}-${m}-${d}`, confidence: 0.85, source: "parsed" };
  }

  // Relative dates
  const relativeMap: Record<string, number> = {
    hoje: 0,
    ontem: -1,
    anteontem: -2,
  };

  for (const [word, offset] of Object.entries(relativeMap)) {
    if (norm.includes(word)) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      return { value: toISODate(d), confidence: 0.9, source: "parsed" };
    }
  }

  // Day of week
  const days: Record<string, number> = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  };

  for (const [name, dayIndex] of Object.entries(days)) {
    if (norm.includes(name)) {
      const d = new Date(today);
      const currentDay = d.getDay();
      let diff = currentDay - dayIndex;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() - diff);
      return { value: toISODate(d), confidence: 0.7, source: "parsed" };
    }
  }

  return undefined;
}

// ─── Transaction Type ───────────────────────────────────────────────
function parseType(text: string): ParsedField<string> | undefined {
  const norm = normalize(text);

  const typePatterns: Array<{ keywords: string[]; type: string; confidence: number }> = [
    { keywords: ["paguei", "gastei", "comprei", "pago", "compra", "despesa", "gasto", "debitado", "debito automatico"], type: "expense", confidence: 0.9 },
    { keywords: ["recebi", "recebido", "entrada", "salario", "rendimento", "receita", "creditado", "deposito"], type: "income", confidence: 0.9 },
    { keywords: ["transferi", "transferencia", "enviei", "mandei"], type: "transfer", confidence: 0.85 },
    { keywords: ["devolveram", "reembolso", "estorno", "devolvido", "cashback", "devolucao"], type: "refund", confidence: 0.85 },
  ];

  for (const { keywords, type, confidence } of typePatterns) {
    for (const kw of keywords) {
      if (norm.includes(kw)) {
        return { value: type, confidence, source: "parsed" };
      }
    }
  }

  return undefined;
}

// ─── Payment Method ─────────────────────────────────────────────────
function parsePaymentMethod(text: string): ParsedField<string> | undefined {
  const norm = normalize(text);

  const methodPatterns: Array<{ keywords: string[]; method: string; confidence: number }> = [
    { keywords: ["pix", " pix ", "via pix"], method: "pix", confidence: 0.95 },
    { keywords: ["cartao de credito", "credito", "no credito", "parcela"], method: "credit", confidence: 0.85 },
    { keywords: ["cartao de debito", "no debito"], method: "debit", confidence: 0.85 },
    { keywords: ["boleto"], method: "boleto", confidence: 0.9 },
    { keywords: ["dinheiro", "especie", "em maos"], method: "cash", confidence: 0.9 },
    { keywords: [" ted ", " doc ", "transferencia bancaria"], method: "transfer", confidence: 0.8 },
    { keywords: ["cartao"], method: "credit", confidence: 0.6 }, // generic "cartão" defaults to credit
  ];

  for (const { keywords, method, confidence } of methodPatterns) {
    for (const kw of keywords) {
      if (norm.includes(kw) || (` ${norm} `).includes(kw)) {
        return { value: method, confidence, source: "parsed" };
      }
    }
  }

  return undefined;
}

// ─── Beneficiary Name Extraction ────────────────────────────────────
function parseBeneficiaryName(text: string): ParsedField<string> | undefined {
  // Try to extract text after prepositions
  const prepositionPatterns = [
    /(?:no|na|do|da|pro|pra|para|em|ao|à|pelo|pela|com)\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+(?:de|do|da|dos|das|e|&)?\s*[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/g,
    /(?:no|na|do|da|pro|pra|para|em|ao|à|pelo|pela|com)\s+([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ÿ\s']+?)(?:\s*[,.\-!?]|\s+(?:ontem|hoje|via|por|de|com|pix|cartao|credito|debito|boleto|R\$|\d))/gi,
  ];

  const candidates: Array<{ name: string; position: number }> = [];

  for (const pattern of prepositionPatterns) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length >= 2 && name.length <= 60) {
        candidates.push({ name, position: match.index });
      }
    }
  }

  // Pick the longest candidate (more likely to be complete name)
  if (candidates.length > 0) {
    const best = candidates.sort((a, b) => b.name.length - a.name.length)[0];
    return { value: best.name, confidence: 0.6, source: "parsed" };
  }

  return undefined;
}

// ─── Description Cleaning ───────────────────────────────────────────
function buildDescription(text: string, parsed: Omit<TextParseResult, "description">): ParsedField<string> {
  // Clean up the raw text as a description
  let desc = text
    .replace(/\s+/g, " ")
    .trim();

  // Cap at 200 chars
  if (desc.length > 200) {
    desc = desc.slice(0, 200).trim();
  }

  return { value: desc, confidence: 0.5, source: "parsed" };
}

// ─── Main Parser ────────────────────────────────────────────────────
export function parseRawText(text: string): TextParseResult {
  const amount = parseAmount(text);
  const date = parseDate(text);
  const type = parseType(text);
  const paymentMethod = parsePaymentMethod(text);
  const beneficiaryName = parseBeneficiaryName(text);
  const description = buildDescription(text, { amount, date, type, paymentMethod, beneficiaryName });

  return { amount, date, type, paymentMethod, beneficiaryName, description };
}
