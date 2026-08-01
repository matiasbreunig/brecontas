import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { recurringTemplates, transactions } from "@/server/db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const recurringRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.recurringTemplates.findMany({
      where: eq(recurringTemplates.userId, ctx.userId),
      with: {
        category: true,
        beneficiary: true,
        account: true,
      },
      orderBy: [desc(recurringTemplates.createdAt)],
    });
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.recurringTemplates.findFirst({
        where: and(eq(recurringTemplates.id, input.id), eq(recurringTemplates.userId, ctx.userId)),
        with: { category: true, beneficiary: true, account: true },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        description: z.string().min(1),
        accountId: z.string().optional(),
        cardId: z.string().optional(),
        beneficiaryId: z.string().optional(),
        categoryId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        type: z.enum(["income", "expense"]),
        estimatedAmount: z.number().int().positive(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
        frequency: z.enum(["monthly", "weekly", "biweekly", "quarterly", "yearly", "custom"]),
        // A negative interval walked the date backwards, so the while loop in
        // generateDates never terminated and hung the process.
        customIntervalDays: z.number().int().min(1).optional(),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        startDate: z.string(),
        endDate: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(recurringTemplates).values({
        id,
        userId: ctx.userId,
        description: input.description,
        accountId: input.accountId ?? null,
        cardId: input.cardId ?? null,
        beneficiaryId: input.beneficiaryId ?? null,
        categoryId: input.categoryId ?? null,
        tagIds: input.tagIds ? JSON.stringify(input.tagIds) : null,
        type: input.type,
        estimatedAmount: input.estimatedAmount,
        paymentMethod: input.paymentMethod ?? null,
        frequency: input.frequency,
        customIntervalDays: input.customIntervalDays ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        isActive: true,
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
        description: z.string().optional(),
        estimatedAmount: z.number().int().positive().optional(),
        categoryId: z.string().nullable().optional(),
        beneficiaryId: z.string().nullable().optional(),
        accountId: z.string().nullable().optional(),
        frequency: z.enum(["monthly", "weekly", "biweekly", "quarterly", "yearly", "custom"]).optional(),
        dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
        isActive: z.boolean().optional(),
        endDate: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(recurringTemplates)
        .set({ ...data, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(recurringTemplates)
        .where(and(eq(recurringTemplates.id, input.id), eq(recurringTemplates.userId, ctx.userId)));
    }),

  // Generate projected transactions from templates
  generateProjections: protectedProcedure
    .input(
      z.object({
        monthsAhead: z.number().int().min(1).max(12).default(3),
      }).default({ monthsAhead: 3 })
    )
    .mutation(async ({ ctx, input }) => {
      const templates = await ctx.db.query.recurringTemplates.findMany({
        where: and(
          eq(recurringTemplates.userId, ctx.userId),
          eq(recurringTemplates.isActive, true)
        ),
      });

      const now = new Date();
      const endDate = new Date(now.getFullYear(), now.getMonth() + input.monthsAhead, 0);
      let created = 0;
      const timestamp = nowTimestamp();

      for (const template of templates) {
        const dates = generateDates(template, now, endDate);

        for (const date of dates) {
          const dateStr = date.toISOString().split("T")[0];

          // Check if projection already exists
          const existing = await ctx.db.query.transactions.findFirst({
            where: and(
              eq(transactions.userId, ctx.userId),
              eq(transactions.projectedSourceId, template.id),
              eq(transactions.date, dateStr),
              eq(transactions.isProjected, true)
            ),
          });

          if (existing) continue;

          const id = generateId();
          await ctx.db.insert(transactions).values({
            id,
            userId: ctx.userId,
            accountId: template.accountId,
            cardId: template.cardId,
            beneficiaryId: template.beneficiaryId,
            categoryId: template.categoryId,
            type: template.type,
            amount: template.estimatedAmount,
            date: dateStr,
            description: template.description,
            paymentMethod: template.paymentMethod,
            status: "draft",
            source: "manual",
            isRecurring: true,
            isProjected: true,
            projectedSourceId: template.id,
            createdByUserId: ctx.userId,
            createdAt: timestamp,
            updatedByUserId: ctx.userId,
            updatedAt: timestamp,
          });

          created++;
        }

        // Update last generated date
        await ctx.db
          .update(recurringTemplates)
          .set({
            lastGeneratedDate: endDate.toISOString().split("T")[0],
            updatedAt: timestamp,
          })
          .where(eq(recurringTemplates.id, template.id));
      }

      return { created, templates: templates.length };
    }),

  // Future balance projection
  futureBalance: protectedProcedure
    .input(
      z.object({
        monthsAhead: z.number().int().min(1).max(12).default(6),
      }).default({ monthsAhead: 6 })
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const results = [];

      for (let i = 0; i <= input.monthsAhead; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const dateFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const dateTo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${lastDay}`;

        // Get realized + projected for this month
        const monthStats = ctx.db
          .select({
            realized_income: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' AND is_projected = 0 THEN amount ELSE 0 END), 0)`,
            realized_expense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' AND is_projected = 0 THEN amount ELSE 0 END), 0)`,
            projected_income: sql<number>`COALESCE(SUM(CASE WHEN type = 'income' AND is_projected = 1 THEN amount ELSE 0 END), 0)`,
            projected_expense: sql<number>`COALESCE(SUM(CASE WHEN type = 'expense' AND is_projected = 1 THEN amount ELSE 0 END), 0)`,
          })
          .from(transactions)
          .where(and(
            eq(transactions.userId, ctx.userId),
            gte(transactions.date, dateFrom),
            lte(transactions.date, dateTo),
            sql`status != 'discarded'`
          ))
          .get();

        results.push({
          month: dateFrom.slice(0, 7),
          label: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
          realizedIncome: monthStats?.realized_income ?? 0,
          realizedExpense: monthStats?.realized_expense ?? 0,
          projectedIncome: monthStats?.projected_income ?? 0,
          projectedExpense: monthStats?.projected_expense ?? 0,
        });
      }

      return results;
    }),
});

function generateDates(
  template: typeof recurringTemplates.$inferSelect,
  from: Date,
  until: Date
): Date[] {
  const dates: Date[] = [];
  const start = new Date(template.startDate);
  const end = template.endDate ? new Date(template.endDate) : until;
  const effectiveEnd = end < until ? end : until;

  let current = new Date(start);

  // Belt and braces: zod rejects a non-positive interval on create, but a row
  // written before that guard existed would make nextOccurrence walk backwards
  // (or stand still) and hang the request forever.
  const MAX_ITERATIONS = 10_000;
  let iterations = 0;
  const advance = (): Date => {
    const next = nextOccurrence(current, template);
    if (next <= current || ++iterations > MAX_ITERATIONS) {
      throw new Error(
        "Intervalo inválido no lançamento recorrente: não avança no tempo"
      );
    }
    return next;
  };

  // Advance to first date >= from
  while (current < from) {
    current = advance();
  }

  while (current <= effectiveEnd) {
    dates.push(new Date(current));
    current = advance();
  }

  return dates;
}

function nextOccurrence(
  date: Date,
  template: typeof recurringTemplates.$inferSelect
): Date {
  const next = new Date(date);

  switch (template.frequency) {
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      if (template.dayOfMonth) {
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(template.dayOfMonth, lastDay));
      }
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14);
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
    case "custom":
      next.setDate(next.getDate() + (template.customIntervalDays || 30));
      break;
  }

  return next;
}
