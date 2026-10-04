import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { coveredMonths } from "../story/moment-kit.js";
import {
  monthRange,
  shortRange,
  yearMonthStory,
  yearStory,
} from "../story/year.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const words = (parts) =>
  parts
    .map((p) => p.chip ?? p.text)
    .join("")
    .replace(/[⁨⁩]/g, "");

test("section dates read as drawn", () => {
  assert.equal(shortRange("2025-12-10", "2025-12-13"), "10 – 13 Dec 2025");
  assert.equal(shortRange("2026-03-28", "2026-04-02"), "28 Mar – 2 Apr 2026");
  assert.equal(monthRange("2025-10", "2025-11"), "Oct – Nov 2025");
  assert.equal(monthRange("2025-11", "2026-02"), "Nov 2025 – Feb 2026");
});

test("the year is told from the first month to the last, with a typical month", () => {
  const ms = coveredMonths(derived);
  const y = yearStory(derived, demo);
  assert.equal(y.title.split(" to ").length, 2);
  assert.match(words(y.lead), /went out over these twelve months\./);
  assert.match(words(y.lead), /Most months came to about/);
  // Every month is in exactly one section, in date order.
  const froms = y.sections.map((s) => s.from);
  assert.deepEqual(froms, [...froms].sort());
  assert.equal(y.sections[0].from.slice(0, 7), ms[0]);
  // The car and the holiday are headed by their names, with the person's
  // own description kept apart.
  const car = y.sections.find((s) => s.chip === "The car broke down");
  assert.ok(car?.note?.label === "Your description");
  assert.ok(!words(car.paragraphs.flat()).includes(car.note.text));
  // A busy stretch is described by amount, days and merchants only.
  const stretch = y.sections.find((s) => s.stretch);
  assert.match(words(stretch.paragraphs[0]), /went out in \w+ days: /);
  assert.ok(!/\?/.test(words(stretch.paragraphs[0])));
});

test("every underlined phrase lights up payments that exist", () => {
  const y = yearStory(derived, demo);
  const phrases = [
    y.lead,
    ...y.sections.flatMap((s) => [...s.paragraphs, s.after ?? []]),
  ]
    .flat()
    .filter((p) => p.txnIds);
  assert.ok(phrases.length > 10);
  for (const p of phrases) {
    assert.ok(p.txnIds.length, p.text);
    for (const id of p.txnIds) assert.ok(derived.byId.has(id), p.text);
  }
});

test("with two months there is no typical month", () => {
  const ms = coveredMonths(derived).slice(-2);
  const two = {
    ...demo,
    periods: [],
    batches: Object.fromEntries(
      Object.entries(demo.batches).filter(([, b]) =>
        b.periods.every((m) => ms.includes(m)),
      ),
    ),
  };
  const d2 = deriveTransactions(two, { today });
  assert.equal(coveredMonths(d2).length, 2);
  const y = yearStory(d2, two);
  const text = [y.lead, ...y.sections.flatMap((s) => s.paragraphs)]
    .map(words)
    .join(" ");
  assert.match(text, /went out over these two months\./);
  for (const w of ["typical", "usual", "every month"])
    assert.ok(!text.includes(w), `"${w}" needs three months`);
});

test("the month inside the year keeps budgets for Numbers", () => {
  const m = coveredMonths(derived).at(-2);
  const off = yearMonthStory(derived, demo, m);
  const on = yearMonthStory(derived, demo, m, { numbers: true });
  assert.ok(off.lead.length);
  assert.equal(off.numbersHint, true);
  assert.equal(on.numbersHint, false);
  assert.ok(on.paragraphs.length > off.paragraphs.length);
});
