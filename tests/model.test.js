// The model (ADR 0013): every command returns a change record, applying it
// makes the change, and undoing it puts saved state back exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { parseRules } from "../transactions/rules.js";
import { STARTER_LENSES } from "../defaults.js";
import * as model from "../model/index.js";
import { KEY_OF } from "../model/change.js";
import { createChanges } from "../changes.js";

const today = "2026-09-30";
function fresh() {
  const runtime = createRuntime({ today });
  Object.assign(runtime.state, createDemoData(today), { loaded: true });
  runtime.derived = deriveTransactions(runtime.state, { today });
  return runtime;
}
const saved = (state) =>
  JSON.parse(
    JSON.stringify(
      Object.fromEntries(Object.keys(KEY_OF).map((k) => [k, state[k]])),
    ),
  );

// Runs a command, checks what it changed, undoes it, and checks that saved
// state is back as it was. Returns the record.
function roundTrip(state, command, input, check) {
  const before = saved(state);
  const change = command(state, input);
  assert.ok(change, "the command changed something");
  assert.deepEqual(saved(state), before, "a command alone leaves state alone");
  model.applyChange(state, change);
  check(state, change);
  model.applyChange(state, change, { undo: true });
  assert.deepEqual(saved(state), before, "undo puts it back");
  model.applyChange(state, model.invert(model.invert(change)));
  check(state, change);
  model.applyChange(state, model.invert(change));
  assert.deepEqual(saved(state), before, "the inverse record undoes too");
  return change;
}

const { state, derived } = fresh();
const [a, b] = derived.allTxns.filter((t) => t.kind === "actual");

test("tag and untag", () => {
  const c = roundTrip(
    state,
    model.tag,
    { ids: [a.id, b.id], add: ["#trip"] },
    (s) => {
      assert.match(s.notes[a.id], /#trip/);
      assert.match(s.notes[b.id], /#trip/);
    },
  );
  assert.equal(c.summary, "Added #trip on 2 transactions.");
  assert.deepEqual(model.keysOf(c), ["notes"]);
  model.applyChange(state, c);
  roundTrip(state, model.untag, { ids: [a.id], remove: ["trip"] }, (s) =>
    assert.doesNotMatch(s.notes[a.id] || "", /#trip/),
  );
  model.applyChange(state, c, { undo: true });
  assert.equal(model.untag(state, { ids: [a.id], remove: ["#nothere"] }), null);
  assert.throws(
    () => model.tag(state, { ids: [], add: ["#x"] }),
    model.CommandError,
  );
  assert.throws(() => model.tag(state, { ids: [a.id] }), /which tag/);
});

test("set and clear a note", () => {
  roundTrip(
    state,
    model.setNote,
    { id: a.id, text: "Bella's checkup #vet" },
    (s) => assert.equal(s.notes[a.id], "Bella's checkup #vet"),
  );
  state.notes = { ...state.notes, [a.id]: "old" };
  roundTrip(state, model.setNote, { id: a.id, text: "  " }, (s) =>
    assert.equal(a.id in s.notes, false),
  );
  assert.equal(model.setNote(state, { id: a.id, text: "old" }), null);
  assert.throws(() => model.setNote(state, { id: a.id, text: 3 }), /text/);
});

test("rename a merchant, and back to the original", () => {
  const key = model.nameKeyOf(a);
  roundTrip(
    state,
    model.renameMerchant,
    { key, original: a.merchant, name: "Corner shop" },
    (s) => assert.deepEqual(s.names[key], { name: "Corner shop", by: "you" }),
  );
  assert.equal(
    model.renameMerchant(state, {
      key,
      original: a.merchant,
      name: a.merchant,
    }),
    null,
  );
});

test("label a transaction as a transfer, or not", () => {
  roundTrip(state, model.setTransfer, { id: a.id, on: true }, (s) =>
    assert.equal(s.transferOv[a.id], true),
  );
  roundTrip(state, model.setTransfer, { id: a.id, on: false }, (s) =>
    assert.equal(s.transferOv[a.id], false),
  );
  // Found by the app already: yes needs no override.
  assert.equal(
    model.setTransfer(state, { id: a.id, on: true, auto: true }),
    null,
  );
});

test("create, edit and delete a period", () => {
  roundTrip(
    state,
    model.addPeriod,
    { id: "pnew", name: "Trip", start: "2026-05-09", end: "2026-05-02" },
    (s) => {
      const p = s.periods.find((q) => q.id === "pnew");
      assert.deepEqual(
        [p.name, p.start, p.end],
        ["Trip", "2026-05-02", "2026-05-09"],
      );
      assert.ok(p.color);
    },
  );
  const p = state.periods[0];
  roundTrip(
    state,
    model.editPeriod,
    { id: p.id, name: "Renamed", end: "2026-12-01" },
    (s) => {
      assert.equal(s.periods[0].name, "Renamed");
      assert.equal(s.periods[0].end, "2026-12-01");
    },
  );
  roundTrip(state, model.removePeriod, { id: p.id }, (s, c) => {
    assert.equal(
      s.periods.some((q) => q.id === p.id),
      false,
    );
    assert.equal(c.summary, `Removed “${p.name}”.`);
  });
  assert.throws(
    () => model.addPeriod(state, { id: "x", start: "May" }),
    /dates/,
  );
  assert.throws(
    () => model.editPeriod(state, { id: "nope" }),
    /no such period/,
  );
  assert.throws(() => model.editPeriod(state, { id: p.id, name: " " }), /name/);
});

test("set, clear and add to threads and their budgets", () => {
  const thread = parseRules(state.rules).threads[0].name;
  roundTrip(state, model.setBudget, { thread, value: 640 }, (s) =>
    assert.equal(parseRules(s.rules).threads[0].budget, 640),
  );
  model.applyChange(state, model.setBudget(state, { thread, value: 640 }));
  roundTrip(state, model.clearBudget, { thread }, (s) =>
    assert.ok(!parseRules(s.rules).threads[0].budget),
  );
  roundTrip(state, model.addToThread, { name: "Vet", txns: [a] }, (s, c) => {
    assert.ok(parseRules(s.rules).threads.some((t) => t.name === "Vet"));
    assert.ok(c.count >= 1);
  });
  roundTrip(
    state,
    model.setRules,
    { rules: state.rules + "\nPets\n  vet\n" },
    (s) =>
      assert.ok(parseRules(s.rules).threads.some((t) => t.name === "Pets")),
  );
  assert.throws(
    () => model.setBudget(state, { thread: "Nope", value: 5 }),
    /no thread/,
  );
  state.previewRules = "Other\n  x\n";
  assert.throws(
    () => model.setBudget(state, { thread, value: 5 }),
    /suggested/,
  );
  state.previewRules = null;
});

test("create, edit, run and delete a lens", () => {
  const code = 'return { kind: "number", value: 7, label: "Seven" };';
  roundTrip(state, model.addLens, { id: "lnew", title: "Seven", code }, (s) =>
    assert.equal(s.lenses.at(-1).title, "Seven"),
  );
  model.applyChange(
    state,
    model.addLens(state, { id: "lnew", title: "Seven", code }),
  );
  assert.equal(model.runLens(state, derived, { id: "lnew" }, today).value, 7);
  roundTrip(
    state,
    model.editLens,
    { id: "lnew", title: "", code: "return 1;" },
    (s) => {
      const l = s.lenses.find((x) => x.id === "lnew");
      assert.deepEqual([l.title, l.code], ["Untitled lens", "return 1;"]);
    },
  );
  roundTrip(state, model.removeLens, { id: "lnew" }, (s) =>
    assert.equal(
      s.lenses.some((l) => l.id === "lnew"),
      false,
    ),
  );
  const first = STARTER_LENSES[0].id;
  model.applyChange(state, model.removeLens(state, { id: first }));
  roundTrip(state, model.restoreStarterLenses, undefined, (s) =>
    assert.ok(s.lenses.some((l) => l.id === first)),
  );
  assert.throws(() => model.addLens(state, { id: "l2", code: "" }), /code/);
});

test("save, remove and restore a saved question", () => {
  const report = { id: "r1", q: "What did the car cost?", answer: "" };
  roundTrip(state, model.addReport, { report }, (s) =>
    assert.equal(s.reports.at(-1).q, report.q),
  );
  model.applyChange(state, model.addReport(state, { report }));
  model.applyChange(
    state,
    model.addReport(state, { report: { id: "r2", q: "Two?" } }),
  );
  const removed = roundTrip(state, model.removeReport, { id: "r1" }, (s) =>
    assert.deepEqual(
      s.reports.map((r) => r.id),
      ["r2"],
    ),
  );
  model.applyChange(state, removed);
  roundTrip(
    state,
    model.restoreReport,
    { report: removed.report, at: removed.at },
    (s) =>
      assert.deepEqual(
        s.reports.map((r) => r.id),
        ["r1", "r2"],
      ),
  );
});

test("one undo log: commit saves and refreshes, undo reverses by record", () => {
  const runtime = fresh();
  const calls = [];
  const changes = createChanges(runtime, {
    save: (...k) => calls.push(["save", ...k]),
    refresh: () => calls.push(["refresh"]),
    refreshSoon: () => calls.push(["soon"]),
  });
  const s = runtime.state;
  const before = saved(s);
  const tagged = changes.commit(model.tag(s, { ids: [a.id], add: "#one" }));
  const noted = changes.commit(model.setNote(s, { id: b.id, text: "two" }), {
    refresh: "soon",
  });
  assert.deepEqual(calls, [
    ["save", "notes"],
    ["refresh"],
    ["save", "notes"],
    ["soon"],
  ]);
  // Undo an earlier change on its own: the later one stays.
  changes.undo(tagged);
  assert.doesNotMatch(s.notes[a.id] || "", /#one/);
  assert.equal(s.notes[b.id], "two");
  assert.equal(changes.undo(tagged), null, "undone once only");
  changes.undo();
  assert.deepEqual(saved(s), before);
  assert.equal(changes.commit(null), null);
});

// C1-VERIFY property test: random commands, each undone and redone at once,
// then all undone latest first, give back exactly what was there.
test("undoing in order restores everything, over random commands", () => {
  let seed = 7;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let run = 0; run < 60; run++) {
    const { state } = fresh();
    const txns = deriveTransactions(state, { today }).txns;
    const txIds = txns.map((t) => t.id);
    const start = saved(state);
    const done = [];
    let n = 0;
    for (let step = 0; step < 25; step++) {
      const threads = parseRules(state.rules).threads.map((t) => t.name);
      const ops = [
        () =>
          model.tag(state, {
            ids: [pick(txIds), pick(txIds)],
            add: [pick(["#a", "#trip"])],
          }),
        () => model.untag(state, { ids: [pick(txIds)], remove: ["#a"] }),
        () =>
          model.setNote(state, {
            id: pick(txIds),
            text: pick(["hi", "", "x #trip"]),
          }),
        () => model.setTransfer(state, { id: pick(txIds), on: rnd() < 0.5 }),
        () =>
          model.addPeriod(state, {
            id: `p${n++}`,
            name: "P",
            start: `2026-03-0${1 + Math.floor(rnd() * 9)}`,
            end: "2026-04-01",
          }),
        () =>
          state.periods.length &&
          model.editPeriod(state, {
            id: pick(state.periods).id,
            name: `E${n}`,
          }),
        () =>
          state.periods.length &&
          model.removePeriod(state, { id: pick(state.periods).id }),
        () =>
          model.setBudget(state, {
            thread: pick(threads),
            value: Math.floor(rnd() * 900),
          }),
        () => model.clearBudget(state, { thread: pick(threads) }),
        () =>
          model.addToThread(state, {
            name: pick([...threads, "Pets"]),
            txns: [pick(txns)],
          }),
        () =>
          model.setRules(state, { rules: `${state.rules}\nX${n}\n  foo\n` }),
        () =>
          model.addLens(state, { id: `l${n++}`, title: "L", code: "return 1" }),
        () =>
          state.lenses.length &&
          model.editLens(state, { id: pick(state.lenses).id, title: `T${n}` }),
        () =>
          state.lenses.length &&
          model.removeLens(state, { id: pick(state.lenses).id }),
        () => model.restoreStarterLenses(state),
        () => model.addReport(state, { report: { id: `r${n++}`, q: "q?" } }),
        () =>
          state.reports.length &&
          model.removeReport(state, { id: pick(state.reports).id }),
      ];
      let rec;
      try {
        rec = pick(ops)();
      } catch (e) {
        if (e instanceof model.CommandError) continue;
        throw e;
      }
      if (!rec) continue;
      const before = saved(state);
      model.applyChange(state, rec);
      const after = saved(state);
      model.applyChange(state, model.invert(rec));
      assert.deepEqual(saved(state), before, `undo ${rec.command}`);
      model.applyChange(state, rec);
      assert.deepEqual(saved(state), after, `redo ${rec.command}`);
      done.push(rec);
    }
    for (const r of done.reverse()) model.applyChange(state, model.invert(r));
    assert.deepEqual(saved(state), start, `run ${run}`);
  }
});

// C1-VERIFY finding 1: a toast's Undo pressed after later edits reverses only
// what it changed, as 8d87cd2's did, and keeps the later edits.
test("undoing an earlier change keeps later edits", () => {
  const runtime = fresh();
  const { state } = runtime;
  const told = [];
  const io = {
    save() {},
    refresh() {},
    refreshSoon() {},
    tell: (m) => told.push(m),
  };
  const { commit, undo } = createChanges(runtime, io);

  // Periods: remove one, rename the other, undo the remove.
  const [car, trip] = state.periods;
  const removed = commit(model.removePeriod(state, { id: car.id }));
  commit(
    model.editPeriod(state, { id: trip.id, name: "Renamed after remove" }),
  );
  commit(
    model.addPeriod(state, {
      id: "pnew",
      start: "2026-05-01",
      end: "2026-05-02",
    }),
  );
  undo(removed);
  assert.deepEqual(
    state.periods.map((p) => p.name),
    [car.name, "Renamed after remove", "New period"],
  );

  // Budgets: clear one, set another, undo the clear.
  const threads = parseRules(state.rules).threads.filter((t) => t.budget);
  const [a, b] = threads.map((t) => t.name);
  const budgetOf = (name) =>
    parseRules(state.rules).threads.find((t) => t.name === name).budget;
  const was = budgetOf(a);
  const cleared = commit(model.clearBudget(state, { thread: a }));
  commit(model.setBudget(state, { thread: b, value: 700 }));
  undo(cleared);
  assert.equal(budgetOf(a), was);
  assert.equal(budgetOf(b), 700);

  // Lenses and saved questions: the same, by id.
  const lens = state.lenses[0];
  const others = state.lenses.slice(1).map((l) => l.id);
  const gone = commit(model.removeLens(state, { id: lens.id }));
  commit(
    model.addLens(state, { id: "lafter", title: "After", code: "return 1" }),
  );
  undo(gone);
  assert.deepEqual(
    state.lenses.map((l) => l.id),
    [lens.id, ...others, "lafter"],
  );
  assert.equal(state.lenses[0].id, lens.id, "back in its place");
  commit(model.addReport(state, { report: { id: "r1", q: "One?" } }));
  const r2 = commit(
    model.addReport(state, { report: { id: "r2", q: "Two?" } }),
  );
  const off = commit(model.removeReport(state, { id: "r1" }));
  undo(r2);
  undo(off);
  assert.deepEqual(
    state.reports.map((r) => r.id),
    ["r1"],
  );

  // The same note written twice: undoing the first would lose the second,
  // so it is refused with a sentence, and stays undoable later.
  const id = deriveTransactions(state, { today }).txns[0].id;
  const note0 = state.notes[id];
  const first = commit(model.setNote(state, { id, text: "first" }));
  const second = commit(model.setNote(state, { id, text: "second" }));
  assert.equal(undo(first), null);
  assert.equal(state.notes[id], "second");
  assert.match(told.at(-1), /changed again since/);
  undo(second);
  undo(first);
  assert.equal(state.notes[id], note0);

  // Thread rules edited on the same lines: refused, the edit kept.
  const rules = state.rules;
  const one = commit(
    model.setRules(state, { rules: `${rules}\nCoffee\n  kite` }),
  );
  commit(model.setRules(state, { rules: `${rules}\nCoffee\n  kite cafe` }));
  assert.equal(undo(one), null);
  assert.match(state.rules, /kite cafe/);
  assert.match(told.at(-1), /threads have changed/);
});
