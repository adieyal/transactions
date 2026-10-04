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
