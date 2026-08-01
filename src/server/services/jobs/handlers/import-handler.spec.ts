import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integration test against a real (throwaway) SQLite file.
 *
 * `DATABASE_PATH` already drives the connection in src/server/db/index.ts, so
 * pointing it at a temp file needs no production code change. It must be set
 * before the module graph is imported, hence the dynamic imports below.
 */
const dir = mkdtempSync(join(tmpdir(), "brecontas-test-"));
const dbPath = join(dir, "test.db");

const USER = "user_test";
const CARD = "card_test";
const ACCOUNT = "acct_test";

let handleImportJob: typeof import("./import-handler").handleImportJob;
let db: typeof import("@/server/db").db;
let sqlite: import("better-sqlite3").Database;

beforeAll(async () => {
  process.env.DATABASE_PATH = dbPath;

  // Built from test-data/schema.sql, a snapshot of the live schema. The single
  // committed drizzle migration is stale (no transfer_account_id, no
  // discarded_at) because this project applies schema changes with
  // `drizzle-kit push` by design — see CLAUDE.md. Refresh the snapshot with:
  //   docker exec brecontas node -e "…SELECT sql FROM sqlite_master…"
  const Database = (await import("better-sqlite3")).default;
  sqlite = new Database(dbPath);
  sqlite.exec(readFileSync(join(process.cwd(), "test-data", "schema.sql"), "utf-8"));

  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)")
    .run(USER, "Teste", "teste@brecontas.local", "scrypt$1$00$00", now);
  sqlite
    .prepare(
      "INSERT INTO accounts (id, user_id, name, type, initial_balance, created_by_user_id, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(ACCOUNT, USER, "Conta Teste", "checking", 0, USER, now);
  sqlite
    .prepare(
      "INSERT INTO cards (id, account_id, user_id, name, closing_day, due_day, created_by_user_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(CARD, ACCOUNT, USER, "Cartão Teste", 2, 9, USER, now);

  ({ handleImportJob } = await import("./import-handler"));
  ({ db } = await import("@/server/db"));
});

afterAll(() => {
  sqlite?.close();
  rmSync(dir, { recursive: true, force: true });
});

function newImport(id: string) {
  sqlite
    .prepare(
      "INSERT INTO imports (id, user_id, account_id, card_id, filename, format, status, created_by_user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    )
    .run(
      id,
      USER,
      ACCOUNT,
      CARD,
      "fatura.csv",
      "csv",
      "pending",
      USER,
      Math.floor(Date.now() / 1000)
    );
}

const invoiceCsv = () =>
  readFileSync(join(process.cwd(), "test-data", "itau-fatura.csv"), "utf-8");

const rows = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).all(...args);

describe("handleImportJob — Itaú invoice", () => {
  it("books every purchase as an expense and none as income", async () => {
    newImport("imp_1");
    const result = await handleImportJob({
      importId: "imp_1",
      content: invoiceCsv(),
      filename: "fatura.csv",
      accountId: ACCOUNT,
      cardId: CARD,
      userId: USER,
    });

    // Two purchases as expenses, the refund as a credit, the payment dropped.
    expect(result.transactionsCreated).toBe(3);

    const byType = Object.fromEntries(
      (
        rows(
          "SELECT type, count(*) c FROM transactions WHERE import_id = 'imp_1' GROUP BY type"
        ) as { type: string; c: number }[]
      ).map((r) => [r.type, r.c])
    );
    expect(byType).toEqual({ expense: 2, income: 1 });

    // The one credit is the refund itself, not an invoice-sized phantom income.
    const income = rows(
      "SELECT amount, description FROM transactions WHERE import_id = 'imp_1' AND type = 'income'"
    ) as { amount: number; description: string }[];
    expect(income[0].amount).toBe(8000);
    expect(income[0].description.toUpperCase()).toContain("ESTORNO");

    const expenses = rows(
      "SELECT sum(amount) s FROM transactions WHERE import_id = 'imp_1' AND type = 'expense'"
    ) as { s: number }[];
    expect(expenses[0].s).toBe(37050); // 250,00 + 120,50
  });

  it("never stores the invoice payment line", async () => {
    const payment = rows(
      "SELECT id FROM statement_entries WHERE upper(raw_description) LIKE '%PAGAMENTO EFETUADO%'"
    );
    expect(payment).toHaveLength(0);
  });

  it("stamps the owner on every statement entry", async () => {
    const orphan = rows(
      "SELECT id FROM statement_entries WHERE user_id IS NULL OR user_id != ?",
      USER
    );
    expect(orphan).toHaveLength(0);
  });

  it("treats a re-import of the same file as fully duplicate", async () => {
    const before = (rows("SELECT count(*) c FROM statement_entries")[0] as { c: number }).c;

    newImport("imp_2");
    const result = await handleImportJob({
      importId: "imp_2",
      content: invoiceCsv(),
      filename: "fatura.csv",
      accountId: ACCOUNT,
      cardId: CARD,
      userId: USER,
    });

    expect(result.transactionsCreated).toBe(0);
    expect(result.duplicatesSkipped).toBeGreaterThan(0);
    expect((rows("SELECT count(*) c FROM statement_entries")[0] as { c: number }).c).toBe(before);
  });
});
