import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { coveredMonths } from "../story/moment-kit.js";
import { monthAxis, oneMonthStory } from "../story/one-month.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const month = coveredMonths(derived).at(-1);
const story = oneMonthStory(derived, demo, month);
const words = (parts) => parts.map((p) => p.text).join("");

test("the day axis names each day's weekday", () => {
  const axis = monthAxis("2026-09");
  assert.equal(axis.length, 30);
  assert.deepEqual(axis[0], { day: 1, weekday: "T" });
  assert.deepEqual(axis[5], { day: 6, weekday: "S" });
});

test("one month's story says only what one month can say", () => {
  const text = [story.lead, ...story.paragraphs].map(words).join(" ");
  assert.match(text, /went out in August, in \d+ payments\./);
  assert.match(text, /was the busiest/);
  assert.match(text, /The largest single payment was/);
  for (const w of [
    "typical",
    "usual",
    "regular",
    "every month",
    "again",
    "new",
  ])
    assert.ok(!text.includes(w), `"${w}" needs more than one month`);
});

test("every dotted phrase lights up payments from that month", () => {
  const ids = new Set(story.rows.flatMap((r) => r.beads.map((b) => b.id)));
  for (const p of [story.lead, ...story.paragraphs].flat())
    for (const id of p.txnIds || []) {
      assert.equal(derived.byId.get(id).date.slice(0, 7), month);
      assert.ok(ids.has(id) || derived.byId.get(id).transfer);
    }
});

test("rows follow the real threads and their colours", () => {
  for (const r of story.rows) assert.equal(r.color, derived.colorOf[r.thread]);
  assert.ok(story.rows.some((r) => r.starter));
});

test("the maybe-regular question is asked only with one or two months", () => {
  assert.equal(story.question, null);
  const one = Object.fromEntries(
    Object.entries(demo.batches).filter(([, b]) =>
      JSON.stringify(b).includes(month),
    ),
  );
  const state = { ...demo, batches: one };
  const d = deriveTransactions(state, { today });
  const s = oneMonthStory(d, state, coveredMonths(d).at(-1));
  assert.match(s.question.text, /Is it something you pay every month\?$/);
  assert.equal(s.source[0], "Your first statements");
});
