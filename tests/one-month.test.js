import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { coveredMonths } from "../story/moment-kit.js";
import { monthAxis, oneMonthStory, periodStrip } from "../story/one-month.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const month = coveredMonths(derived).at(-1);
const story = oneMonthStory(derived, demo, month);
const words = (parts) => parts.map((p) => p.text).join("");

test("the day axis names each day's weekday", () => {
  const axis = monthAxis("2026-09");
  assert.equal(axis.length, 30);
  assert.deepEqual(axis[0], { day: 1, weekday: "T" });
  assert.deepEqual(axis[5], { day: 6, weekday: "S" });
});

test("one month's story says only what one month can say", () => {
  const text = [story.lead, ...story.paragraphs].map(words).join(" ");
  assert.match(text, /went out in August, in \d+ payments\./);
  assert.match(text, /was the busiest/);
  assert.match(text, /The largest single payment was/);
  for (const w of [
    "typical",
    "usual",
    "regular",
    "every month",
    "again",
    "new",
  ])
    assert.ok(!text.includes(w), `"${w}" needs more than one month`);
});

test("every dotted phrase lights up payments from that month", () => {
  const ids = new Set(story.rows.flatMap((r) => r.beads.map((b) => b.id)));
  for (const p of [story.lead, ...story.paragraphs].flat())
    for (const id of p.txnIds || []) {
      assert.equal(derived.byId.get(id).date.slice(0, 7), month);
      assert.ok(ids.has(id) || derived.byId.get(id).transfer);
    }
});

test("rows follow the real threads and their colours", () => {
  for (const r of story.rows) assert.equal(r.color, derived.colorOf[r.thread]);
  assert.ok(story.rows.some((r) => r.starter));
});

test("the maybe-regular question is asked only with one or two months", () => {
  assert.equal(story.question, null);
  const one = Object.fromEntries(
    Object.entries(demo.batches).filter(([, b]) =>
      JSON.stringify(b).includes(month),
    ),
  );
  const state = { ...demo, batches: one };
  const d = deriveTransactions(state, { today });
  const s = oneMonthStory(d, state, coveredMonths(d).at(-1));
  assert.match(s.question.text, /Is it something you pay every month\?$/);
  assert.equal(s.source[0], "Your first statements");
});

// Only one month of statements: Sam's April, without the periods.
function onlyMonth(m, periods = []) {
  const batches = Object.fromEntries(
    Object.entries(demo.batches)
      .map(([k, b]) => [
        k,
        { ...b, rows: b.rows.filter((r) => r.date.startsWith(m)) },
      ])
      .filter(([, b]) => b.rows.length),
  );
  const state = { ...demo, batches, periods };
  return [deriveTransactions(state, { today }), state];
}

test("with one month, a busy stretch is 3+ payments in 7 days over a third of the month", () => {
  const [d, s] = onlyMonth("2026-04");
  const { stretches, periods, days } = periodStrip(d, s, "2026-04");
  assert.equal(days, 30);
  assert.deepEqual(periods, []);
  assert.equal(stretches.length, 1);
  const [b] = stretches;
  assert.equal(b.label, "₪2,520 · 9–16 Apr");
  assert.equal(b.aria, "A busy stretch, 9 to 16 April, not named yet");
  const paid = d.allTxns.filter((t) => b.txnIds.includes(t.id));
  const spent = d.allTxns
    .filter((t) => t.amount > 0 && !t.transfer && !t.inflow)
    .reduce((a, t) => a + t.amount, 0);
  assert.ok(paid.length >= 3);
  assert.ok(paid.reduce((a, t) => a + t.amount, 0) > spent / 3);
});

test("the strip shows the person's periods clipped to the month, and no stretch inside them", () => {
  const p = {
    id: "p1",
    name: "Moving",
    start: "2026-03-28",
    end: "2026-04-16",
    color: "#000",
  };
  const [d, s] = onlyMonth("2026-04", [p]);
  const strip = periodStrip(d, s, "2026-04");
  assert.deepEqual(strip.periods, [
    { id: "p1", name: "Moving", color: "#000", from: 1, to: 16 },
  ]);
  assert.deepEqual(strip.stretches, [], "payments in a period are explained");
});

// A first statement of the person's own, as an imported CSV would give it.
function ownStatement(rows) {
  const batch = {
    id: "own-zar",
    kind: "generic",
    currency: "ZAR",
    account: "Everyday",
    periods: ["2026-09"],
    file: "mine.csv",
    added: "2026-10-01",
    rows: rows.map(([date, merchant, amount], i) => ({
      id: `own-${i}`,
      account: "Everyday",
      period: "2026-09",
      date,
      chargeDate: date,
      merchant,
      amount,
      currency: "ZAR",
      orig: null,
      type: "",
      details: "",
      inst: null,
      section: "",
      file: "mine.csv",
    })),
  };
  const s = { ...createRuntime().state, batches: { [batch.id]: batch } };
  return [deriveTransactions(s, { today: "2026-10-04" }), s];
}

test("a month the statement covers only part of is told as a range (Copy s2)", () => {
  const [d, s] = ownStatement([
    ["2026-09-13", "Corner Grocer", 120],
    ["2026-09-14", "Juniper Books", 89],
    ["2026-09-15", "Corner Grocer", 80],
    ["2026-09-16", "Plumtree Pharmacy", 62],
    ["2026-09-17", "Harbour Lights Cinema", 70],
  ]);
  const st = oneMonthStory(d, s, "2026-09");
  assert.equal(st.label, "13–17 September so far");
  assert.match(
    words(st.lead),
    /went out between 13 and 17 September, in 5 payments\./,
  );
  const text = st.paragraphs.map(words).join(" ");
  assert.ok(!/busiest/.test(text), "no week is covered in full to compare");
});

test("a whole month's statement is told as the month", () => {
  const [d, s] = ownStatement([
    ["2026-09-02", "Northgate Rent", 1200],
    ["2026-09-30", "Corner Grocer", 175],
  ]);
  assert.equal(oneMonthStory(d, s, "2026-09").label, "September 2026");
});

test("a first statement with no threads yet still gets its question (Copy s6)", () => {
  const [d, s] = ownStatement([
    ["2026-09-02", "Northgate Rent", 1200],
    ["2026-09-03", "Corner Grocer", 180],
    ["2026-09-10", "Corner Grocer", 165],
    ["2026-09-17", "Juniper Books", 130],
    ["2026-09-28", "Corner Grocer", 175],
  ]);
  const st = oneMonthStory(d, s, "2026-09");
  assert.ok(st.loose, "every payment is loose");
  assert.match(
    st.question?.text ?? "",
    /^ZAR\s1,200 went to \u2068Northgate Rent\u2069\. Is it something you pay every month\?$/,
  );
});
