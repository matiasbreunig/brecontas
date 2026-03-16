import { z } from "zod";
import { router, protectedProcedure } from "../init";
import { inboxItems, transactions, transactionTags, attachments, beneficiaries } from "@/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { parseRawText } from "@/server/services/inference/text-parser";
import { matchFromHistory } from "@/server/services/inference/history-matcher";
import { mergeInferences, ocrToFields } from "@/server/services/inference/merger";
import type { InferenceResult } from "@/server/services/inference/merger";
import { enhanceWithAI } from "@/server/services/inference/ai-enhancer";

export const inboxRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "processing", "converted", "discarded"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).default({ limit: 50, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(inboxItems.userId, ctx.userId)];
      if (input.status) conditions.push(eq(inboxItems.status, input.status));

      const items = await ctx.db.query.inboxItems.findMany({
        where: and(...conditions),
        with: { attachments: true },
        orderBy: [desc(inboxItems.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      const countResult = ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(inboxItems)
        .where(and(...conditions))
        .get();

      return { items, total: countResult?.count ?? 0 };
    }),

  create: protectedProcedure
    .input(
      z.object({
        rawContent: z.string().min(1),
        source: z.enum(["manual", "whatsapp", "mcp", "receipt", "email", "ai_chat"]).default("manual"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = generateId();
      const now = nowTimestamp();

      await ctx.db.insert(inboxItems).values({
        id,
        userId: ctx.userId,
        createdByUserId: ctx.userId,
        rawContent: input.rawContent,
        source: input.source,
        status: "pending",
        createdAt: now,
      });

      return { id };
    }),

  getExtractedData: protectedProcedure
    .input(z.object({ inboxItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const attachment = await ctx.db.query.attachments.findFirst({
        where: and(
          eq(attachments.inboxItemId, input.inboxItemId),
          eq(attachments.userId, ctx.userId)
        ),
      });

      if (!attachment?.extractedText) return null;

      try {
        return JSON.parse(attachment.extractedText) as {
          amount: number | null;
          type: string;
          description: string;
          date: string | null;
          beneficiaryName: string | null;
          paymentMethod: string | null;
          documentType: string;
          confidence: number;
          rawText: string;
        };
      } catch {
        return null;
      }
    }),

  inferAI: protectedProcedure
    .input(z.object({ inboxItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.query.inboxItems.findFirst({
        where: and(eq(inboxItems.id, input.inboxItemId), eq(inboxItems.userId, ctx.userId)),
      });
      if (!item) return null;

      const result = await enhanceWithAI(item.rawContent, ctx.userId);
      return result;
    }),

  convertToTransaction: protectedProcedure
    .input(
      z.object({
        inboxItemId: z.string(),
        accountId: z.string().optional(),
        cardId: z.string().optional(),
        beneficiaryId: z.string().optional(),
        beneficiaryName: z.string().optional(), // free-text: creates new beneficiary if no ID
        categoryId: z.string().optional(),
        type: z.enum(["income", "expense", "transfer", "refund"]),
        amount: z.number().int().positive(),
        date: z.string(),
        description: z.string().optional(),
        paymentMethod: z.enum(["pix", "debit", "credit", "transfer", "boleto", "cash", "other"]).optional(),
        tagIds: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { inboxItemId, tagIds, beneficiaryName, ...data } = input;
      const transactionId = generateId();
      const now = nowTimestamp();

      // Auto-create beneficiary from free text if no ID provided
      let beneficiaryId = data.beneficiaryId;
      if (!beneficiaryId && beneficiaryName && beneficiaryName.trim().length > 0) {
        const newBenId = generateId();
        await ctx.db.insert(beneficiaries).values({
          id: newBenId,
          userId: ctx.userId,
          name: beneficiaryName.trim(),
          createdByUserId: ctx.userId,
          createdAt: now,
          updatedByUserId: ctx.userId,
          updatedAt: now,
        });
        beneficiaryId = newBenId;
      }

      // Create the transaction
      await ctx.db.insert(transactions).values({
        id: transactionId,
        userId: ctx.userId,
        ...data,
        beneficiaryId,
        status: "identified",
        source: "inbox",
        inboxItemId,
        createdByUserId: ctx.userId,
        createdAt: now,
        updatedByUserId: ctx.userId,
        updatedAt: now,
      });

      if (tagIds?.length) {
        await ctx.db.insert(transactionTags).values(
          tagIds.map((tagId) => ({ transactionId, tagId }))
        );
      }

      // Link attachments to the transaction
      await ctx.db
        .update(attachments)
        .set({ transactionId })
        .where(and(eq(attachments.inboxItemId, inboxItemId), eq(attachments.userId, ctx.userId)));

      // Update inbox item
      await ctx.db
        .update(inboxItems)
        .set({ status: "converted", transactionId })
        .where(and(eq(inboxItems.id, inboxItemId), eq(inboxItems.userId, ctx.userId)));

      return { transactionId };
    }),

  infer: protectedProcedure
    .input(z.object({ inboxItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get the inbox item
      const item = await ctx.db.query.inboxItems.findFirst({
        where: and(eq(inboxItems.id, input.inboxItemId), eq(inboxItems.userId, ctx.userId)),
      });
      if (!item) return null;

      const rawText = item.rawContent;

      // Stage 1: Regex text parsing
      const textParsed = parseRawText(rawText);

      // Stage 2: History-based matching
      const amountCentavos = textParsed.amount
        ? Math.round(textParsed.amount.value * 100)
        : undefined;
      const historyMatch = await matchFromHistory(rawText, ctx.userId, amountCentavos);

      // Check for OCR data from attachments
      let ocrFields: Parameters<typeof mergeInferences>[2] | undefined;
      const attachment = await ctx.db.query.attachments.findFirst({
        where: and(
          eq(attachments.inboxItemId, input.inboxItemId),
          eq(attachments.userId, ctx.userId)
        ),
      });
      if (attachment?.extractedText) {
        try {
          const ocrData = JSON.parse(attachment.extractedText);
          ocrFields = ocrToFields(ocrData);
        } catch { /* ignore */ }
      }

      // Stage 3: Merge all sources
      const merged = mergeInferences(textParsed, historyMatch, ocrFields);

      // Convert amount from reais (float) to centavos (int) for the text-parsed amount
      if (merged.amount && merged.amount.source === "parsed") {
        merged.amount = {
          ...merged.amount,
          value: Math.round(merged.amount.value * 100),
        };
      }

      return merged as InferenceResult;
    }),

  discard: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(inboxItems)
        .set({ status: "discarded" })
        .where(and(eq(inboxItems.id, input.id), eq(inboxItems.userId, ctx.userId)));
    }),

  pendingCount: protectedProcedure.query(async ({ ctx }) => {
    const result = ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, ctx.userId), eq(inboxItems.status, "pending")))
      .get();
    return result?.count ?? 0;
  }),
});
