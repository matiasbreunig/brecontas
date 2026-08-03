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

describe("parseFile — identidade das linhas (deduplicação)", () => {
  const csv = (rows: string[]) => ["data,lançamento,valor", ...rows].join("\n");

  it("keeps two genuinely identical movements apart", async () => {
    // Two R$ 5,00 bus fares on the same day are two fares, not a duplicate.
    // Hashing only (date, amount, text) merged them and silently dropped one.
    const result = await parseFile(
      csv(['2026-07-15,PASSAGEM ONIBUS,"5,00"', '2026-07-15,PASSAGEM ONIBUS,"5,00"']),
      "fatura.csv"
    );

    expect(result.entries).toHaveLength(2);
    const hashes = result.entries.map((e) => (e as { hash: string }).hash);
    expect(new Set(hashes).size).toBe(2);
  });

  it("gives the same file the same hashes, so a re-import is still a duplicate", async () => {
    const content = csv(['2026-07-15,PASSAGEM ONIBUS,"5,00"', '2026-07-15,PASSAGEM ONIBUS,"5,00"']);
    const first = await parseFile(content, "fatura.csv");
    const second = await parseFile(content, "fatura.csv");

    expect(second.entries.map((e) => (e as { hash: string }).hash)).toEqual(
      first.entries.map((e) => (e as { hash: string }).hash)
    );
  });

  it("skips a footer row instead of losing the whole file", async () => {
    // "Total" is not a date: reaching padStart on undefined used to throw and
    // take every line down with it.
    const result = await parseFile(
      csv(['2026-07-15,SUPERMERCADO ABC,"250,00"', 'Total,Saldo final,"250,00"']),
      "fatura.csv"
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].rawDescription).toContain("SUPERMERCADO");
  });
});

describe("parseFile — OFX de cartão", () => {
  // A spec-compliant card statement has <CCACCTFROM>, which carries no
  // <ACCTTYPE> — so keying on ACCTTYPE alone filed every card OFX as a bank
  // statement and skipped the invoice pipeline entirely.
  const cardOfx = `OFXHEADER:100
DATA:OFXSGML
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM><ACCTID>1234567890123456</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260715<TRNAMT>-250.00<FITID>ABC123<MEMO>SUPERMERCADO ABC</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

  it("is detected as a card invoice", async () => {
    const result = await parseFile(cardOfx, "fatura.ofx");
    expect(result.mode).toBe("card_invoice");
  });

  it("uses the FITID as the line's identity", async () => {
    const a = await parseFile(cardOfx, "fatura.ofx");
    const b = await parseFile(cardOfx, "fatura.ofx");
    expect((a.entries[0] as { hash: string }).hash).toBe(
      (b.entries[0] as { hash: string }).hash
    );
    expect(a.entries[0].externalId).toBe("ABC123");
  });
});
