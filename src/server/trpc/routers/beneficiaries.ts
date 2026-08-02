import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../init";
import { beneficiaries, transactions } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const beneficiariesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.beneficiaries.findMany({
      where: eq(beneficiaries.userId, ctx.userId),
      with: { defaultCategory: true },
      orderBy: (b, { asc }) => [asc(b.name)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).optional(),
        defaultCategoryId: z.string().optional(),
        defaultTagIds: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(beneficiaries).values({
        id,
        userId: ctx.userId,
        name: input.name,
        aliases: input.aliases ? JSON.stringify(input.aliases) : null,
        defaultCategoryId: input.defaultCategoryId,
        defaultTagIds: input.defaultTagIds ? JSON.stringify(input.defaultTagIds) : null,
        notes: input.notes,
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
        aliases: z.array(z.string()).optional(),
        defaultCategoryId: z.string().nullable().optional(),
        defaultTagIds: z.array(z.string()).optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, aliases, defaultTagIds, ...data } = input;

      await ctx.db
        .update(beneficiaries)
        .set({
          ...data,
          ...(aliases !== undefined && { aliases: JSON.stringify(aliases) }),
          ...(defaultTagIds !== undefined && { defaultTagIds: JSON.stringify(defaultTagIds) }),
          updatedByUserId: ctx.userId,
          updatedAt: nowTimestamp(),
        })
        .where(and(eq(beneficiaries.id, id), eq(beneficiaries.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Same as categories: a raw foreign-key error told the user nothing.
      const inUse = ctx.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.beneficiaryId, input.id),
            eq(transactions.userId, ctx.userId)
          )
        )
        .get();

      if (inUse) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Este favorecido está em uso por transações. Troque o favorecido delas antes de excluir.",
        });
      }

      await ctx.db
        .delete(beneficiaries)
        .where(and(eq(beneficiaries.id, input.id), eq(beneficiaries.userId, ctx.userId)));
    }),
});
