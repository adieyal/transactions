import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { yearStory } from "../story/year.js";
import { withCurrency } from "../helpers.js";

// Amounts are told in the statement's currency.
const test = (title, fn) => nodeTest(title, () => withCurrency("ILS", fn));
import {
  cadenceClause,
  groupClause,
  oneOffSentence,
  periodComparison,
  trendSentence,
} from "../story/year-quiet.js";

const words = (parts) =>
  (parts ?? [])
    .map((p) => p.chip ?? p.text)
    .join("")
    .replace(/[⁨⁩]/g, "");

// A fixture of nine months, December to August, shaped like the drawn year:
// Harbor Pantry four times a month, Bills from three merchants that drop in
// June because of Brightwell Energy, and one payment to Florentine Flowers.
const MONTHS = [
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
];
function fixture({ pantry = [100, 105, 98, 107], brightwell } = {}) {
  let n = 0;
  const txns = [];
  const add = (month, d, merchant, amount, thread) =>
    txns.push({
      id: `t${++n}`,
      date: `${month}-${String(d).padStart(2, "0")}`,
      merchant,
      amount,
      thread,
    });
  MONTHS.forEach((m, i) => {
    pantry.forEach((a, w) =>
      add(m, 4 + w * 7, "Harbor Pantry", a, "Groceries"),
    );
    const late = i >= 6;
    add(
      m,
      3,
      "Brightwell Energy",
      brightwell?.[i] ?? (late ? 130 : 190),
      "Bills",
    );
    add(m, 5, "Willow Water", 42, "Bills");
    add(m, 7, "Cloudfern Internet", 65, "Bills");
  });
  add("2026-02", 14, "Florentine Flowers", 85, undefined);
  const byMonth = new Map(MONTHS.map((m) => [m, []]));
  for (const t of txns) byMonth.get(t.date.slice(0, 7)).push(t);
  const ctx = {
    byMonth,
    months: MONTHS,
    typical: 900,
    threads: new Set(["Groceries", "Bills"]),
  };
  return { txns, byMonth, ctx };
}
const lit = ({ txns }, parts) => {
  const known = new Set(txns.map((t) => t.id));
  for (const p of parts)
    for (const id of p.txnIds ?? []) assert.ok(known.has(id), p.text);
};

test("a merchant paid about once a week is told with its monthly amount", () => {
  const f = fixture();
  const c = cadenceClause(["2026-01", "2026-02"], f.ctx);
  assert.equal(
    words(c.parts),
    "You went to Harbor Pantry about once a week, roughly ₪410 a month",
  );
  assert.equal(c.thread, "Groceries");
  assert.equal(c.parts[1].txnIds.length, 8);
  lit(f, c.parts);
});

test("cadence needs two months, steady counts and two to five a month", () => {
  const f = fixture();
  assert.equal(cadenceClause(["2026-01"], f.ctx), null);
  // Twice in one month and four times in the next: counts differ by two.
  f.byMonth.set(
    "2026-01",
    f.byMonth
      .get("2026-01")
      .filter((t, i) => t.merchant !== "Harbor Pantry" || i < 2),
  );
  const c = cadenceClause(["2026-01", "2026-02"], f.ctx);
  assert.ok(!c || !words(c.parts).includes("Harbor Pantry"));
});

test("an unsteady monthly amount leaves the amount out", () => {
  const f = fixture();
  f.byMonth.get("2026-02").find((t) => t.merchant === "Harbor Pantry").amount =
    400;
  const c = cadenceClause(["2026-01", "2026-02"], f.ctx);
  assert.equal(words(c.parts), "You went to Harbor Pantry about once a week");
});

test("a steady thread of several merchants is told as one total", () => {
  const f = fixture();
  const g = groupClause(["2026-01", "2026-02"], f.ctx, "Groceries");
  assert.equal(words(g), "Bills came to around ₪295 a month");
  lit(f, g);
  // The cadence's own thread is not told again, and one merchant is no group.
  assert.equal(groupClause(["2026-01", "2026-02"], f.ctx, "Bills"), null);
});

test("an unsteady thread total is not told", () => {
  const f = fixture({
    brightwell: [190, 400, 190, 190, 190, 190, 130, 130, 130],
  });
  assert.equal(groupClause(["2026-01", "2026-02"], f.ctx, "Groceries"), null);
});

test("a merchant paid once in all the statements is told as a one-off", () => {
  const f = fixture();
  const s = oneOffSentence(["2026-02", "2026-03"], f.ctx, f.txns, null);
  assert.equal(
    words(s),
    "On 14 February there’s one payment to Florentine Flowers, ₪85, the only one this year.",
  );
  lit(f, s);
  // Too small against a typical month, or the run's largest payment.
  assert.equal(
    oneOffSentence(["2026-02"], { ...f.ctx, typical: 2000 }, f.txns, null),
    null,
  );
  const big = f.txns.find((t) => t.merchant === "Florentine Flowers");
  assert.equal(oneOffSentence(["2026-02"], f.ctx, f.txns, big), null);
});

test("a merchant seen twice is no one-off, and a longer span says so", () => {
  const f = fixture();
  const again = { ...f.txns.at(-1), id: "again", date: "2026-05-01" };
  assert.equal(
    oneOffSentence(["2026-02"], f.ctx, [...f.txns, again], null),
    null,
  );
  const long = { ...f.ctx, months: [...MONTHS, "a", "b", "c", "d"] };
  assert.match(
    words(oneOffSentence(["2026-02"], long, f.txns, null)),
    /the only one in these 13 months\.$/,
  );
});

test("a thread lower since a month is told with its main cause", () => {
  const f = fixture();
  const s = trendSentence(f.ctx);
  assert.equal(
    words(s),
    "Bills have been lower since June, ₪237 a month, against ₪297 from December to May, mostly because of Brightwell Energy.",
  );
  lit(f, s);
  assert.equal(s.at(-2).txnIds.length, 9);
});

test("a trend needs three months each side and a tenth of a change", () => {
  // Lower only in the last two months.
  const two = fixture({
    brightwell: [190, 190, 190, 190, 190, 190, 190, 130, 130],
  });
  assert.equal(trendSentence(two.ctx), null);
  // Lower by ₪10 on ₪297: under a tenth.
  const small = fixture({
    brightwell: [190, 190, 190, 190, 190, 190, 180, 180, 180],
  });
  assert.equal(trendSentence(small.ctx), null);
  // One month back up breaks "since June".
  const broken = fixture({
    brightwell: [190, 190, 190, 190, 190, 190, 130, 195, 130],
  });
  assert.equal(trendSentence(broken.ctx), null);
});

test("no main cause is named when no merchant carries half the change", () => {
  const f = fixture({
    brightwell: [190, 190, 190, 190, 190, 190, 170, 170, 170],
  });
  // Each of the three bills drops by ₪20: a third of the change each.
  for (const m of MONTHS.slice(6)) {
    f.byMonth.get(m).find((t) => t.merchant === "Willow Water").amount = 22;
    f.byMonth.get(m).find((t) => t.merchant === "Cloudfern Internet").amount =
      45;
  }
  assert.equal(
    words(trendSentence(f.ctx)),
    "Bills have been lower since June, ₪237 a month, against ₪297 from December to May.",
  );
});

test("a merchant in a period's month is compared with other months", () => {
  const f = fixture();
  // In April, Harbor Pantry came to ₪201 in two payments.
  f.byMonth.set(
    "2026-04",
    f.byMonth
      .get("2026-04")
      .filter((t) => t.merchant !== "Harbor Pantry")
      .concat([
        {
          id: "a1",
          date: "2026-04-04",
          merchant: "Harbor Pantry",
          amount: 101,
        },
        {
          id: "a2",
          date: "2026-04-26",
          merchant: "Harbor Pantry",
          amount: 100,
        },
      ]),
  );
  assert.equal(
    words(periodComparison("2026-04", f.ctx)),
    "Harbor Pantry came to ₪201 that month, against about ₪410 in other months.",
  );
  // A usual month says nothing.
  assert.equal(periodComparison("2026-03", f.ctx), null);
  // Paid in only two other months is no baseline.
  const few = { ...f.ctx, months: ["2026-02", "2026-03", "2026-04"] };
  assert.equal(periodComparison("2026-04", few), null);
});

test("the demo year tells the facts its data supports, and no others", () => {
  const today = "2026-09-30";
  const demo = { ...createRuntime().state, ...createDemoData(today) };
  const derived = deriveTransactions(demo, { today });
  const y = yearStory(derived, demo, today);
  const text = y.sections
    .flatMap((s) => [...s.paragraphs, s.after ?? []])
    .map(words);
  assert.ok(
    text.some((t) =>
      t.startsWith(
        "You went to Harbor Pantry about twice a month, roughly ₪220 a month, Bills came to around ₪250 a month, and ₪150 went into Demo Savings on the 24th of each month.",
      ),
    ),
  );
  assert.ok(
    text.some((t) =>
      t.includes(
        "On 14 June there’s one payment to Oak & Loom, ₪60, the only one this year.",
      ),
    ),
  );
  assert.ok(
    text.some((t) =>
      t.includes(
        "Meadow Paws came to ₪95 that month, against about ₪55 in other months.",
      ),
    ),
  );
  // The demo's bills don't change level, so no trend is told.
  assert.ok(!text.some((t) => /have been (lower|higher) since/.test(t)));
  assert.ok(!text.some((t) => t.includes("..")));
  for (const s of y.sections)
    for (const p of [...s.paragraphs, s.after ?? []].flat())
      for (const id of p.txnIds ?? [])
        assert.ok(
          derived.byId.has(id) || y.expected.some((e) => e.id === id),
          p.text,
        );
});
