import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { createLenses } from "../ui/lenses.js";
import { LIB_MEMBERS, TXN_FIELDS } from "../lens-api.js";

function demoLenses() {
  const runtime = createRuntime();
  Object.assign(runtime.state, createDemoData("2026-09-30"), { loaded: true });
  runtime.derived = deriveTransactions(runtime.state, { today: "2026-09-30" });
  return createLenses(runtime, {});
}

test("the lens reference documents every transaction field and lib member", () => {
  const lenses = demoLenses();
  const t = lenses.publicTxn(lenses.lensLib().expected[0] || {});
  assert.deepEqual(TXN_FIELDS.map((f) => f.name).sort(), Object.keys(t).sort());
  assert.deepEqual(
    LIB_MEMBERS.map((m) => m.name).sort(),
    Object.keys(lenses.lensLib()).sort(),
  );
});

test("starter lenses run on the demo and return a view", () => {
  const runtime = createRuntime();
  const lenses = demoLenses();
  for (const l of runtime.state.lenses) {
    const view = lenses.runLens(l.code);
    assert.ok(["bars", "table", "number", "text"].includes(view.kind), l.id);
  }
});
