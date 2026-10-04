import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { findMoments } from "../story/moments.js";
import { answerMoment } from "../story/answers.js";
import { sectionText, summarizeMonth } from "../story/summary.js";

const TODAY = "2026-09-30";
function demo({ moveOpen = false } = {}) {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  if (moveOpen)
    state.periods = state.periods.filter((p) => p.id !== "demo-move");
  return state;
}
const derive = (state) => deriveTransactions(state, { today: TODAY });
const text = (sections) => sections.map((s) => [s.kind, sectionText(s)]);
const amount = (s) => Number(s.replace(/[₪,]/g, ""));

// Every part that states an amount carries the transactions that add up to
// its first figure; questions carry their moment's transactions.
function checkIds(sections, derived) {
  let checked = 0;
  for (const s of sections)
    for (const p of s.parts) {
      if (s.kind === "question") {
        assert.deepEqual(p.txnIds, s.moment.txnIds);
        continue;
      }
      if (s.kind === "yours") {
        assert.equal(p.txnIds, undefined, "your own words carry no ids");
        continue;
      }
      const figure = p.text.match(/₪[\d,.]+/);
      if (!figure) continue;
      assert.ok(Array.isArray(p.txnIds), `ids for “${p.text}”`);
      const sum = p.txnIds.reduce(
        (a, id) => a + derived.byId.get(id).amount,
        0,
      );
      assert.equal(
        Math.round(Math.abs(sum)),
        amount(figure[0]),
        `“${p.text}” adds up`,
      );
      checked++;
    }
  return checked;
}

test("the demo's April reads as an ordinary month", () => {
  const state = demo();
  const derived = derive(state);
  const april = summarizeMonth(derived, state, "2026-04");
  assert.deepEqual(text(april), [
    ["overview", "₪611 went out in April, close to a typical month (₪590)."],
    [
      "regular",
      "The regular things stayed close to usual: ₪247 on Bills, ₪218 on Groceries, ₪55 on Pets, ₪38 on Getting around and ₪53 on other regular things.",
    ],
    [
      "savings",
      "₪150 went from Demo Everyday to Demo Savings, ₪900 in all since September 2025.",
    ],
    [
      "budget",
      "Budgets: Bills ₪247 of ₪300, Groceries ₪218 of ₪300, Dining out ₪24 of ₪100, Getting around ₪38 of ₪100, Subscriptions ₪29 of ₪50 and Pets ₪55 of ₪120.",
    ],
  ]);
  assert.ok(checkIds(april, derived) >= 14);
  const bills = april
    .find((s) => s.kind === "budget")
    .parts.find((p) => p.text.startsWith("Bills"));
  assert.deepEqual(
    bills.txnIds.map((id) => derived.byId.get(id).merchant).sort(),
    ["Brightwell Energy", "Cloudfern Internet", "Willow Water"],
  );
});

test("the move month tells the period apart from your own words", () => {
  const state = demo();
  const derived = derive(state);
  const march = summarizeMonth(derived, state, "2026-03");
  assert.deepEqual(text(march), [
    [
      "overview",
      "March was a big month: ₪3,163 went out, about five times a typical month.",
    ],
    [
      "regular",
      "Regular spending came to ₪754: ₪305 on Bills, ₪236 on Groceries, ₪91 on Dining out, ₪55 on Pets and ₪67 on other regular things. Bills came to ₪305, against a usual ₪245. Dining out came to ₪91, against a usual ₪24.",
    ],
    [
      "period",
      "“Moving to Elm Street”, 8–28 March 2026: ₪2,409 went out, with ₪1,505 at Kettle & Coil (three purchases), ₪640 at Bluebell Removals, ₪144 at Northgate Hardware (three purchases) and ₪120 at Linen Lane.",
    ],
    [
      "yours",
      "We moved into the flat on Elm Street. It came without a fridge or a washing machine, so most of the dots on the Home wire this month are appliances. We ate out a lot while the kitchen was in boxes.",
    ],
    [
      "question",
      "Bills came to ₪305 of ₪300 in March 2026, the first month above the budget. Want to add a note?",
    ],
    [
      "savings",
      "You moved ₪150 from Demo Everyday to Demo Savings, ₪750 in all since September 2025.",
    ],
    [
      "budget",
      "Budgets: Bills ₪305 of ₪300, Groceries ₪236 of ₪300, Dining out ₪91 of ₪100, Getting around ₪38 of ₪100, Subscriptions ₪29 of ₪50 and Pets ₪55 of ₪120.",
    ],
  ]);
  assert.ok(checkIds(march, derived) >= 20);
  const yours = march.find((s) => s.kind === "yours");
  assert.equal(yours.label, "Your description");
  assert.equal(yours.periodId, "demo-move");
});

test("answering the open move question changes the summary", () => {
  const state = demo({ moveOpen: true });
  const derived = derive(state);
  const before = summarizeMonth(derived, state, "2026-03");
  const move = before.find(
    (s) => s.kind === "question" && s.moment.kind === "cluster",
  ).moment;
  assert.equal(
    sectionText(before.find((s) => s.moment === move)),
    "₪2,313 went to Bluebell Removals, Kettle & Coil, Northgate Hardware and Linen Lane within a week. Want to name this period?",
  );
  assert.ok(!before.some((s) => s.kind === "period"));

  Object.assign(
    state,
    answerMoment(state, derived, move, {
      action: "period",
      text: "Moving house",
      at: "2026-10-04",
      periodId: "p-move",
    }),
  );
  state.periods.push({
    id: "p-move",
    name: "Moving house",
    start: move.from,
    end: move.to,
    story: "",
  });
  const again = derive(state);
  const after = summarizeMonth(again, state, "2026-03");
  assert.ok(
    !after.some((s) => s.kind === "question" && s.moment.id === move.id),
  );
  assert.equal(
    sectionText(after.find((s) => s.kind === "period")),
    "“Moving house”, 9–16 March 2026: ₪2,313 went out, with ₪1,505 at Kettle & Coil (three purchases), ₪640 at Bluebell Removals, ₪120 at Linen Lane and ₪48 at Northgate Hardware.",
  );
  assert.ok(!after.some((s) => s.kind === "yours"), "no words were written");
  checkIds(after, again);
});

test("other demo months: questions inline, refunds, savings both ways", () => {
  const state = demo();
  const derived = derive(state);
  const august = summarizeMonth(derived, state, "2026-08");
  assert.equal(
    sectionText(august[0]),
    "August was a big month: ₪1,454 went out, about twice a typical month. ₪18 came back as a refund from Harbor Pantry.",
  );
  assert.equal(
    sectionText(august.find((s) => s.kind === "savings")),
    "₪150 went from Demo Everyday to Demo Savings, ₪1,500 in all since September 2025. ₪1,200 went from Demo Savings to Demo Everyday.",
  );
  const open = findMoments(derived, state).filter((m) => m.month === "2026-08");
  assert.deepEqual(
    august.filter((s) => s.kind === "question").map((s) => s.moment.id),
    open.map((m) => m.id),
  );
  checkIds(august, derived);
  // The same month always reads the same way.
  assert.deepEqual(
    text(summarizeMonth(derived, state, "2026-08")),
    text(august),
  );
  assert.deepEqual(text(summarizeMonth(derived, state, "2027-01")), [
    ["empty", "There are no statements covering January 2027 yet."],
  ]);
});

test("with fewer than three months there is no comparison", () => {
  const state = demo();
  for (const [id, batch] of Object.entries(state.batches))
    if (batch.periods[0] > "2025-10") delete state.batches[id];
  const derived = derive(state);
  assert.equal(
    sectionText(summarizeMonth(derived, state, "2025-10")[0]),
    "₪651 went out in October. There aren't enough months of statements yet to compare it with a typical month.",
  );
});
