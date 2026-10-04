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
  totals,
} from "../assistant/tools.js";
import {
  applyChange,
  invert,
  renameMerchants,
  writeNotes,
} from "../model/index.js";

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
  assert.ok(byMonth.every((x) => x.currency === "ILS"));
  assert.deepEqual(Object.keys(found.totals), ["ILS"]);
  assert.equal(
    byMonth.reduce((s, x) => s + x.total, 0).toFixed(2),
    found.totals.ILS.toFixed(2),
  );
  const byThread = totals(derived, { group_by: "thread" });
  assert.ok(byThread[0].total >= byThread[1].total, "largest first");

  const merchants = listMerchants(derived);
  assert.ok(merchants.some((m) => m.original === "Lantern Stream"));
  assert.ok(merchants[0].total >= merchants[1].total);
});

test("update_notes is the model's writeNotes: appends or replaces, with a record undo reverses", () => {
  const { state, derived } = demo();
  const id = derived.allTxns.find((t) => t.merchant === "Meadow Paws").id;
  const before = JSON.stringify(state.notes);
  const first = writeNotes(state, derived, {
    changes: [
      { id, text: "#checked" },
      { merchant: "Lantern Stream", text: "Streaming" },
      { merchant: "Nobody", text: "x" },
    ],
  });
  assert.equal(JSON.stringify(state.notes), before, "state left alone");
  applyChange(state, first);
  assert.match(state.notes[id], /#pets\n#checked$/);
  const streams = derived.allTxns.filter(
    (t) => t.merchant === "Lantern Stream",
  );
  assert.ok(streams.every((t) => state.notes[t.id] === "Streaming"));
  assert.deepEqual(first.result, {
    changed: 1 + streams.length,
    not_found: ["Nobody"],
  });
  const second = writeNotes(state, derived, {
    changes: [{ id, text: "Replaced", mode: "replace" }],
  });
  applyChange(state, second);
  assert.equal(state.notes[id], "Replaced");
  applyChange(state, invert(second));
  applyChange(state, invert(first));
  assert.equal(JSON.stringify(state.notes), before, "undo restores");
  assert.throws(() => writeNotes(state, derived, { changes: [] }), /non-empty/);
  assert.throws(
    () =>
      writeNotes(state, derived, {
        changes: [{ merchant: "Nobody", text: "x" }],
      }),
    /Not found: Nobody/,
  );
});

test("rename_merchants is the model's renameMerchants, and restores originals", () => {
  const { state, derived } = demo();
  const renamed = renameMerchants(state, derived, {
    changes: [
      { merchant: "Paper Kite Cafe", name: "The cafe" },
      { merchant: "Unknown place", name: "x" },
    ],
  });
  const key = derived.allTxns.find(
    (t) => t.merchant === "Paper Kite Cafe",
  ).nameKey;
  applyChange(state, renamed);
  assert.deepEqual(state.names[key], { name: "The cafe", by: "ai" });
  assert.deepEqual(renamed.result, {
    changed: 1,
    not_found: ["Unknown place"],
  });
  const back = renameMerchants(state, derived, {
    changes: [{ merchant: "Paper Kite Cafe", name: "" }],
  });
  applyChange(state, back);
  assert.equal(state.names[key], undefined);
  applyChange(state, invert(back));
  assert.deepEqual(state.names[key], { name: "The cafe", by: "ai" });
});
