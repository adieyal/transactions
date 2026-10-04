import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { detectMoments, findMoments } from "../story/moments.js";
import { summarizeMonth } from "../story/summary.js";
import { summarizePeriod } from "../story/period-story.js";
import { summarizeThread } from "../story/thread-story.js";
import { answerOptions } from "../story/copy.js";
import {
  answerSuggestionPrompt,
  parseAnswerSuggestions,
  polishPrompt,
  polishSummary,
  suggestAnswers,
  validatePolish,
} from "../story/assist.js";

const TODAY = "2026-09-30";
function setup() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  const derived = deriveTransactions(state, { today: TODAY });
  const april = summarizeMonth(derived, state, "2026-04");
  const move = detectMoments(derived, state).find((m) => m.kind === "cluster");
  const ids = (kind) =>
    april.find((s) => s.kind === kind).parts.find((p) => p.txnIds).txnIds;
  return { state, derived, april, move, ids };
}
// A pretend assistant that records what it was sent.
function mock(reply) {
  const calls = [];
  const sample = async (input, opts) => {
    calls.push({ input, opts });
    return { text: typeof reply === "function" ? reply(input) : reply };
  };
  return { sample, calls };
}

test("a valid polish keeps every sentence tied to its transactions", async () => {
  const { april, ids } = setup();
  const overview = ids("overview"),
    savings = ids("savings");
  const { sample, calls } = mock(
    `April 2026 was a big month for you: ₪3,136 went out, about five times a typical month. [[${overview.join(",")}]]\n\nYou also moved ₪150 from Demo Everyday to Demo Savings [[${savings.join(", ")}]].`,
  );
  const result = await polishSummary(sample, april, "2026-04");
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.sentences.map((s) => s.text),
    [
      "April 2026 was a big month for you: ₪3,136 went out, about five times a typical month.",
      "You also moved ₪150 from Demo Everyday to Demo Savings.",
    ],
  );
  assert.deepEqual(result.sentences[0].txnIds, overview);
  assert.deepEqual(result.sentences[1].txnIds, savings);
  // The prompt carries the facts with their ids, not the person's own words
  // or the questions.
  assert.match(calls[0].input, /April was a big month: ₪3,136 went out/);
  assert.ok(calls[0].input.includes(`[[${overview.join(",")}]]`));
  assert.doesNotMatch(calls[0].input, /Want to name this period/);
});

test("uncited, foreign or invented output falls back to the template", () => {
  const { april, ids, derived } = setup();
  const overview = ids("overview").join(",");
  const cases = [
    [
      "₪3,136 went out in April. That's a lot more than usual.",
      /didn't cite its transactions/,
    ],
    [
      `₪3,136 went out in April. [[${overview}]] You spent the rest on fun. `,
      /didn't cite its transactions/,
    ],
    [
      `₪3,136 went out in April. [[${derived.allTxns.find((t) => t.date.startsWith("2026-08")).id}]]`,
      /aren't in April 2026/,
    ],
    [`₪3,136 went out in April. [[made-up-id]]`, /aren't in April 2026/],
    [
      `₪3,136 went out, ₪2,500 more than a typical month. [[${overview}]]`,
      /figure that isn't in the summary \(2500\)/,
    ],
    [
      `₪3,136 went out, 430% of a typical month. [[${overview}]]`,
      /figure that isn't in the summary \(430\)/,
    ],
    ["", /empty/],
    ["```\n```", /empty/],
  ];
  for (const [reply, reason] of cases) {
    const result = validatePolish(reply, april, "2026-04");
    assert.equal(result.ok, false, reply);
    assert.match(result.reason, reason);
  }
});

test("suggested answers are short labels without figures", async () => {
  const { move } = setup();
  const prompt = answerSuggestionPrompt(move);
  assert.match(
    prompt,
    /Bluebell Removals, Kettle & Coil, Northgate Hardware, Linen Lane/,
  );
  assert.match(prompt, /₪2,313 went to/);

  const { sample, calls } = mock(
    '```json\n{"answers": ["Moving house", "New flat", "moving house", "Renovating"]}\n```',
  );
  const result = await suggestAnswers(sample, move);
  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    ok: true,
    labels: ["Moving house", "New flat", "Renovating"],
  });
  // They join the options, after the merchant and keyword suggestions.
  const labels = answerOptions(move, {}, result.labels).map((o) => o.label);
  assert.deepEqual(labels, [
    "Moving house",
    "New flat",
    "Renovating",
    "Name this period",
    "Write a note",
    "Skip",
  ]);

  for (const [reply, reason] of [
    ["Moving house, probably", /expected shape/],
    ['{"answers": []}', /no answers/],
    ['{"answers": ["Moving house", "Spent ₪2,313"]}', /brought in a figure/],
    ['{"answers": [42]}', /plain text/],
  ])
    assert.match(parseAnswerSuggestions(reply).reason, reason);
});

test("nothing goes to the assistant without a press", () => {
  const { state, derived } = setup();
  const { sample, calls } = mock("should never be read");
  const runtime = { state, derived, caps: { sample } };
  // Everything the app shows on its own: moments, questions, every month's
  // summary, period and thread summaries, and answer options.
  for (const month of ["2025-12", "2026-04", "2026-08"])
    summarizeMonth(runtime.derived, state, month);
  for (const p of state.periods) summarizePeriod(derived, state, p);
  for (const name of derived.names) summarizeThread(derived, state, name);
  for (const m of findMoments(derived, state)) answerOptions(m, {});
  // Building a prompt doesn't send it either.
  polishPrompt(summarizeMonth(derived, state, "2026-04"), "2026-04");
  assert.equal(calls.length, 0);
});
