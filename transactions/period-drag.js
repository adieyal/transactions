// Named periods on a timeline: which row each sits on, which one a point
// is over, and where a drag takes it. Shared by the old timeline (ui/
// timeline.js) and the canvas views (components/), which pass in their own
// geometry: x positions in pixels, and inv(x), the time at x in ms.

const DAY = 864e5;
const iso = (v) => new Date(v).toISOString().slice(0, 10);
const msOf = (d) => Date.parse(`${d}T00:00:00Z`);

// Periods packed into lanes so overlapping ones sit on top of each other:
// earliest first, and the longer of two that start together first. A
// period goes in the first lane that ends before it starts.
export function periodLanes(periods) {
  const pers = [...periods].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : a.end > b.end ? -1 : 1,
  );
  const laneEnds = [],
    laneOf = {};
  for (const p of pers) {
    let l = laneEnds.findIndex((e) => e < p.start);
    if (l < 0) {
      l = laneEnds.length;
      laneEnds.push(p.end);
    } else laneEnds[l] = p.end;
    laneOf[p.id] = l;
  }
  return { pers, laneOf, lanes: laneEnds.length };
}

// The period whose column is under x, and which side if x is within
// `slop` pixels of one. bands: [{ id, a, b }], a and b its sides' x. The
// selected period wins where periods overlap, then the narrowest.
export function periodAt(bands, x, selected = null, slop = 4) {
  const band = bands
    .filter((b) => b.b > b.a && x >= b.a - slop && x <= b.b + slop)
    .sort(
      (p, q) =>
        (q.id === selected) - (p.id === selected) || p.b - p.a - (q.b - q.a),
    )[0];
  if (!band) return null;
  const edge =
    Math.abs(x - band.a) <= slop
      ? "start"
      : Math.abs(x - band.b) <= slop
        ? "end"
        : undefined;
  return { id: band.id, edge };
}

// A press on a period: what dragging it does.
export const startDrag = (p, x, edge) => ({
  kind: edge ? "resize" : "move",
  edge,
  id: p.id,
  x,
  start: p.start,
  end: p.end,
  moved: false,
});

// Where the drag puts the period with the pointer at x: whole days, a move
// keeps its length, and a side stops at the other. Nothing until the
// pointer has gone more than three pixels (a click, not a drag).
export function dragTo(drag, x, inv) {
  if (Math.abs(x - drag.x) > 3) drag.moved = true;
  if (!drag.moved) return null;
  const days = Math.round((inv(x) - inv(drag.x)) / DAY);
  const [s, e] = [msOf(drag.start), msOf(drag.end)];
  if (drag.kind === "move")
    return { start: iso(s + days * DAY), end: iso(e + days * DAY) };
  if (drag.edge === "start")
    return { start: iso(Math.min(e, s + days * DAY)), end: drag.end };
  return { start: drag.start, end: iso(Math.max(s, e + days * DAY)) };
}
