import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import {
  LIB_MEMBERS,
  TXN_FIELDS,
  lensLib,
  publicTxn,
  runLens,
} from "../lens-api.js";

const TODAY = "2026-09-30";
function demo() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY), { loaded: true });
  return { state, derived: deriveTransactions(state, { today: TODAY }) };
}

test("the lens reference documents every transaction field and lib member", () => {
  const { state, derived } = demo();
  const lib = lensLib(derived, state, TODAY);
  const t = publicTxn(derived.expected[0]);
  assert.deepEqual(TXN_FIELDS.map((f) => f.name).sort(), Object.keys(t).sort());
  assert.deepEqual(
    LIB_MEMBERS.map((m) => m.name).sort(),
    Object.keys(lib).sort(),
  );
});

test("starter lenses run on the demo and return a view", () => {
  const { state, derived } = demo();
  assert.equal(lensLib(derived, state, TODAY).today, TODAY);
  for (const l of state.lenses) {
    const view = runLens(l.code, derived, state, TODAY);
    assert.ok(["bars", "table", "number", "text"].includes(view.kind), l.id);
  }
});

test("what a lens gets is plain data that can be posted to the sandbox", async () => {
  const { lensInput } = await import("../lens-api.js");
  const { state, derived } = demo();
  const input = lensInput(derived, state, TODAY);
  // structuredClone fails on functions, so this is what postMessage accepts.
  assert.deepEqual(structuredClone(input), input);
  assert.ok(Object.values(input.data).every((v) => typeof v !== "function"));
  assert.deepEqual(
    Object.keys(input.data).sort(),
    LIB_MEMBERS.filter((m) => !m.sig.includes("("))
      .map((m) => m.name)
      .sort(),
  );
  assert.equal(
    input.txns.length,
    derived.txns.filter((t) => !t.transfer).length,
  );
  assert.equal(input.data.today, TODAY);
});
