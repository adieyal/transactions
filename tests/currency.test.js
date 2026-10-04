import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { detectMoments } from "../story/moments.js";
import {
  sectionText,
  summarizeMonth,
  summarizePeriod,
  summarizeThread,
  summaryMonths,
} from "../story/summary.js";
import { momentFact, questionText } from "../story/copy.js";
import {
  applyMapping,
  csvMatrix,
  decodeText,
  detectCurrency,
} from "../transactions/import.js";
import { periodStats } from "../transactions/period-stats.js";
import { loadDocuments, needsCurrency, setCurrency } from "../documents.js";
import { batchDocuments, createBackup, parseBackup } from "../backup.js";
import { lensFmt, lensLib } from "../lens-api.js";
import { totals } from "../assistant/tools.js";
import { fmtByCurrency } from "../helpers.js";
import { TODAY, eurGbpWorkspace, usdWorkspace } from "./fixtures/currencies.js";

function workspace(data) {
  const { state } = createRuntime();
  Object.assign(state, data);
  return state;
}
const derive = (state) => deriveTransactions(state, { today: TODAY });
const SYMBOLS = /[₪$€£¥]/g;
const symbolsIn = (s) => new Set(s.match(SYMBOLS) || []);

test("a dollar workspace is told in dollars, never in shekels", () => {
  const state = workspace(usdWorkspace());
  const derived = derive(state);
  assert.ok(derived.allTxns.every((t) => t.currency === "USD"));
  const month = summaryMonths(derived).at(-1);
  const all = summarizeMonth(derived, state, month).map(sectionText).join(" ");
  assert.match(all, /\$\d/);
  assert.deepEqual([...symbolsIn(all)], ["$"]);
  const moments = detectMoments(derived, state);
  assert.ok(moments.length > 0);
  for (const m of moments) {
    assert.equal(m.currency, "USD");
    assert.doesNotMatch(momentFact(m) + questionText(m), /[₪€£]/);
  }
  const trip = state.periods.find((p) => p.id === "demo-trip");
  const told = summarizePeriod(derived, state, trip).map(sectionText).join(" ");
  assert.deepEqual([...symbolsIn(told)], ["$"]);
});

test("euros and pounds are told separately, never added or compared", () => {
  const state = workspace(eurGbpWorkspace());
  const derived = derive(state);
  const month = summaryMonths(derived).at(-1);
  const sections = summarizeMonth(derived, state, month);
  assert.equal(sections[0].kind, "currencies");
  assert.match(sectionText(sections[0]), /EUR and GBP/);
  assert.deepEqual(
    sections.filter((s) => s.kind === "heading").map(sectionText),
    ["EUR", "GBP"],
  );
  // Every other section holds one currency's money only.
  for (const s of sections.slice(1).filter((s) => s.kind !== "heading")) {
    const symbols = symbolsIn(sectionText(s));
    assert.ok(symbols.size <= 1, sectionText(s));
    if (symbols.size)
      assert.equal([...symbols][0], s.currency === "EUR" ? "€" : "£");
  }
  // Each overview's total is that currency's own spending.
  for (const cur of ["EUR", "GBP"]) {
    const overview = sections.find(
      (s) => s.kind === "overview" && s.currency === cur,
    );
    const ids = overview.parts.find((p) => p.txnIds)?.txnIds || [];
    assert.ok(ids.every((id) => derived.byId.get(id).currency === cur));
  }
  // Moments look at one currency at a time.
  for (const m of detectMoments(derived, state))
    assert.ok(
      m.txnIds.every((id) => derived.byId.get(id)?.currency === m.currency),
      m.id,
    );
  // Threads, period stats, lenses and the assistant keep currencies apart.
  const both = derived.names.find(
    (n) =>
      new Set(
        derived.allTxns.filter((t) => t.thread === n).map((t) => t.currency),
      ).size === 2,
  );
  assert.ok(both, "a thread with charges in both currencies");
  const thread = summarizeThread(derived, state, both);
  assert.deepEqual(
    thread.strips.map((s) => s.currency),
    ["EUR", "GBP"],
  );
  assert.equal(thread.sections[0].kind, "currencies");
  const trip = state.periods.find((p) => p.id === "demo-trip");
  const st = periodStats(derived.allTxns, trip);
  assert.ok(st.sums.length >= 1 && st.sums.every(([c]) => /EUR|GBP/.test(c)));
  assert.ok(
    totals(derived, { group_by: "thread" }).every((x) =>
      ["EUR", "GBP"].includes(x.currency),
    ),
  );
  assert.equal(
    fmtByCurrency([
      { amount: 12, currency: "GBP" },
      { amount: 3.5, currency: "EUR" },
    ]),
    "€3.50 · £12.00",
  );
  const lib = lensLib(derived, state, TODAY);
  assert.deepEqual(lib.currencies, ["EUR", "GBP"]);
  assert.equal(lib.fmt(1234, "GBP"), "£1,234");
  assert.throws(() => lib.fmt(5), /Say which currency/);
  assert.equal(lensFmt(5, undefined, ["USD"]), "$5.00");
});

test("a file that doesn't show its currency is never given one", async () => {
  const text = decodeText(
    await readFile(new URL("./fixtures/unknown-currency.csv", import.meta.url)),
  );
  const matrix = csvMatrix(text);
  const map = { headerRow: 0, date: 0, merchant: 1, amount: 2, account: "X" };
  assert.equal(detectCurrency(matrix, map), null);
  assert.equal(applyMapping(matrix, map, "unknown.csv").rows.length, 0);
  const told = applyMapping(matrix, { ...map, currency: "CAD" }, "unknown.csv");
  assert.equal(told.currency, "CAD");
  assert.equal(told.rows.length, 3);
  assert.ok(told.rows.every((r) => r.currency === "CAD"));
});

test("currency is detected from headings, symbols, codes and a currency column", () => {
  const map = { headerRow: 0, date: 0, merchant: 1, amount: 2 };
  const rows = (cells) => [
    ["Date", "Description", "Amount"],
    ...cells.map((c) => ["02/09/2026", "Fictional Shop", c]),
  ];
  assert.equal(detectCurrency(rows(["£3.00", "£4.50"]), map), "GBP");
  assert.equal(detectCurrency(rows(["3.00 EUR"]), map), "EUR");
  assert.equal(detectCurrency(rows(["¥500"]), map), "JPY");
  assert.equal(detectCurrency(rows(["$3", "€4"]), map), null, "two currencies");
  assert.equal(
    detectCurrency(
      [
        ["Date", "Description", "Amount (CHF)"],
        ["02/09/2026", "x", "3"],
      ],
      map,
    ),
    "CHF",
  );
  const mixed = [
    ["Date", "Description", "Amount", "Currency"],
    ["02/09/2026", "Fictional Café", "3.00", "EUR"],
    ["03/09/2026", "Fictional Pub", "4.00", "GBP"],
  ];
  const b = applyMapping(mixed, { ...map, currencyColumn: 3 }, "mixed.csv");
  assert.deepEqual(
    b.rows.map((r) => r.currency),
    ["EUR", "GBP"],
  );
  assert.equal(b.currency, null, "a batch in two currencies names neither");
});

test("heading words are never read as currency codes", () => {
  const map = { headerRow: 0, date: 0, merchant: 1, amount: 2 };
  const head = (h) =>
    detectCurrency(
      [
        ["Date", "Description", h],
        ["2026-09-02", "Fictional Shop", "3"],
      ],
      map,
    );
  for (const h of ["Top-up amount", "Cup amount", "Try amount", "Amount"])
    assert.equal(head(h), null, h);
  assert.equal(head("Amount (USD)"), "USD");
  assert.equal(head("Betrag EUR"), "EUR");
  assert.equal(head("Amount (€)"), "EUR");
});

test("an amount cell's own currency wins over the one chosen for the file", () => {
  const map = { headerRow: 0, date: 0, merchant: 1, amount: 2, account: "X" };
  const m = [
    ["Date", "Description", "Amount"],
    ["2026-09-02", "Fictional Diner", "USD 12.50"],
    ["2026-09-04", "Fictional Inn", "EUR 90.00"],
    ["2026-09-05", "Fictional Kiosk", "7.00"],
  ];
  assert.equal(detectCurrency(m, map), null);
  const b = applyMapping(m, { ...map, currency: "USD" }, "mixed.csv");
  assert.deepEqual(
    b.rows.map((r) => [r.amount, r.currency]),
    [
      [12.5, "USD"],
      [90, "EUR"],
      [7, "USD"],
    ],
  );
});

test("old statements take their format's currency, and others wait to be asked", () => {
  const rows = (id) => [
    {
      id,
      account: "Fictional",
      period: "2026-09",
      date: "2026-09-02",
      chargeDate: "2026-09-02",
      merchant: "Fictional Shop",
      amount: 10,
    },
  ];
  const old = (batch) => {
    const docs = structuredClone(batchDocuments(batch));
    for (const d of Object.values(docs)) delete d.currency;
    for (const d of Object.values(docs))
      d.rows.forEach((r) => delete r.currency);
    return docs;
  };
  const leumi = {
    id: "a",
    kind: "leumi",
    account: "Card",
    periods: ["2026-09"],
    file: "a.html",
    added: TODAY,
    rows: rows("ra"),
  };
  const generic = {
    id: "b",
    kind: "generic",
    account: "Bank",
    periods: ["2026-09"],
    file: "b.csv",
    added: TODAY,
    rows: rows("rb"),
  };
  const { state } = createRuntime();
  loadDocuments({ ...old(leumi), ...old(generic) }, state);
  assert.equal(state.batches.a.currency, "ILS");
  assert.equal(state.batches.a.rows[0].currency, "ILS");
  assert.deepEqual(
    needsCurrency(state).map((b) => b.id),
    ["b"],
  );
  const before = derive(state);
  assert.equal(before.unpriced, 1);
  assert.ok(!before.byId.has("rb"), "no amount is shown in a guessed currency");
  setCurrency(state.batches.b, "NZD");
  assert.deepEqual(needsCurrency(state), []);
  assert.equal(derive(state).byId.get("rb").currency, "NZD");
});

test("an old statement's default ILS original amount is dropped, a named one kept", () => {
  const row = (id, orig) => ({
    id,
    account: "Fictional",
    period: "2026-09",
    date: "2026-09-02",
    chargeDate: "2026-09-02",
    merchant: "Fictional Shop",
    amount: 41.2,
    orig,
  });
  const generic = {
    id: "g",
    kind: "generic",
    account: "Bank",
    periods: ["2026-09"],
    file: "g.csv",
    added: TODAY,
    rows: [
      row("r1", { amount: 41.2, currency: "ILS" }),
      row("r2", { amount: 38, currency: "GBP" }),
    ],
  };
  const leumi = {
    ...generic,
    id: "l",
    kind: "leumi",
    file: "l.html",
    rows: [row("r3", { amount: 41.2, currency: "ILS" })],
  };
  const docs = structuredClone({
    ...batchDocuments(generic),
    ...batchDocuments(leumi),
  });
  const { state } = createRuntime();
  loadDocuments(docs, state);
  const g = state.batches.g.rows;
  assert.equal(g[0].orig, null, "main's default says nothing");
  assert.deepEqual(g[1].orig, { amount: 38, currency: "GBP" });
  assert.deepEqual(state.batches.l.rows[0].orig, {
    amount: 41.2,
    currency: "ILS",
  });
  setCurrency(state.batches.g, "USD");
  assert.equal(state.batches.g.rows[0].orig, null);
});

test("backups keep each statement's currency and reject an unknown code", () => {
  const state = workspace(eurGbpWorkspace());
  const backup = createBackup(state, TODAY);
  const back = parseBackup(JSON.stringify(backup), TODAY);
  const currencies = Object.values(back.batches).map((b) => b.currency);
  assert.deepEqual([...new Set(currencies)].sort(), ["EUR", "GBP"]);
  backup.batches[0].currency = "XYZ";
  assert.throws(() => parseBackup(JSON.stringify(backup), TODAY), /currency/);
});

test("statements waiting for a currency are named as the cause, not shown as empty", async () => {
  const { waitingForCurrency, sectionsPerCurrency } =
    await import("../story/currency.js");
  assert.match(waitingForCurrency(1), /^1 transaction is saved .* currency/);
  assert.match(waitingForCurrency(161), /^161 transactions are saved/);
  const [empty] = sectionsPerCurrency(
    { allTxns: [], txns: [], unpriced: 3 },
    [],
    () => [],
  );
  assert.match(empty.parts[0].text, /waiting for their currency/);
});

test("original amounts keep their currency's own decimals", async () => {
  const { fmtExact } = await import("../helpers.js");
  assert.equal(fmtExact(1280, "JPY"), "¥1,280");
  assert.equal(fmtExact(41.2, "USD"), "$41.20");
  assert.equal(fmtExact(1234.5, "EUR"), "€1,234.50");
  assert.match(fmtExact(12.345, "BHD"), /BHD\s12\.345$/);
});
