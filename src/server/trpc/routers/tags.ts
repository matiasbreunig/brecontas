import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { tags } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";

export const tagsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.tags.findMany({
      where: eq(tags.userId, ctx.userId),
      orderBy: (tags, { asc }) => [asc(tags.name)],
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      await ctx.db.insert(tags).values({
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
        color: z.string().optional(),
        icon: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(tags)
        .set(data)
        .where(and(eq(tags.id, id), eq(tags.userId, ctx.userId)));
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(tags)
        .where(and(eq(tags.id, input.id), eq(tags.userId, ctx.userId)));
    }),
});
