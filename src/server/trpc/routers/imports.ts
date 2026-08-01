import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { imports, statementEntries, importTemplates, transactions, transactionTags, aiClassifications, accounts, cards, cardInvoices } from "@/server/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { handleImportJob } from "@/server/services/jobs/handlers/import-handler";

export const importsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }).default({ limit: 20, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.imports.findMany({
        where: eq(imports.userId, ctx.userId),
        orderBy: [desc(imports.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const imp = await ctx.db.query.imports.findFirst({
        where: and(eq(imports.id, input.id), eq(imports.userId, ctx.userId)),
      });

      if (!imp) return null;

      const entries = await ctx.db.query.statementEntries.findMany({
        where: eq(statementEntries.importId, input.id),
        orderBy: [desc(statementEntries.rowNumber)],
      });

      return { ...imp, entries };
    }),

  // ============================================================================
  // DETECT — Auto-detect format, mode, account, card from file content
  // ============================================================================
  detect: protectedProcedure
    .input(
      z.object({
        filename: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { detectImportSettings } = await import("@/server/services/parsers/parser-factory");
      const detection = await detectImportSettings(input.content, input.filename);

      // Try to auto-match account from OFX metadata or institution
      let suggestedAccountId: string | undefined;
      let suggestedCardId: string | undefined;

      if (detection.mode === "bank_statement") {
        if (detection.institution) {
          const userAccounts = await ctx.db.query.accounts.findMany({
            where: and(eq(accounts.userId, ctx.userId), eq(accounts.isActive, true)),
          });
          const match = userAccounts.find((a) => {
            const inst = (a.institution || "").toLowerCase();
            return inst.includes(detection.institution!) || detection.institution!.includes(inst);
          });
          if (match) suggestedAccountId = match.id;
        }

        if (!suggestedAccountId && detection.ofxMetadata?.accountId) {
          const userAccounts = await ctx.db.query.accounts.findMany({
            where: and(eq(accounts.userId, ctx.userId), eq(accounts.isActive, true)),
          });
          const acctId = detection.ofxMetadata.accountId;
          const match = userAccounts.find((a) =>
            a.name.includes(acctId) || (a.institution || "").includes(acctId),
          );
          if (match) suggestedAccountId = match.id;
        }
      }

      if (detection.mode === "card_invoice") {
        const userCards = await ctx.db.query.cards.findMany({
          where: and(eq(cards.userId, ctx.userId), eq(cards.isActive, true)),
          with: { account: true },
        });

        if (userCards.length === 1) {
          suggestedCardId = userCards[0].id;
          suggestedAccountId = userCards[0].accountId;
        } else if (userCards.length > 1 && detection.institution) {
          const match = userCards.find((c) => {
            const inst = (c.account?.institution || "").toLowerCase();
            return inst.includes(detection.institution!) || detection.institution!.includes(inst);
          });
          if (match) {
            suggestedCardId = match.id;
            suggestedAccountId = match.accountId;
          }
        }
      }

      return {
        ...detection,
        suggestedAccountId,
        suggestedCardId,
      };
    }),

  // ============================================================================
  // SMART UPLOAD — Unified import with auto-detection + auto-create transactions
  // ============================================================================
  smartUpload: protectedProcedure
    .input(
      z.object({
        filename: z.string(),
        content: z.string(),
        accountId: z.string(),
        cardId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      const { detectImportSettings } = await import("@/server/services/parsers/parser-factory");
      const detection = await detectImportSettings(input.content, input.filename);

      await ctx.db.insert(imports).values({
        id,
        userId: ctx.userId,
        accountId: input.accountId,
        cardId: input.cardId ?? null,
        filename: input.filename,
        format: detection.format,
        status: "pending",
        createdByUserId: ctx.userId,
        createdAt: now,
      });

      try {
        const result = await handleImportJob({
          importId: id,
          content: input.content,
          filename: input.filename,
          accountId: input.accountId,
          userId: ctx.userId,
          cardId: input.cardId,
          autoCreateInvoice: detection.mode === "card_invoice",
        });

        return {
          id,
          mode: detection.mode,
          institution: detection.institution,
          ...result,
        };
      } catch (error) {
        return {
          id,
          mode: detection.mode,
          institution: detection.institution,
          totalRows: 0,
          processedRows: 0,
          duplicatesSkipped: 0,
          transactionsCreated: 0,
          error: error instanceof Error ? error.message : "Erro ao processar arquivo",
        };
      }
    }),

  // Preview file before importing
  preview: protectedProcedure
    .input(
      z.object({
        filename: z.string(),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { parseFile } = await import("@/server/services/parsers/parser-factory");
      const result = await parseFile(input.content, input.filename);

      return {
        format: result.format,
        mode: result.mode,
        detectedInstitution: result.detectedInstitution,
        totalEntries: result.entries.length,
        entries: result.entries.slice(0, 10),
        balance: result.balance,
        balanceDate: result.balanceDate,
        dateRange: result.dateRange,
        enrichments: result.enrichments?.slice(0, 10),
      };
    }),

  // Statement entries for a specific import
  getEntries: protectedProcedure
    .input(
      z.object({
        importId: z.string(),
        status: z.enum(["pending", "matched", "skipped", "duplicate"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(statementEntries.importId, input.importId)];
      if (input.status) conditions.push(eq(statementEntries.status, input.status));

      return ctx.db.query.statementEntries.findMany({
        where: and(...conditions),
        orderBy: [desc(statementEntries.entryDate)],
      });
    }),

  // Convert statement entries to transactions
  convertEntries: protectedProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            statementEntryId: z.string(),
            accountId: z.string(),
            cardId: z.string().optional(),
            beneficiaryId: z.string().optional(),
            categoryId: z.string().optional(),
            type: z.enum(["income", "expense", "transfer", "refund"]),
            description: z.string().optional(),
            paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
            tagIds: z.array(z.string()).optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      const createdIds: string[] = [];

      for (const entry of input.entries) {
        const stmtEntry = await ctx.db.query.statementEntries.findFirst({
          where: eq(statementEntries.id, entry.statementEntryId),
        });

        if (!stmtEntry) continue;

        const transactionId = generateId();
        const { statementEntryId, tagIds, ...data } = entry;

        // Cash-basis date: if this is a card invoice entry, use invoice due date
        let cashDate = stmtEntry.entryDate;
        let compDate: string | null = null;
        if (stmtEntry.cardInvoiceId) {
          const inv = await ctx.db.query.cardInvoices.findFirst({
            where: eq(cardInvoices.id, stmtEntry.cardInvoiceId),
            columns: { dueDate: true },
          });
          if (inv?.dueDate) {
            cashDate = inv.dueDate;
            compDate = stmtEntry.entryDate;
          }
        }

        await ctx.db.insert(transactions).values({
          id: transactionId,
          userId: ctx.userId,
          ...data,
          amount: Math.abs(stmtEntry.amount),
          date: cashDate,
          competenceDate: compDate,
          status: entry.categoryId ? "identified" : "unrecognized",
          source: "import",
          statementEntryId,
          importId: stmtEntry.importId,
          createdByUserId: ctx.userId,
          createdAt: now,
          updatedByUserId: ctx.userId,
          updatedAt: now,
        });

        if (tagIds?.length) {
          await ctx.db.insert(transactionTags).values(
            tagIds.map((tagId) => ({ transactionId, tagId })),
          );
        }

        await ctx.db
          .update(statementEntries)
          .set({ status: "matched", transactionId })
          .where(eq(statementEntries.id, statementEntryId));

        createdIds.push(transactionId);
      }

      return { createdIds, count: createdIds.length };
    }),

  quickConvert: protectedProcedure
    .input(
      z.object({
        importId: z.string(),
        accountId: z.string(),
        cardId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pendingEntries = await ctx.db.query.statementEntries.findMany({
        where: and(
          eq(statementEntries.importId, input.importId),
          eq(statementEntries.status, "pending"),
        ),
      });

      const now = nowTimestamp();
      let count = 0;

      // Pre-fetch invoice due dates for card imports
      const invoiceDueDates = new Map<string, string>();
      if (input.cardId) {
        const invoices = await ctx.db.query.cardInvoices.findMany({
          where: eq(cardInvoices.cardId, input.cardId),
          columns: { id: true, dueDate: true },
        });
        for (const inv of invoices) invoiceDueDates.set(inv.id, inv.dueDate);
      }

      for (const entry of pendingEntries) {
        const transactionId = generateId();
        const type = entry.amount >= 0 ? "income" : "expense";

        // Cash-basis date semantics
        const invoiceDue = entry.cardInvoiceId ? invoiceDueDates.get(entry.cardInvoiceId) : null;

        await ctx.db.insert(transactions).values({
          id: transactionId,
          userId: ctx.userId,
          accountId: input.accountId,
          cardId: input.cardId ?? null,
          type,
          amount: Math.abs(entry.amount),
          date: invoiceDue || entry.entryDate,
          competenceDate: invoiceDue ? entry.entryDate : null,
          description: entry.rawDescription,
          status: "unrecognized",
          source: "import",
          statementEntryId: entry.id,
          importId: entry.importId,
          createdByUserId: ctx.userId,
          createdAt: now,
          updatedByUserId: ctx.userId,
          updatedAt: now,
        });

        await ctx.db
          .update(statementEntries)
          .set({ status: "matched", transactionId })
          .where(eq(statementEntries.id, entry.id));

        count++;
      }

      return { count };
    }),

  // Import templates
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.importTemplates.findMany({
      where: eq(importTemplates.userId, ctx.userId),
      orderBy: [desc(importTemplates.usageCount)],
    });
  }),

  createTemplate: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        format: z.enum(["csv", "ofx", "pdf", "xls"]),
        institution: z.string().optional(),
        config: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(importTemplates).values({
        id,
        userId: ctx.userId,
        name: input.name,
        format: input.format,
        institution: input.institution ?? null,
        config: input.config,
        createdByUserId: ctx.userId,
        createdAt: now,
      });

      return { id };
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(importTemplates)
        .where(and(eq(importTemplates.id, input.id), eq(importTemplates.userId, ctx.userId)));
    }),

  // Hard delete import with cascade — for testing/dev use
  deleteImport: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const imp = await ctx.db.query.imports.findFirst({
        where: and(eq(imports.id, input.id), eq(imports.userId, ctx.userId)),
      });
      if (!imp) return { deleted: 0 };

      // Get transaction IDs for this import
      const txList = await ctx.db.query.transactions.findMany({
        where: eq(transactions.importId, input.id),
        columns: { id: true },
      });
      const txIds = txList.map((tx) => tx.id);

      // Delete in FK-safe order (children before parents), all or nothing:
      // ai_classifications → transaction_tags → transactions → statement_entries → import → card_invoice
      //
      // better-sqlite3 transactions are synchronous, so the callback must stay
      // sync — an `await` inside would silently escape the transaction.
      const cardInvoiceId = imp.cardInvoiceId;
      ctx.db.transaction((tx) => {
        if (txIds.length > 0) {
          tx.delete(aiClassifications)
            .where(inArray(aiClassifications.transactionId, txIds))
            .run();

          tx.delete(transactionTags)
            .where(inArray(transactionTags.transactionId, txIds))
            .run();

          tx.delete(transactions)
            .where(inArray(transactions.id, txIds))
            .run();
        }

        tx.delete(statementEntries)
          .where(eq(statementEntries.importId, input.id))
          .run();

        tx.delete(imports).where(eq(imports.id, input.id)).run();

        // Clean up the now-orphaned card invoice. These three checks used to be
        // called without `await`, so each returned an always-truthy promise and
        // the delete below was dead code: the invoice survived with its old
        // dueDate and a re-import reused it through cycle matching, poisoning
        // the cash date of the new transactions. `.get()` is the sync form.
        if (cardInvoiceId) {
          const remainingEntries = tx
            .select({ id: statementEntries.id })
            .from(statementEntries)
            .where(eq(statementEntries.cardInvoiceId, cardInvoiceId))
            .get();
          const otherImport = tx
            .select({ id: imports.id })
            .from(imports)
            .where(eq(imports.cardInvoiceId, cardInvoiceId))
            .get();
          const otherTx = tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.cardInvoiceId, cardInvoiceId))
            .get();

          if (!remainingEntries && !otherImport && !otherTx) {
            tx.delete(cardInvoices).where(eq(cardInvoices.id, cardInvoiceId)).run();
          }
        }
      });

      return { deleted: txIds.length };
    }),
});
