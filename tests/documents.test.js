import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENTS,
  documentFor,
  loadDocuments,
  toDocument,
} from "../documents.js";
import {
  batchDocuments,
  createBackup,
  parseBackup,
  restoreBackupDocuments,
} from "../backup.js";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";

const TODAY = "2026-09-30";
const fresh = () => createRuntime().state;
const clone = (v) => JSON.parse(JSON.stringify(v));
function demoState() {
  const state = Object.assign(fresh(), createDemoData(TODAY));
  state.view.parked = ["Home"];
  state.answers = {
    "cluster-2026-04-84d1cf4d": { status: "skipped", at: "2026-10-04" },
  };
  return state;
}
// What the demo seed wrote before R2: a `demo` marker instead of `workspace`.
function legacySeed(state) {
  return clone({
    demo: { version: 1 },
    rules: { text: state.rules },
    notes: { map: state.notes },
    periods: { items: state.periods },
    ...Object.assign({}, ...Object.values(state.batches).map(batchDocuments)),
  });
}

test("a demo workspace saved under the old keys loads unchanged", () => {
  const demo = Object.assign(fresh(), createDemoData(TODAY));
  const state = fresh();
  const { invalid, legacyDemo } = loadDocuments(legacySeed(demo), state);
  assert.deepEqual(invalid, []);
  assert.equal(legacyDemo, true, "the old marker is read and can be migrated");
  assert.equal(state.isDemo, true);
  for (const field of ["rules", "notes", "periods"])
    assert.deepEqual(state[field], demo[field], field);
  // Statements come back whole, with the chunk count loading has always added.
  const withParts = (batches) =>
    Object.fromEntries(
      Object.entries(batches).map(([id, b]) => [id, { ...b, parts: 1 }]),
    );
  assert.deepEqual(state.batches, withParts(demo.batches));
  // Nothing else changed from a fresh start.
  for (const field of ["lenses", "names", "answers", "view", "turns"])
    assert.deepEqual(state[field], fresh()[field], field);

  // Saved again the current way, it reads the same without the old marker.
  const migrated = { ...legacySeed(demo) };
  migrated.workspace = toDocument(documentFor("workspace"), state);
  delete migrated.demo;
  const again = fresh();
  assert.deepEqual(loadDocuments(migrated, again), {
    invalid: [],
    legacyDemo: false,
  });
  assert.equal(again.isDemo, true);
  assert.deepEqual(again.batches, state.batches);
});

test("a workspace restored from a backup is not a demo, even with the old marker", async () => {
  const docs = {};
  const backend = {
    all: async () => clone(docs),
    put: async (k, v) => void (docs[k] = clone(v)),
    del: async (k) => void delete docs[k],
  };
  Object.assign(docs, legacySeed(demoState()));
  const imported = parseBackup(
    JSON.stringify({ ...createBackup(demoState()), demo: false }),
  );
  await restoreBackupDocuments(backend, imported);
  const state = fresh();
  assert.deepEqual(loadDocuments(docs, state).invalid, []);
  assert.equal(state.isDemo, false);
});

test("every document survives saving and loading at boot", () => {
  const state = demoState();
  state.turns = [{ role: "user", content: "Hello", pending: false }];
  const docs = clone(
    Object.fromEntries(DOCUMENTS.map((d) => [d.key, toDocument(d, state)])),
  );
  const loaded = fresh();
  assert.deepEqual(loadDocuments(docs, loaded).invalid, []);
  for (const d of DOCUMENTS) {
    const expected = d.out ? d.out(state[d.field]) : state[d.field];
    const got = d.out ? d.out(loaded[d.field]) : loaded[d.field];
    assert.deepEqual(got, clone(expected), d.key);
  }
  // The view keeps its session-only setting.
  assert.equal(loaded.view.showParked, false);
});

test("every backed-up document survives a backup round trip", () => {
  const state = demoState();
  const parsed = parseBackup(JSON.stringify(createBackup(state)));
  for (const d of DOCUMENTS.filter((d) => d.backup))
    assert.deepEqual(parsed[d.field], clone(state[d.field]), d.key);
});

test("a saved document that fails its check is reported and not loaded", () => {
  const state = demoState();
  const docs = clone(
    Object.fromEntries(DOCUMENTS.map((d) => [d.key, toDocument(d, state)])),
  );
  docs.lenses = { items: [{ id: "bad id!", title: 3 }] };
  docs.notes = { map: { x: 4 } };
  const loaded = fresh();
  const { invalid } = loadDocuments(docs, loaded);
  assert.deepEqual(invalid.sort(), ["lenses", "notes"]);
  assert.deepEqual(loaded.lenses, fresh().lenses);
  assert.deepEqual(loaded.notes, {});
  assert.deepEqual(loaded.periods, state.periods);
});
