import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { accounts, transactions } from "@/server/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const accountsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.query.accounts.findMany({
      where: eq(accounts.userId, ctx.userId),
      orderBy: (accounts, { asc }) => [asc(accounts.name)],
    });
    return result;
  }),

  getWithBalance: protectedProcedure.query(async ({ ctx }) => {
    const accs = await ctx.db.query.accounts.findMany({
      where: eq(accounts.userId, ctx.userId),
      orderBy: (accounts, { asc }) => [asc(accounts.name)],
    });

    const balances = await Promise.all(
      accs.map(async (acc) => {
        const result = ctx.db
          .select({
            totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' OR type = 'refund' THEN amount ELSE 0 END), 0)`,
            totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
            totalTransferIn: sql<number>`COALESCE(SUM(CASE WHEN type = 'transfer' AND transfer_pair_id IS NOT NULL THEN amount ELSE 0 END), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, acc.id),
              eq(transactions.isProjected, false),
              sql`status != 'discarded'`
            )
          )
          .get();

        const balance =
          acc.initialBalance +
          (result?.totalIncome ?? 0) -
          (result?.totalExpense ?? 0);

        return { ...acc, balance };
      })
    );

    return balances;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: z.enum(["checking", "savings", "investment", "wallet"]),
        institution: z.string().optional(),
        initialBalance: z.number().int().default(0),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(accounts).values({
        id,
        userId: ctx.userId,
        ...input,
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        type: z.enum(["checking", "savings", "investment", "wallet"]).optional(),
        institution: z.string().optional(),
        initialBalance: z.number().int().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(accounts)
        .set({ ...data, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(accounts.id, id), eq(accounts.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(accounts)
        .set({ isActive: false, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(accounts.id, input.id), eq(accounts.userId, ctx.userId)));
    }),
});
