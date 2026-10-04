import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { coveredMonths } from "../story/moment-kit.js";
import { largestSentence } from "../story/year-quiet.js";
import { withCurrency } from "../helpers.js";
import { fiveMonths } from "./fixtures/five-months.js";
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
  const y = yearStory(derived, demo, today);
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
  const y = yearStory(derived, demo, today);
  const phrases = [
    y.lead,
    ...y.sections.flatMap((s) => [...s.paragraphs, s.after ?? []]),
  ]
    .flat()
    .filter((p) => p.txnIds);
  assert.ok(phrases.length > 10);
  for (const p of phrases) {
    assert.ok(p.txnIds.length, p.text);
    for (const id of p.txnIds)
      assert.ok(
        derived.byId.has(id) || y.expected.some((e) => e.id === id),
        p.text,
      );
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
  const y = yearStory(d2, two, today);
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

test("the year's sections tell rhythms, a savings gap, a price change and what's ahead", () => {
  const y = yearStory(derived, demo, today);
  const all = y.sections.flatMap((s) => [...s.paragraphs, s.after ?? []]);
  const said = all.map(words).join("\n");
  assert.match(
    said,
    /You were at Paper Kite Cafe on the 9th of each of these three months, and of every month since\./,
  );
  assert.match(said, /₪150 went into Demo Savings on the 24th of each month\./);
  assert.match(
    said,
    /Nothing went into Demo Savings in December or January; it did in every other month\./,
  );
  assert.match(
    said,
    /One price changed in August: Lantern Stream went from ₪29 to ₪35\./,
  );
  // The statements end in August, so September is the month ahead (no
  // month is skipped), and its charges dated before today are counted.
  const ahead = y.sections.at(-1);
  assert.equal(ahead.label, "Sep 2026 and ahead");
  const coming = ahead.paragraphs.at(-1);
  assert.match(
    words(coming),
    /^Coming up, going by what repeats: about ₪267 in Bills in the first week of September, ₪35 to Lantern Stream on the 15th and ₪95 to Meadow Paws on the 18th\. Your September statement isn’t added yet/,
  );
  // Each phrase lights exactly the expected charges it names, and the band
  // draws every one of them.
  const lit = coming.find((p) => p.txnIds).txnIds;
  const byId = new Map(y.expected.map((e) => [e.id, e]));
  assert.equal(
    lit.reduce((a, id) => a + byId.get(id).amount, 0),
    267 + 35 + 95,
  );
  // A rhythm and a transfer are told once.
  assert.equal(said.match(/Paper Kite Cafe on the 9th/g).length, 1);
  assert.equal(said.match(/went into Demo Savings on/g).length, 1);
});

test("with two months there are no rhythms, gaps, price changes or expected charges", () => {
  const two = {
    ...demo,
    batches: Object.fromEntries(
      Object.entries(demo.batches).filter(([, b]) =>
        JSON.stringify(b).match(/2026-0[78]/),
      ),
    ),
  };
  const d2 = deriveTransactions(two, { today });
  assert.equal(coveredMonths(d2).length, 2);
  const y = yearStory(d2, two, today);
  const said = y.sections
    .flatMap((s) => [...s.paragraphs, s.after ?? []])
    .map(words)
    .join("\n");
  for (const w of [
    "of every month",
    "Nothing went",
    "price changed",
    "Coming up",
  ])
    assert.ok(!said.includes(w), `"${w}" needs three months`);
});

test("what's ahead counts charges due before today, and is told only while that month is current", () => {
  // Statements to September, today 4 October: October's Bills on the 1st to
  // the 3rd are expected too (M3 verifier finding 3).
  const oct = "2026-10-04";
  const d4 = { ...createRuntime().state, ...createDemoData(oct) };
  const derived4 = deriveTransactions(d4, { today: oct });
  assert.equal(coveredMonths(derived4).at(-1), "2026-09");
  const y = yearStory(derived4, d4, oct);
  const coming = y.sections.at(-1).paragraphs.at(-1);
  assert.match(
    words(coming),
    /^Coming up, going by what repeats: about ₪267 in Bills in the first week of October/,
  );
  const byId = new Map(y.expected.map((e) => [e.id, e]));
  const lit = coming.find((p) => p.txnIds).txnIds;
  assert.ok(lit.every((id) => byId.get(id)?.date.startsWith("2026-10")));
  assert.ok(lit.some((id) => byId.get(id).date < oct));
  // Statements to August, today 4 October: September is over and October
  // isn't the month after the statements, so nothing is told as coming up
  // and no month is skipped (finding 2).
  const late = yearStory(derived, demo, oct);
  const said = late.sections
    .flatMap((s) => [...s.paragraphs, s.after ?? []])
    .map(words)
    .join("\n");
  assert.doesNotMatch(said, /Coming up/);
  assert.deepEqual(late.expected, []);
});

test("a price change that holds for two months or more is told", () => {
  // Lantern Stream went from ₪29 to ₪35 in July and stayed there in August
  // (M3 verifier finding 4); findChanges only flags a change in the last month.
  const held = structuredClone(demo);
  for (const b of Object.values(held.batches))
    for (const r of b.rows)
      if (r.merchant === "Lantern Stream" && r.date.startsWith("2026-07"))
        r.amount = 35;
  const d = deriveTransactions(held, { today });
  const y = yearStory(d, held, today);
  const said = y.sections
    .flatMap((s) => [...s.paragraphs, s.after ?? []])
    .map(words)
    .join("\n");
  assert.match(
    said,
    /One price changed in July: Lantern Stream went from ₪29 to ₪35\./,
  );
  assert.equal(said.match(/Lantern Stream went from/g).length, 1);
});

// Money is spaced with a no-break space; compared with a plain one.
const flat = (parts) => words(parts).replace(/[\u00a0\u202f]/g, " ");

// The M3 verifier's five-month CSV: ZAR, April to August, no thread catching
// anything, read on 4 October.
const five = (() => {
  const st = { ...createRuntime().state, ...fiveMonths() };
  const d = deriveTransactions(st, { today: "2026-10-04" });
  return withCurrency("ZAR", () => ({
    d,
    y: yearStory(d, st, "2026-10-04"),
    m: yearMonthStory(d, st, "2026-08", {}),
  }));
})();
const told = (y) =>
  y.sections
    .flatMap((s) => [...s.paragraphs, s.after ?? []])
    .map(flat)
    .join("\n");

test("statements ending in August, read in October, tell nothing as coming up", () => {
  const said = told(five.y);
  assert.doesNotMatch(said, /Coming up/);
  assert.deepEqual(five.y.expected, []);
  assert.equal(five.y.sections.at(-1).label, "Aug 2026 and ahead");
  // Streamly: ZAR 99 April to June, ZAR 129 in July and August.
  assert.match(
    said,
    /One price changed in July: Streamly went from ZAR 99 to ZAR 129\./,
  );
});

test("a largest payment shared by every month is told as a rhythm", () => {
  const p = five.y.sections
    .flatMap((s) => s.paragraphs)
    .find((p) => flat(p).startsWith("The largest single payment"));
  assert.equal(
    flat(p),
    "The largest single payment was ZAR 6,500 to Hilltop Flats on the 1st, every month.",
  );
  // It lights all four rents in the run, April to July.
  assert.equal(p.find((x) => x.txnIds).txnIds.length, 4);
});

test("several merchants sharing the largest amount are all named", () => {
  const ts = [
    { id: "a", date: "2026-04-02", merchant: "North", amount: 50 },
    { id: "b", date: "2026-05-09", merchant: "South", amount: 50 },
    { id: "c", date: "2026-05-10", merchant: "East", amount: 20 },
  ];
  const p = withCurrency("ZAR", () =>
    largestSentence(ts, ["2026-04", "2026-05"], ts[0]),
  );
  assert.equal(
    flat(p),
    "The largest single payments were ZAR 50 each, to North and South.",
  );
  assert.deepEqual(p.find((x) => x.txnIds).txnIds, ["a", "b"]);
  const twice = [ts[0], { ...ts[1], merchant: "North", date: "2026-05-04" }];
  assert.equal(
    flat(
      withCurrency("ZAR", () =>
        largestSentence(twice, ["2026-04", "2026-05", "2026-06"], ts[0]),
      ),
    ),
    "The largest single payment was ZAR 50 to North, twice.",
  );
});

test("a month with no thread names its merchants, and offers no Numbers", () => {
  const said = five.m.paragraphs.map(flat).join("\n");
  assert.doesNotMatch(said, /Loose ends/);
  assert.match(
    said,
    /The regular things stayed close to usual: ZAR 9,375 to Hilltop Flats, Fresh Mart and three others\./,
  );
  assert.equal(five.m.numbersHint, false);
});
