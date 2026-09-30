import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../state.js";
import { parseAmount, parseDateCell } from "../transactions/parse.js";
import { applyMapping, readMatrix } from "../transactions/import.js";
import { parseRules } from "../transactions/rules.js";
import { deriveTransactions } from "../transactions/derive.js";
import { detectTransfers } from "../transactions/transfers.js";
import { addMonths } from "../helpers.js";

function row(id, date, amount = 100, extra = {}) {
  return {
    id,
    date,
    chargeDate: date,
    period: date.slice(0, 7),
    merchant: "Electric",
    account: "Bank",
    amount,
    details: "",
    ...extra,
  };
}
function stateWith(rows, extra = {}) {
  const { state } = createRuntime();
  return Object.assign(
    state,
    {
      rules: "Bills\n  electric",
      batches: {
        bank: {
          kind: "generic",
          account: "Bank",
          periods: [...new Set(rows.map((r) => r.period))],
          rows,
        },
      },
    },
    extra,
  );
}

test("money parsing preserves currency, decimal separators and refunds", () => {
  for (const [input, amount, currency] of [
    ["₪1,234.56", 1234.56, "ILS"],
    ["€1.234,56", 1234.56, "EUR"],
    ["($42.50)", -42.5, "USD"],
    ["−100", -100, null],
    ["1,25", 1.25, null],
  ]) {
    assert.deepEqual(parseAmount(input), { amount, currency });
  }
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("merchant"), null);
  assert.equal(parseAmount(Infinity), null);
});

test("dates preserve statement ordering and month-end forecast behavior", () => {
  assert.equal(parseDateCell("02/03/26"), "2026-03-02");
  assert.equal(parseDateCell("02/03/26", "MDY"), "2026-02-03");
  assert.equal(parseDateCell(46023), "2026-01-01");
  assert.equal(parseDateCell("not a date"), null);
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
});

test("CSV import preserves quoted merchants, stable occurrence IDs and sign mapping", async () => {
  const text =
    'date,merchant,amount\n01/09/2026,"Shop, Ltd",-42.50\n01/09/2026,"Shop, Ltd",-42.50';
  const matrix = (
    await readMatrix({
      name: "bank.csv",
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    })
  ).matrix;
  const map = {
    headerRow: 0,
    date: 0,
    merchant: 1,
    amount: 2,
    expenseSign: "negative",
    account: "Bank",
  };
  const a = applyMapping(matrix, map, "bank.csv"),
    b = applyMapping(matrix, map, "bank.csv");
  assert.deepEqual(a, b);
  assert.equal(a.rows[0].merchant, "Shop, Ltd");
  assert.equal(a.rows[0].amount, 42.5);
  assert.notEqual(a.rows[0].id, a.rows[1].id);
});

test("rules retain budgets, tag matching, regex errors and duplicate-thread merging", () => {
  const rules = parseRules(
    "Pets [budget 200/month]\n  #pets\nPets\n  vet\nBroken\n  /[/",
  );
  assert.equal(rules.threads[0].budget, 200);
  assert.equal(rules.threads[0].patterns.length, 2);
  assert.ok(
    rules.threads[0].patterns[0].test({
      noteLower: "#pets",
      raw: "",
      norm: "",
    }),
  );
  assert.equal(Object.keys(rules.errors).length, 2);
});

test("derivation deduplicates imports, applies aliases and notes, and leaves source data intact", () => {
  const rows = [row("a", "2026-08-01"), row("b", "2026-09-01", 110)];
  const state = stateWith(rows, {
    notes: { a: "#home" },
    names: { electric: { name: "Power" } },
    periods: [{ name: "Trip", start: "2026-08-01", end: "2026-08-31" }],
  });
  state.batches.duplicate = structuredClone(state.batches.bank);
  const before = structuredClone(state);
  const result = deriveTransactions(state, { today: "2026-09-30" });
  assert.deepEqual(state, before);
  assert.equal(result.allTxns.length, 2);
  assert.equal(result.allTxns[0].merchant, "Power");
  assert.equal(result.allTxns[0].original, "Electric");
  assert.equal(result.allTxns[0].thread, "Bills");
  assert.deepEqual(result.allTxns[0].periods, ["Trip"]);
  assert.deepEqual(
    result.expected.map((t) => t.date),
    ["2026-10-01", "2026-11-01", "2026-12-01"],
  );
  assert.equal(result.flags[0].type, "price");
  state.query = "#home";
  assert.equal(
    deriveTransactions(state, { today: "2026-09-30" }).txns.length,
    1,
  );
  state.hiddenAccounts.add("Bank");
  assert.equal(
    deriveTransactions(state, { today: "2026-09-30" }).allTxns.length,
    0,
  );
});

test("instalments infer missing payments and retain purchase amount", () => {
  const state = stateWith([
    row("a", "2026-08-10", 50, {
      inst: { n: 1, of: 4 },
      orig: { amount: 200, currency: "ILS" },
    }),
  ]);
  const result = deriveTransactions(state, { today: "2026-09-30" });
  assert.equal(result.extras.find((t) => t.kind === "purchase").amount, 200);
  assert.equal(
    result.extras.find((t) => t.kind === "inferred").date,
    "2026-09-10",
  );
  assert.deepEqual(
    result.expected.map((t) => t.date),
    ["2026-10-10", "2026-11-10"],
  );
});

test("transfers pair accounts, match card statement payments and respect overrides", () => {
  const rows = [
    row("out", "2026-09-03", 100),
    row("in", "2026-09-04", -100, { account: "Savings" }),
  ];
  const input = { batches: {}, transferOv: {} };
  assert.equal(detectTransfers(rows, input).info.out.other, "in");
  assert.equal(
    detectTransfers(rows, { ...input, transferOv: { out: false } }).info.in,
    undefined,
  );
  assert.equal(
    detectTransfers(rows, { ...input, transferOv: { out: true, in: false } })
      .info.out.kind,
    "manual",
  );
  const card = {
    kind: "leumi",
    account: "Card",
    periods: ["2026-09"],
    rows: [row("charge", "2026-09-01", 300, { account: "Card" })],
  };
  const result = detectTransfers([row("payment", "2026-09-10", 300)], {
    batches: { card },
    transferOv: {},
  });
  assert.equal(result.info.payment.kind, "card");
  assert.equal(result.paid["Card|2026-09"], "payment");
});
