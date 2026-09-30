import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";

test("fictional demo covers forecasts, price changes, refunds, transfers and instalments", () => {
  const demo = createDemoData("2026-09-30");
  const { state } = createRuntime();
  Object.assign(state, demo);
  const before = structuredClone(state);
  const result = deriveTransactions(state, { today: "2026-09-30" });
  assert.deepEqual(state, before);
  assert.equal(Object.keys(demo.batches).length, 9);
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
    result.allTxns.some((t) => t.periods.includes("Weekend in Lantern Bay")),
  );
  assert.ok(result.allTxns.every((t) => t.thread !== "Loose ends"));
});

test("demo dates stay in completed months across a year boundary, and instances are independent", () => {
  const a = createDemoData("2027-01-01"),
    b = createDemoData("2027-01-01");
  const rows = Object.values(a.batches).flatMap((batch) => batch.rows);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.period))],
    ["2026-10", "2026-11", "2026-12"],
  );
  assert.ok(rows.every((r) => r.chargeDate < "2027-01-01"));
  rows[0].merchant = "Edited";
  assert.notEqual(Object.values(b.batches)[0].rows[0].merchant, "Edited");
});
