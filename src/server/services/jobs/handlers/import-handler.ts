import { db } from "@/server/db";
import { imports, statementEntries } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/id";
import { nowTimestamp } from "@/lib/date";
import { parseFile } from "@/server/services/parsers/parser-factory";
import { generateEntryHash } from "@/server/services/parsers/csv-parser";

export interface ImportJobPayload {
  importId: string;
  content: string;
  filename: string;
  accountId: string;
  cardId?: string;
  templateConfig?: Record<string, unknown>;
}

export async function handleImportJob(payload: ImportJobPayload): Promise<{
  totalRows: number;
  processedRows: number;
  duplicatesSkipped: number;
}> {
  const { importId, content, filename, accountId, cardId, templateConfig } = payload;

  // Update import status
  db.update(imports)
    .set({ status: "processing" })
    .where(eq(imports.id, importId))
    .run();

  try {
    const result = parseFile(
      content,
      filename,
      templateConfig as Parameters<typeof parseFile>[2]
    );

    let processedRows = 0;
    let duplicatesSkipped = 0;
    const now = nowTimestamp();

    for (const entry of result.entries) {
      const hash = generateEntryHash(entry.entryDate, entry.amount, entry.rawDescription);

      // Check for duplicates
      const existing = db
        .select()
        .from(statementEntries)
        .where(
          and(
            eq(statementEntries.hash, hash),
            eq(statementEntries.importId, importId)
          )
        )
        .get();

      // Also check across all imports for this account
      const existingAnyImport = db
        .select()
        .from(statementEntries)
        .where(
          and(
            eq(statementEntries.hash, hash),
            eq(statementEntries.accountId, accountId)
          )
        )
        .get();

      if (existing || existingAnyImport) {
        duplicatesSkipped++;
        continue;
      }

      db.insert(statementEntries).values({
        id: generateId(),
        importId,
        accountId,
        cardId: cardId ?? null,
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

      processedRows++;
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
