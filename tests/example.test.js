import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData, demoMoments } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { exampleStrip } from "../story/example.js";

const today = "2026-09-30";
const demo = createDemoData(today);
const derived = deriveTransactions(
  { ...createRuntime().state, ...demo },
  { today },
);

test("Sam's year has the car repair, the house move and the holiday", () => {
  const rows = Object.values(demo.batches).flatMap((b) => b.rows);
  const on = (merchant) => rows.find((t) => t.merchant === merchant)?.date;
  const [car, move, holiday] = demoMoments(today);
  assert.equal(on("Cobble Lane Garage"), car.date);
  assert.equal(on("Bluebell Removals"), move.date);
  assert.equal(on("Lantern Bay Ferry"), holiday.date);
  assert.deepEqual(
    demo.periods.map((p) => p.start),
    [car.date, holiday.date],
  );
});

test("the example strip draws the year's biggest threads along time", () => {
  const strip = exampleStrip(derived, demoMoments(today));
  assert.equal(strip.rows.length, 5);
  for (const row of strip.rows) {
    assert.match(row.color, /^#[0-9A-Fa-f]{6}$/);
    assert.ok(row.dots.length);
    for (const d of row.dots) {
      assert.ok(d.left >= 0 && d.left < 100);
      assert.ok(d.size >= 6 && d.size <= 16);
    }
  }
  assert.deepEqual(
    strip.moments.map((m) => m.label),
    ["Car", "Move", "Holiday"],
  );
  const [car, move, holiday] = strip.moments.map((m) => m.left);
  assert.ok(car < move && move < holiday && holiday < 100);
});

test("an empty workspace has no strip", () => {
  const empty = deriveTransactions(createRuntime().state, { today });
  assert.deepEqual(exampleStrip(empty, demoMoments(today)), {
    rows: [],
    moments: [],
  });
});
