import { z } from "zod";
import { router, protectedProcedure } from "../init";
import {
  reconciliationRules,
  transactions,
  statementEntries,
  beneficiaries,
  cardInvoices,
} from "@/server/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

function matchesRule(
  description: string,
  pattern: string,
  matchType: "exact" | "contains" | "regex"
): boolean {
  const lower = description.toLowerCase();
  const patternLower = pattern.toLowerCase();

  switch (matchType) {
    case "exact":
      return lower === patternLower;
    case "contains":
      return lower.includes(patternLower);
    case "regex":
      try {
        return new RegExp(pattern, "i").test(description);
      } catch {
        return false;
      }
  }
}

export const reconciliationRouter = router({
  // List rules
  listRules: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.reconciliationRules.findMany({
      where: eq(reconciliationRules.userId, ctx.userId),
      orderBy: [desc(reconciliationRules.priority), desc(reconciliationRules.hitCount)],
    });
  }),

  // Create rule
  createRule: protectedProcedure
    .input(
      z.object({
        pattern: z.string().min(1),
        matchType: z.enum(["exact", "contains", "regex"]),
        beneficiaryId: z.string().optional(),
        categoryId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
        priority: z.number().int().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate regex if regex type
      if (input.matchType === "regex") {
        try {
          new RegExp(input.pattern);
        } catch {
          throw new Error("Regex inválido");
        }
      }

      const id = generateId();
      await ctx.db.insert(reconciliationRules).values({
        id,
        userId: ctx.userId,
        pattern: input.pattern,
        matchType: input.matchType,
        beneficiaryId: input.beneficiaryId ?? null,
        categoryId: input.categoryId ?? null,
        tagIds: input.tagIds ? JSON.stringify(input.tagIds) : null,
        paymentMethod: input.paymentMethod ?? null,
        priority: input.priority,
        hitCount: 0,
        createdByUserId: ctx.userId,
        createdAt: nowTimestamp(),
      });

      return { id };
    }),

  // Update rule
  updateRule: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        pattern: z.string().min(1).optional(),
        matchType: z.enum(["exact", "contains", "regex"]).optional(),
        beneficiaryId: z.string().nullable().optional(),
        categoryId: z.string().nullable().optional(),
        tagIds: z.array(z.string()).optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).nullable().optional(),
        priority: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, tagIds, ...data } = input;
      const updateData: Record<string, unknown> = { ...data };
      if (tagIds !== undefined) updateData.tagIds = JSON.stringify(tagIds);

      await ctx.db
        .update(reconciliationRules)
        .set(updateData)
        .where(and(eq(reconciliationRules.id, id), eq(reconciliationRules.userId, ctx.userId)));
    }),

  // Delete rule
  deleteRule: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(reconciliationRules)
        .where(and(eq(reconciliationRules.id, input.id), eq(reconciliationRules.userId, ctx.userId)));
    }),

  // Apply rules to pending transactions
  applyRules: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()).optional(), // If empty, apply to all pending
      }).default({})
    )
    .mutation(async ({ ctx, input }) => {
      // Get all rules ordered by priority
      const rules = await ctx.db.query.reconciliationRules.findMany({
        where: eq(reconciliationRules.userId, ctx.userId),
        orderBy: [desc(reconciliationRules.priority), desc(reconciliationRules.hitCount)],
      });

      if (rules.length === 0) return { matched: 0 };

      // Get target transactions
      const conditions = [
        eq(transactions.userId, ctx.userId),
        inArray(transactions.status, ["draft", "unrecognized"]),
      ];

      if (input.transactionIds?.length) {
        conditions.push(inArray(transactions.id, input.transactionIds));
      }

      const targetTxs = await ctx.db.query.transactions.findMany({
        where: and(...conditions),
      });

      let matched = 0;
      const now = nowTimestamp();

      for (const tx of targetTxs) {
        const description = tx.description || "";

        for (const rule of rules) {
          if (matchesRule(description, rule.pattern, rule.matchType as "exact" | "contains" | "regex")) {
            // Apply rule
            const updateData: Record<string, unknown> = {
              updatedByUserId: ctx.userId,
              updatedAt: now,
            };

            if (rule.beneficiaryId) updateData.beneficiaryId = rule.beneficiaryId;
            if (rule.categoryId) updateData.categoryId = rule.categoryId;
            if (rule.paymentMethod) updateData.paymentMethod = rule.paymentMethod;

            // Set status based on what's filled
            if (rule.beneficiaryId || rule.categoryId) {
              updateData.status = "identified";
            }

            await ctx.db
              .update(transactions)
              .set(updateData)
              .where(eq(transactions.id, tx.id));

            // Increment hit count
            await ctx.db
              .update(reconciliationRules)
              .set({ hitCount: sql`hit_count + 1` })
              .where(eq(reconciliationRules.id, rule.id));

            matched++;
            break; // First match wins
          }
        }
      }

      return { matched };
    }),

  // Reconcile transaction (mark as reviewed and confirmed)
  reconcile: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        beneficiaryId: z.string().optional(),
        categoryId: z.string().optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
        description: z.string().optional(),
        createRule: z.boolean().default(false), // Auto-create rule from this reconciliation
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      const { transactionId, createRule, ...updateData } = input;

      await ctx.db
        .update(transactions)
        .set({
          ...updateData,
          status: "reconciled",
          updatedByUserId: ctx.userId,
          updatedAt: now,
        })
        .where(and(eq(transactions.id, transactionId), eq(transactions.userId, ctx.userId)));

      // Optionally create a rule from this reconciliation
      if (createRule) {
        const tx = await ctx.db.query.transactions.findFirst({
          where: eq(transactions.id, transactionId),
        });

        if (tx?.description) {
          const ruleId = generateId();
          await ctx.db.insert(reconciliationRules).values({
            id: ruleId,
            userId: ctx.userId,
            pattern: tx.description,
            matchType: "contains",
            beneficiaryId: input.beneficiaryId ?? tx.beneficiaryId ?? null,
            categoryId: input.categoryId ?? tx.categoryId ?? null,
            paymentMethod: input.paymentMethod ?? tx.paymentMethod ?? null,
            priority: 0,
            hitCount: 1,
            createdByUserId: ctx.userId,
            createdAt: now,
          });
        }
      }

      // Update linked statement entry if exists
      const tx = await ctx.db.query.transactions.findFirst({
        where: eq(transactions.id, transactionId),
      });
      if (tx?.statementEntryId) {
        await ctx.db
          .update(statementEntries)
          .set({ status: "matched" })
          .where(eq(statementEntries.id, tx.statementEntryId));
      }
    }),

  // Bulk reconcile
  bulkReconcile: protectedProcedure
    .input(
      z.object({
        transactionIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      await ctx.db
        .update(transactions)
        .set({ status: "reconciled", updatedByUserId: ctx.userId, updatedAt: now })
        .where(
          and(
            inArray(transactions.id, input.transactionIds),
            eq(transactions.userId, ctx.userId)
          )
        );

      return { count: input.transactionIds.length };
    }),

  // Create transfer pair
  createTransfer: protectedProcedure
    .input(
      z.object({
        fromAccountId: z.string(),
        toAccountId: z.string(),
        amount: z.number().int().positive(),
        date: z.string(),
        description: z.string().optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).default("transfer"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      const outgoingId = generateId();
      const incomingId = generateId();

      // Outgoing (expense from source)
      await ctx.db.insert(transactions).values({
        id: outgoingId,
        userId: ctx.userId,
        accountId: input.fromAccountId,
        type: "transfer",
        amount: input.amount,
        date: input.date,
        description: input.description || "Transferência (saída)",
        paymentMethod: input.paymentMethod,
        status: "reconciled",
        source: "manual",
        transferPairId: incomingId,
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      // Incoming (income to destination)
      await ctx.db.insert(transactions).values({
        id: incomingId,
        userId: ctx.userId,
        accountId: input.toAccountId,
        type: "transfer",
        amount: input.amount,
        date: input.date,
        description: input.description || "Transferência (entrada)",
        paymentMethod: input.paymentMethod,
        status: "reconciled",
        source: "manual",
        transferPairId: outgoingId,
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      return { outgoingId, incomingId };
    }),

  // Pay invoice (special transfer)
  payInvoice: protectedProcedure
    .input(
      z.object({
        cardInvoiceId: z.string(),
        fromAccountId: z.string(),
        amount: z.number().int().positive(),
        date: z.string(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).default("transfer"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      const transactionId = generateId();

      // Create payment transaction
      await ctx.db.insert(transactions).values({
        id: transactionId,
        userId: ctx.userId,
        accountId: input.fromAccountId,
        cardInvoiceId: input.cardInvoiceId,
        type: "expense",
        amount: input.amount,
        date: input.date,
        description: "Pagamento de fatura",
        paymentMethod: input.paymentMethod,
        status: "reconciled",
        source: "manual",
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      // Update invoice status
      await ctx.db
        .update(cardInvoices)
        .set({
          status: "paid",
          paymentTransactionId: transactionId,
          updatedAt: now,
        })
        .where(eq(cardInvoices.id, input.cardInvoiceId));

      return { transactionId };
    }),

  // Test a rule against descriptions
  testRule: protectedProcedure
    .input(
      z.object({
        pattern: z.string(),
        matchType: z.enum(["exact", "contains", "regex"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get recent transaction descriptions to test against
      const recentTxs = await ctx.db.query.transactions.findMany({
        where: eq(transactions.userId, ctx.userId),
        columns: { id: true, description: true, status: true },
        limit: 100,
        orderBy: [desc(transactions.createdAt)],
      });

      const matches = recentTxs.filter(
        (tx) => tx.description && matchesRule(tx.description, input.pattern, input.matchType)
      );

      return { totalTested: recentTxs.length, matchCount: matches.length, matches: matches.slice(0, 10) };
    }),
});
