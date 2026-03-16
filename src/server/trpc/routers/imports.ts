import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { imports, statementEntries, importTemplates, transactions, transactionTags } from "@/server/db/schema";
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
      }).default({ limit: 20, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.query.imports.findMany({
        where: eq(imports.userId, ctx.userId),
        orderBy: [desc(imports.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return items;
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

  upload: protectedProcedure
    .input(
      z.object({
        filename: z.string(),
        content: z.string(), // base64 or text content
        format: z.enum(["csv", "ofx"]),
        accountId: z.string(),
        cardId: z.string().optional(),
        templateId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      // Create import record
      await ctx.db.insert(imports).values({
        id,
        userId: ctx.userId,
        accountId: input.accountId,
        cardId: input.cardId ?? null,
        importTemplateId: input.templateId ?? null,
        filename: input.filename,
        format: input.format,
        status: "pending",
        createdByUserId: ctx.userId,
        createdAt: now,
      });

      // Get template config if specified
      let templateConfig;
      if (input.templateId) {
        const template = await ctx.db.query.importTemplates.findFirst({
          where: eq(importTemplates.id, input.templateId),
        });
        if (template) {
          templateConfig = JSON.parse(template.config);
        }
      }

      // Process synchronously for now (small files for personal use)
      try {
        const result = await handleImportJob({
          importId: id,
          content: input.content,
          filename: input.filename,
          accountId: input.accountId,
          cardId: input.cardId,
          templateConfig,
        });

        return { id, ...result };
      } catch (error) {
        return {
          id,
          totalRows: 0,
          processedRows: 0,
          duplicatesSkipped: 0,
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
        format: z.enum(["csv", "ofx"]),
      })
    )
    .mutation(async ({ input }) => {
      const { parseFile } = await import("@/server/services/parsers/parser-factory");
      const result = parseFile(input.content, input.filename);

      return {
        format: result.format,
        detectedInstitution: result.detectedInstitution,
        totalEntries: result.entries.length,
        entries: result.entries.slice(0, 10), // Preview first 10
        balance: result.balance,
        balanceDate: result.balanceDate,
      };
    }),

  // Statement entries for a specific import
  getEntries: protectedProcedure
    .input(
      z.object({
        importId: z.string(),
        status: z.enum(["pending", "matched", "skipped", "duplicate"]).optional(),
      })
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
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = nowTimestamp();
      const createdIds: string[] = [];

      for (const entry of input.entries) {
        // Get the statement entry
        const stmtEntry = await ctx.db.query.statementEntries.findFirst({
          where: eq(statementEntries.id, entry.statementEntryId),
        });

        if (!stmtEntry) continue;

        const transactionId = generateId();
        const { statementEntryId, tagIds, ...data } = entry;

        await ctx.db.insert(transactions).values({
          id: transactionId,
          userId: ctx.userId,
          ...data,
          amount: Math.abs(stmtEntry.amount),
          date: stmtEntry.entryDate,
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
            tagIds.map((tagId) => ({ transactionId, tagId }))
          );
        }

        // Update statement entry status
        await ctx.db
          .update(statementEntries)
          .set({ status: "matched", transactionId })
          .where(eq(statementEntries.id, statementEntryId));

        createdIds.push(transactionId);
      }

      return { createdIds, count: createdIds.length };
    }),

  // Quick convert — auto-create transactions from all pending entries
  quickConvert: protectedProcedure
    .input(
      z.object({
        importId: z.string(),
        accountId: z.string(),
        cardId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const pendingEntries = await ctx.db.query.statementEntries.findMany({
        where: and(
          eq(statementEntries.importId, input.importId),
          eq(statementEntries.status, "pending")
        ),
      });

      const now = nowTimestamp();
      let count = 0;

      for (const entry of pendingEntries) {
        const transactionId = generateId();
        const type = entry.amount >= 0 ? "income" : "expense";

        await ctx.db.insert(transactions).values({
          id: transactionId,
          userId: ctx.userId,
          accountId: input.accountId,
          cardId: input.cardId ?? null,
          type,
          amount: Math.abs(entry.amount),
          date: entry.entryDate,
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
        format: z.enum(["csv", "ofx", "pdf"]),
        institution: z.string().optional(),
        config: z.string(), // JSON string
      })
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
});
