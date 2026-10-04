import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  parseBackup,
  restoreBackupDocuments,
} from "../backup.js";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import {
  MAX_OPEN_PER_MONTH,
  applyAnswer,
  detectMoments,
  findMoments,
  typicalMonth,
} from "../story/moments.js";
import {
  answerOptions,
  dateRange,
  kindLabel,
  momentWhen,
  money,
  monthList,
  privacyLabel,
  questionText,
} from "../story/copy.js";

const TODAY = "2026-09-30";

// The demo year with its periods and notes, as shipped.
function shipped() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  return state;
}
// The same transactions before anyone explained anything.
function unexplained() {
  const state = shipped();
  state.periods = [];
  state.notes = {};
  return state;
}
const derive = (state) => deriveTransactions(state, { today: TODAY });
const describe = (derived, m) =>
  m.txnIds.map((id) => {
    const t = derived.byId.get(id);
    return `${t.date} ${t.merchant} ${t.amount}`;
  });
const find = (moments, kind, merchant) =>
  moments.find(
    (m) =>
      m.kind === kind &&
      (m.facts.merchant === merchant ||
        m.facts.thread === merchant ||
        m.facts.merchants?.includes(merchant)),
  );

test("the demo year yields each kind of moment with the right transactions", () => {
  const state = unexplained();
  const derived = derive(state);
  const moments = detectMoments(derived, state);

  const move = find(moments, "cluster", "Bluebell Removals");
  assert.deepEqual(describe(derived, move), [
    "2026-03-09 Bluebell Removals 640",
    "2026-03-11 Kettle & Coil 890",
    "2026-03-12 Kettle & Coil 540",
    "2026-03-14 Kettle & Coil 75",
    "2026-03-15 Northgate Hardware 48",
    "2026-03-16 Linen Lane 120",
  ]);
  assert.equal(move.month, "2026-03");
  assert.equal(move.facts.total, 2313);

  const garage = find(moments, "large", "Cobble Lane Garage");
  assert.deepEqual(describe(derived, garage), [
    "2025-12-10 Cobble Lane Garage 120",
    "2025-12-13 Cobble Lane Garage 1480",
  ]);
  assert.equal(garage.facts.largestOfYear, true);

  const savings = find(moments, "gap", "Demo savings transfer");
  assert.deepEqual(savings.facts.months, ["2025-12", "2026-01"]);
  assert.equal(savings.from, "2025-12-01");
  assert.equal(savings.to, "2026-01-31");
  assert.equal(savings.txnIds.length, 10);
  assert.ok(
    describe(derived, savings).every((d) =>
      d.endsWith("Demo savings transfer 150"),
    ),
  );

  const stream = find(moments, "price", "Lantern Stream");
  assert.deepEqual(describe(derived, stream), [
    "2026-07-15 Lantern Stream 29",
    "2026-08-15 Lantern Stream 35",
  ]);

  const paws = find(moments, "spike", "Meadow Paws");
  assert.deepEqual(describe(derived, paws), ["2026-08-18 Meadow Paws 95"]);
  assert.equal(paws.facts.usual, 55);

  const cafe = find(moments, "rhythm", "Paper Kite Cafe");
  assert.equal(cafe.facts.day, 9);
  assert.equal(cafe.facts.months, 12);
  assert.ok(
    describe(derived, cafe).every((d) =>
      /^\d{4}-\d{2}-09 Paper Kite Cafe/.test(d),
    ),
  );

  const removals = find(moments, "new", "Bluebell Removals");
  assert.deepEqual(describe(derived, removals), [
    "2026-03-09 Bluebell Removals 640",
  ]);

  const bills = find(moments, "budget", "Bills");
  assert.equal(bills.month, "2026-03");
  assert.deepEqual(
    [bills.facts.spent, bills.facts.budget, bills.facts.first],
    [305, 300, true],
  );

  // Routine charges and other merchants don't make noise.
  assert.equal(find(moments, "price", "Brightwell Energy"), undefined);
  assert.equal(find(moments, "price", "Meadow Paws"), undefined);
  assert.equal(find(moments, "rhythm", "Harbor Pantry"), undefined);
  assert.equal(find(moments, "rhythm", "Brightwell Energy"), undefined);
  assert.equal(find(moments, "rhythm", "Loopway Transit"), undefined);
  assert.ok(
    moments.every(
      (m) => m.kind !== "gap" || m.facts.merchant === "Demo savings transfer",
    ),
  );
});

test("open moments are ranked, capped at three a month, and fold into bigger ones", () => {
  const state = unexplained();
  const derived = derive(state);
  const open = findMoments(derived, state);
  const perMonth = {};
  for (const m of open) perMonth[m.month] = (perMonth[m.month] || 0) + 1;
  assert.ok(Object.values(perMonth).every((n) => n <= MAX_OPEN_PER_MONTH));
  assert.deepEqual(
    open.map((m) => m.rank),
    [...open.map((m) => m.rank)].sort((a, b) => b - a),
  );
  const ids = new Set(open.map((m) => m.id));
  const all = detectMoments(derived, state);
  assert.ok(ids.has(find(all, "cluster", "Bluebell Removals").id));
  // Bluebell Removals is new, but it is part of the move: one question, not two.
  assert.ok(!ids.has(find(all, "new", "Bluebell Removals").id));
  assert.ok(!ids.has(find(all, "large", "Kettle & Coil").id));
});

test("moments explained by a period or a note are dropped", () => {
  const state = shipped();
  const derived = derive(state);
  const all = detectMoments(derived, state);
  const open = new Set(findMoments(derived, state).map((m) => m.id));
  // The car is in a period and its charges have their own notes.
  assert.ok(!open.has(find(all, "large", "Cobble Lane Garage").id));
  assert.ok(!all.some((m) => m.kind === "cluster" && m.month === "2026-03"));
  for (const [kind, name] of [
    ["gap", "Demo savings transfer"],
    ["price", "Lantern Stream"],
    // In the holiday's dates, but routine, and its note is on every charge.
    ["spike", "Meadow Paws"],
    ["rhythm", "Paper Kite Cafe"],
    ["budget", "Bills"],
  ])
    assert.ok(open.has(find(all, kind, name).id), `${kind} ${name} is open`);
});

test("moment ids survive re-deriving, re-importing and a backup round trip", () => {
  const state = unexplained();
  const ids = detectMoments(derive(state), state).map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    detectMoments(derive(state), state).map((m) => m.id),
    ids,
  );

  // Re-importing can give transactions new ids; moment ids don't use them.
  const reimported = unexplained();
  for (const batch of Object.values(reimported.batches))
    batch.rows = batch.rows.map((r) => ({ ...r, id: "again-" + r.id }));
  assert.deepEqual(
    detectMoments(derive(reimported), reimported).map((m) => m.id),
    ids,
  );

  const { state: restored } = createRuntime();
  Object.assign(restored, parseBackup(JSON.stringify(createBackup(state))));
  assert.deepEqual(
    detectMoments(derive(restored), restored).map((m) => m.id),
    ids,
  );
});

test("answers and skips close questions and survive a backup round trip", async () => {
  const state = unexplained();
  const derived = derive(state);
  const all = detectMoments(derived, state);
  const move = find(all, "cluster", "Bluebell Removals");
  const stream = find(all, "price", "Lantern Stream");
  let docs = applyAnswer(state, move, {
    status: "answered",
    choice: "Moving house",
    action: "period",
    created: { periodId: "p-move" },
    at: "2026-10-04",
  });
  docs = applyAnswer(docs, stream, { status: "skipped", at: "2026-10-04" });
  Object.assign(state, docs);

  assert.deepEqual(state.answers[move.id], {
    status: "answered",
    choice: "Moving house",
    note: null,
    created: { periodId: "p-move" },
    at: "2026-10-04",
  });
  assert.equal(state.answers[stream.id].status, "skipped");
  const key = derived.byId.get(move.txnIds[0]).key;
  assert.deepEqual(state.merchantAnswers[key], {
    choice: "Moving house",
    action: "period",
    at: "2026-10-04",
  });
  assert.equal(
    state.merchantAnswers[derived.byId.get(stream.txnIds[0]).key],
    undefined,
  );
  const open = new Set(findMoments(derived, state).map((m) => m.id));
  assert.ok(!open.has(move.id) && !open.has(stream.id));

  const imported = parseBackup(JSON.stringify(createBackup(state)));
  assert.deepEqual(imported.answers, state.answers);
  assert.deepEqual(imported.merchantAnswers, state.merchantAnswers);
  const { state: restored } = createRuntime();
  Object.assign(restored, imported);
  assert.deepEqual(
    findMoments(derive(restored), restored).map((m) => m.id),
    findMoments(derived, state).map((m) => m.id),
  );

  const saved = {};
  await restoreBackupDocuments(
    {
      all: async () => structuredClone(saved),
      put: async (k, v) => (saved[k] = structuredClone(v)),
      del: async (k) => delete saved[k],
    },
    imported,
  );
  assert.deepEqual(saved.answers.map, state.answers);
  assert.deepEqual(saved.merchantAnswers.map, state.merchantAnswers);

  for (const bad of [
    { answers: { x: { status: "maybe" } } },
    { answers: { x: { status: "answered", choice: 4 } } },
    { merchantAnswers: { x: { choice: null } } },
  ])
    assert.throws(
      () => parseBackup(JSON.stringify({ ...createBackup(shipped()), ...bad })),
      /Invalid backup/,
    );
  const legacy = createBackup(shipped());
  delete legacy.answers;
  delete legacy.merchantAnswers;
  const old = parseBackup(JSON.stringify(legacy));
  assert.deepEqual([old.answers, old.merchantAnswers], [{}, {}]);
});

test("question copy states the facts and offers options without an assistant", () => {
  const state = unexplained();
  const derived = derive(state);
  const all = detectMoments(derived, state);
  const text = (kind, name) => questionText(find(all, kind, name));
  assert.equal(
    text("cluster", "Bluebell Removals"),
    "₪2,313 went to Bluebell Removals, Kettle & Coil, Northgate Hardware and Linen Lane within a week. Want to name this period?",
  );
  assert.equal(
    text("large", "Cobble Lane Garage"),
    "You made two payments to Cobble Lane Garage, ₪1,600 in all. Want to add a note?",
  );
  assert.equal(
    text("gap", "Demo savings transfer"),
    "No Demo savings transfer in December 2025 or January 2026, though there was one in each of the other 10 months. Want to add a note?",
  );
  assert.equal(
    text("price", "Lantern Stream"),
    "Lantern Stream went up from ₪29 to ₪35 a month. Want to add a note?",
  );
  assert.equal(
    text("spike", "Meadow Paws"),
    "Meadow Paws came to ₪95 in August 2026, compared with the usual ₪55. Want to add a note?",
  );
  assert.equal(
    text("rhythm", "Paper Kite Cafe"),
    "You've paid Paper Kite Cafe on the 9th of the month for 12 months running. Want to add a note?",
  );
  assert.equal(
    text("new", "Bluebell Removals"),
    "₪640 went to Bluebell Removals in March 2026, the first time it appears in your statements. Want to add a note?",
  );
  assert.equal(
    text("budget", "Bills"),
    "Bills came to ₪305 of ₪300 in March 2026, the first month above the budget. Want to add a note?",
  );
  const move = find(all, "cluster", "Bluebell Removals");
  assert.equal(kindLabel(move), "Several purchases close together");
  assert.equal(momentWhen(move), "9–16 March 2026");
  assert.equal(
    momentWhen(find(all, "gap", "Demo savings transfer")),
    "December 2025 and January 2026",
  );

  const labels = (m, merchantAnswers) =>
    answerOptions(m, merchantAnswers).map((o) => o.label);
  const generic = ["Name this period", "Write a note", "Skip"];
  assert.deepEqual(labels(move), ["Moving house", ...generic]);
  const garage = find(all, "large", "Cobble Lane Garage");
  assert.deepEqual(labels(garage), ["Car repair", ...generic]);
  assert.deepEqual(labels(find(all, "spike", "Meadow Paws")), generic);
  const { merchantAnswers } = applyAnswer({}, garage, {
    status: "answered",
    choice: "Clutch",
    action: "note",
    at: "2026-10-04",
  });
  assert.deepEqual(labels(garage, merchantAnswers), [
    "Clutch",
    "Car repair",
    ...generic,
  ]);
  const hebrew = {
    ...garage,
    facts: { ...garage.facts, keys: ["Card::מוסך הדר"], merchant: "מוסך הדר" },
  };
  assert.deepEqual(labels(hebrew), ["Car repair", ...generic]);
});

test("copy helpers and a typical month", () => {
  assert.equal(money(2313), "₪2,313");
  assert.equal(money(26.5), "₪26.50");
  assert.equal(money(-18), "−₪18");
  assert.equal(
    dateRange("2026-03-28", "2026-04-02"),
    "28 March – 2 April 2026",
  );
  assert.equal(
    dateRange("2025-12-28", "2026-01-02"),
    "28 December 2025 – 2 January 2026",
  );
  assert.equal(dateRange("2026-08-18", "2026-08-18"), "18 August 2026");
  assert.equal(
    monthList(["2026-03", "2026-04", "2026-05"]),
    "March, April and May 2026",
  );
  assert.equal(privacyLabel("local"), "Private to this device");
  assert.equal(
    privacyLabel("account"),
    "Saved privately to your Claude account",
  );

  const shippedState = shipped();
  assert.equal(typicalMonth(derive(shippedState)), 590);
  const short = shipped();
  for (const [id, batch] of Object.entries(short.batches))
    if (batch.periods[0] > "2025-10") delete short.batches[id];
  assert.equal(typicalMonth(derive(short)), null);
  assert.ok(
    !findMoments(derive(short), short).some((m) =>
      ["cluster", "new"].includes(m.kind),
    ),
  );
});

test("a regular charge that stops becomes a question, as Worth a look's flags did", () => {
  const state = shipped();
  const latest = Object.values(state.batches).find(
    (b) => b.account === "Demo Card" && b.periods[0] === "2026-08",
  );
  latest.rows = latest.rows.filter((r) => r.merchant !== "Lantern Stream");
  const derived = derive(state);
  assert.ok(derived.flags.some((f) => f.type === "gone"));
  const stopped = findMoments(derived, state).find(
    (m) => m.kind === "gap" && m.facts.stopped,
  );
  assert.equal(stopped.facts.merchant, "Lantern Stream");
  assert.equal(kindLabel(stopped), "Stopped");
  assert.equal(
    questionText(stopped),
    "Lantern Stream last appeared on 15 July 2026, and not in August 2026. Want to add a note?",
  );
});
