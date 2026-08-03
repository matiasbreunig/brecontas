import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { transactions, categories, cardInvoices } from "@/server/db/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { toISODate } from "@/lib/date";
import { incomeSql, expenseSql, isRealTransaction } from "@/server/services/money/ledger";

const dateFieldSchema = z.enum(["date", "competenceDate"]).default("date");

function getDateCol(dateField: "date" | "competenceDate") {
  return dateField === "competenceDate"
    ? sql`COALESCE(${transactions.competenceDate}, ${transactions.date})`
    : sql`${transactions.date}`;
}

export const reportsRouter = router({
  // Expenses by category for a month
  byCategory: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string(),
        dateTo: z.string(),
        type: z.enum(["expense", "income"]).default("expense"),
        dateField: dateFieldSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const dateCol = getDateCol(input.dateField);

      const results = await ctx.db
        .select({
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          categoryIcon: categories.icon,
          categoryColor: categories.color,
          total: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`.as("total"),
          count: sql<number>`COUNT(*)`.as("count"),
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.userId, ctx.userId),
            eq(transactions.type, input.type),
            sql`${dateCol} >= ${input.dateFrom}`,
            sql`${dateCol} <= ${input.dateTo}`,
            sql`${transactions.status} != 'discarded'`,
            eq(transactions.isProjected, false)
          )
        )
        .groupBy(transactions.categoryId, categories.name, categories.icon, categories.color)
        .orderBy(sql`total DESC`);

      const total = results.reduce((sum, r) => sum + r.total, 0);

      return results.map((r) => ({
        ...r,
        percentage: total > 0 ? Math.round((r.total / total) * 100) : 0,
      }));
    }),

  // Daily spending for a month (for chart)
  dailySpending: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string(),
        dateTo: z.string(),
        dateField: dateFieldSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const dateCol = getDateCol(input.dateField);

      return ctx.db
        .select({
          date: sql<string>`${dateCol}`.as("date_val"),
          income: incomeSql,
          expense: expenseSql,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.userId),
            sql`${dateCol} >= ${input.dateFrom}`,
            sql`${dateCol} <= ${input.dateTo}`,
            sql`${transactions.status} != 'discarded'`,
            eq(transactions.isProjected, false)
          )
        )
        .groupBy(sql`date_val`)
        .orderBy(sql`date_val`);
    }),

  // Month-over-month comparison
  monthComparison: protectedProcedure
    .input(
      z.object({
        months: z.number().int().min(2).max(12).default(6),
        dateField: dateFieldSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const dateCol = getDateCol(input.dateField);
      // One grouped query instead of one full scan per month. With no index on
      // date, six months meant six scans of the whole table, in sequence, on a
      // synchronous driver.
      const now = new Date();
      const firstMonth = new Date(now.getFullYear(), now.getMonth() - (input.months - 1), 1);
      const dateFrom = toISODate(firstMonth);
      const dateTo = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const rows = ctx.db
        .select({
          month: sql<string>`substr(${dateCol}, 1, 7)`,
          income: incomeSql,
          expense: expenseSql,
          count: sql<number>`COUNT(*)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.userId),
            sql`${dateCol} >= ${dateFrom}`,
            sql`${dateCol} <= ${dateTo}`,
            isRealTransaction
          )
        )
        .groupBy(sql`substr(${dateCol}, 1, 7)`)
        .all();

      const byMonth = new Map(rows.map((r) => [r.month, r]));

      // Months with no movement still have to appear, or the chart has holes.
      const results = [];
      for (let i = input.months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = toISODate(d).slice(0, 7);
        const row = byMonth.get(key);
        results.push({
          month: key,
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
          income: row?.income ?? 0,
          expense: row?.expense ?? 0,
          count: row?.count ?? 0,
        });
      }

      return results;
    }),

  // Upcoming invoices
  upcomingInvoices: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.cardInvoices.findMany({
      where: and(
        eq(cardInvoices.userId, ctx.userId),
        sql`${cardInvoices.status} IN ('open', 'closed', 'overdue')`
      ),
      with: { card: true },
      orderBy: [desc(cardInvoices.dueDate)],
      limit: 10,
    });
  }),
});
