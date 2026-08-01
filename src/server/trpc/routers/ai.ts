import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { transactions, aiClassifications } from "@/server/db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { classifyTransaction, classifyBatch } from "@/server/services/ai/classifier";
import { parseText, askFinancial } from "@/server/services/ai/parser";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const aiRouter = router({
  // Classify a single transaction
  classify: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.query.transactions.findFirst({
        where: and(eq(transactions.id, input.transactionId), eq(transactions.userId, ctx.userId)),
      });

      if (!tx || !tx.description) {
        throw new Error("Transação não encontrada ou sem descrição");
      }

      return classifyTransaction(tx.description, ctx.userId, input.transactionId);
    }),

  // Classify batch of transactions
  classifyBatch: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()).optional(),
        status: z.enum(["draft", "unrecognized"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let ids = input.transactionIds;

      if (!ids) {
        // Get all pending transactions
        const status = input.status || "unrecognized";
        const pending = await ctx.db.query.transactions.findMany({
          where: and(
            eq(transactions.userId, ctx.userId),
            eq(transactions.status, status)
          ),
          columns: { id: true },
          limit: 50,
        });
        ids = pending.map((t) => t.id);
      }

      if (!ids.length) return { classified: 0 };

      return classifyBatch(ids, ctx.userId);
    }),

  // Parse free text into transactions
  parseText: protectedProcedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return parseText(input.text);
    }),

  // Accept AI suggestion
  acceptSuggestion: protectedProcedure
    .input(
      z.object({
        classificationId: z.string(),
        transactionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Scoped: an unscoped lookup let another user's suggested category and
      // beneficiary — foreign keys pointing at entities the caller doesn't own —
      // be written onto the caller's own transaction.
      const classification = await ctx.db.query.aiClassifications.findFirst({
        where: and(
          eq(aiClassifications.id, input.classificationId),
          eq(aiClassifications.userId, ctx.userId)
        ),
      });

      if (!classification) throw new Error("Classificação não encontrada");
      if (classification.transactionId !== input.transactionId) {
        throw new Error("Sugestão não pertence a esta transação");
      }

      // Apply suggestion
      const updateData: Record<string, unknown> = {
        updatedByUserId: ctx.userId,
        updatedAt: nowTimestamp(),
      };

      if (classification.suggestedBeneficiaryId) updateData.beneficiaryId = classification.suggestedBeneficiaryId;
      if (classification.suggestedCategoryId) updateData.categoryId = classification.suggestedCategoryId;
      if (classification.suggestedDescription) updateData.description = classification.suggestedDescription;
      updateData.status = "identified";
      updateData.confidence = classification.confidence;

      await ctx.db
        .update(transactions)
        .set(updateData)
        .where(and(eq(transactions.id, input.transactionId), eq(transactions.userId, ctx.userId)));

      // Mark as accepted
      await ctx.db
        .update(aiClassifications)
        .set({ wasAccepted: 1 })
        .where(
          and(
            eq(aiClassifications.id, input.classificationId),
            eq(aiClassifications.userId, ctx.userId)
          )
        );
    }),

  // Reject AI suggestion
  rejectSuggestion: protectedProcedure
    .input(
      z.object({
        classificationId: z.string(),
        correction: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(aiClassifications)
        .set({
          wasAccepted: 0,
          userCorrection: input.correction ?? null,
        })
        .where(
          and(
            eq(aiClassifications.id, input.classificationId),
            eq(aiClassifications.userId, ctx.userId)
          )
        );
    }),

  // Ask a question about finances
  ask: protectedProcedure
    .input(z.object({ question: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Gather context
      const stats = ctx.db
        .select({
          totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
          totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
        })
        .from(transactions)
        .where(and(
          eq(transactions.userId, ctx.userId),
          eq(transactions.isProjected, false),
          sql`status != 'discarded'`
        ))
        .get();

      const recent = await ctx.db.query.transactions.findMany({
        where: and(eq(transactions.userId, ctx.userId), sql`status != 'discarded'`),
        columns: { description: true, amount: true, type: true, date: true },
        orderBy: [desc(transactions.date)],
        limit: 20,
      });

      const answer = await askFinancial(input.question, {
        totalBalance: 0,
        monthIncome: stats?.totalIncome ?? 0,
        monthExpense: stats?.totalExpense ?? 0,
        topCategories: [],
        recentTransactions: recent.map((t) => ({
          description: t.description || "",
          amount: t.amount,
          type: t.type,
          date: t.date,
        })),
      });

      return { answer };
    }),
});
