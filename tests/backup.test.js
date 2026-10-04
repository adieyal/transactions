import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  parseBackup,
  batchDocuments,
  restoreBackupDocuments,
} from "../backup.js";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";

function source() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData("2026-09-30"), { isDemo: true });
  state.notes[Object.values(state.batches)[0].rows[0].id] =
    "Round-trip note #custom";
  state.names["brightwell energy"] = { name: "Renamed energy", by: "user" };
  state.reports = [
    {
      id: "report-1",
      q: "What changed?",
      answer: "Example answer",
      ranAt: "2026-09-30",
      dataKey: "test",
      coverage: "Three months",
    },
  ];
  state.view.parked = ["Home"];
  state.dismissed = { "price|example": true };
  state.answers = {
    "cluster-2026-03-84d1cf4d": {
      status: "answered",
      choice: "Moving house",
      note: null,
      created: { periodId: "p-1", noteIds: ["demo-1"] },
      at: "2026-10-04",
    },
  };
  state.merchantAnswers = {
    "Demo Everyday::bluebell removals": {
      choice: "Moving house",
      action: "period",
      at: "2026-10-04",
    },
  };
  return state;
}
function memoryBackend(initial = {}) {
  const docs = structuredClone(initial);
  return {
    async all() {
      return structuredClone(docs);
    },
    async put(k, v) {
      docs[k] = structuredClone(v);
    },
    async del(k) {
      delete docs[k];
    },
  };
}

test("current exports restore transactions and annotations without credentials", () => {
  const state = source();
  const exported = createBackup(state);
  const imported = parseBackup(JSON.stringify(exported));
  for (const key of [
    "rules",
    "notes",
    "names",
    "periods",
    "reports",
    "lenses",
    "adapters",
    "dismissed",
    "answers",
    "merchantAnswers",
    "view",
  ])
    assert.deepEqual(imported[key], state[key]);
  assert.deepEqual(imported.transferOv, state.transferOv);
  const { state: next } = createRuntime();
  Object.assign(next, imported);
  const a = deriveTransactions(state, { today: "2026-09-30" }),
    b = deriveTransactions(next, { today: "2026-09-30" });
  assert.deepEqual(b.allTxns, a.allTxns);
  assert.deepEqual(b.expected, a.expected);
  assert.equal(imported.isDemo, true);
  assert.equal(Object.hasOwn(imported, "caps"), false);
});

test("legacy Abacus exports and an empty backup are accepted", () => {
  const legacy = createBackup(source());
  for (const key of [
    "format",
    "version",
    "demo",
    "names",
    "periods",
    "reports",
    "dismissed",
    "view",
  ])
    delete legacy[key];
  const imported = parseBackup(JSON.stringify(legacy));
  assert.equal(Object.keys(imported.batches).length, 36);
  assert.equal(imported.isDemo, false);
  assert.deepEqual(imported.names, {});
  const empty = parseBackup(JSON.stringify({ rules: "", batches: [] }));
  assert.deepEqual(empty.batches, {});
  assert.ok(empty.lenses.length > 0);
});

test("malformed or unsupported backups fail before persistence", () => {
  assert.throws(() => parseBackup("not JSON"), /valid JSON backup/);
  assert.throws(
    () => parseBackup('{"rules":"x","batches":[],"__proto__":{}}'),
    /object key/,
  );
  for (const modify of [
    (d) => (d.version = 9),
    (d) => (d.batches[0].rows[0].amount = "100"),
    (d) => (d.batches[0].rows[0].date = "2026-02-31"),
    (d) => d.batches.push(d.batches[0]),
    (d) => (d.notes = { a: 42 }),
    (d) => (d.lenses = [{ id: "a", title: "x", code: 42 }]),
    (d) => (d.periods[0].end = "2020-01-01"),
  ]) {
    const backup = createBackup(source());
    modify(backup);
    assert.throws(() => parseBackup(JSON.stringify(backup)), /Invalid backup/);
  }
});

test("restoring replaces old chunks, preserves unrelated documents, and chunks large statements", async () => {
  const imported = parseBackup(JSON.stringify(createBackup(source())));
  const batch = Object.values(imported.batches)[0];
  batch.rows = Array.from({ length: 351 }, (_, i) => ({
    ...batch.rows[0],
    id: "large-" + i,
  }));
  const chunks = batchDocuments(batch);
  assert.equal(Object.keys(chunks).length, 2);
  assert.equal(Object.values(chunks)[1].rows.length, 1);
  const backend = memoryBackend({
    batch_old_0: { rows: [] },
    rules: { text: "old" },
    unrelated: { keep: true },
  });
  await restoreBackupDocuments(backend, imported);
  const docs = await backend.all();
  assert.equal(docs.batch_old_0, undefined);
  assert.deepEqual(docs.unrelated, { keep: true });
  assert.equal(docs.rules.text, imported.rules);
  assert.deepEqual(docs.notes.map, imported.notes);
  assert.equal(
    Object.values(docs).filter((v) => v.batchId === batch.id).length,
    2,
  );
  assert.ok(Object.values(docs).some((v) => v.card === true));
});

test("failed writes restore the previous saved workspace", async () => {
  const original = {
    rules: { text: "old" },
    notes: { map: { a: "original" } },
    batch_old_0: { rows: [] },
  };
  const backend = memoryBackend(original);
  const put = backend.put;
  let fail = true;
  backend.put = async (k, v) => {
    if (k === "lenses" && fail) {
      fail = false;
      throw new Error("Quota exceeded");
    }
    return put(k, v);
  };
  await assert.rejects(
    restoreBackupDocuments(
      backend,
      parseBackup(JSON.stringify(createBackup(source()))),
    ),
    /Previous saved data was restored/,
  );
  assert.deepEqual(await backend.all(), original);
});

test("silently dropped writes are detected rather than reporting success", async () => {
  const original = { rules: { text: "old" } };
  const backend = memoryBackend(original);
  const put = backend.put;
  backend.put = async (k, v) => {
    if (k !== "lenses") await put(k, v);
  };
  await assert.rejects(
    restoreBackupDocuments(
      backend,
      parseBackup(JSON.stringify(createBackup(source()))),
    ),
    /Previous saved data was restored/,
  );
  assert.deepEqual(await backend.all(), original);
});
