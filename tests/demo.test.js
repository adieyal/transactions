import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { findMoments } from "../story/moments.js";
import { questionText } from "../story/copy.js";

test("fictional demo covers forecasts, price changes, refunds, transfers and instalments", () => {
  const demo = createDemoData("2026-09-30");
  const { state } = createRuntime();
  Object.assign(state, demo);
  const before = structuredClone(state);
  const result = deriveTransactions(state, { today: "2026-09-30" });
  assert.deepEqual(state, before);
  assert.equal(Object.keys(demo.batches).length, 36);
  assert.deepEqual(result.accounts, [
    "Demo Card",
    "Demo Everyday",
    "Demo Savings",
  ]);
  assert.ok(
    result.allTxns.every(
      (t) => t.id.startsWith("demo-") && t.file.startsWith("fictional-"),
    ),
  );
  assert.ok(result.allTxns.some((t) => t.amount < 0 && !t.transfer));
  assert.ok(result.allTxns.some((t) => t.transfer?.kind === "pair"));
  assert.ok(result.allTxns.some((t) => t.transfer?.kind === "card"));
  assert.ok(result.expected.length > 0);
  assert.ok(
    result.flags.some(
      (f) => f.type === "price" && f.t.merchant === "Lantern Stream",
    ),
  );
  assert.ok(
    result.extras.some((t) => t.kind === "purchase" && t.amount === 360),
  );
  assert.ok(
    result.allTxns.some((t) => t.periods.includes("Holiday in Lantern Bay")),
  );
  assert.ok(result.allTxns.every((t) => t.thread !== "Loose ends"));
  assert.ok(
    result.allTxns.some(
      (t) => t.thread === "Car" && t.periods.includes("The car broke down"),
    ),
  );
  assert.ok(!result.flags.some((f) => f.type === "gone"));
});

test("a fresh demo explains the car and the holiday and leaves the move open", () => {
  const demo = createDemoData("2026-09-30");
  const { state } = createRuntime();
  Object.assign(state, demo);
  const result = deriveTransactions(state, { today: "2026-09-30" });
  assert.deepEqual(
    demo.periods.map((p) => p.id),
    ["demo-car", "demo-trip"],
  );
  const noted = (merchant) =>
    result.allTxns.filter((t) => t.merchant === merchant && t.note).length;
  assert.equal(noted("Cobble Lane Garage"), 2);
  assert.equal(noted("Lantern Bay Guesthouse"), 1);
  // The move's purchases are all there, in April, with no period or notes.
  const move = result.allTxns.filter(
    (t) =>
      t.date >= "2026-04-09" && t.date <= "2026-04-27" && t.thread === "Home",
  );
  assert.deepEqual(
    move.map((t) => `${t.date.slice(8)} ${t.merchant} ${t.amount}`).sort(),
    [
      "09 Bluebell Removals 640",
      "11 Kettle & Coil 890",
      "12 Kettle & Coil 540",
      "14 Kettle & Coil 75",
      "15 Northgate Hardware 48",
      "16 Linen Lane 120",
      "22 Northgate Hardware 32",
      "27 Northgate Hardware 64",
    ],
  );
  assert.ok(move.every((t) => !t.note && !t.periods.length));
  const question = findMoments(result, state).find(
    (m) => m.kind === "cluster" && m.month === "2026-04",
  );
  assert.equal(
    questionText(question),
    "₪2,313 went to Bluebell Removals, Kettle & Coil, Northgate Hardware and Linen Lane within a week. Want to name this period?",
  );
});

test("demo savings pause for two months after the car repair", () => {
  const demo = createDemoData("2026-09-30");
  const saved = Object.values(demo.batches)
    .flatMap((batch) => batch.rows)
    .filter((r) => r.merchant === "Demo savings transfer")
    .map((r) => r.period);
  assert.equal(saved.length, 10);
  assert.ok(!saved.includes("2025-12") && !saved.includes("2026-01"));
});

test("demo dates stay in completed months across a year boundary, and instances are independent", () => {
  const a = createDemoData("2027-01-01"),
    b = createDemoData("2027-01-01");
  const rows = Object.values(a.batches).flatMap((batch) => batch.rows);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.period))],
    [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ],
  );
  assert.ok(rows.every((r) => r.chargeDate < "2027-01-01"));
  rows[0].merchant = "Edited";
  assert.notEqual(Object.values(b.batches)[0].rows[0].merchant, "Edited");
});
