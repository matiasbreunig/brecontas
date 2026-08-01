import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { parseFile } from "@/server/services/parsers/parser-factory";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "test-data", name), "utf-8");

// The sign convention has exactly one owner: parseFile normalises every format
// to "negative = money leaves". Parsers stay faithful to the file.
describe("parseFile — Itaú credit card invoice (CSV)", () => {
  const load = () => parseFile(fixture("itau-fatura.csv"), "fatura.csv");

  it("detects the file as a card invoice", async () => {
    const result = await load();
    expect(result.mode).toBe("card_invoice");
  });

  // Regression: csv-parser forced -Math.abs() and parser-factory inverted it
  // again, so every purchase came out positive and was imported as income.
  it("imports purchases as debits", async () => {
    const result = await load();
    const market = result.entries.find((e) =>
      e.rawDescription.includes("SUPERMERCADO")
    );
    const gas = result.entries.find((e) => e.rawDescription.includes("POSTO"));

    expect(market?.amount).toBe(-25000);
    expect(gas?.amount).toBe(-12050);
  });

  // Regression: XLS and PDF wiped the sign with Math.abs, turning a refund into
  // one more expense and inflating the invoice total.
  it("keeps a refund as a credit", async () => {
    const result = await load();
    const refund = result.entries.find((e) =>
      e.rawDescription.includes("ESTORNO")
    );
    expect(refund?.amount).toBe(8000);
  });

  // Regression: classifySpecialEntry tagged it income and the import handler
  // obeyed, creating a monthly income the size of the whole invoice — on top of
  // the purchases already booked as expenses. XLS and PDF always skipped it.
  it("drops the invoice payment line instead of booking it as income", async () => {
    const result = await load();
    const payment = result.entries.find((e) =>
      e.rawDescription.toUpperCase().includes("PAGAMENTO EFETUADO")
    );
    expect(payment).toBeUndefined();
  });

  it("totals the invoice as purchases minus refunds", async () => {
    const result = await load();
    const total = result.entries.reduce((sum, e) => sum + -e.amount, 0);
    expect(total).toBe(29050); // 250,00 + 120,50 − 80,00
  });
});
