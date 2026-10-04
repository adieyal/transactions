import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../state.js";
import { parseAmount, parseDateCell } from "../transactions/parse.js";
import {
  applyMapping,
  csvMatrix,
  decodeText,
  guessHeaderRow,
  parseLeumiRows,
  sigOf,
  tableMatrix,
} from "../transactions/import.js";
import { readMatrix } from "../files.js";
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
    currency: "EUR",
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
    currency: "EUR",
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
      orig: { amount: 200, currency: "EUR" },
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
    currency: "EUR",
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

// A fictional Leumi card page, as files.js reads it into table rows.
const LEUMI = [
  {
    nested: true,
    text: "פרוט עסקאות לכרטיס כרטיס בדוי 4821 לתקופה: ספטמבר 2026",
  },
  { cells: ["עסקאות בארץ"] },
  {
    cells: [
      "תאריך העסקה",
      "שם בית העסק",
      "סכום העסקה",
      "סוג העסקה",
      "פרטים",
      "סכום חיוב",
    ],
  },
  { cells: ["03/08/26", "מאפיית הגבעה", "42.50 ₪", "רגילה", "", "42.50 ₪"] },
  {
    cells: [
      "05/06/26",
      "רהיטי האלון",
      "1,200.00 ₪",
      "תשלומים",
      "תשלום 3 מתוך 6",
      "200.00 ₪",
    ],
  },
  { cells: ["", 'סה"כ', "", "", "", "242.50 ₪"] },
];

test("a Leumi card page parses from its table rows, without a browser", () => {
  const batch = parseLeumiRows(LEUMI, "leumi.html");
  assert.equal(batch.kind, "leumi");
  assert.equal(batch.account, "כרטיס בדוי 4821");
  assert.deepEqual(batch.periods, ["2026-09"]);
  assert.equal(batch.rows.length, 2);
  const [bread, desk] = batch.rows;
  assert.deepEqual(
    [bread.date, bread.merchant, bread.amount, bread.section],
    ["2026-08-03", "מאפיית הגבעה", 42.5, "עסקאות בארץ"],
  );
  assert.deepEqual(desk.inst, { n: 3, of: 6 });
  assert.equal(desk.chargeDate, "2026-09-10");
  assert.equal(parseLeumiRows([{ cells: ["a", "b"] }], "x.html"), null);
});

test("generic tables, CSV text and header guessing work without a browser", () => {
  assert.deepEqual(
    tableMatrix([
      { nested: true, text: "wrapper" },
      { cells: ["date", "merchant", "amount"] },
      { cells: ["", "", ""] },
      { cells: ["2026-09-01", "Shop", "10"] },
    ]),
    [
      ["date", "merchant", "amount"],
      ["2026-09-01", "Shop", "10"],
    ],
  );
  const bytes = new TextEncoder().encode('﻿a;b\n"x;y";2\n');
  const m = csvMatrix(decodeText(bytes));
  assert.deepEqual(m, [
    ["a", "b"],
    ["x;y", "2"],
  ]);
  assert.equal(sigOf(m[0]), "a|b");
  assert.equal(typeof guessHeaderRow(m), "number");
});

test("SheetJS loads on demand, pinned and hash-checked, and a failed load says so", async () => {
  const { SHEETJS, SHEETJS_UNAVAILABLE, loadSheetJS } =
    await import("../files.js");
  assert.match(SHEETJS.src, /\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js$/);
  assert.match(SHEETJS.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  // A fake page: the script tag is checked, then its load succeeds or fails.
  const page = (outcome) => {
    const added = [];
    const win = {};
    const doc = {
      createElement: () => ({ remove() {} }),
      head: {
        append(script) {
          added.push(script);
          queueMicrotask(() => {
            if (outcome === "ok") win.XLSX = { read() {} };
            (outcome === "ok" ? script.onload : script.onerror)();
          });
        },
      },
    };
    return { added, win, doc };
  };
  const failing = page("blocked");
  await assert.rejects(loadSheetJS(failing.doc, failing.win), (e) => {
    assert.equal(e.message, SHEETJS_UNAVAILABLE);
    assert.equal(e.code, "sheet-reader");
    return true;
  });
  const [tag] = failing.added;
  assert.deepEqual(
    [tag.src, tag.integrity, tag.crossOrigin],
    [SHEETJS.src, SHEETJS.integrity, "anonymous"],
  );
  // After a failure it tries again, and a loaded reader is reused.
  const ok = page("ok");
  const XLSX = await loadSheetJS(ok.doc, ok.win);
  assert.equal(XLSX, ok.win.XLSX);
  assert.equal(await loadSheetJS(ok.doc, ok.win), XLSX);
  assert.equal(ok.added.length, 1);
});

test("price changes and stopped charges reach the questions, not markers on the timeline", async () => {
  const { createDemoData } = await import("../demo.js");
  const { createRuntime } = await import("../state.js");
  const { state } = createRuntime();
  Object.assign(state, createDemoData("2026-09-30"));
  const derived = deriveTransactions(state, { today: "2026-09-30" });
  // findChanges still flags them, for story/moments.js to turn into questions…
  assert.ok(derived.flags.some((f) => f.type === "price"));
  // …but nothing marks beads with ▲, ▼ or ◌ any more.
  assert.equal(derived.flagged, undefined);
  const { readFileSync } = await import("node:fs");
  for (const file of ["ui/timeline.js", "ui/timeline-layout.js"])
    assert.doesNotMatch(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      /flagmark|[▲▼◌]/,
      file,
    );
});
