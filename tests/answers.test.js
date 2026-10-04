import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { detectMoments, findMoments } from "../story/moments.js";
import { answerMoment, noteTargets } from "../story/answers.js";
import { PRIVACY_NOTE, privacyLabel, privacyText } from "../story/copy.js";

const TODAY = "2026-09-30";
function demo({ explained = false } = {}) {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  if (!explained) {
    state.periods = [];
    state.notes = {};
  }
  return state;
}
const derive = (state) => deriveTransactions(state, { today: TODAY });
const moment = (all, kind, name) =>
  all.find(
    (m) =>
      m.kind === kind &&
      (m.facts.merchant === name || m.facts.merchants?.includes(name)),
  );

test("naming a period answers the move and remembers the merchants", () => {
  const state = demo();
  const derived = derive(state);
  const move = moment(
    detectMoments(derived, state),
    "cluster",
    "Bluebell Removals",
  );
  const result = answerMoment(state, derived, move, {
    action: "period",
    text: "Moving house",
    at: "2026-10-04",
    periodId: "p-move",
  });
  assert.equal(
    result.message,
    "Saved a period, “Moving house”, 9–16 April 2026.",
  );
  assert.deepEqual(result.created, { periodId: "p-move" });
  assert.equal(result.answers[move.id].status, "answered");
  assert.equal(result.notes, state.notes);
  for (const key of move.facts.keys)
    assert.equal(result.merchantAnswers[key].choice, "Moving house");
  // The original documents are untouched, so Undo can put them back.
  assert.deepEqual(state.answers, {});
  assert.deepEqual(state.merchantAnswers, {});

  // With the period in place and the answer saved, the question is gone.
  Object.assign(state, result);
  state.periods = [
    { id: "p-move", name: "Moving house", start: move.from, end: move.to },
  ];
  assert.ok(!findMoments(derive(state), state).some((m) => m.id === move.id));
});

test("a note goes on the moment's transactions and can be undone", () => {
  const state = demo();
  const derived = derive(state);
  const all = detectMoments(derived, state);
  const garage = moment(all, "large", "Cobble Lane Garage");
  state.notes[garage.txnIds[0]] = "Tow";
  const result = answerMoment(state, derived, garage, {
    action: "note",
    text: "Clutch went on the ring road",
    at: "2026-10-04",
  });
  assert.deepEqual(result.created, { noteIds: garage.txnIds });
  assert.equal(
    result.notes[garage.txnIds[0]],
    "Tow Clutch went on the ring road",
  );
  assert.equal(result.notes[garage.txnIds[1]], "Clutch went on the ring road");
  assert.equal(state.notes[garage.txnIds[1]], undefined);
  assert.equal(result.message, "Added a note to two transactions.");

  // A suggested answer writes its label as the note.
  const paws = moment(all, "spike", "Meadow Paws");
  const suggested = answerMoment(state, derived, paws, {
    action: "note",
    label: "Vet visit",
    at: "2026-10-04",
  });
  assert.equal(suggested.notes[paws.txnIds[0]], "Vet visit");
  assert.equal(suggested.message, "Added a note to Meadow Paws.");
});

test("notes land on one sensible transaction for price changes and gaps", () => {
  const state = demo();
  const derived = derive(state);
  const all = detectMoments(derived, state);
  const stream = moment(all, "price", "Lantern Stream");
  assert.deepEqual(noteTargets(stream, derived), [stream.txnIds[1]]);
  const savings = moment(all, "gap", "Demo savings transfer");
  const [target] = noteTargets(savings, derived);
  assert.equal(derived.byId.get(target).date, "2025-11-24");
});

test("skip counts as an answer and the question doesn't come back", () => {
  const state = demo({ explained: true });
  const derived = derive(state);
  const open = findMoments(derived, state);
  const first = open[0];
  const result = answerMoment(state, derived, first, {
    action: "skip",
    at: "2026-10-04",
  });
  assert.equal(result.answers[first.id].status, "skipped");
  assert.deepEqual(result.merchantAnswers, {});
  assert.equal(result.created, null);
  Object.assign(state, result);
  assert.ok(!findMoments(derived, state).some((m) => m.id === first.id));
});

test("privacy wording follows where the data is stored", () => {
  const local = privacyText("local");
  assert.equal(local.label, "Private to this device");
  assert.equal(privacyLabel("local"), local.label);
  assert.match(local.details[0], /in this browser, on this device only/);
  assert.match(local.banner, /saved in this browser/);
  const account = privacyText("account");
  assert.equal(account.label, "Saved privately to your Claude account");
  assert.match(
    account.details[0],
    /in your Claude account, where only you can see them/,
  );
  assert.doesNotMatch(account.banner, /not sent anywhere/);
  for (const p of [local, account])
    assert.match(
      p.details[1],
      /Nothing goes to an assistant unless you press a button/,
    );
  assert.equal(PRIVACY_NOTE, "Optional. Only you can see your answer.");
});
