import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { accounts, transactions } from "@/server/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

const accountTypeEnum = z.enum(["checking", "savings", "investment", "wallet", "virtual"]);

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
        // Canonical balance formula:
        // saldo = initialBalance
        //   + income where accountId = this
        //   - expense where accountId = this
        //   + refund where accountId = this
        //   - transfer OUT where accountId = this (money leaves)
        //   + transfer IN where transfer_account_id = this (money arrives)
        const outgoing = ctx.db
          .select({
            totalIncome: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
            totalExpense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
            totalRefund: sql<number>`COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0)`,
            totalTransferOut: sql<number>`COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END), 0)`,
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

        const incoming = ctx.db
          .select({
            totalTransferIn: sql<number>`COALESCE(SUM(amount), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.transferAccountId, acc.id),
              eq(transactions.type, "transfer"),
              eq(transactions.isProjected, false),
              sql`status != 'discarded'`
            )
          )
          .get();

        const balance =
          acc.initialBalance +
          (outgoing?.totalIncome ?? 0) -
          (outgoing?.totalExpense ?? 0) +
          (outgoing?.totalRefund ?? 0) -
          (outgoing?.totalTransferOut ?? 0) +
          (incoming?.totalTransferIn ?? 0);

        return { ...acc, balance };
      })
    );

    return balances;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: accountTypeEnum,
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
        type: accountTypeEnum.optional(),
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
