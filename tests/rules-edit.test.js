import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { parseRules } from "../transactions/rules.js";
import { addToThread, setBudget } from "../transactions/rules-edit.js";

const TODAY = "2026-09-30";
function demo() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  return state;
}
const budgetOf = (rules, name) =>
  parseRules(rules).threads.find((t) => t.name === name).budget;

test("setBudget sets, replaces and removes a thread's budget", () => {
  const { rules } = demo();
  assert.equal(budgetOf(rules, "Bills"), 300);
  const raised = setBudget(rules, "Bills", 349.6);
  assert.equal(budgetOf(raised, "Bills"), 350);
  assert.match(raised, /^Bills {2}\[budget 350\]$/m);
  assert.equal(budgetOf(setBudget(raised, "Bills", 0), "Bills"), null);
  assert.equal(budgetOf(setBudget(rules, "Car", 500), "Car"), 500);
  // Other lines stay as they were.
  assert.equal(
    raised.split("\n").filter((l, i) => l !== rules.split("\n")[i]).length,
    1,
  );
  assert.equal(setBudget(rules, "No such thread", 10), rules);
});

test("addToThread adds merchants to a thread, or starts one", () => {
  const state = demo();
  const derived = deriveTransactions(state, { today: TODAY });
  const cafe = derived.allTxns.filter((t) => t.merchant === "Paper Kite Cafe");
  const ferry = derived.allTxns.filter((t) =>
    t.merchant.startsWith("Lantern Bay F"),
  );

  // An existing thread gains one pattern per merchant, under its last line.
  const one = addToThread(state.rules, "car", cafe);
  const lines = one.rules.split("\n");
  assert.equal(one.count, 1);
  assert.deepEqual(lines.slice(one.at - 3, one.at + 1), [
    "Car",
    "  cobble lane garage",
    "  #car",
    "  paper kite cafe",
  ]);

  // A new thread goes first, after the opening comments.
  const trip = addToThread(state.rules, "Ferries and fish", ferry);
  const added = trip.rules.split("\n").slice(trip.at, trip.at + trip.count);
  assert.deepEqual(added, [
    "Ferries and fish",
    "  lantern bay ferry",
    "  lantern bay fish bar",
  ]);
  assert.match(trip.rules.split("\n")[trip.at - 1], /^\/\/|^$/);
  const { state: after } = createRuntime();
  Object.assign(after, state, { rules: trip.rules });
  const rederived = deriveTransactions(after, { today: TODAY });
  assert.ok(
    rederived.allTxns
      .filter((t) => t.merchant.startsWith("Lantern Bay F"))
      .every((t) => t.thread === "Ferries and fish"),
  );
});
