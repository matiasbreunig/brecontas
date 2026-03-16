import { generateObject } from "ai";
import { z } from "zod";
import { getAIProvider } from "./provider";
import { db } from "@/server/db";
import { beneficiaries, categories, reconciliationRules, aiClassifications, transactions } from "@/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

const classificationSchema = z.object({
  beneficiaryName: z.string().optional().describe("Nome do favorecido/estabelecimento"),
  categoryName: z.string().optional().describe("Nome da categoria mais adequada"),
  description: z.string().optional().describe("Descrição enriquecida e limpa"),
  confidence: z.number().min(0).max(1).describe("Confiança na classificação (0.0 a 1.0)"),
  reasoning: z.string().describe("Breve raciocínio da classificação"),
});

function buildSystemPrompt(
  categoriesList: { id: string; name: string; parentId: string | null; icon: string | null }[],
  beneficiariesList: { id: string; name: string; aliases: string | null }[]
): string {
  const catTree = categoriesList
    .filter((c) => !c.parentId)
    .map((parent) => {
      const children = categoriesList.filter((c) => c.parentId === parent.id);
      const childrenStr = children.map((c) => `  - ${c.icon || ""} ${c.name}`).join("\n");
      return `${parent.icon || ""} ${parent.name}\n${childrenStr}`;
    })
    .join("\n");

  const benList = beneficiariesList
    .map((b) => {
      const aliases: string[] = b.aliases ? JSON.parse(b.aliases) : [];
      return `- ${b.name}${aliases.length ? ` (aliases: ${aliases.join(", ")})` : ""}`;
    })
    .join("\n");

  return `Você é um classificador de transações financeiras pessoais brasileiras.

Sua tarefa: dado o texto de uma transação (descrição de extrato bancário ou texto livre), identificar:
1. O favorecido (estabelecimento/pessoa)
2. A categoria mais adequada
3. Uma descrição limpa e legível

## Categorias disponíveis:
${catTree}

## Favorecidos conhecidos:
${benList}

## Regras:
- Se o favorecido corresponder a um conhecido, use o nome exato da lista
- Se não reconhecer, sugira um nome baseado no texto
- Escolha a subcategoria mais específica quando possível
- confidence >= 0.8 = alta certeza, 0.5-0.8 = provável, < 0.5 = incerto
- Transações PIX geralmente incluem nome da pessoa/CNPJ
- Descrições de cartão são truncadas (ex: "PAG*JoseDaSilva" = "José da Silva")
- Descrições do Nubank incluem "Nu Pagamentos"`;
}

export async function classifyTransaction(
  description: string,
  userId: string,
  transactionId?: string
): Promise<{
  beneficiaryId?: string;
  categoryId?: string;
  suggestedDescription?: string;
  confidence: number;
}> {
  // Get user's categories and beneficiaries
  const userCategories = await db.query.categories.findMany({
    where: and(eq(categories.userId, userId), eq(categories.isActive, true)),
  });

  const userBeneficiaries = await db.query.beneficiaries.findMany({
    where: eq(beneficiaries.userId, userId),
  });

  const model = getAIProvider();

  const { object } = await generateObject({
    model,
    schema: classificationSchema,
    system: buildSystemPrompt(userCategories, userBeneficiaries),
    prompt: `Classifique esta transação: "${description}"`,
  });

  // Match beneficiary by name
  let beneficiaryId: string | undefined;
  if (object.beneficiaryName) {
    const match = userBeneficiaries.find(
      (b) => b.name.toLowerCase() === object.beneficiaryName!.toLowerCase()
    );
    if (match) beneficiaryId = match.id;
  }

  // Match category by name
  let categoryId: string | undefined;
  if (object.categoryName) {
    const match = userCategories.find(
      (c) => c.name.toLowerCase() === object.categoryName!.toLowerCase()
    );
    if (match) categoryId = match.id;
  }

  // Record AI classification
  if (transactionId) {
    const provider = process.env.AI_PROVIDER || "anthropic";
    const modelName = process.env.AI_MODEL || "claude-sonnet-4-20250514";

    await db.insert(aiClassifications).values({
      id: generateId(),
      transactionId,
      userId,
      suggestedBeneficiaryId: beneficiaryId ?? null,
      suggestedCategoryId: categoryId ?? null,
      suggestedDescription: object.description ?? null,
      confidence: object.confidence,
      provider,
      model: modelName,
      createdAt: nowTimestamp(),
    });
  }

  return {
    beneficiaryId,
    categoryId,
    suggestedDescription: object.description,
    confidence: object.confidence,
  };
}

export async function classifyBatch(
  transactionIds: string[],
  userId: string
): Promise<{ classified: number }> {
  let classified = 0;

  for (const txId of transactionIds) {
    const tx = await db.query.transactions.findFirst({
      where: and(eq(transactions.id, txId), eq(transactions.userId, userId)),
    });

    if (!tx || !tx.description) continue;
    if (tx.status === "reconciled" || tx.status === "discarded") continue;

    try {
      const result = await classifyTransaction(tx.description, userId, txId);

      const updateData: Record<string, unknown> = {
        updatedByUserId: userId,
        updatedAt: nowTimestamp(),
        confidence: result.confidence,
      };

      if (result.beneficiaryId) updateData.beneficiaryId = result.beneficiaryId;
      if (result.categoryId) updateData.categoryId = result.categoryId;
      if (result.suggestedDescription) updateData.description = result.suggestedDescription;

      if (result.beneficiaryId || result.categoryId) {
        updateData.status = "identified";
      }

      await db
        .update(transactions)
        .set(updateData)
        .where(eq(transactions.id, txId));

      classified++;
    } catch (error) {
      console.error(`Error classifying transaction ${txId}:`, error);
    }
  }

  return { classified };
}
