// Moving and resizing named periods on a timeline: which one a point is
// over, where a drag takes it, and a nudge from the keyboard. The one home
// of these rules (tests/architecture.test.js): the old timeline (ui/
// timeline-drag.js) and <tx-period-strip> pass in their own geometry, x
// positions in pixels and inv(x), the time at x in ms. monthsScale is the
// canvas views' date-to-x scale.

const DAY = 864e5;
const iso = (v) => new Date(v).toISOString().slice(0, 10);
const msOf = (d) => Date.parse(`${d}T00:00:00Z`);

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

// A nudge of a day from the keyboard: the whole period, or with endOnly its
// end, which stops at its start.
export function nudge(p, days, endOnly) {
  if (!endOnly)
    return {
      start: iso(msOf(p.start) + days * DAY),
      end: iso(msOf(p.end) + days * DAY),
    };
  const end = iso(msOf(p.end) + days * DAY);
  return { start: p.start, end: end >= p.start ? end : p.end };
}

// Months side by side as equal columns, each day an equal part of its
// month: at(date) and end(date) are the start and end of a day as a
// fraction of the width (clamped to the months), and inv(f) is the time at
// a fraction, in ms. cols: ["YYYY-MM", …].
export function monthsScale(cols) {
  const N = cols.length;
  const days = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  const pos = (date, off) => {
    const i = cols.indexOf(date.slice(0, 7));
    if (i < 0) return date < cols[0] ? 0 : 1;
    return (i + (Number(date.slice(8, 10)) - 1 + off) / days(cols[i])) / N;
  };
  const inv = (f) => {
    const g = Math.min(N - 1e-9, Math.max(0, f * N));
    const i = Math.floor(g);
    return msOf(`${cols[i]}-01`) + (g - i) * days(cols[i]) * DAY;
  };
  return {
    from: `${cols[0]}-01`,
    to: `${cols[N - 1]}-${String(days(cols[N - 1])).padStart(2, "0")}`,
    at: (d) => pos(d, 0),
    end: (d) => pos(d, 1),
    inv,
    dateAt: (f) => iso(inv(f)),
  };
}
