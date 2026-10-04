import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { answerStory, suggestionWhat } from "../story/saved-question.js";
import { rerunGoes } from "../assistant/prompts.js";
import { savedHTML } from "../components/tx-year-saved.js";
import { notesHTML } from "../components/tx-year-story.js";

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

// M4-VERIFY finding 1: the label "each sentence checked against your
// transactions" only when every figure was compared with the cited payments.
test("an answer is checked only when every figure in it was compared and matched", () => {
  const garage = derived.allTxns.filter(
    (t) => t.merchant === "Cobble Lane Garage",
  );
  const cite = garage.map((t) => `[[${t.id}]]`).join(" ");
  const total = garage.reduce((a, t) => a + t.amount, 0);
  assert.equal(total, 1600);
  const checked = (sentence) =>
    answerStory(`${sentence} ${cite}`, derived.byId).checked;
  // Right: amounts in the payments' own currency, each one matched.
  assert.equal(checked("Cobble Lane Garage came to ₪1,600."), true);
  assert.equal(
    checked(
      `Cobble Lane Garage came to ₪1,600: ₪${garage[0].amount.toLocaleString("en")} and ₪${garage[1].amount.toLocaleString("en")}.`,
    ),
    true,
  );
  assert.equal(checked("Cobble Lane Garage came to ILS 1,600."), true);
  // The verifier's probes.
  assert.equal(checked("Cobble Lane Garage came to ₪1,700."), false);
  assert.equal(checked("Cobble Lane Garage came to 1700."), false);
  assert.equal(checked("Cobble Lane Garage came to 1,700 shekels."), false);
  assert.equal(
    checked("You paid Cobble Lane Garage 9 times, ₪1,600 in all."),
    false,
  );
  assert.equal(checked("Cobble Lane Garage came to $1,600."), false);
  assert.equal(checked("Cobble Lane Garage came to ₪1,600 on 30 June."), false);
  // A count in words can't be compared either.
  assert.equal(
    checked("You paid Cobble Lane Garage nine times, ₪1,600 in all."),
    false,
  );
  // An unknown code is never matched.
  assert.equal(checked("Cobble Lane Garage came to USD 1,600."), false);
});

// Privacy review 5: a suggestion over several merchants names each payment
// before Apply, rather than "these three payments".
test("a suggested change across merchants names each payment", () => {
  const ts = derived.txns.filter((t) => t.amount > 0).slice(0, 40);
  const a = ts[0];
  const b = ts.find((t) => t.merchant !== a.merchant);
  const what = plain(
    suggestionWhat({ tags: ["#x"], txnIds: [a.id, b.id] }, derived.byId),
  );
  assert.match(what, /^these two payments: /);
  for (const t of [a, b]) assert.ok(what.includes(t.merchant), what);
});

// Privacy review 4: Run again shows what goes, including the earlier answer,
// and sends only from that card's Send.
test("Run again shows what goes before anything is sent", () => {
  const goes = rerunGoes({
    question: "What did taxis cost?",
    ai: "ChatGPT",
    tools: true,
    ranAt: "2026-10-04",
  });
  assert.match(goes.goes.at(-1), /answer from the last run, on 2026-10-04/);
  const r = { id: "r1", q: "What did taxis cost?", answer: "", by: "" };
  const story = answerStory("", derived.byId);
  const opts = { canRun: true, byId: derived.byId, ai: "ChatGPT" };
  const idle = savedHTML(r, story, opts);
  assert.match(idle, /data-run-question="r1"/);
  assert.doesNotMatch(idle, /data-rerun-send/);
  const shown = savedHTML(r, story, { ...opts, rerun: { id: "r1", ...goes } });
  assert.match(shown, /Ready to send to ChatGPT/);
  assert.match(shown, /data-rerun-send="r1"/);
  assert.ok(shown.includes("answer from the last run"));
});

// The person's feedback: "Your notes" as a real table, tags as chips.
test("Your notes is a table with Date, Payment, Amount and Note", () => {
  const html = notesHTML([
    {
      date: "2026-01-10",
      merchant: "Cobble Lane Garage",
      amount: 120,
      currency: "ILS",
      text: "Tow home after the clutch went. #car #repair",
    },
  ]);
  assert.match(html, /<table class="yr-notetable"><caption[^>]*>Your notes</);
  assert.deepEqual(
    [...html.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]),
    ["Date", "Payment", "Amount", "Note"],
  );
  assert.match(html, /<td[^>]*>Cobble Lane Garage<\/td>/);
  assert.match(html, /₪120/);
  assert.equal([...html.matchAll(/class="yr-tag">#/g)].length, 2);
  assert.match(html, /<span>Tow home after the clutch went\.<\/span>/);
});
