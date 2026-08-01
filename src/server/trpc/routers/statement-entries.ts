import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { statementEntries } from "@/server/db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

// Every procedure here is scoped by userId. The column exists on the table now,
// so this looks like the other twelve routers instead of needing a join.
export const statementEntriesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
        importId: z.string().optional(),
        status: z.enum(["pending", "matched", "skipped", "duplicate"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }).default({ limit: 100, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(statementEntries.userId, ctx.userId)];

      if (input.accountId) conditions.push(eq(statementEntries.accountId, input.accountId));
      if (input.importId) conditions.push(eq(statementEntries.importId, input.importId));
      if (input.status) conditions.push(eq(statementEntries.status, input.status));
      if (input.dateFrom) conditions.push(gte(statementEntries.entryDate, input.dateFrom));
      if (input.dateTo) conditions.push(lte(statementEntries.entryDate, input.dateTo));

      const items = await ctx.db.query.statementEntries.findMany({
        where: and(...conditions),
        with: {
          account: true,
          card: true,
        },
        orderBy: [desc(statementEntries.entryDate), desc(statementEntries.rowNumber)],
        limit: input.limit,
        offset: input.offset,
      });

      return items;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.statementEntries.findFirst({
        where: and(
          eq(statementEntries.id, input.id),
          eq(statementEntries.userId, ctx.userId)
        ),
        with: {
          account: true,
          card: true,
          cardInvoice: true,
        },
      });
    }),

  skip: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(statementEntries)
        .set({ status: "skipped" })
        .where(
          and(
            eq(statementEntries.id, input.id),
            eq(statementEntries.userId, ctx.userId)
          )
        );
    }),

  stats: protectedProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
      }).default({})
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(statementEntries.userId, ctx.userId)];
      if (input.accountId) conditions.push(eq(statementEntries.accountId, input.accountId));

      const result = ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          pending: sql<number>`SUM(CASE WHEN ${statementEntries.status} = 'pending' THEN 1 ELSE 0 END)`,
          matched: sql<number>`SUM(CASE WHEN ${statementEntries.status} = 'matched' THEN 1 ELSE 0 END)`,
          skipped: sql<number>`SUM(CASE WHEN ${statementEntries.status} = 'skipped' THEN 1 ELSE 0 END)`,
          duplicate: sql<number>`SUM(CASE WHEN ${statementEntries.status} = 'duplicate' THEN 1 ELSE 0 END)`,
        })
        .from(statementEntries)
        .where(and(...conditions))
        .get();

      return result;
    }),
});
