import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { LOOSE } from "../transactions/constants.js";
import { detectMoments, findMoments } from "../story/moments.js";
import {
  sectionText,
  summarizeMonth,
  summaryMonths,
} from "../story/summary.js";
import { summarizeThread } from "../story/thread-story.js";
import { answerOptions, money, questionText } from "../story/copy.js";
import {
  M,
  PURCHASE_MONTHS,
  CURRENCY,
  REALISTIC_TODAY,
  createRealisticData,
} from "./fixtures/realistic.js";

// One test per wrong fact found by playtesting with real data (section 1 of
// the playtest findings), reproduced with a fictional workspace.

function setup() {
  const { state } = createRuntime();
  Object.assign(state, createRealisticData());
  const derived = deriveTransactions(state, { today: REALISTIC_TODAY });
  return { state, derived, moments: detectMoments(derived, state) };
}
const of = (moments, kind, merchant) =>
  moments.filter((m) => m.kind === kind && m.facts.merchant === merchant);
const idsAt = (derived, merchant) =>
  derived.allTxns.filter((t) => t.merchant === merchant).map((t) => t.id);
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

test("the month opens on the latest month with purchases, and a month without a statement is never a gap", () => {
  const { state, derived, moments } = setup();
  assert.deepEqual(summaryMonths(derived), PURCHASE_MONTHS);
  const latest = summaryMonths(derived).at(-1);
  assert.equal(latest, "2026-09");
  const [overview] = summarizeMonth(derived, state, latest);
  assert.doesNotMatch(sectionText(overview), /^Nothing went out/);
  for (const m of moments) {
    assert.ok(PURCHASE_MONTHS.includes(m.month), `${m.id} is in ${m.month}`);
    if (m.kind === "gap")
      for (const g of m.facts.months)
        assert.ok(PURCHASE_MONTHS.includes(g), `${m.id} counts ${g}`);
    assert.doesNotMatch(questionText(m), /October/);
  }
});

test("usual amounts compare like with like: monthly thread totals, and a merchant against its own history", () => {
  const { state, derived, moments } = setup();
  // Bills in September against the median Bills total of the other months.
  const billsIn = (ym) =>
    derived.allTxns
      .filter((t) => t.thread === "Bills" && t.date.startsWith(ym))
      .reduce((s, t) => s + t.amount, 0);
  const usual = median(
    PURCHASE_MONTHS.filter((m) => m !== "2026-09").map(billsIn),
  );
  const regular = summarizeMonth(derived, state, "2026-09").find(
    (s) => s.kind === "regular",
  );
  assert.match(
    sectionText(regular),
    new RegExp(
      `Bills came to ${money(billsIn("2026-09"), CURRENCY)}, against a usual ${money(Math.round(usual), CURRENCY)}\\.`,
    ),
  );
  // Electricity every two months and a fixed phone charge are not large or
  // spikes; a large charge is measured against its own merchant.
  for (const merchant of [M.power, M.phone]) {
    assert.deepEqual(of(moments, "large", merchant), [], merchant);
    assert.deepEqual(of(moments, "spike", merchant), [], merchant);
  }
  for (const m of moments.filter((m) => m.kind === "large" && m.facts.usual))
    assert.equal(m.facts.usualFor, m.facts.merchant, m.id);
});

test("money coming in is told as money in, not as refunds or price changes", () => {
  const { state, derived, moments } = setup();
  for (const m of moments.filter((m) =>
    ["price", "spike", "large", "gap"].includes(m.kind),
  ))
    for (const id of m.txnIds)
      assert.ok(derived.byId.get(id).amount > 0, `${m.id} includes ${id}`);

  const parts = summarizeMonth(derived, state, "2026-09").flatMap(
    (s) => s.parts,
  );
  const about = (id) => parts.filter((p) => p.txnIds?.includes(id));
  const [salary] = idsAt(derived, M.payer).filter((id) =>
    id.startsWith("real-2026-09"),
  );
  assert.ok(
    about(salary).some((p) => /came in/.test(p.text)),
    "September's salary is told as money that came in",
  );
  for (const p of about(salary)) assert.doesNotMatch(p.text, /refund/);
  const refund = derived.allTxns.find(
    (t) =>
      t.merchant === M.grocer && t.amount < 0 && t.date.startsWith("2026-09"),
  );
  assert.ok(about(refund.id).some((p) => /refund/.test(p.text)));

  // A thread's total is what went out, not net of money that came in.
  for (const s of summarizeThread(derived, state, LOOSE).sections)
    assert.doesNotMatch(sectionText(s), /−₪/);
});

test("an ordinary week with one big purchase is not a cluster", () => {
  const { derived, moments } = setup();
  for (const m of moments.filter((m) => m.kind === "cluster")) {
    const amounts = m.txnIds.map((id) => derived.byId.get(id).amount);
    assert.ok(
      Math.max(...amounts) < m.facts.total / 2,
      `${m.id} is driven by one purchase of ${Math.max(...amounts)}`,
    );
  }
  const [furniture] = idsAt(derived, M.furniture);
  assert.ok(
    !moments.some((m) => m.kind === "cluster" && m.txnIds.includes(furniture)),
  );
});

test("price changes are only for steady monthly charges", () => {
  const { moments } = setup();
  for (const merchant of [M.parking, M.vet, M.payer])
    assert.deepEqual(of(moments, "price", merchant), [], merchant);
  // A subscription that was steady and then went up is still a price change.
  const [stream] = of(moments, "price", M.stream);
  assert.ok(stream, "Streamly's rise is a price change");
  assert.deepEqual([stream.facts.before, stream.facts.after], [30, 35]);
});

test("charges in no thread become one question that offers to sort them", () => {
  const { state, derived, moments } = setup();
  const loose = moments.filter((m) => m.kind === "loose");
  assert.equal(loose.length, 1);
  const [m] = loose;
  assert.equal(m.month, "2026-09");
  const ids = derived.allTxns
    .filter((t) => t.thread === LOOSE && t.amount > 0)
    .map((t) => t.id);
  assert.deepEqual([...m.txnIds].sort(), [...ids].sort());
  assert.equal(
    questionText(m),
    `${m.facts.count} charges at ${m.facts.places} places, ${money(m.facts.total, CURRENCY)} in all, aren't in any thread yet. Want to sort them into threads?`,
  );
  assert.deepEqual(
    answerOptions(m).map((o) => [o.label, o.action]),
    [
      ["Sort them in Threads", "threads"],
      ["Skip", "skip"],
    ],
  );
  assert.ok(findMoments(derived, state).some((o) => o.id === m.id));
  // Once they are threaded, the question goes away.
  state.rules += "\nEverything else\n  /./\n";
  const threaded = deriveTransactions(state, { today: REALISTIC_TODAY });
  assert.ok(!detectMoments(threaded, state).some((o) => o.kind === "loose"));
});

test("each merchant is asked about once, and naming a period is offered only for several charges", () => {
  const { state, derived, moments } = setup();
  const open = findMoments(derived, state, moments);
  const keys = open
    .filter((m) => !["budget", "loose"].includes(m.kind))
    .flatMap((m) => m.facts.keys);
  assert.equal(new Set(keys).size, keys.length);
  // A thread over budget month after month is one question, not one a month.
  const overBudget = open.filter((m) => m.kind === "budget");
  assert.equal(overBudget.length, 1);
  assert.equal(overBudget[0].facts.thread, "To Cancel");

  // A skip about a merchant closes every question about it.
  const stream = of(moments, "price", M.stream)[0];
  state.answers = { [stream.id]: { status: "skipped", at: REALISTIC_TODAY } };
  assert.ok(
    !findMoments(derived, state, moments).some((m) =>
      m.facts.keys.includes(stream.facts.keys[0]),
    ),
  );

  const labels = (m) => answerOptions(m).map((o) => o.label);
  assert.ok(!labels(stream).includes("Name this period"));
  const [furniture] = of(moments, "large", M.furniture);
  assert.ok(!labels(furniture).includes("Name this period"));
});

test("sentences use whole shekels, skip trivial refunds and keep names in their own direction", () => {
  const { state, derived, moments } = setup();
  const july = summarizeMonth(derived, state, "2026-07");
  const overview = sectionText(july[0]);
  assert.doesNotMatch(overview, /refund/, "₪4.50 back isn't worth a sentence");
  for (const s of july) assert.doesNotMatch(sectionText(s), /₪[\d,]+\.\d\d/);

  // A name with Hebrew in it is isolated, so the amount after it stays put.
  const [furniture] = of(moments, "large", M.furniture);
  assert.match(
    questionText(furniture),
    new RegExp(`You paid ⁨${M.furniture}⁩ ₪2,450,`),
  );
  const september = summarizeMonth(derived, state, "2026-09");
  const cameIn = september[0].parts.find((p) => /came in/.test(p.text));
  assert.ok(cameIn.text.includes(`⁨${M.payer}⁩`));
  assert.ok(sectionText(september[0]).includes(`came in from ${M.payer}.`));
});
