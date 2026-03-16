import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { transactions, transactionTags } from "@/server/db/schema";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

const transactionInput = z.object({
  accountId: z.string().optional(),
  cardId: z.string().optional(),
  beneficiaryId: z.string().optional(),
  categoryId: z.string().optional(),
  type: z.enum(["income", "expense", "transfer", "refund"]),
  amount: z.number().int().positive(),
  date: z.string(), // ISO date
  competenceDate: z.string().optional(),
  description: z.string().optional(),
  paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
  notes: z.string().optional(),
  isProjected: z.boolean().default(false),
  installmentCurrent: z.number().int().optional(),
  installmentTotal: z.number().int().optional(),
  tagIds: z.array(z.string()).optional(),
});

export const transactionsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        accountId: z.string().optional(),
        cardId: z.string().optional(),
        categoryId: z.string().optional(),
        beneficiaryId: z.string().optional(),
        status: z.enum(["draft", "unrecognized", "identified", "reconciled", "discarded"]).optional(),
        type: z.enum(["income", "expense", "transfer", "refund"]).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        isProjected: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).default({ limit: 50, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(transactions.userId, ctx.userId)];

      if (input.accountId) conditions.push(eq(transactions.accountId, input.accountId));
      if (input.cardId) conditions.push(eq(transactions.cardId, input.cardId));
      if (input.categoryId) conditions.push(eq(transactions.categoryId, input.categoryId));
      if (input.beneficiaryId) conditions.push(eq(transactions.beneficiaryId, input.beneficiaryId));
      if (input.status) conditions.push(eq(transactions.status, input.status));
      if (input.type) conditions.push(eq(transactions.type, input.type));
      if (input.dateFrom) conditions.push(gte(transactions.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(transactions.date, input.dateTo));
      if (input.isProjected !== undefined) conditions.push(eq(transactions.isProjected, input.isProjected));

      const items = await ctx.db.query.transactions.findMany({
        where: and(...conditions),
        with: {
          account: true,
          card: true,
          beneficiary: true,
          category: true,
          transactionTags: { with: { tag: true } },
        },
        orderBy: [desc(transactions.date), desc(transactions.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      const countResult = ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(transactions)
        .where(and(...conditions))
        .get();

      return {
        items,
        total: countResult?.count ?? 0,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.transactions.findFirst({
        where: and(eq(transactions.id, input.id), eq(transactions.userId, ctx.userId)),
        with: {
          account: true,
          card: true,
          beneficiary: true,
          category: true,
          transactionTags: { with: { tag: true } },
          attachments: true,
          aiClassifications: true,
        },
      });
    }),

  create: protectedProcedure
    .input(transactionInput)
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();
      const { tagIds, ...data } = input;

      await ctx.db.insert(transactions).values({
        id,
        userId: ctx.userId,
        ...data,
        status: "draft",
        source: "manual",
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      if (tagIds?.length) {
        await ctx.db.insert(transactionTags).values(
          tagIds.map((tagId) => ({ transactionId: id, tagId }))
        );
      }

      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        accountId: z.string().nullable().optional(),
        cardId: z.string().nullable().optional(),
        beneficiaryId: z.string().nullable().optional(),
        categoryId: z.string().nullable().optional(),
        type: z.enum(["income", "expense", "transfer", "refund"]).optional(),
        amount: z.number().int().positive().optional(),
        date: z.string().optional(),
        competenceDate: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).nullable().optional(),
        status: z.enum(["draft", "unrecognized", "identified", "reconciled", "discarded"]).optional(),
        notes: z.string().nullable().optional(),
        tagIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, tagIds, ...data } = input;

      await ctx.db
        .update(transactions)
        .set({ ...data, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(transactions.id, id), eq(transactions.userId, ctx.userId)));

      if (tagIds !== undefined) {
        await ctx.db.delete(transactionTags).where(eq(transactionTags.transactionId, id));
        if (tagIds.length > 0) {
          await ctx.db.insert(transactionTags).values(
            tagIds.map((tagId) => ({ transactionId: id, tagId }))
          );
        }
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(transactions)
        .set({ status: "discarded", updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(transactions.id, input.id), eq(transactions.userId, ctx.userId)));
    }),

  bulkUpdateStatus: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
        status: z.enum(["draft", "unrecognized", "identified", "reconciled", "discarded"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(transactions)
        .set({ status: input.status, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(
          and(
            inArray(transactions.id, input.ids),
            eq(transactions.userId, ctx.userId)
          )
        );
    }),

  stats: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).default({})
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(transactions.userId, ctx.userId),
        eq(transactions.isProjected, false),
        sql`status != 'discarded'`,
      ];

      if (input.dateFrom) conditions.push(gte(transactions.date, input.dateFrom));
      if (input.dateTo) conditions.push(lte(transactions.date, input.dateTo));

      const result = ctx.db
        .select({
          totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
          totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
          totalRefund: sql<number>`COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0)`,
          count: sql<number>`COUNT(*)`,
          pendingCount: sql<number>`SUM(CASE WHEN status IN ('draft', 'unrecognized') THEN 1 ELSE 0 END)`,
        })
        .from(transactions)
        .where(and(...conditions))
        .get();

      return result;
    }),
});
