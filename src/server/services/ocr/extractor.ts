import { generateObject } from "ai";
import { z } from "zod";
import { getAIProvider } from "@/server/services/ai/provider";
import fs from "fs";
import path from "path";

const ocrResultSchema = z.object({
  amount: z.number().nullable().describe("Valor em reais (ex: 49.90). Null se não identificado."),
  type: z.enum(["income", "expense", "transfer", "refund"]).describe("Tipo da transação"),
  description: z.string().describe("Descrição curta da transação/documento"),
  date: z.string().nullable().describe("Data no formato YYYY-MM-DD. Null se não identificada."),
  beneficiaryName: z.string().nullable().describe("Nome do estabelecimento, pessoa ou empresa"),
  paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).nullable().describe("Meio de pagamento identificado"),
  documentType: z.enum(["receipt", "invoice", "boleto", "pix_receipt", "bank_slip", "nf", "other"]).describe("Tipo de documento"),
  confidence: z.number().min(0).max(1).describe("Confiança da extração (0 a 1)"),
  rawText: z.string().describe("Texto bruto extraído do documento para referência"),
});

export type OcrResult = z.infer<typeof ocrResultSchema>;

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return map[ext] || "image/jpeg";
}

export async function extractFromImage(filePath: string): Promise<OcrResult> {
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString("base64");
  const mimeType = getMimeType(filePath);

  const model = getAIProvider();

  const { object } = await generateObject({
    model,
    schema: ocrResultSchema,
    messages: [
      {
        role: "system",
        content: `Você é um assistente financeiro especializado em OCR de documentos brasileiros.
Analise a imagem/documento fornecido e extraia informações financeiras.
Identifique: valor, tipo (receita/despesa/transferência/reembolso), descrição, data, beneficiário, meio de pagamento e tipo de documento.
Para valores, use formato decimal (49.90, não 4990).
Para datas, use YYYY-MM-DD.
Se não conseguir identificar algo com certeza, use null.
Defina confidence com base na clareza da extração (1.0 = perfeito, 0.0 = nada identificado).`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extraia as informações financeiras deste documento:",
          },
          {
            type: "file",
            data: base64,
            mediaType: mimeType,
          },
        ],
      },
    ],
  });

  return object;
}

export function formatOcrSummary(result: OcrResult): string {
  const parts: string[] = [];

  if (result.documentType) {
    const typeLabels: Record<string, string> = {
      receipt: "Recibo",
      invoice: "Fatura",
      boleto: "Boleto",
      pix_receipt: "Comprovante PIX",
      bank_slip: "Extrato",
      nf: "Nota Fiscal",
      other: "Documento",
    };
    parts.push(`[${typeLabels[result.documentType] || "Documento"}]`);
  }

  if (result.description) parts.push(result.description);
  if (result.beneficiaryName) parts.push(`— ${result.beneficiaryName}`);
  if (result.amount != null) parts.push(`R$ ${result.amount.toFixed(2).replace(".", ",")}`);
  if (result.date) parts.push(`em ${result.date.split("-").reverse().join("/")}`);

  return parts.join(" ") || "Documento sem informações extraídas";
}
