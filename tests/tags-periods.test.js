import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import {
  parseTags,
  restoreNotes,
  retag,
  tagsOf,
} from "../transactions/tags.js";
import { periodPayments, periodStats } from "../transactions/period-stats.js";

const TODAY = "2026-09-30";
function demo() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  return state;
}

test("tags are read from what people type and from notes", () => {
  assert.deepEqual(parseTags("trip, #Car  ##home trip"), [
    "#trip",
    "#car",
    "#home",
  ]);
  assert.deepEqual(parseTags(" , "), []);
  assert.deepEqual(tagsOf("Tow home. #car #Car #קניות"), ["#car", "#קניות"]);
  assert.deepEqual(tagsOf(""), []);
});

test("retag adds and removes tags in bulk, and restoreNotes undoes it", () => {
  const { notes } = demo();
  const [withPets, withCar] = Object.entries(notes).filter(([, n]) =>
    /#pets|#car/.test(n),
  );
  const ids = [withPets[0], withCar[0], "no-note"];
  const added = retag(notes, ids, ["#checked"]);
  assert.deepEqual(Object.keys(added.previous).sort(), [...ids].sort());
  assert.equal(added.notes["no-note"], "#checked");
  assert.match(added.notes[withPets[0]], /#pets #checked$/);
  assert.equal(notes["no-note"], undefined, "the input is left alone");

  // Adding again changes nothing; removing takes the tag out cleanly.
  assert.deepEqual(retag(added.notes, ids, ["#checked"]).previous, {});
  const removed = retag(added.notes, ids, [], ["#checked"]);
  assert.equal(removed.notes["no-note"], undefined);
  assert.equal(removed.notes[withPets[0]], notes[withPets[0]]);

  assert.deepEqual(restoreNotes(added.notes, added.previous), notes);
});

test("periodStats sums a period's charges by thread", () => {
  const state = demo();
  const derived = deriveTransactions(state, { today: TODAY });
  const trip = state.periods.find((p) => p.id === "demo-trip");
  const st = periodStats(derived.allTxns, trip);
  assert.equal(st.days, 6);
  assert.equal(st.out.length, 7);
  assert.deepEqual(st.sums, [["ILS", 984]]);
  assert.equal(
    st.byThread.reduce((s, [, v]) => s + v, 0),
    984,
  );
  assert.ok(st.byThread.every(([, , c]) => c === "ILS"));
  assert.deepEqual(
    st.biggest.map((t) => t.amount),
    [...st.out.map((t) => t.amount)].sort((a, b) => b - a).slice(0, 6),
  );
  assert.ok(st.inside.every((t) => !t.transfer));
  assert.ok(st.out.every((t) => st.inside.includes(t) && t.amount > 0));
});

test("periodPayments finds a period's payments by its id, not its name", () => {
  const state = demo();
  const derived = deriveTransactions(state, { today: TODAY });
  const trip = state.periods.find((p) => p.id === "demo-trip");
  const twin = { ...trip, id: "twin", start: "2026-01-10", end: "2026-01-13" };
  const ids = periodPayments(derived.allTxns, trip);
  assert.ok(ids.length >= periodStats(derived.allTxns, trip).out.length);
  for (const id of ids) {
    const t = derived.byId.get(id);
    assert.ok(t.date >= trip.start && t.date <= trip.end && !t.transfer);
  }
  // Same name, other dates: other payments.
  const other = periodPayments(derived.allTxns, twin);
  assert.ok(other.length > 0);
  assert.ok(other.every((id) => !ids.includes(id)));
});
