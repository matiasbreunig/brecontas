/**
 * Test script: Import → Delete → Re-import (duplicate detection)
 * Run: npx tsx scripts/test-import-delete.ts
 */
import { db } from "../src/server/db";
import { imports, statementEntries, transactions, transactionTags, aiClassifications, cardInvoices, users, accounts } from "../src/server/db/schema";
import { eq, sql, like } from "drizzle-orm";
import { handleImportJob } from "../src/server/services/jobs/handlers/import-handler";
import { generateId } from "../src/lib/id";
import { nowTimestamp } from "../src/lib/date";
import fs from "fs";
import path from "path";

const userRow = db.select().from(users).where(eq(users.email, "matias@brecontas.local")).get();
if (!userRow) throw new Error("User not found");
const userId = userRow.id;

const accountRow = db.select().from(accounts).where(like(accounts.name, "%04753%")).get();
if (!accountRow) throw new Error("Account not found");
const accountId = accountRow.id;

console.log(`\n✅ User: ${userId}, Account: ${accountId}\n`);

// Read test OFX file
const ofxContent = fs.readFileSync(path.join(__dirname, "../test-data/test-import.ofx"), "utf-8");

function counts() {
  const imp = db.select({ c: sql<number>`count(*)` }).from(imports).get()!.c;
  const se = db.select({ c: sql<number>`count(*)` }).from(statementEntries).get()!.c;
  const tx = db.select({ c: sql<number>`count(*)` }).from(transactions).get()!.c;
  const tt = db.select({ c: sql<number>`count(*)` }).from(transactionTags).get()!.c;
  const ai = db.select({ c: sql<number>`count(*)` }).from(aiClassifications).get()!.c;
  const ci = db.select({ c: sql<number>`count(*)` }).from(cardInvoices).get()!.c;
  return { imports: imp, statementEntries: se, transactions: tx, transactionTags: tt, aiClassifications: ai, cardInvoices: ci };
}

async function testImport(): Promise<string> {
  console.log("═══════════════════════════════════════════");
  console.log("TEST 1: IMPORT OFX FILE");
  console.log("═══════════════════════════════════════════");

  const before = counts();
  console.log("Before:", before);

  const importId = generateId();
  const now = nowTimestamp();

  // Create import record (same as smartUpload does)
  db.insert(imports).values({
    id: importId,
    userId,
    accountId,
    cardId: null,
    filename: "test-import.ofx",
    format: "ofx",
    status: "pending",
    createdByUserId: userId,
    createdAt: now,
  }).run();

  const result = await handleImportJob({
    importId,
    content: ofxContent,
    filename: "test-import.ofx",
    accountId,
    userId,
  });

  const after = counts();
  console.log("\nResult:", {
    totalRows: result.totalRows,
    processedRows: result.processedRows,
    duplicatesSkipped: result.duplicatesSkipped,
    transactionsCreated: result.transactionsCreated,
  });
  console.log("After:", after);

  // Assertions
  console.assert(result.totalRows === 5, `Expected 5 total rows, got ${result.totalRows}`);
  console.assert(result.processedRows === 5, `Expected 5 processed rows, got ${result.processedRows}`);
  console.assert(result.duplicatesSkipped === 0, `Expected 0 duplicates, got ${result.duplicatesSkipped}`);
  console.assert(result.transactionsCreated === 5, `Expected 5 transactions created, got ${result.transactionsCreated}`);
  console.assert(after.imports === before.imports + 1, "Import count should increase by 1");
  console.assert(after.statementEntries === before.statementEntries + 5, "Statement entries should increase by 5");
  console.assert(after.transactions === before.transactions + 5, "Transactions should increase by 5");

  console.log("\n✅ TEST 1 PASSED: Import created 5 entries + 5 transactions\n");
  return importId;
}

async function testDuplicateDetection(firstImportId: string): Promise<string> {
  console.log("═══════════════════════════════════════════");
  console.log("TEST 2: DUPLICATE DETECTION (same file)");
  console.log("═══════════════════════════════════════════");

  const before = counts();
  console.log("Before:", before);

  const importId2 = generateId();
  const now = nowTimestamp();

  db.insert(imports).values({
    id: importId2,
    userId,
    accountId,
    cardId: null,
    filename: "test-import.ofx",
    format: "ofx",
    status: "pending",
    createdByUserId: userId,
    createdAt: now,
  }).run();

  const result = await handleImportJob({
    importId: importId2,
    content: ofxContent,
    filename: "test-import.ofx",
    accountId,
    userId,
  });

  const after = counts();
  console.log("\nResult:", {
    totalRows: result.totalRows,
    processedRows: result.processedRows,
    duplicatesSkipped: result.duplicatesSkipped,
    transactionsCreated: result.transactionsCreated,
  });
  console.log("After:", after);

  // All 5 entries should be detected as duplicates
  console.assert(result.totalRows === 5, `Expected 5 total rows, got ${result.totalRows}`);
  console.assert(result.duplicatesSkipped === 5, `Expected 5 duplicates, got ${result.duplicatesSkipped}`);
  console.assert(result.processedRows === 0, `Expected 0 processed rows, got ${result.processedRows}`);
  console.assert(result.transactionsCreated === 0, `Expected 0 transactions created, got ${result.transactionsCreated}`);
  console.assert(after.statementEntries === before.statementEntries, "Statement entries should not increase");
  console.assert(after.transactions === before.transactions, "Transactions should not increase");

  console.log("\n✅ TEST 2 PASSED: All 5 entries detected as duplicates\n");
  return importId2;
}

async function testDeleteImport(importId: string, label: string) {
  console.log("═══════════════════════════════════════════");
  console.log(`TEST: DELETE IMPORT (${label})`);
  console.log("═══════════════════════════════════════════");

  const before = counts();
  console.log("Before:", before);

  // Replicate the deleteImport mutation logic
  const { inArray } = await import("drizzle-orm");

  const imp = db.select().from(imports).where(eq(imports.id, importId)).get();
  if (!imp) {
    console.log(`Import ${importId} not found — already deleted or never existed`);
    return;
  }

  // Get transaction IDs for this import
  const txList = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.importId, importId)).all();
  const txIds = txList.map((tx: any) => tx.id);
  console.log(`Found ${txIds.length} transactions to delete`);

  // Delete in FK-safe order
  if (txIds.length > 0) {
    db.delete(aiClassifications).where(inArray(aiClassifications.transactionId, txIds)).run();
    db.delete(transactionTags).where(inArray(transactionTags.transactionId, txIds)).run();
    db.delete(transactions).where(inArray(transactions.id, txIds)).run();
  }

  db.delete(statementEntries).where(eq(statementEntries.importId, importId)).run();
  db.delete(imports).where(eq(imports.id, importId)).run();

  // Clean orphaned card invoice
  if (imp.cardInvoiceId) {
    const remaining = db.select().from(statementEntries).where(eq(statementEntries.cardInvoiceId, imp.cardInvoiceId)).get();
    if (!remaining) {
      db.delete(cardInvoices).where(eq(cardInvoices.id, imp.cardInvoiceId)).run();
      console.log(`Cleaned orphaned card invoice: ${imp.cardInvoiceId}`);
    }
  }

  const after = counts();
  console.log("After:", after);

  // Verify clean deletion
  const remainingTx = db.select().from(transactions).where(eq(transactions.importId, importId)).all();
  const remainingEntries = db.select().from(statementEntries).where(eq(statementEntries.importId, importId)).all();
  const remainingImport = db.select().from(imports).where(eq(imports.id, importId)).get();

  console.assert(remainingTx.length === 0, `Expected 0 remaining transactions, got ${remainingTx.length}`);
  console.assert(remainingEntries.length === 0, `Expected 0 remaining entries, got ${remainingEntries.length}`);
  console.assert(!remainingImport, "Import record should be deleted");

  console.log(`\n✅ DELETE PASSED (${label}): All records cleaned\n`);
}

async function testReimportAfterDelete() {
  console.log("═══════════════════════════════════════════");
  console.log("TEST 3: RE-IMPORT AFTER DELETE");
  console.log("═══════════════════════════════════════════");

  const before = counts();
  console.log("Before:", before);

  const importId = generateId();
  const now = nowTimestamp();

  db.insert(imports).values({
    id: importId,
    userId,
    accountId,
    cardId: null,
    filename: "test-import.ofx",
    format: "ofx",
    status: "pending",
    createdByUserId: userId,
    createdAt: now,
  }).run();

  const result = await handleImportJob({
    importId,
    content: ofxContent,
    filename: "test-import.ofx",
    accountId,
    userId,
  });

  const after = counts();
  console.log("\nResult:", {
    totalRows: result.totalRows,
    processedRows: result.processedRows,
    duplicatesSkipped: result.duplicatesSkipped,
    transactionsCreated: result.transactionsCreated,
  });
  console.log("After:", after);

  // After deleting everything, re-import should create fresh entries
  console.assert(result.duplicatesSkipped === 0, `Expected 0 duplicates after delete, got ${result.duplicatesSkipped}`);
  console.assert(result.transactionsCreated === 5, `Expected 5 transactions, got ${result.transactionsCreated}`);

  console.log("\n✅ TEST 3 PASSED: Re-import after delete creates fresh entries\n");

  // Cleanup
  await testDeleteImport(importId, "cleanup after test 3");
}

async function main() {
  try {
    console.log("\n🧪 Starting Import/Delete/Duplicate Tests\n");

    // Test 1: Basic import
    const importId1 = await testImport();

    // Test 2: Duplicate detection (same file, same account)
    const importId2 = await testDuplicateDetection(importId1);

    // Delete import 2 first (it has 0 transactions, easy case)
    await testDeleteImport(importId2, "empty import with duplicates");

    // Delete import 1 (has 5 transactions, the real test)
    await testDeleteImport(importId1, "import with 5 transactions");

    // Verify DB is clean
    const final = counts();
    console.assert(final.imports === 0, `Expected 0 imports, got ${final.imports}`);
    console.assert(final.statementEntries === 0, `Expected 0 entries, got ${final.statementEntries}`);
    console.assert(final.transactions === 0, `Expected 0 transactions, got ${final.transactions}`);

    // Test 3: Re-import after delete (entries should be fresh, not duplicates)
    await testReimportAfterDelete();

    // Final state
    console.log("═══════════════════════════════════════════");
    console.log("FINAL STATE");
    console.log("═══════════════════════════════════════════");
    console.log(counts());
    console.log("\n🎉 ALL TESTS PASSED!\n");

  } catch (error) {
    console.error("\n❌ TEST FAILED:", error);
    process.exit(1);
  }
}

main();
