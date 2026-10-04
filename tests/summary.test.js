import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { findMoments } from "../story/moments.js";
import { answerMoment } from "../story/answers.js";
import {
  periodNotes,
  sectionText,
  summarizeMonth,
  summarizePeriod,
  summarizeThread,
} from "../story/summary.js";

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
function median(xs) {
  const s = [...xs].sort((a, b) => a - b),
    mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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
      const txns = p.txnIds.map((id) => derived.byId.get(id));
      const amounts = txns.map((t) => t.amount);
      // "the ₪100 monthly budget": the figure is the limit, so check each
      // month of the transactions against it.
      if (/monthly budget/.test(p.text)) {
        const limit = amount(figure[0]);
        const perMonth = {};
        for (const t of txns)
          perMonth[t.date.slice(0, 7)] =
            (perMonth[t.date.slice(0, 7)] || 0) + t.amount;
        const over = Object.values(perMonth).filter((v) => v > limit);
        assert.equal(
          over.length > 0,
          /more than/.test(p.text),
          `“${p.text}” matches its months`,
        );
        checked++;
        continue;
      }
      // "A typical one was about ₪28" and "usually about ₪26" are medians.
      const value = /typical one|usually about/.test(p.text)
        ? median(amounts)
        : amounts.reduce((a, b) => a + b, 0);
      assert.equal(
        Math.round(Math.abs(value)),
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

test("a period is told apart from the regular spending in its dates", () => {
  const state = demo();
  const derived = derive(state);
  const move = state.periods.find((p) => p.id === "demo-move");
  assert.deepEqual(text(summarizePeriod(derived, state, move)), [
    [
      "period",
      "₪2,409 went out in these dates, with ₪1,505 at Kettle & Coil (three purchases), ₪640 at Bluebell Removals, ₪144 at Northgate Hardware (three purchases) and ₪120 at Linen Lane.",
    ],
    [
      "regular",
      "Eight regular charges (₪359) also fell in these dates and aren't counted above.",
    ],
    [
      "compare",
      "That's more than in any of your other periods: “The car broke down” came to ₪1,600 and “Holiday in Lantern Bay” came to ₪770.",
    ],
  ]);
  const listed = summarizePeriod(derived, state, move, { regular: true });
  assert.equal(
    sectionText(listed[1]),
    "Regular spending in these dates came to ₪359: ₪106 on Groceries, ₪91 on Dining out, ₪55 on Pets, ₪40 on Bills, ₪38 on Getting around and ₪29 on Subscriptions.",
  );
  checkIds(listed, derived);
  checkIds(summarizePeriod(derived, state, move), derived);

  const notes = periodNotes(derived, move);
  assert.deepEqual(
    notes.map((n) => [n.date, n.merchant, n.note]),
    [
      [
        "2026-03-09",
        "Bluebell Removals",
        "Van and two movers for the day. #move",
      ],
      [
        "2026-03-11",
        "Kettle & Coil",
        "Fridge. The new flat came without one. #move",
      ],
      ["2026-03-12", "Kettle & Coil", "Washing machine. #move"],
      [
        "2026-03-14",
        "Kettle & Coil",
        "Kettle and toaster, ours are still in a box somewhere. #move",
      ],
      [
        "2026-03-27",
        "Northgate Hardware",
        "Shelf brackets and wall plugs. #move",
      ],
    ],
  );
  // Regular spending's notes show up only when it is listed too.
  const trip = state.periods.find((p) => p.id === "demo-trip");
  assert.ok(
    !periodNotes(derived, trip).some((n) => n.merchant === "Meadow Paws"),
  );
  assert.ok(
    periodNotes(derived, trip, { regular: true }).some(
      (n) => n.merchant === "Meadow Paws",
    ),
  );
});

test("a thread is told as a summary, a month strip and a blow-by-blow list", () => {
  const state = demo();
  const derived = derive(state);
  const dining = summarizeThread(derived, state, "Dining out");
  assert.deepEqual(text(dining.sections), [
    [
      "overview",
      "Dining out had 14 charges between September 2025 and August 2026, ₪370 in all, all at Paper Kite Cafe. A typical one was about ₪28.",
    ],
    [
      "rhythm",
      "12 of them were on the 9th of the month at Paper Kite Cafe, usually about ₪26.",
    ],
    [
      "busiest",
      "The busiest month was March 2026: three charges, ₪91, all during “Moving to Elm Street”.",
    ],
    ["budget", "It stayed within the ₪100 monthly budget every month."],
  ]);
  checkIds(dining.sections, derived);
  assert.equal(dining.months.length, 12);
  assert.deepEqual(
    dining.months.map((m) => m.count),
    [1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1],
  );
  assert.equal(dining.items.length, 14);
  const march = dining.items.filter((i) => i.date.startsWith("2026-03"));
  assert.ok(march.every((i) => i.periods.includes("Moving to Elm Street")));

  const bills = summarizeThread(derived, state, "Bills");
  assert.equal(
    sectionText(bills.sections.find((s) => s.kind === "budget")),
    "It came to more than the ₪300 monthly budget in March 2026.",
  );
  const car = summarizeThread(derived, state, "Car");
  assert.deepEqual(text(car.sections), [
    [
      "overview",
      "Car had two charges in December 2025, ₪1,600 in all, all at Cobble Lane Garage. ",
    ],
  ]);
  assert.deepEqual(
    car.items.map((i) => i.note),
    [
      "Tow home after the clutch went on the ring road. #car",
      "New clutch. Paid from the holiday money, so the savings transfers stop for a while. #car",
    ],
  );
  const transfers = summarizeThread(derived, state, "Transfers");
  assert.doesNotMatch(sectionText(transfers.sections[0]), /₪/);
});
