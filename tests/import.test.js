import test from "node:test";
import assert from "node:assert/strict";
import {
  inferDateOrder,
  inferExpenseSign,
  readMapping,
} from "../transactions/import.js";

const map = { headerRow: 0, date: 0, merchant: 1, amount: 2, account: "X" };
const file = (rows) => [["Date", "Description", "Amount"], ...rows];

// A fictional US checking export: month first, spending negative.
const us = file([
  ["09/02/2026", "Fictional Grocer", "-$42.17"],
  ["09/05/2026", "Fictional Payroll", "$3,250.00"],
  ["09/09/2026", "Fictional Power Co", "-$118.40"],
  ["09/15/2026", "Fictional Grocer", "-$37.80"],
  ["09/20/2026", "Fictional Streaming", "-$15.99"],
]);

test("date order and the sign of spending are read from the data", () => {
  assert.equal(inferDateOrder(us, map), "MDY");
  assert.equal(inferExpenseSign(us, map), "negative");
  const { batch, unread } = readMapping(
    us,
    { ...map, dateFormat: "MDY", expenseSign: "negative" },
    "us.csv",
  );
  assert.equal(unread.length, 0);
  assert.deepEqual(
    batch.rows.map((r) => [r.date, r.amount]),
    [
      ["2026-09-02", 42.17],
      ["2026-09-05", -3250],
      ["2026-09-09", 118.4],
      ["2026-09-15", 37.8],
      ["2026-09-20", 15.99],
    ],
  );

  const card = file([
    ["15/09/2026", "Fictional Café", "12.00"],
    ["03/09/2026", "Fictional Books", "30.00"],
  ]);
  assert.equal(inferDateOrder(card, map), "DMY");
  assert.equal(inferExpenseSign(card, map), "positive");
  assert.equal(
    inferDateOrder(file([["2026-09-03", "x", "1"]]), map),
    "YMD",
    "a year first settles it",
  );
});

test("dates or signs that could go either way are left for the person", () => {
  const open = file([
    ["03/04/2026", "Fictional Shop", "-5"],
    ["04/05/2026", "Fictional Refund", "5"],
  ]);
  assert.equal(inferDateOrder(open, map), null);
  assert.equal(inferExpenseSign(open, map), null);
  const clash = file([
    ["13/04/2026", "x", "1"],
    ["04/13/2026", "y", "1"],
  ]);
  assert.equal(inferDateOrder(clash, map), null, "the dates disagree");
});

test("rows that can't be read are counted with their reason", () => {
  const m = file([
    ["09/02/2026", "Fictional Grocer", "-$42.17"],
    ["09/15/2026", "Fictional Grocer", "-$37.80"],
    ["Total", "", "-$79.97"],
    ["09/16/2026", "Fictional Note", ""],
    ["09/17/2026", "Fictional Hold", "0.00"],
    ["", "", ""],
  ]);
  // Read the wrong way round, the 15th can't be a month.
  const { batch, unread } = readMapping(
    m,
    { ...map, dateFormat: "DMY", expenseSign: "negative" },
    "us.csv",
  );
  assert.equal(batch.rows.length, 1);
  assert.deepEqual(unread, [
    { row: 2, reason: "date" },
    { row: 3, reason: "date" },
    { row: 4, reason: "date" },
    { row: 5, reason: "date" },
  ]);
  const right = readMapping(
    m,
    { ...map, dateFormat: "MDY", expenseSign: "negative" },
    "us.csv",
  );
  assert.deepEqual(right.unread, [
    { row: 3, reason: "date" },
    { row: 4, reason: "amount" },
    { row: 5, reason: "zero" },
  ]);
});

test("columns are found from what the cells hold, in any language", async () => {
  const { guessColumns } = await import("../transactions/import.js");
  const de = [
    ["Buchungstag", "Verwendungszweck", "Betrag (EUR)", "Saldo"],
    ["02.09.2026", "Fiktive Bäckerei", "-4,20", "1.000,00"],
    ["03.09.2026", "Fiktiver Lohn", "2.500,00", "3.500,00"],
    ["05.09.2026", "Fiktiver Markt", "-38,15", "3.461,85"],
  ];
  assert.deepEqual(guessColumns(de, 0), {
    date: 0,
    merchant: 1,
    amount: 2,
    debit: null,
    credit: null,
    currencyColumn: null,
  });
  const ja = [
    ["メモ", "日付", "通貨", "金額"],
    ["架空のカフェ", "2026/09/02", "JPY", "1,280"],
    ["架空の書店", "2026/09/04", "JPY", "3,300"],
  ];
  assert.deepEqual(guessColumns(ja, 0), {
    date: 1,
    merchant: 0,
    amount: 3,
    debit: null,
    credit: null,
    currencyColumn: 2,
  });
  // Heading words name money out and in, which the cells can't.
  const en = [
    ["Date", "Description", "Debit", "Credit"],
    ["2026-09-02", "Fictional Shop", "12.00", ""],
    ["2026-09-03", "Fictional Employer", "", "900.00"],
  ];
  const g = guessColumns(en, 0);
  assert.deepEqual(
    [g.date, g.merchant, g.debit, g.credit, g.amount],
    [0, 1, 2, 3, null],
  );
});

test("the mapping dialog asks for the currency among the first fields", async () => {
  const { MAP_FIELDS } = await import("../ui/import.js");
  assert.ok(MAP_FIELDS.indexOf("currency") <= 5, MAP_FIELDS.join());
  assert.ok(
    MAP_FIELDS.indexOf("currency") < MAP_FIELDS.indexOf("currencyColumn"),
  );
});

// A fictional statement with money out in euros and money in in dollars.
test("money out and in each keep the currency of the cell that holds them", () => {
  const dc = { headerRow: 0, date: 0, merchant: 1, debit: 2, credit: 3 };
  const rows = (...r) => [["Date", "Description", "Debit", "Credit"], ...r];
  const read = (m, extra = {}) =>
    readMapping(m, { ...dc, ...extra }, "x.csv").batch.rows.map((t) => [
      t.amount,
      t.currency,
    ]);
  const m = rows(
    ["2026-09-17", "Fictional refund", "EUR 0", "USD 35"],
    ["2026-09-18", "Fictional shop", "EUR 20", "USD 0"],
  );
  assert.deepEqual(read(m), [
    [-35, "USD"],
    [20, "EUR"],
  ]);
  // A chosen currency fills only cells that don't say theirs.
  assert.deepEqual(read(m, { currency: "GBP" }), [
    [-35, "USD"],
    [20, "EUR"],
  ]);
  // Both sides filled in different currencies: held back, never netted.
  const both = readMapping(
    rows(["2026-09-19", "Fictional swap", "EUR 20", "USD 35"]),
    dc,
    "x.csv",
  );
  assert.equal(both.batch.rows.length, 0);
  assert.deepEqual(both.unread, [{ row: 1, reason: "mixed" }]);
});
