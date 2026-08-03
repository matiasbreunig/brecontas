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
      // An import only stays in "processing" if the process died mid-run — the
      // handler always leaves it completed or failed. Without this it would sit
      // there spinning forever, since nothing else ever revisits the row.
      const STALE_AFTER_SECONDS = 30 * 60;
      ctx.db
        .update(imports)
        .set({
          status: "failed",
          errorMessage: "Importação interrompida (processo reiniciado)",
        })
        .where(
          and(
            eq(imports.userId, ctx.userId),
            eq(imports.status, "processing"),
            sql`${imports.createdAt} < unixepoch() - ${STALE_AFTER_SECONDS}`
          )
        )
        .run();

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
