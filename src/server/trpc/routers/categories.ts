import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../init";
import { categories, transactions } from "@/server/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const categoriesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.categories.findMany({
      where: eq(categories.userId, ctx.userId),
      orderBy: (categories, { asc }) => [asc(categories.name)],
    });
  }),

  listTree: protectedProcedure.query(async ({ ctx }) => {
    const all = await ctx.db.query.categories.findMany({
      where: and(eq(categories.userId, ctx.userId), eq(categories.isActive, true)),
      orderBy: (categories, { asc }) => [asc(categories.name)],
    });

    const roots = all.filter((c) => !c.parentId);
    return roots.map((root) => ({
      ...root,
      children: all.filter((c) => c.parentId === root.id),
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        icon: z.string().optional(),
        color: z.string().optional(),
        parentId: z.string().optional(),
        type: z.enum(["income", "expense", "both"]).default("expense"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      await ctx.db.insert(categories).values({
        id,
        userId: ctx.userId,
        ...input,
        createdByUserId: ctx.userId,
        createdAt: nowTimestamp(),
      });
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        icon: z.string().optional(),
        color: z.string().optional(),
        parentId: z.string().nullable().optional(),
        type: z.enum(["income", "expense", "both"]).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(categories)
        .set(data)
        .where(and(eq(categories.id, id), eq(categories.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Deleting a category still in use raised a raw foreign-key error, which
      // surfaced as an unexplained failure. Say what is in the way instead.
      const inUse = ctx.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.categoryId, input.id),
            eq(transactions.userId, ctx.userId)
          )
        )
        .get();

      if (inUse) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Esta categoria está em uso por transações. Troque a categoria delas antes de excluir.",
        });
      }

      // Move children to root before deleting
      await ctx.db
        .update(categories)
        .set({ parentId: null })
        .where(and(eq(categories.parentId, input.id), eq(categories.userId, ctx.userId)));

      await ctx.db
        .delete(categories)
        .where(and(eq(categories.id, input.id), eq(categories.userId, ctx.userId)));
    }),
});
