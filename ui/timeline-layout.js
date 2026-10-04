import { addMonths, monthOf, ms } from "../helpers.js";
import { LOOSE, TRANSFERS } from "../transactions/constants.js";

// Where everything on the timeline goes, as plain numbers: the time scale,
// statement bars, period lanes, thread rows, budget bands, beads, arcs and
// period bands. Pure, so it is tested in Node; ui/timeline.js turns it into
// SVG. Nothing here depends on what is lit up or selected.

const DAY = 864e5;
export const isoFromMs = (v) => new Date(v).toISOString().slice(0, 10);

// A budget value rounded to something a person would type.
export const niceBudget = (v) =>
  v <= 0
    ? 0
    : v < 100
      ? Math.round(v / 10) * 10
      : v < 1000
        ? Math.round(v / 50) * 50
        : Math.round(v / 100) * 100;

// The dates shown: everything there is, today, three months ahead and the
// periods, cut to the chosen range, with a little room either side.
export function timeDomain(derived, state, today) {
  const dates = [...derived.txns, ...derived.extras].map(
    (t) => t.chargeDate || t.date,
  );
  state.periods.forEach((p) => dates.push(p.start, p.end));
  let lo = dates.reduce((a, b) => (a < b ? a : b), today),
    hi = dates.reduce((a, b) => (a > b ? a : b), today);
  if (hi < addMonths(today, 3)) hi = addMonths(today, 3);
  const r = { 3: 3, 6: 6, 12: 12 }[state.range];
  if (r) {
    const s = addMonths(today, -r);
    if (s > lo) lo = s;
  }
  return [ms(lo) - 8 * DAY, ms(hi) + 10 * DAY];
}

// One row's monthly spend against its budget, for the bars behind its beads.
function budgetBand(row, budget, drag, cy, months, colX) {
  const spent = {},
    exp = {};
  for (const t of row.items) {
    const k = monthOf(t.chargeDate || t.date);
    if (t.kind === "actual") spent[k] = (spent[k] || 0) + t.amount;
    else if (t.kind === "ghost") exp[k] = (exp[k] || 0) + t.amount;
  }
  const peak = Math.max(
    0,
    ...months.map((mm) => (spent[monthOf(mm)] || 0) + (exp[monthOf(mm)] || 0)),
  );
  const bandMax = drag
    ? drag.bandMax
    : Math.max(budget * 1.35, peak * 1.05, 10);
  const bandH = 88 - 14,
    base = cy + bandH / 2,
    yv = (v) => base - Math.min(1, Math.max(0, v) / bandMax) * bandH;
  const bars = [];
  for (const mm of months) {
    const k = monthOf(mm);
    const { a, b } = colX(mm);
    if (b - a < 3) continue;
    const sp = spent[k] || 0,
      ex = exp[k] || 0;
    if (!sp && !ex) continue;
    bars.push({ k, a, b, sp, ex, over: sp + ex > budget + 0.005 });
  }
  const currency = row.items[0]?.currency;
  return { budget, currency, base, bandH, bandMax, yv, yb: yv(budget), bars };
}

// width: the timeline's width in pixels.
export function layoutTimeline({ derived, state, today, width }) {
  const W = Math.max(320, width);
  const narrow = W < 640;
  const labelW = narrow ? 100 : 158,
    padR = 10;
  const [t0, t1] = timeDomain(derived, state, today);
  const X = (v) => labelW + ((v - t0) / (t1 - t0)) * (W - labelW - padR);
  const inRange = (t) => {
    const v = ms(t.chargeDate || t.date);
    return v >= t0 && v <= t1;
  };
  // Hidden accounts keep their row so their name can turn them back on.
  const accts = derived.accounts;
  // Room above the statement bars for the future area's heading.
  const covTop = 28,
    covH = accts.length * 13;
  const axisY = covTop + covH + 16;
  const expY = axisY + 16;

  // Periods, packed into lanes so overlapping ones sit on top of each other.
  const pers = state.periods
    .filter((p) => ms(p.end) >= t0 && ms(p.start) <= t1)
    .sort((a, b) =>
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
  const laneH = 20,
    perTop = expY + 8,
    perBottom = perTop + Math.max(1, laneEnds.length) * laneH;
  const top = perBottom + 10;
  const periodX = (p) => ({
    a: Math.max(labelW, X(ms(p.start))),
    b: Math.min(W - padR, X(ms(p.end) + DAY)),
  });

  // Months along the axis, and what is expected in each (money in isn't a
  // charge, so it is left out).
  const monthsShown = [];
  for (let m = monthOf(isoFromMs(t0)) + "-01"; ms(m) <= t1; m = addMonths(m, 1))
    monthsShown.push(m);
  const every = monthsShown.length > 30 ? 3 : monthsShown.length > 16 ? 2 : 1;
  // Expected charges per month, kept as items so each currency is added up
  // on its own.
  const expByMonth = {};
  for (const e of derived.expected)
    if (inRange(e) && !e.inflow) (expByMonth[monthOf(e.date)] ||= []).push(e);
  const colX = (mm) => ({
    a: Math.max(labelW, X(ms(mm))) + 2,
    b: Math.min(W - padR, X(ms(addMonths(mm, 1)))) - 2,
  });

  // Thread rows, with parked threads folded into one quiet row at the bottom.
  const rowH = 60;
  const rows = derived.names.map((name) => ({
    name,
    color: derived.colorOf[name],
    items: [],
  }));
  const rowOf = Object.fromEntries(rows.map((r, i) => [r.name, i]));
  for (const t of [...derived.txns, ...derived.extras])
    if (inRange(t)) rows[rowOf[t.thread] ?? rowOf[LOOSE]].items.push(t);
  const parkedSet = new Set(state.view.parked.map((n) => n.toLowerCase()));
  const isParked = (r) => parkedSet.has(r.name.toLowerCase());
  const visibleRows = rows.filter(
    (r) =>
      (r.items.length || (r.name !== LOOSE && r.name !== TRANSFERS)) &&
      (state.view.showParked || !isParked(r)),
  );
  const parkedRows = state.view.showParked ? [] : rows.filter(isParked);
  if (parkedRows.length)
    visibleRows.push({
      name: "__parked",
      parked: parkedRows,
      color: "var(--ink-2)",
      items: parkedRows.flatMap((r) => r.items),
    });
  const threadOf = (name) => derived.R.threads.find((t) => t.name === name);
  const hasBudget = (r) =>
    !narrow &&
    (threadOf(r.name)?.budget != null || state.budgetDrag?.thread === r.name);
  let yAcc = top;
  const beads = [];
  const byId = {};
  const budgetMeta = {};
  for (const row of visibleRows) {
    const h = row.name === "__parked" ? 44 : hasBudget(row) ? 88 : rowH;
    row.cy = yAcc + h / 2;
    yAcc += h;
    row.isParked = isParked(row);
    row.thread = threadOf(row.name) || null;
    row.drag = state.budgetDrag?.thread === row.name ? state.budgetDrag : null;
    const budget = row.drag ? row.drag.value : row.thread?.budget;
    // A budget band compares one currency; a thread with charges in several
    // has its budget told per currency in the summaries instead.
    const oneCurrency = new Set(row.items?.map((t) => t.currency)).size <= 1;
    if (
      row.name !== "__parked" &&
      row.thread &&
      budget != null &&
      !narrow &&
      oneCurrency
    ) {
      row.band = budgetBand(row, budget, row.drag, row.cy, monthsShown, colX);
      const { base, bandH, bandMax } = row.band;
      budgetMeta[row.name] = { base, bandH, bandMax };
    }
    // Beads, by amount, spread over a few lanes so they don't overlap.
    const items = row.items
      .map((t) => ({
        t,
        x: X(ms(t.chargeDate || t.date)),
        r: Math.max(
          3,
          Math.min(17, 2.2 + Math.sqrt(Math.abs(t.amount)) * 0.38),
        ),
      }))
      .sort((a, b) => a.x - b.x || b.r - a.r);
    const lanes = (
      row.name === "__parked" ? [0, -7, 7] : [0, -10, 10, -19, 19]
    ).map((off) => ({ off, lastX: -1e9, lastR: 0 }));
    if (row.name === "__parked")
      items.forEach((it) => (it.r = Math.max(2.5, it.r * 0.55)));
    for (const it of items) {
      const lane =
        lanes.find((l) => it.x - l.lastX > it.r + l.lastR + 1) ||
        lanes.reduce((a, b) => (a.lastX < b.lastX ? a : b));
      lane.lastX = it.x;
      lane.lastR = it.r;
      it.y = row.cy + lane.off;
      if (!byId[it.t.id]) beads.push(it);
      byId[it.t.id] = it;
    }
  }
  const H = yAcc + 8;

  // Arcs along each chain (rhythm, instalments, transfers) within a row.
  const arcs = [];
  for (const chain of derived.links)
    for (let i = 1; i < chain.length; i++) {
      const a = byId[chain[i - 1]],
        b = byId[chain[i]];
      if (!a || !b || Math.abs(a.y - b.y) > rowH / 2 + 20) continue;
      arcs.push({
        a,
        b,
        h: Math.min(22, Math.max(6, Math.abs(b.x - a.x) / 5)),
        dash: a.t.kind !== "actual" || b.t.kind !== "actual",
      });
    }
  // A card payment points up at the statement it settled.
  const cardLinks = [];
  for (const it of beads) {
    const tr = it.t.transfer;
    if (tr?.kind !== "card") continue;
    const ai = accts.indexOf(tr.stmt.account);
    if (ai < 0) continue;
    cardLinks.push({
      it,
      stmt: tr.stmt,
      xm: X(ms(tr.stmt.period + "-01") + 15 * DAY),
      ys: covTop + ai * 13 + 8,
    });
  }

  return {
    W,
    H,
    narrow,
    labelW,
    padR,
    t0,
    t1,
    X,
    accts,
    covTop,
    axisY,
    expY,
    pers,
    laneOf,
    laneH,
    perTop,
    perBottom,
    top,
    periodX,
    monthsShown,
    every,
    expByMonth,
    visibleRows,
    beads,
    arcs,
    cardLinks,
    budgetMeta,
    // The selected period first, then the narrowest, so the most specific
    // band wins where periods overlap.
    bands: pers
      .map((p) => ({ id: p.id, ...periodX(p) }))
      .filter((p) => p.b > p.a)
      .sort(
        (p, q) =>
          (q.id === state.periodSel) - (p.id === state.periodSel) ||
          p.b - p.a - (q.b - q.a),
      ),
    // From an x position back to a time.
    inv: (x) => t0 + ((x - labelW) / (W - labelW - padR)) * (t1 - t0),
  };
}
