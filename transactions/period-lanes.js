// Named periods packed into lanes, so overlapping ones sit on top of each
// other: the one home of this rule (tests/architecture.test.js), used by the
// old timeline (ui/timeline-layout.js) and <tx-period-strip>. start and end
// are anything that compares in order: ISO dates, or pixel extents.
// Earliest first, and the longer of two that start together first. A
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
