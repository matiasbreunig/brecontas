import { db } from "@/server/db";
import { imports, statementEntries, cardInvoices, cards, transactions, transactionTags } from "@/server/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { parseFile, type EntryEnrichment } from "@/server/services/parsers/parser-factory";
import { generateEntryHash } from "@/server/services/parsers/csv-parser";
import { matchFromHistory } from "@/server/services/inference/history-matcher";
import { classifyBatch } from "@/server/services/ai/classifier";

export interface ImportJobPayload {
  importId: string;
  content: string;
  filename: string;
  accountId: string;
  userId: string;
  cardId?: string;
  cardInvoiceId?: string;
  autoCreateInvoice?: boolean;
  templateConfig?: Record<string, unknown>;
}

export interface ImportJobResult {
  totalRows: number;
  processedRows: number;
  duplicatesSkipped: number;
  cardInvoiceId?: string;
  transactionsCreated: number;
  classifiedByRules: number;  // auto-classified via rules/aliases/history
  pendingAIClassification: number; // sent to AI batch
  totalExpense: number;   // centavos
  totalIncome: number;    // centavos (credits/refunds)
  dateFrom?: string;      // ISO date
  dateTo?: string;        // ISO date
  invoiceDueDate?: string; // ISO date (for card invoices)
}

export async function handleImportJob(payload: ImportJobPayload): Promise<ImportJobResult> {
  const {
    importId,
    content,
    filename,
    accountId,
    userId,
    cardId,
    templateConfig,
  } = payload;

  // Update import status
  db.update(imports)
    .set({ status: "processing" })
    .where(eq(imports.id, importId))
    .run();

  try {
    const result = await parseFile(
      content,
      filename,
      templateConfig as Parameters<typeof parseFile>[2],
    );

    let processedRows = 0;
    let duplicatesSkipped = 0;
    let transactionsCreated = 0;
    let classifiedByRules = 0;
    let totalExpense = 0;  // centavos
    let totalIncome = 0;   // centavos (credits/refunds/payments)
    let dateMin = "";
    let dateMax = "";
    const now = nowTimestamp();
    const unclassifiedTxIds: string[] = [];

    // If card invoice mode and card provided, handle invoice creation
    let cardInvoiceId = payload.cardInvoiceId;
    if (result.mode === "card_invoice" && cardId && !cardInvoiceId && payload.autoCreateInvoice !== false) {
      cardInvoiceId = findOrCreateCardInvoice(cardId, userId, result.dateRange, now);
    }

    // Update import with cardInvoiceId if created
    if (cardInvoiceId) {
      db.update(imports)
        .set({ cardInvoiceId })
        .where(eq(imports.id, importId))
        .run();
    }

    // For card invoices: resolve the invoice due date for cash-basis date semantics
    // date = invoice due date (when money leaves), competenceDate = purchase date
    let invoiceDueDate: string | null = null;
    if (cardInvoiceId) {
      const invoice = db.select({ dueDate: cardInvoices.dueDate })
        .from(cardInvoices)
        .where(eq(cardInvoices.id, cardInvoiceId))
        .get();
      invoiceDueDate = invoice?.dueDate ?? null;
    }

    // Build enrichment lookup by rowNumber
    const enrichmentMap = new Map<number, EntryEnrichment>();
    if (result.enrichments) {
      for (const e of result.enrichments) {
        enrichmentMap.set(e.rowNumber, e);
      }
    }

    for (const entry of result.entries) {
      const hash = generateEntryHash(entry.entryDate, entry.amount, entry.rawDescription);

      // Check for duplicates within same account/card
      const duplicateConditions = [eq(statementEntries.hash, hash)];
      if (cardId) {
        duplicateConditions.push(eq(statementEntries.cardId, cardId));
      } else {
        duplicateConditions.push(eq(statementEntries.accountId, accountId));
      }

      const existingEntry = db
        .select()
        .from(statementEntries)
        .where(and(...duplicateConditions))
        .get();

      if (existingEntry) {
        duplicatesSkipped++;
        continue;
      }

      // Create statement entry (immutable bank data)
      const entryId = generateId();
      const enrichment = enrichmentMap.get(entry.rowNumber);

      db.insert(statementEntries).values({
        id: entryId,
        userId,
        importId,
        accountId,
        cardId: cardId ?? null,
        cardInvoiceId: cardInvoiceId ?? null,
        entryDate: entry.entryDate,
        amount: entry.amount,
        rawDescription: entry.rawDescription,
        balanceAfter: entry.balanceAfter ?? null,
        rowNumber: entry.rowNumber,
        rawData: JSON.stringify(entry.rawData),
        hash,
        status: "pending",
        createdAt: now,
      }).run();

      // Auto-create transaction.
      // The sign is the single source of truth for the type — it was normalised
      // once in the parser-factory. Honouring enrichment.suggestedType here is
      // what used to import the invoice payment line as income.
      const transactionId = generateId();
      const baseType = entry.amount >= 0 ? ("income" as const) : ("expense" as const);

      db.insert(transactions).values({
        id: transactionId,
        userId,
        accountId,
        cardId: cardId ?? null,
        cardInvoiceId: cardInvoiceId ?? null,
        type: baseType,
        amount: Math.abs(entry.amount),
        date: invoiceDueDate || entry.entryDate,
        competenceDate: invoiceDueDate ? entry.entryDate : null,
        description: enrichment?.cleanDescription || entry.rawDescription,
        paymentMethod: cardId ? "credit" : detectPaymentMethod(entry.rawDescription),
        status: "unrecognized",
        source: "import",
        statementEntryId: entryId,
        importId,
        installmentCurrent: enrichment?.installmentCurrent ?? null,
        installmentTotal: enrichment?.installmentTotal ?? null,
        createdByUserId: userId,
        createdAt: now,
        updatedByUserId: userId,
        updatedAt: now,
      }).run();

      // Link statement entry to transaction
      db.update(statementEntries)
        .set({ status: "matched", transactionId })
        .where(eq(statementEntries.id, entryId))
        .run();

      // ── Nível 1: Rules + Aliases + History match (síncrono, grátis) ──
      try {
        const description = enrichment?.cleanDescription || entry.rawDescription;
        const historyMatch = await matchFromHistory(description, userId, entry.amount);

        const updates: Record<string, unknown> = {};
        let wasClassified = false;

        // Apply high-confidence beneficiary match
        if (historyMatch.beneficiaryId && historyMatch.beneficiaryId.confidence >= 0.7) {
          updates.beneficiaryId = historyMatch.beneficiaryId.value;
          wasClassified = true;
        }

        // Apply high-confidence category match
        if (historyMatch.categoryId && historyMatch.categoryId.confidence >= 0.7) {
          updates.categoryId = historyMatch.categoryId.value;
          wasClassified = true;
        }

        // Apply payment method if not already set and confidence is decent
        if (historyMatch.paymentMethod && historyMatch.paymentMethod.confidence >= 0.5) {
          const currentMethod = cardId ? "credit" : detectPaymentMethod(entry.rawDescription);
          if (currentMethod === "other") {
            updates.paymentMethod = historyMatch.paymentMethod.value;
          }
        }

        // Store confidence for UI display
        const maxConfidence = Math.max(
          historyMatch.beneficiaryId?.confidence ?? 0,
          historyMatch.categoryId?.confidence ?? 0,
        );
        if (maxConfidence > 0) {
          updates.confidence = maxConfidence;
        }

        if (wasClassified) {
          updates.status = "identified";
          classifiedByRules++;
        } else {
          unclassifiedTxIds.push(transactionId);
        }

        if (Object.keys(updates).length > 0) {
          db.update(transactions)
            .set(updates)
            .where(eq(transactions.id, transactionId))
            .run();
        }

        // Apply tags if matched
        if (historyMatch.tagIds && historyMatch.tagIds.confidence >= 0.7) {
          for (const tagId of historyMatch.tagIds.value) {
            db.insert(transactionTags).values({
              transactionId,
              tagId,
            }).run();
          }
        }
      } catch (err) {
        // Classification failure should not block import
        console.error("[import] Classification failed for tx", transactionId, err);
        unclassifiedTxIds.push(transactionId);
      }

      transactionsCreated++;
      processedRows++;

      // Accumulate financial totals
      const absAmount = Math.abs(entry.amount);
      if (entry.amount < 0) {
        totalExpense += absAmount;
      } else {
        totalIncome += absAmount;
      }
      const entryDate = entry.entryDate;
      if (!dateMin || entryDate < dateMin) dateMin = entryDate;
      if (!dateMax || entryDate > dateMax) dateMax = entryDate;
    }

    // Update card invoice total if applicable
    if (cardInvoiceId) {
      updateInvoiceTotal(cardInvoiceId);
    }

    // ── Nível 2: AI batch (assíncrono, não bloqueia importação) ──
    if (unclassifiedTxIds.length > 0) {
      classifyBatch(unclassifiedTxIds, userId).catch((err) => {
        console.error("[import] AI batch classification failed:", err);
      });
    }

    // Update import as completed
    db.update(imports)
      .set({
        status: "completed",
        totalRows: result.entries.length,
        processedRows,
      })
      .where(eq(imports.id, importId))
      .run();

    return {
      totalRows: result.entries.length,
      processedRows,
      duplicatesSkipped,
      cardInvoiceId: cardInvoiceId ?? undefined,
      transactionsCreated,
      classifiedByRules,
      pendingAIClassification: unclassifiedTxIds.length,
      totalExpense,
      totalIncome,
      dateFrom: dateMin || undefined,
      dateTo: dateMax || undefined,
      invoiceDueDate: invoiceDueDate ?? undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    db.update(imports)
      .set({
        status: "failed",
        errorMessage,
      })
      .where(eq(imports.id, importId))
      .run();

    throw error;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function detectPaymentMethod(description: string): "pix" | "debit" | "credit" | "transfer" | "boleto" | "cash" | "other" {
  const upper = description.toUpperCase();
  if (upper.startsWith("PIX")) return "pix";
  if (upper.startsWith("PAG BOLETO") || upper.includes("BOLETO")) return "boleto";
  if (upper.includes("DEB AUTOR") || upper.includes("DEBITO")) return "debit";
  if (upper.startsWith("TBI ") || upper.includes("APLICACAO") || upper.includes("RESGATE") || upper.includes("AQUISICAO")) return "transfer";
  if (upper.startsWith("INT ")) return "boleto"; // INT = pagamento interbancário (multas, etc.)
  if (upper.startsWith("PERS BLACK") || upper.startsWith("PERS ")) return "credit"; // Fatura cartão
  if (upper.startsWith("CONS PARCELA")) return "other"; // Consórcio
  return "other";
}

function findOrCreateCardInvoice(
  cardId: string,
  userId: string,
  dateRange?: { start: string; end: string },
  now?: Date,
): string {
  if (!dateRange) {
    const id = generateId();
    const today = new Date().toISOString().split("T")[0];
    db.insert(cardInvoices).values({
      id,
      cardId,
      userId,
      cycleStart: today,
      cycleEnd: today,
      closingDate: today,
      dueDate: today,
      status: "open",
      createdAt: now || new Date(),
    }).run();
    return id;
  }

  // Check if invoice already exists for this card and overlapping cycle
  const existing = db
    .select()
    .from(cardInvoices)
    .where(
      and(
        eq(cardInvoices.cardId, cardId),
        lte(cardInvoices.cycleStart, dateRange.end),
        gte(cardInvoices.cycleEnd, dateRange.start),
      ),
    )
    .get();

  if (existing) return existing.id;

  // Get card info for due day calculation
  const card = db
    .select()
    .from(cards)
    .where(eq(cards.id, cardId))
    .get();

  const closingDate = dateRange.end;

  // Due date: card.dueDay of the month after closing
  const closingDateObj = new Date(closingDate + "T12:00:00");
  const dueMonth = new Date(closingDateObj.getFullYear(), closingDateObj.getMonth() + 1, 1);
  const dueDayNum = card?.dueDay || 10;
  const dueDate = `${dueMonth.getFullYear()}-${String(dueMonth.getMonth() + 1).padStart(2, "0")}-${String(dueDayNum).padStart(2, "0")}`;

  const id = generateId();
  db.insert(cardInvoices).values({
    id,
    cardId,
    userId,
    cycleStart: dateRange.start,
    cycleEnd: dateRange.end,
    closingDate,
    dueDate,
    status: "closed",
    createdAt: now || new Date(),
  }).run();

  return id;
}

function updateInvoiceTotal(cardInvoiceId: string): void {
  // Debits minus refunds. Summing ABS() of debits only used to both zero the
  // total (when purchases came out positive) and overstate it (by counting a
  // refund as one more purchase).
  const result = db
    .select({
      total: sql<number>`COALESCE(SUM(-amount), 0)`,
    })
    .from(statementEntries)
    .where(eq(statementEntries.cardInvoiceId, cardInvoiceId))
    .get();

  if (result) {
    db.update(cardInvoices)
      .set({ totalAmount: result.total, updatedAt: nowTimestamp() })
      .where(eq(cardInvoices.id, cardInvoiceId))
      .run();
  }
}
