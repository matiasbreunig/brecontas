import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
  }

  const userId = ctx.session.user.id;

  return next({
    ctx: {
      ...ctx,
      userId,
      /**
       * Fetch a row and prove it belongs to the caller.
       *
       * Scoping used to be applied by hand in every procedure, and the ones
       * that forgot (payInvoice, ai.acceptSuggestion, convertEntries) let one
       * spouse read and mutate the other's records. Reaching for this instead
       * of a bare `eq(table.id, input.id)` keeps that a one-liner.
       *
       * Returns NOT_FOUND rather than FORBIDDEN so a probe cannot use the
       * status code to learn whether an id exists.
       */
      requireOwned: <T extends { id: string; userId: string }>(
        row: T | undefined,
        label = "Registro",
      ): T => {
        if (!row || row.userId !== userId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `${label} não encontrado`,
          });
        }
        return row;
      },
    },
  });
});
