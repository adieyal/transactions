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
import { periodStats } from "../transactions/period-stats.js";

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
  assert.equal(st.sum, 984);
  assert.equal(
    st.byThread.reduce((s, [, v]) => s + v, 0),
    st.sum,
  );
  assert.deepEqual(
    st.biggest.map((t) => t.amount),
    [...st.out.map((t) => t.amount)].sort((a, b) => b - a).slice(0, 6),
  );
  assert.ok(st.inside.every((t) => !t.transfer));
  assert.ok(st.out.every((t) => st.inside.includes(t) && t.amount > 0));
});
