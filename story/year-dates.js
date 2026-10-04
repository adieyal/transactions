import { MONTHS } from "../helpers.js";

// The year's section labels, as drawn.

export const short = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, mon: MONTHS[m - 1], d };
};

// "10 – 13 Dec 2025", "28 Mar – 2 Apr 2026": a section's dates, as drawn.
export function shortRange(from, to) {
  const a = short(from),
    b = short(to);
  if (from === to) return `${a.d} ${a.mon} ${a.y}`;
  if (a.y === b.y && a.mon === b.mon) return `${a.d} – ${b.d} ${b.mon} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.mon} – ${b.d} ${b.mon} ${b.y}`;
  return `${a.d} ${a.mon} ${a.y} – ${b.d} ${b.mon} ${b.y}`;
}

// "Oct – Nov 2025", "Sep 2026": a run of months.
export function monthRange(first, last) {
  const [y1, m1] = first.split("-").map(Number),
    [y2, m2] = last.split("-").map(Number);
  if (first === last) return `${MONTHS[m1 - 1]} ${y1}`;
  return y1 === y2
    ? `${MONTHS[m1 - 1]} – ${MONTHS[m2 - 1]} ${y2}`
    : `${MONTHS[m1 - 1]} ${y1} – ${MONTHS[m2 - 1]} ${y2}`;
}
