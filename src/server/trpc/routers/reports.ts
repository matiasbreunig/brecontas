import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { transactions, categories, cardInvoices } from "@/server/db/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

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
          income: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' OR type = 'refund' THEN amount ELSE 0 END), 0)`,
          expense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
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
      const now = new Date();
      const results = [];

      for (let i = 0; i < input.months; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const dateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const dateTo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${lastDay}`;

        const stats = ctx.db
          .select({
            income: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)`,
            expense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)`,
            count: sql<number>`COUNT(*)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, ctx.userId),
              sql`${dateCol} >= ${dateFrom}`,
              sql`${dateCol} <= ${dateTo}`,
              sql`${transactions.status} != 'discarded'`,
              eq(transactions.isProjected, false)
            )
          )
          .get();

        results.push({
          month: dateFrom.slice(0, 7),
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
          income: stats?.income ?? 0,
          expense: stats?.expense ?? 0,
          count: stats?.count ?? 0,
        });
      }

      return results.reverse();
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
