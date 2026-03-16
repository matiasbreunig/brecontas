import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { cards } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const cardsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.cards.findMany({
      where: eq(cards.userId, ctx.userId),
      with: { account: true },
      orderBy: (cards, { asc }) => [asc(cards.name)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        name: z.string().min(1),
        lastFour: z.string().max(4).optional(),
        brand: z.enum(["visa", "mastercard", "elo", "amex", "other"]).optional(),
        closingDay: z.number().int().min(1).max(31).optional(),
        dueDay: z.number().int().min(1).max(31).optional(),
        creditLimit: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(cards).values({
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
        lastFour: z.string().max(4).optional(),
        brand: z.enum(["visa", "mastercard", "elo", "amex", "other"]).optional(),
        closingDay: z.number().int().min(1).max(31).optional(),
        dueDay: z.number().int().min(1).max(31).optional(),
        creditLimit: z.number().int().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(cards)
        .set({ ...data, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(cards.id, id), eq(cards.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(cards)
        .set({ isActive: false, updatedByUserId: ctx.userId, updatedAt: nowTimestamp() })
        .where(and(eq(cards.id, input.id), eq(cards.userId, ctx.userId)));
    }),
});
