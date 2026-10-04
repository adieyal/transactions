import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { manyStory, oneStory } from "../story/bench.js";
import { plain } from "../story/copy.js";
import {
  answerStory,
  figures,
  latestPayment,
  sinceLastRun,
  suggestionWhat,
} from "../story/saved-question.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const car = derived.txns.filter(
  (t) => t.kind === "actual" && t.periods?.includes("The car broke down"),
);
const garage = car.filter((t) => t.merchant === "Cobble Lane Garage");

test("one bead: a one-line story, then how often", () => {
  const said = plain(oneStory(garage.at(-1), derived.txns, 12));
  assert.equal(
    said,
    "₪1,480 at Cobble Lane Garage on 13 December, during “The car broke down”. You paid Cobble Lane Garage 2 times in these twelve months.",
  );
  const ghost = derived.expected.find((t) => t.amount > 0);
  assert.match(
    plain(oneStory(ghost, derived.txns, 12)),
    /^Expected around \d+ \w+: about ₪[\d,]+, going by what repeats\.$/,
  );
});

test("several beads told as a story, without an assistant", () => {
  const m = manyStory(car, demo.periods);
  assert.equal(m.title, `${car.length} beads`);
  const sum = car.reduce((a, t) => a + t.amount, 0);
  assert.match(
    plain(m.sub),
    /on statements, 10 December 2025 to 13 December 2025$/,
  );
  assert.equal(
    plain(m.told),
    `₪${sum.toLocaleString("en-US")} went out in ${car.length} payments between 10 December and 13 December. Cobble Lane Garage came to ₪1,600 of it, in 2 payments. All of it was during “The car broke down”.`,
  );
  assert.deepEqual(m.tags, ["#car 2"]);
});

test("an answer is checked only when each sentence's amounts are its payments'", () => {
  assert.deepEqual(
    figures("₪1,600 to X, and ZAR 119; $12.50 or 26.50€"),
    [1600, 119, 12.5, 26.5],
  );
  const [a, b] = garage;
  const ok = answerStory(
    `The garage came to ₪1,600 [[${a.id}]] [[${b.id}]]. The repair itself was ₪1,480 [[${b.id}]].`,
    derived.byId,
  );
  assert.equal(ok.checked, true);
  const wrong = answerStory(
    `The garage came to ₪1,700 [[${a.id}]] [[${b.id}]].`,
    derived.byId,
  );
  assert.equal(wrong.checked, false);
  assert.equal(wrong.unchecked, false, "cited, so not struck");
  const uncited = answerStory(
    `The garage came to ₪1,600 [[${a.id}]] [[${b.id}]]. Repairs are dear.`,
    derived.byId,
  );
  assert.equal(uncited.checked, false);
});

test("since the last run: new payments to the merchants the answer cites", () => {
  const paws = derived.txns.filter(
    (t) => t.kind === "actual" && t.merchant === "Meadow Paws",
  );
  const story = answerStory(`Pixel cost ₪55 [[${paws[0].id}]].`, derived.byId);
  const latest = latestPayment(derived);
  assert.equal(sinceLastRun({ prevThrough: "" }, story, derived), null);
  assert.equal(
    plain(sinceLastRun({ prevThrough: latest }, story, derived)),
    "Since the last run: no new payments to Meadow Paws.",
  );
  const last = paws.at(-1);
  const before = paws.at(-2).date;
  assert.equal(
    plain(sinceLastRun({ prevThrough: before }, story, derived)),
    `Since the last run: 1 new payment to Meadow Paws, ₪${last.amount}.`,
  );
});

test("a suggested change is taken out of the answer and offered", () => {
  const [a, b] = garage;
  const s = answerStory(
    `The garage came to ₪1,600 [[${a.id}]] [[${b.id}]].\n\nSuggested change: add #Car to [[${a.id}]] [[${b.id}]] [[nope]]`,
    derived.byId,
  );
  assert.deepEqual(s.suggestion, { tags: ["#car"], txnIds: [a.id, b.id] });
  assert.equal(s.paragraphs.flat().length, 1);
  assert.equal(s.checked, true);
  assert.equal(
    plain(suggestionWhat(s.suggestion, derived.byId)),
    "the two Cobble Lane Garage payments",
  );
  assert.equal(answerStory("No change here.", derived.byId).suggestion, null);
});
