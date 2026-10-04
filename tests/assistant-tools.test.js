import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import {
  compactTxn,
  filterTxns,
  findTransactions,
  listMerchants,
  nameChanges,
  noteChanges,
  totals,
} from "../assistant/tools.js";

const TODAY = "2026-09-30";
function demo() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  return { state, derived: deriveTransactions(state, { today: TODAY }) };
}
const compactFor = (state) => (t) =>
  compactTxn(t, { rules: state.rules, transferText: () => "a transfer" });

test("filters find transactions by text, thread, dates, amounts and period", () => {
  const { derived } = demo();
  const cafe = filterTxns(derived, { text: "paper kite" });
  assert.equal(cafe.length, 14);
  assert.ok(cafe.every((t) => t.merchant === "Paper Kite Cafe"));
  assert.ok(filterTxns(derived, {}).every((t) => !t.transfer));
  assert.ok(
    filterTxns(derived, { include_transfers: true }).some((t) => t.transfer),
  );
  const april = filterTxns(derived, {
    from: "2026-04-01",
    to: "2026-04-30",
    min: 500,
  });
  assert.deepEqual(
    april.map((t) => t.amount).sort((a, b) => a - b),
    [540, 640, 890],
  );
  assert.ok(
    filterTxns(derived, { period: "lantern" }).every((t) =>
      t.periods.includes("Holiday in Lantern Bay"),
    ),
  );
});

test("find_transactions and totals answer from the same filters", () => {
  const { state, derived } = demo();
  const found = findTransactions(
    derived,
    { thread: "Bills", limit: 3 },
    compactFor(state),
  );
  assert.equal(found.rows.length, 3);
  assert.ok(found.rows[0].date >= found.rows[1].date, "newest first");
  assert.match(found.rows[0].rule, /^line \d+: /);
  assert.equal(found.rows[0].kind, undefined, "statement rows have no kind");

  const byMonth = totals(derived, { group_by: "month", thread: "Bills" });
  assert.deepEqual(
    byMonth.map((x) => x.key),
    [...byMonth.map((x) => x.key)].sort(),
  );
  assert.equal(
    byMonth.reduce((s, x) => s + x.total, 0).toFixed(2),
    found.total.toFixed(2),
  );
  const byThread = totals(derived, { group_by: "thread" });
  assert.ok(byThread[0].total >= byThread[1].total, "largest first");

  const merchants = listMerchants(derived);
  assert.ok(merchants.some((m) => m.original === "Lantern Stream"));
  assert.ok(merchants[0].total >= merchants[1].total);
});

test("update_notes appends or replaces, and records how to undo", () => {
  const { state, derived } = demo();
  const id = derived.allTxns.find((t) => t.merchant === "Meadow Paws").id;
  const first = noteChanges(derived, state.notes, [
    { id, text: "#checked" },
    { merchant: "Lantern Stream", text: "Streaming" },
    { merchant: "Nobody", text: "x" },
  ]);
  assert.match(first.notes[id], /#pets\n#checked$/);
  assert.equal(first.undo[id], state.notes[id]);
  const streams = derived.allTxns.filter(
    (t) => t.merchant === "Lantern Stream",
  );
  assert.ok(streams.every((t) => first.notes[t.id] === "Streaming"));
  assert.ok(streams.every((t) => first.undo[t.id] === ""));
  assert.deepEqual(first.result, {
    changed: 1 + streams.length,
    not_found: ["Nobody"],
  });
  assert.equal(state.notes[streams[0].id], undefined, "input left alone");

  // A second call in the same reply keeps the first "before".
  const second = noteChanges(
    derived,
    first.notes,
    [{ id, text: "Replaced", mode: "replace" }],
    first.undo,
  );
  assert.equal(second.notes[id], "Replaced");
  assert.equal(second.undo[id], state.notes[id]);
  assert.throws(() => noteChanges(derived, state.notes, []), /non-empty/);
});

test("rename_merchants sets display names and restores originals", () => {
  const { state, derived } = demo();
  const renamed = nameChanges(derived, state.names, [
    { merchant: "Paper Kite Cafe", name: "The cafe" },
    { merchant: "Unknown place", name: "x" },
  ]);
  const key = derived.allTxns.find(
    (t) => t.merchant === "Paper Kite Cafe",
  ).nameKey;
  assert.deepEqual(renamed.names[key], { name: "The cafe", by: "ai" });
  assert.equal(renamed.undo[key], null);
  assert.deepEqual(renamed.result, {
    changed: 1,
    not_found: ["Unknown place"],
  });
  const back = nameChanges(
    derived,
    renamed.names,
    [{ merchant: "Paper Kite Cafe", name: "" }],
    renamed.undo,
  );
  assert.equal(back.names[key], undefined);
  assert.equal(back.undo[key], null);
});
