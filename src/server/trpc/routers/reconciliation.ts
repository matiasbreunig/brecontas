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
import type { Database } from "@/server/db";

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

      // Fetch the reconciled transaction once for all post-processing
      const tx = await ctx.db.query.transactions.findFirst({
        where: and(eq(transactions.id, transactionId), eq(transactions.userId, ctx.userId)),
      });

      // Optionally create a rule from this reconciliation
      if (createRule && tx?.description) {
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

      // Update linked statement entry if exists
      if (tx?.statementEntryId) {
        await ctx.db
          .update(statementEntries)
          .set({ status: "matched" })
          .where(eq(statementEntries.id, tx.statementEntryId));
      }

      // ── Auto-learning: expand beneficiary aliases ──
      // When a transaction is reconciled with a beneficiary, add the description
      // as an alias so future imports auto-match this beneficiary
      const effectiveBeneficiaryId = input.beneficiaryId ?? tx?.beneficiaryId;
      if (effectiveBeneficiaryId && tx?.description) {
        await autoExpandBeneficiaryAliases(
          effectiveBeneficiaryId,
          tx.description,
          ctx.userId,
          ctx.db,
        );
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

      // Auto-learning: expand aliases for all reconciled transactions
      const reconciledTxs = await ctx.db.query.transactions.findMany({
        where: and(
          inArray(transactions.id, input.transactionIds),
          eq(transactions.userId, ctx.userId),
        ),
        columns: { id: true, beneficiaryId: true, description: true },
      });

      for (const tx of reconciledTxs) {
        if (tx.beneficiaryId && tx.description) {
          await autoExpandBeneficiaryAliases(
            tx.beneficiaryId,
            tx.description,
            ctx.userId,
            ctx.db,
          );
        }
      }

      return { count: input.transactionIds.length };
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

// ============================================================================
// HELPERS
// ============================================================================

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Extract the most significant part of a transaction description for alias matching.
 * Removes common prefixes (PIX, TBI, INT, PAG), installment suffixes, and numbers.
 */
function extractSignificantPart(description: string): string | null {
  let clean = description
    // Remove common bank operation prefixes
    .replace(/^(PIX\s+(TRANSF|RECEBID[AO]|ENVIADO?|QR\s*CODE)\s*)/i, "")
    .replace(/^(TBI\s+\d+\.\d+\s*)/i, "")
    .replace(/^(INT\s+)/i, "")
    .replace(/^(PAG\s+BOLETO\s*)/i, "")
    .replace(/^(DEB\s+AUTOR\s*)/i, "")
    // Remove installment suffixes (e.g., "03/12", "C 17/21")
    .replace(/\s*[-–]\s*C?\s*\d{1,2}\s*[\/\\]\s*\d{1,2}\s*$/i, "")
    .replace(/\s+\d{1,2}\s*[\/\\]\s*\d{1,2}\s*$/i, "")
    // Remove trailing dates (DD/MM, DD/MM/YY)
    .replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?\s*$/i, "")
    // Remove trailing asterisks and numbers (e.g., "*MERCADOPAG*1234")
    .replace(/\*\d+\s*$/, "")
    .trim();

  // Must be at least 4 chars to be meaningful
  if (clean.length < 4) return null;

  return clean;
}

/**
 * Auto-expand beneficiary aliases when a transaction is reconciled.
 * Adds the transaction description (or its significant part) as an alias
 * if it's not already present and is sufficiently specific.
 */
async function autoExpandBeneficiaryAliases(
  beneficiaryId: string,
  description: string,
  userId: string,
  database: Database,
): Promise<void> {
  try {
    const ben = await database.query.beneficiaries.findFirst({
      where: and(eq(beneficiaries.id, beneficiaryId), eq(beneficiaries.userId, userId)),
    });

    if (!ben) return;

    const currentAliases: string[] = ben.aliases ? JSON.parse(ben.aliases) : [];
    const normDesc = normalize(description);

    // Check if description already matches the beneficiary name
    if (normalize(ben.name) === normDesc) return;

    // Check if description is already an alias (normalized comparison)
    if (currentAliases.some((a) => normalize(a) === normDesc)) return;

    // Extract significant part of description
    const significant = extractSignificantPart(description);
    if (!significant) return;

    const normSignificant = normalize(significant);

    // Check if significant part already matches name or existing alias
    if (normalize(ben.name) === normSignificant) return;
    if (currentAliases.some((a) => normalize(a) === normSignificant)) return;

    // Check if an existing alias already contains or is contained by the significant part
    // (avoid adding "MERCADOPAGO" if "MERCADOPAG" already exists, or vice versa)
    if (currentAliases.some((a) => {
      const na = normalize(a);
      return na.includes(normSignificant) || normSignificant.includes(na);
    })) return;

    // Also check if the beneficiary name already contains the significant part
    if (normalize(ben.name).includes(normSignificant) || normSignificant.includes(normalize(ben.name))) return;

    // Add as new alias
    const newAliases = [...currentAliases, significant];
    await database
      .update(beneficiaries)
      .set({
        aliases: JSON.stringify(newAliases),
        updatedByUserId: userId,
        updatedAt: nowTimestamp(),
      })
      .where(eq(beneficiaries.id, beneficiaryId));
  } catch (err) {
    // Alias expansion should never block reconciliation
    console.error("[reconcile] Auto-expand aliases failed:", err);
  }
}
