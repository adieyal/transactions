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

test("lenses saved with the earlier on/off flag still load, labelled as from a backup", async () => {
  const { STARTER_LENSES } = await import("../defaults.js");
  const mine = {
    id: "mine",
    title: "Mine",
    code: "return { kind: 'text', text: 'hi' };",
  };
  // Saved before any flag: loads as it was.
  const old = { lenses: { items: [...STARTER_LENSES, mine] } };
  const state = fresh();
  assert.deepEqual(loadDocuments(clone(old), state).invalid, []);
  assert.ok(state.lenses.every((l) => !l.fromBackup && !("off" in l)));
  // Saved while imported lenses were switched off (step 8): now a label.
  const switchedOff = clone(old);
  switchedOff.lenses.items.at(-1).off = true;
  switchedOff.lenses.items[0].off = false;
  const migrated = fresh();
  assert.deepEqual(loadDocuments(switchedOff, migrated).invalid, []);
  assert.equal(migrated.lenses.at(-1).fromBackup, true);
  assert.ok(migrated.lenses.every((l) => !("off" in l)));
  assert.equal(migrated.lenses[0].fromBackup, undefined);
  // The label round-trips; a flag that isn't a boolean fails the check.
  const again = fresh();
  loadDocuments(
    clone({ lenses: toDocument(documentFor("lenses"), migrated) }),
    again,
  );
  assert.equal(again.lenses.at(-1).fromBackup, true);
  const bad = clone(old);
  bad.lenses.items[0].fromBackup = "yes";
  assert.deepEqual(loadDocuments(bad, fresh()).invalid, ["lenses"]);
});

test("lenses in an imported backup are labelled as from the backup, unless they are starter lenses", async () => {
  const { STARTER_LENSES } = await import("../defaults.js");
  const state = demoState();
  state.lenses = [
    ...STARTER_LENSES,
    { id: "mine", title: "Mine", code: "return { kind: 'text', text: 'hi' };" },
    { id: "was-off", title: "Was off", code: "return 1;", off: true },
  ];
  const parsed = parseBackup(JSON.stringify(createBackup(state, TODAY)), TODAY);
  assert.deepEqual(
    parsed.lenses.filter((l) => l.fromBackup).map((l) => l.id),
    ["mine", "was-off"],
  );
  assert.ok(parsed.lenses.every((l) => !("off" in l)));
  const older = createBackup(state, TODAY);
  delete older.lenses;
  assert.ok(
    !parseBackup(JSON.stringify(older), TODAY).lenses.some((l) => l.fromBackup),
  );
});

test("the first real statements replace the demo: no demo data stays, and it's no longer a demo", async () => {
  const { withoutDemo } = await import("../documents.js");
  const demo = demoState();
  demo.view.panel = false;
  const docs = {};
  const backend = {
    all: async () => clone(docs),
    put: async (k, v) => void (docs[k] = clone(v)),
    del: async (k) => void delete docs[k],
  };
  await restoreBackupDocuments(backend, demo);
  assert.ok(Object.keys(docs).some((k) => k.startsWith("batch_")));

  const blank = withoutDemo(demo, fresh());
  assert.equal(blank.isDemo, false);
  assert.deepEqual(blank.batches, {});
  assert.deepEqual([blank.notes, blank.periods, blank.answers], [{}, [], {}]);
  assert.equal(blank.view, demo.view, "the person's view settings stay");
  const { parseRules } = await import("../transactions/rules.js");
  assert.equal(parseRules(blank.rules).threads.length, 0, "no demo threads");
  assert.match(blank.rules, /^\/\/ A thread: a name on its own line/);

  await restoreBackupDocuments(backend, blank);
  assert.ok(!Object.keys(docs).some((k) => k.startsWith("batch_")));
  assert.deepEqual(docs.workspace, { demo: false });
  const loaded = fresh();
  assert.deepEqual(loadDocuments(docs, loaded).invalid, []);
  assert.equal(loaded.isDemo, false);
  assert.deepEqual(
    [loaded.batches, loaded.notes, loaded.periods, loaded.view.panel],
    [{}, {}, [], false],
  );
  // The input is left as it was, so a cancelled import changes nothing.
  assert.ok(Object.keys(demo.batches).length > 0 && demo.isDemo);
});
