import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { LOOSE } from "../transactions/constants.js";
import { detectMoments } from "../story/moments.js";
import {
  sectionText,
  summarizeMonth,
  summarizeThread,
  summaryMonths,
} from "../story/summary.js";
import { money, questionText } from "../story/copy.js";
import {
  M,
  PURCHASE_MONTHS,
  REALISTIC_TODAY,
  createRealisticData,
} from "./fixtures/realistic.js";

// One test per wrong fact found by playtesting with real data (section 1 of
// the playtest findings), reproduced with a fictional workspace. Each is a
// todo until its fix lands; remove the todo with the fix.

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

test(
  "the month opens on the latest month with purchases, and a month without a statement is never a gap",
  { todo: "finding 1.1: covered months follow statement labels" },
  () => {
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
  },
);

test(
  "usual amounts compare like with like: monthly thread totals, and a merchant against its own history",
  { todo: "finding 1.2: usual amounts mix months and merchants" },
  () => {
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
        `Bills came to ${money(billsIn("2026-09"))}, against a usual ${money(Math.round(usual))}\\.`,
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
  },
);

test(
  "money coming in is told as money in, not as refunds or price changes",
  { todo: "finding 1.3: money in is treated as refunds and prices" },
  () => {
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
      (t) => t.merchant === M.grocer && t.amount < 0,
    );
    assert.ok(about(refund.id).some((p) => /refund/.test(p.text)));

    // A thread's total is what went out, not net of money that came in.
    for (const s of summarizeThread(derived, state, LOOSE).sections)
      assert.doesNotMatch(sectionText(s), /−₪/);
  },
);

test(
  "an ordinary week with one big purchase is not a cluster",
  { todo: "finding 1.4: one purchase drives a cluster" },
  () => {
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
      !moments.some(
        (m) => m.kind === "cluster" && m.txnIds.includes(furniture),
      ),
    );
  },
);

test(
  "price changes are only for steady monthly charges",
  { todo: "finding 1.5: price changes on pay-as-you-go merchants" },
  () => {
    const { moments } = setup();
    for (const merchant of [M.parking, M.vet, M.payer])
      assert.deepEqual(of(moments, "price", merchant), [], merchant);
    // A subscription that was steady and then went up is still a price change.
    const [stream] = of(moments, "price", M.stream);
    assert.ok(stream, "Streamly's rise is a price change");
    assert.deepEqual([stream.facts.before, stream.facts.after], [30, 35]);
  },
);
