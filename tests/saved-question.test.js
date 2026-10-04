import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { answerStory } from "../story/saved-question.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const plain = (s) => s.replace(/[⁨⁩]/g, "");

test("an answer's sentences light their cited payments; uncited ones are unchecked", () => {
  const garage = derived.allTxns.filter(
    (t) => t.merchant === "Cobble Lane Garage",
  );
  assert.equal(garage.length, 2);
  const [a, b] = garage.map((t) => t.id);
  const answer = `December came to **₪2,207**, mostly the car: ₪1,600 to Cobble Lane Garage [[${a}]] [[${b}]]. Energy prices usually rise in winter.\n\n- One more [[nope]].`;
  const s = answerStory(answer, derived.byId);
  assert.equal(s.paragraphs.length, 2);
  const [first, second] = s.paragraphs[0];
  assert.equal(
    first.text,
    "December came to ₪2,207, mostly the car: ₪1,600 to Cobble Lane Garage.",
  );
  assert.deepEqual(first.txnIds, [a, b]);
  assert.equal(second.text, "Energy prices usually rise in winter.");
  assert.equal(second.unchecked, true);
  // An id that isn't a payment ties nothing.
  assert.equal(s.paragraphs[1][0].unchecked, true);
  assert.equal(s.unchecked, true);
  assert.deepEqual(
    s.chips.map((c) => plain(c.text)),
    ["Cobble Lane Garage · 2 payments"],
  );
});

test("chips name one payment by its day, and repeats by their amount", () => {
  const paws = derived.allTxns
    .filter((t) => t.merchant === "Paper Kite Cafe")
    .slice(0, 1);
  const s = answerStory(`One visit [[${paws[0].id}]].`, derived.byId);
  assert.match(
    plain(s.chips[0].text),
    /^Paper Kite Cafe · \d+ [A-Z][a-z]{2} · ₪\d+$/,
  );
  assert.equal(s.unchecked, false);
  assert.deepEqual(answerStory("", derived.byId).paragraphs, []);
});
