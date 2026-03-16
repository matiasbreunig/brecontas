import { generateObject } from "ai";
import { z } from "zod";
import { getAIProvider } from "./provider";

const parsedTransactionSchema = z.object({
  amount: z.number().describe("Valor em reais (ex: 49.90)"),
  type: z.enum(["income", "expense", "transfer", "refund"]).describe("Tipo da transação"),
  description: z.string().describe("Descrição limpa"),
  date: z.string().optional().describe("Data em formato YYYY-MM-DD, se mencionada"),
  beneficiaryName: z.string().optional().describe("Nome do favorecido"),
  paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
  confidence: z.number().min(0).max(1),
});

const multiTransactionSchema = z.object({
  transactions: z.array(parsedTransactionSchema).describe("Lista de transações extraídas do texto"),
});

export async function parseText(text: string): Promise<z.infer<typeof multiTransactionSchema>> {
  const model = getAIProvider();

  const { object } = await generateObject({
    model,
    schema: multiTransactionSchema,
    system: `Você é um parser de texto financeiro brasileiro.
Extraia todas as transações mencionadas no texto livre.

Exemplos de entrada:
- "Paguei 45 reais no almoço com PIX" → 1 despesa, R$45, PIX
- "Recebi 200 do João, paguei 50 do Uber" → 2 transações
- "Fatura Nubank: 1.230,50" → 1 despesa, R$1230.50

Regras:
- Valores em reais brasileiros
- Se não mencionar data, não inclua
- Se não tiver certeza do tipo, assuma "expense"
- confidence >= 0.8 para textos claros`,
    prompt: text,
  });

  return object;
}

export async function askFinancial(
  question: string,
  context: {
    totalBalance: number;
    monthIncome: number;
    monthExpense: number;
    topCategories: { name: string; total: number }[];
    recentTransactions: { description: string; amount: number; type: string; date: string }[];
  }
): Promise<string> {
  const { generateText } = await import("ai");
  const model = getAIProvider();

  const contextStr = `
Saldo total: R$ ${(context.totalBalance / 100).toFixed(2)}
Receitas do mês: R$ ${(context.monthIncome / 100).toFixed(2)}
Despesas do mês: R$ ${(context.monthExpense / 100).toFixed(2)}

Top categorias de despesa:
${context.topCategories.map((c) => `- ${c.name}: R$ ${(c.total / 100).toFixed(2)}`).join("\n")}

Transações recentes:
${context.recentTransactions.slice(0, 10).map((t) => `- ${t.date} ${t.type === "income" ? "+" : "-"}R$${(t.amount / 100).toFixed(2)} ${t.description}`).join("\n")}`;

  const { text } = await generateText({
    model,
    system: `Você é um assistente financeiro pessoal. Responda perguntas sobre as finanças do usuário de forma clara e concisa, em português brasileiro. Use os dados do contexto para responder.`,
    prompt: `Contexto financeiro:\n${contextStr}\n\nPergunta: ${question}`,
  });

  return text;
}
