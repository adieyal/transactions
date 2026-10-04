import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dragTo,
  monthsScale,
  nudge,
  periodAt,
  startDrag,
} from "../transactions/period-drag.js";
import { periodLanes } from "../transactions/period-lanes.js";

const P = (id, start, end) => ({ id, start, end });
// A day is 10px: x 0 is 1 September 2026.
const inv = (x) => Date.parse("2026-09-01T00:00:00Z") + (x / 10) * 864e5;

test("periods that overlap stack on separate lanes, the earliest on top", () => {
  const { laneOf, lanes } = periodLanes([
    P("b", "2026-09-05", "2026-09-12"),
    P("a", "2026-09-01", "2026-09-06"),
    P("c", "2026-09-07", "2026-09-20"),
  ]);
  assert.deepEqual(laneOf, { a: 0, b: 1, c: 0 });
  assert.equal(lanes, 2);
});

test("a period ending the day another starts still overlaps it", () => {
  const { laneOf } = periodLanes([
    P("a", "2026-09-01", "2026-09-06"),
    P("b", "2026-09-06", "2026-09-10"),
    P("c", "2026-09-11", "2026-09-12"),
  ]);
  assert.deepEqual(laneOf, { a: 0, b: 1, c: 0 });
});

test("of two that start together, the longer takes the upper lane", () => {
  const { laneOf } = periodLanes([
    P("short", "2026-09-01", "2026-09-03"),
    P("long", "2026-09-01", "2026-09-30"),
  ]);
  assert.deepEqual(laneOf, { long: 0, short: 1 });
});

test("moving a period onto its neighbour shifts one of them to another lane", () => {
  const ps = [
    P("a", "2026-09-01", "2026-09-05"),
    P("b", "2026-09-10", "2026-09-14"),
  ];
  assert.equal(periodLanes(ps).lanes, 1);
  const d = startDrag(ps[1], 120);
  Object.assign(ps[1], dragTo(d, 80, inv));
  assert.deepEqual(ps[1], P("b", "2026-09-06", "2026-09-10"));
  assert.equal(periodLanes(ps).lanes, 1);
  Object.assign(ps[1], dragTo(d, 70, inv));
  assert.deepEqual(periodLanes(ps).laneOf, { a: 0, b: 1 });
});

test("periodAt: a side within 4px resizes, inside moves, the narrowest wins", () => {
  const bands = [
    { id: "wide", a: 0, b: 300 },
    { id: "narrow", a: 100, b: 150 },
  ];
  assert.deepEqual(periodAt(bands, 50), { id: "wide", edge: undefined });
  assert.deepEqual(periodAt(bands, 103), { id: "narrow", edge: "start" });
  assert.deepEqual(periodAt(bands, 146), { id: "narrow", edge: "end" });
  assert.deepEqual(periodAt(bands, 120, "wide"), {
    id: "wide",
    edge: undefined,
  });
  assert.deepEqual(periodAt(bands, 304), { id: "wide", edge: "end" });
  assert.equal(periodAt(bands, 305), null);
});

test("a drag of three pixels or less is a click", () => {
  const d = startDrag(P("a", "2026-09-05", "2026-09-09"), 40);
  assert.equal(dragTo(d, 43, inv), null);
  assert.equal(d.moved, false);
  assert.deepEqual(dragTo(d, 44, inv), {
    start: "2026-09-05",
    end: "2026-09-09",
  });
});

test("resizing snaps to whole days and a side stops at the other", () => {
  const p = P("a", "2026-09-05", "2026-09-09");
  const s = startDrag(p, 40, "start");
  assert.deepEqual(dragTo(s, 56, inv), {
    start: "2026-09-07",
    end: "2026-09-09",
  });
  assert.deepEqual(dragTo(s, 400, inv), {
    start: "2026-09-09",
    end: "2026-09-09",
  });
  const e = startDrag(p, 90, "end");
  assert.deepEqual(dragTo(e, 114, inv), {
    start: "2026-09-05",
    end: "2026-09-11",
  });
  assert.deepEqual(dragTo(e, -100, inv), {
    start: "2026-09-05",
    end: "2026-09-05",
  });
});

test("arrow keys nudge a period a day, and Shift its end, which stops at its start", () => {
  const p = P("a", "2026-09-05", "2026-09-05");
  assert.deepEqual(nudge(p, 1), { start: "2026-09-06", end: "2026-09-06" });
  assert.deepEqual(nudge(p, 1, true), {
    start: "2026-09-05",
    end: "2026-09-06",
  });
  assert.deepEqual(nudge(p, -1, true), {
    start: "2026-09-05",
    end: "2026-09-05",
  });
});

test("monthsScale: months as equal columns, and back from x to a date", () => {
  const s = monthsScale(["2026-02", "2026-03"]);
  assert.equal(s.at("2026-02-01"), 0);
  assert.equal(s.end("2026-02-28"), 0.5);
  assert.equal(s.at("2026-03-01"), 0.5);
  assert.equal(s.at("2026-01-20"), 0);
  assert.equal(s.end("2026-04-02"), 1);
  assert.equal(s.dateAt(0.5 + 0.5 * (10.5 / 31)), "2026-03-11");
  assert.equal(s.dateAt(1.2), "2026-03-31");
  assert.equal(s.dateAt(-1), "2026-02-01");
  assert.deepEqual([s.from, s.to], ["2026-02-01", "2026-03-31"]);
});
