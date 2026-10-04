import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import {
  layoutTimeline,
  niceBudget,
  timeDomain,
} from "../ui/timeline-layout.js";

const TODAY = "2026-09-30";
function demo(change = () => {}) {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  change(state);
  return { state, derived: deriveTransactions(state, { today: TODAY }) };
}
const layout = ({ state, derived }, width = 1000) =>
  layoutTimeline({ derived, state, today: TODAY, width });

test("the time scale covers the data, today and three months ahead", () => {
  const d = demo();
  const [t0, t1] = timeDomain(d.derived, d.state, TODAY);
  assert.ok(t0 < Date.UTC(2025, 9, 1) && t1 > Date.UTC(2026, 11, 30));
  const recent = demo((s) => (s.range = "3"));
  const [r0] = timeDomain(recent.derived, recent.state, TODAY);
  assert.ok(Math.abs(r0 - (Date.UTC(2026, 5, 30) - 8 * 864e5)) < 864e5);
  const L = layout(d);
  assert.equal(L.X(t0), L.labelW);
  assert.ok(
    Math.abs(L.inv(L.X(Date.UTC(2026, 3, 1))) - Date.UTC(2026, 3, 1)) < 1,
  );
});

test("every shown transaction becomes one bead on its thread's row", () => {
  const d = demo();
  const L = layout(d);
  const shown = [...d.derived.txns, ...d.derived.extras];
  assert.equal(L.beads.length, shown.length);
  const rowOf = Object.fromEntries(L.visibleRows.map((r) => [r.name, r]));
  for (const it of L.beads) {
    const row = rowOf[it.t.thread];
    assert.ok(Math.abs(it.y - row.cy) <= 19, `${it.t.id} sits on its row`);
    assert.ok(it.r >= 3 && it.r <= 17);
  }
  // Rows go down the page without overlapping.
  const ys = L.visibleRows.map((r) => r.cy);
  assert.deepEqual(
    ys,
    [...ys].sort((a, b) => a - b),
  );
  assert.ok(L.H > ys.at(-1));
});

test("beads on one row don't overlap within a lane", () => {
  const L = layout(demo());
  for (const row of L.visibleRows) {
    const lanes = {};
    for (const it of L.beads.filter(
      (b) =>
        b.y - row.cy <= 19 && row.cy - b.y <= 19 && row.items.includes(b.t),
    ))
      (lanes[it.y] ||= []).push(it);
    for (const lane of Object.values(lanes)) {
      lane.sort((a, b) => a.x - b.x);
      const crowded = lane
        .slice(1)
        .filter((b, i) => b.x - lane[i].x <= b.r + lane[i].r);
      // Only when every lane is full does a bead share space.
      assert.ok(crowded.length <= lane.length / 2, row.name);
    }
  }
});

test("periods get lanes, and budgets get a band of monthly bars", () => {
  const d = demo((s) =>
    s.periods.push({
      id: "overlap",
      name: "Overlap",
      start: "2025-12-12",
      end: "2025-12-20",
      color: "#2F6B8F",
    }),
  );
  const L = layout(d);
  assert.equal(L.laneOf["demo-car"], 0);
  assert.equal(L.laneOf.overlap, 1);
  assert.equal(L.perBottom - L.perTop, 2 * L.laneH);
  const bills = L.visibleRows.find((r) => r.name === "Bills");
  assert.equal(bills.band.budget, 300);
  assert.ok(
    bills.band.bars.some((b) => b.over),
    "April is over budget",
  );
  assert.ok(L.budgetMeta.Bills.bandMax >= 300 * 1.35);
  const narrow = layout(d, 500);
  assert.equal(narrow.narrow, true);
  assert.equal(
    narrow.visibleRows.find((r) => r.name === "Bills").band,
    undefined,
  );
});

test("parked threads fold into one quiet row", () => {
  const d = demo((s) => (s.view.parked = ["Bills", "Groceries"]));
  const L = layout(d);
  const names = L.visibleRows.map((r) => r.name);
  assert.ok(!names.includes("Bills") && names.at(-1) === "__parked");
  assert.equal(L.visibleRows.at(-1).parked.length, 2);
});

test("budgets round to numbers a person would type", () => {
  assert.deepEqual(
    [0, -5, 47, 233, 1234].map(niceBudget),
    [0, 0, 50, 250, 1200],
  );
});
