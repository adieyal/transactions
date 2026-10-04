import {
  $,
  MONTHS,
  TODAY,
  addMonths,
  esc,
  fmt,
  fmtDate,
  fmtShort,
  monthName,
  monthOf,
  ms,
} from "../helpers.js";
import { LOOSE, TRANSFERS } from "../transactions/constants.js";
import { toast } from "./dom.js";
import { parseRules } from "../transactions/rules.js";
import { name as bidi } from "../story/copy.js";
import {
  anchorEnd,
  fitLabels,
  placeParkButtons,
  placeStickyNames,
} from "./timeline-labels.js";

// Half a plain row's height (rowH below), for finding the row under the pointer.
const ROW_HALF = 30;

export function createTimeline(runtime, actions) {
  const { state } = runtime;
  let POS = [],
    TL = null;

  const isoFromMs = (v) => new Date(v).toISOString().slice(0, 10);

  const niceBudget = (v) =>
    v <= 0
      ? 0
      : v < 100
        ? Math.round(v / 10) * 10
        : v < 1000
          ? Math.round(v / 50) * 50
          : Math.round(v / 100) * 100;

  function domain() {
    const dates = [...runtime.derived.txns, ...runtime.derived.extras].map(
      (t) => t.chargeDate || t.date,
    );
    state.periods.forEach((p) => {
      dates.push(p.start, p.end);
    });
    let lo = dates.reduce((a, b) => (a < b ? a : b), TODAY),
      hi = dates.reduce((a, b) => (a > b ? a : b), TODAY);
    if (hi < addMonths(TODAY, 3)) hi = addMonths(TODAY, 3);
    const r = { 3: 3, 6: 6, 12: 12 }[state.range];
    if (r) {
      const s = addMonths(TODAY, -r);
      if (s > lo) lo = s;
    }
    return [ms(lo) - 8 * 864e5, ms(hi) + 10 * 864e5];
  }

  function renderTimeline() {
    const host = $("#tl");
    const W = Math.max(320, host.clientWidth);
    if (!state.loaded) {
      host.innerHTML = `<div class="empty"><div><p>Opening your ledger…</p></div></div>`;
      return;
    }
    if (!runtime.derived.txns.length && runtime.derived.allTxns?.length) {
      host.innerHTML = `<div class="empty" style="min-height:220px"><div><p>Nothing matches “${esc(state.query.trim())}”.</p><button class="btn quiet" id="emptyClear">Clear the filter</button></div></div>`;
      $("#emptyClear").onclick = () => $("#qClear").click();
      POS = [];
      TL = null;
      return;
    }
    if (!runtime.derived.txns.length) {
      host.innerHTML = `<div class="empty"><div><h2>Drop statements here</h2><p>Leumi card exports are read as they are. For any other bank, you show Transactions the columns once and it remembers that format.</p><button class="btn" id="emptyAdd">Choose files</button></div></div>`;
      $("#emptyAdd").onclick = () => $("#file").click();
      POS = [];
      TL = null;
      return;
    }
    const narrow = W < 640;
    const labelW = narrow ? 100 : 158,
      padR = 10;
    const [t0, t1] = domain();
    const X = (v) => labelW + ((v - t0) / (t1 - t0)) * (W - labelW - padR);
    const inRange = (t) => {
      const v = ms(t.chargeDate || t.date);
      return v >= t0 && v <= t1;
    };
    // Hidden accounts keep their row so their name can turn them back on.
    const accts = runtime.derived.accounts;
    // Room above the statement bars for the future area's heading.
    const covTop = 28,
      covH = accts.length * 13;
    const axisY = covTop + covH + 16;
    const expY = axisY + 16;
    // periods: packed into lanes so overlapping ones sit on top of each other
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
    const rowH = 60;
    const rows = runtime.derived.names.map((name) => ({
      name,
      color: runtime.derived.colorOf[name],
      items: [],
    }));
    const rowOf = Object.fromEntries(rows.map((r, i) => [r.name, i]));
    for (const t of [...runtime.derived.txns, ...runtime.derived.extras])
      if (inRange(t)) rows[rowOf[t.thread] ?? rowOf[LOOSE]].items.push(t);
    const parkedSet = new Set(state.view.parked.map((n) => n.toLowerCase()));
    const isParked = (r) => parkedSet.has(r.name.toLowerCase());
    let visibleRows = rows.filter(
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
    const hasBudget = (r) =>
      !narrow &&
      (runtime.derived.R.threads.find((t) => t.name === r.name)?.budget !=
        null ||
        state.budgetDrag?.thread === r.name);
    const rowHeight = (r) =>
      r.name === "__parked" ? 44 : hasBudget(r) ? 88 : rowH;
    const rowY = [];
    let yAcc = top;
    for (const r of visibleRows) {
      rowY.push(yAcc + rowHeight(r) / 2);
      yAcc += rowHeight(r);
    }
    const H = yAcc + 8;
    const hl = state.highlight,
      sel = state.selection,
      dimming = hl.size > 0;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Transactions on a timeline, one row per thread">`;
    const xToday = X(ms(TODAY));
    const fx0 = Math.max(labelW, xToday),
      fx1 = W - padR;
    s += `<rect class="futurebg" x="${fx0}" y="0" width="${Math.max(0, fx1 - fx0)}" height="${H}"/>`;
    // A heading with a bracket across the whole shaded area it describes.
    if (fx1 - fx0 > 120)
      s += `<g class="futurehead"><title>Dates still to come. Dashed marks and ≈ amounts are charges expected from recurring payments and instalments.</title><text x="${fx0 + 10}" y="13">Future transactions</text><path d="M${fx0 + 4},${covTop - 8}v4H${fx1 - 4}v-4"/></g>`;
    // every period shades the dates beneath it; the selected one is stronger
    // and can be dragged to move it, or by its sides to resize it
    const selP = pers.find((p) => p.id === state.periodSel);
    for (const p of pers) {
      if (p === selP) continue;
      const a = Math.max(labelW, X(ms(p.start))),
        b = Math.min(W - padR, X(ms(p.end) + 864e5));
      if (b > a)
        s += `<rect class="pfill" x="${a}" y="${perTop}" width="${Math.max(2, b - a)}" height="${H - perTop}" style="--pc:${p.color}"/>`;
    }
    if (selP) {
      const a = Math.max(labelW, X(ms(selP.start))),
        b = Math.min(W - padR, X(ms(selP.end) + 864e5));
      s += `<g class="period pband" data-pid="${selP.id}" style="--pc:${selP.color}"><rect class="pshade" x="${a}" y="${perTop}" width="${Math.max(2, b - a)}" height="${H - perTop}"/><rect class="pedge" data-edge="start" x="${a - 4}" y="${perTop}" width="8" height="${H - perTop}"/><rect class="pedge" data-edge="end" x="${b - 4}" y="${perTop}" width="8" height="${H - perTop}"/></g>`;
    }
    // months
    let m = monthOf(new Date(t0).toISOString().slice(0, 10)) + "-01";
    const expByMonth = {};
    // Expected charges only: money that usually comes in isn't one.
    runtime.derived.expected.forEach((e) => {
      if (inRange(e) && !e.inflow)
        expByMonth[monthOf(e.date)] =
          (expByMonth[monthOf(e.date)] || 0) + e.amount;
    });
    const monthsShown = [];
    while (ms(m) <= t1) {
      monthsShown.push(m);
      m = addMonths(m, 1);
    }
    const span = monthsShown.length;
    const every = span > 30 ? 3 : span > 16 ? 2 : 1;
    const anyCov = new Set(
      Object.values(runtime.derived.coverage).flatMap((set) => [...set]),
    );
    monthsShown.forEach((mm, i) => {
      const x0 = Math.max(labelW, X(ms(mm))),
        x1 = Math.min(W - padR, X(ms(addMonths(mm, 1))));
      if (X(ms(mm)) >= labelW)
        s += `<line class="gridline" x1="${x0}" x2="${x0}" y1="${axisY + 4}" y2="${H}"/>`;
      const [yy, mo] = mm.split("-").map(Number);
      if (i % every === 0 && x1 - x0 > (X(ms(mm)) < labelW ? 64 : 20))
        s += `<text class="axis" data-thin x="${x0 + 4}" y="${axisY}">${MONTHS[mo - 1]}${mo === 1 || i === 0 ? " " + yy : ""}</text>`;
      accts.forEach((a, ai) => {
        const y = covTop + ai * 13;
        const has = runtime.derived.coverage[a]?.has(monthOf(mm));
        if (x1 - x0 > 2)
          s += has
            ? `<rect class="cov-on${state.hiddenAccounts.has(a) ? " hidden-acct" : ""}" data-acct="${esc(a)}" data-period="${monthOf(mm)}" x="${x0 + 1}" y="${y}" width="${x1 - x0 - 2}" height="8" rx="2"><title>${esc(a)}: statement for ${monthName(monthOf(mm))}</title></rect>`
            : mm < TODAY
              ? `<rect class="cov-off" x="${x0 + 1.5}" y="${y + 0.5}" width="${x1 - x0 - 3}" height="7" rx="2"><title>No ${monthName(monthOf(mm))} statement for ${esc(bidi(a))}</title></rect>`
              : "";
      });
      const ex = expByMonth[monthOf(mm)];
      if (ex && x1 - x0 > 40)
        s += `<text class="exp" data-thin x="${(x0 + x1) / 2}" y="${expY}" text-anchor="middle"><title>Expected charges this month</title>≈ ${fmtShort(ex)}</text>`;
    });
    accts.forEach((a, ai) => {
      const off = state.hiddenAccounts.has(a);
      s += `<text class="covlabel acctlabel${off ? " off" : ""}" data-togacct="${esc(a)}" data-fit="${labelW - 12}" role="switch" aria-checked="${!off}" tabindex="0" x="${labelW - 8}" y="${covTop + ai * 13 + 8}" ${anchorEnd(a)}><title>${off ? `Show ${esc(bidi(a))}` : `Hide ${esc(bidi(a))}`}</title><tspan>${esc(a)}</tspan></text>`;
    });
    // periods strip
    s += `<rect class="pstrip" x="${labelW}" y="${perTop}" width="${W - padR - labelW}" height="${perBottom - perTop}"><title>Drag along this strip to mark a period</title></rect>`;
    s += `<text class="covlabel" x="${labelW - 8}" y="${perTop + 14}" text-anchor="end">Periods</text>`;
    if (!pers.length)
      s += `<text class="phint" x="${labelW + 8}" y="${perTop + 14}">Drag along here to mark a stretch of time: a trip, setting up house, a busy month</text>`;
    for (const p of pers) {
      const x0 = Math.max(labelW, X(ms(p.start))),
        x1 = Math.min(W - padR, X(ms(p.end) + 864e5));
      const y = perTop + laneOf[p.id] * laneH + 2;
      const w = Math.max(6, x1 - x0);
      const chars = Math.floor((w - 12) / 6.4);
      const label =
        chars < 2
          ? ""
          : p.name.length > chars
            ? p.name.slice(0, Math.max(1, chars - 1)) + "…"
            : p.name;
      s +=
        `<g class="period${p.id === state.periodSel ? " on" : ""}" data-pid="${p.id}"><title>${esc(bidi(p.name))}: ${fmtDate(p.start)} to ${fmtDate(p.end)}</title><rect class="pbody" x="${x0}" y="${y}" width="${w}" height="16" rx="4" fill="${p.color}" fill-opacity="${p.id === state.periodSel ? 0.4 : 0.22}" stroke="${p.color}"/>` +
        `<text class="plabel" x="${x0 + 6}" y="${y + 12}" dir="auto">${esc(label)}</text>` +
        `<rect class="pedge" data-edge="start" x="${x0 - 3}" y="${y}" width="7" height="16"/><rect class="pedge" data-edge="end" x="${x0 + w - 4}" y="${y}" width="7" height="16"/></g>` +
        (p.id === state.periodSel
          ? `<g class="xbtn" data-pdel="${p.id}" role="button" aria-label="Remove ${esc(p.name)}"><title>Remove this period (Delete)</title><circle cx="${x0 + w + 10}" cy="${y + 8}" r="7"/><path d="M${x0 + w + 7},${y + 5}l6,6m0,-6l-6,6"/></g>`
          : "");
    }
    s += `<rect id="pDraft" x="0" y="${perTop + 2}" width="0" height="16" rx="4" class="pdraft" style="display:none"/>`;
    if (xToday > labelW && xToday < W)
      s += `<line class="todayline" x1="${xToday}" x2="${xToday}" y1="${axisY + 4}" y2="${H}"/><text class="axis" x="${xToday + 4}" y="${H - 4}">today</text>`;
    // rows
    POS = [];
    const P = {};
    const budgetMeta = {};
    visibleRows.forEach((row, ri) => {
      const cy = rowY[ri];
      const total = row.items
        .filter((t) => t.kind === "actual" && !t.inflow)
        .reduce((a, t) => a + t.amount, 0);
      if (row.name === "__parked") {
        s += `<line class="wire parked" x1="${labelW}" x2="${W - padR}" y1="${cy}" y2="${cy}"/>`;
        s += `<text class="parkedlabel" id="parkedLabel" x="${labelW - 12}" y="${cy + 4}" text-anchor="end"><title>Show parked threads on their own wires for now</title>${row.parked.length} parked</text>`;
      } else {
        const thr = runtime.derived.R.threads.find((t) => t.name === row.name);
        const drag =
          state.budgetDrag?.thread === row.name ? state.budgetDrag : null;
        const budget = drag ? drag.value : thr?.budget;
        if (thr && budget != null && !narrow) {
          // monthly spend against the budget, drawn behind the beads
          const spent = {},
            exp = {};
          for (const t of row.items) {
            const k = monthOf(t.chargeDate || t.date);
            if (t.kind === "actual") spent[k] = (spent[k] || 0) + t.amount;
            else if (t.kind === "ghost") exp[k] = (exp[k] || 0) + t.amount;
          }
          const peak = Math.max(
            0,
            ...monthsShown.map(
              (mm) => (spent[monthOf(mm)] || 0) + (exp[monthOf(mm)] || 0),
            ),
          );
          const bandMax = drag
            ? drag.bandMax
            : Math.max(budget * 1.35, peak * 1.05, 10);
          const bandH = 88 - 14,
            base = cy + bandH / 2,
            yv = (v) => base - Math.min(1, Math.max(0, v) / bandMax) * bandH;
          budgetMeta[row.name] = { base, bandH, bandMax };
          for (const mm of monthsShown) {
            const k = monthOf(mm);
            const a = Math.max(labelW, X(ms(mm))) + 2,
              b = Math.min(W - padR, X(ms(addMonths(mm, 1)))) - 2;
            if (b - a < 3) continue;
            const sp = spent[k] || 0,
              ex = exp[k] || 0;
            if (!sp && !ex) continue;
            const over = sp + ex > budget + 0.005;
            if (sp > 0)
              s += `<rect class="bbar${over ? " over" : ""}" x="${a}" y="${yv(sp)}" width="${b - a}" height="${base - yv(sp)}" style="--c:${row.color}"><title>${monthName(k)}: ${fmt(sp, 0)} of ${fmt(budget, 0)}</title></rect>`;
            if (ex > 0)
              s += `<rect class="bexp${over ? " over" : ""}" x="${a}" y="${yv(sp + ex)}" width="${b - a}" height="${yv(sp) - yv(sp + ex)}" style="--c:${row.color}"><title>${monthName(k)}: ${fmt(ex, 0)} expected</title></rect>`;
            if (over && b - a > 34)
              s += `<text class="bover" x="${(a + b) / 2}" y="${Math.max(yv(sp + ex) - 3, cy - bandH / 2 + 9)}" text-anchor="middle">${fmtShort(sp + ex)}</text>`;
          }
          const yb = yv(budget);
          s += `<line class="bline" x1="${labelW}" x2="${W - padR - 8}" y1="${yb}" y2="${yb}" stroke="${row.color}"/>`;
          const blabel = `${fmt(budget, 0)} a month`,
            bx = labelW + 4 + blabel.length * 6 + 8;
          s += `<text class="blabel" x="${labelW + 4}" y="${yb - 4}">${blabel}</text>`;
          s += `<g class="xbtn" data-bdel="${esc(row.name)}" role="button" aria-label="Remove the budget for ${esc(row.name)}"><title>Remove this budget</title><circle cx="${bx}" cy="${yb - 8}" r="6"/><path d="M${bx - 2.5},${yb - 10.5}l5,5m0,-5l-5,5"/></g>`;
          s += `<g class="bhandle" data-bthread="${esc(row.name)}" tabindex="0" role="slider" aria-label="Budget for ${esc(row.name)}" aria-valuenow="${budget}"><title>Drag up or down to set the monthly budget</title><circle cx="${W - padR - 6}" cy="${yb}" r="6" stroke="${row.color}"/></g>`;
        }
        s += `<line class="wire" x1="${labelW}" x2="${W - padR}" y1="${cy}" y2="${cy}"/>`;
        if (!narrow) {
          // An eye beside the thread name parks it; placeParkButtons moves it
          // flush against the rendered name.
          const parked = isParked(row);
          s += `<g class="parkbtn${parked ? " parked" : ""}" data-park="${esc(row.name)}" data-for-y="${cy - 2}" transform="translate(${labelW - 12 - row.name.length * 7 - 14},${cy - 6})" tabindex="0" role="button" aria-label="${parked ? "Unpark" : "Park"} ${esc(row.name)}"><title>${parked ? "Unpark this thread" : "Park this thread: fold it into one quiet wire at the bottom"}</title><rect x="-9" y="-8" width="18" height="16" rx="4"/><path d="M-6,0 Q0,-6 6,0 Q0,6 -6,0Z"/><circle r="1.8"/>${parked ? `<path d="M-6,5 L6,-5"/>` : ""}</g>`;
          // Adding a budget sits at the right end, where its drag handle will be.
          if (thr && thr.budget == null && !drag)
            s += `<g class="budgetbtn" data-budget="${esc(row.name)}" data-cy="${cy}" transform="translate(${W - padR - 4},${cy - 16})" tabindex="0" role="button" aria-label="Set a budget for ${esc(row.name)}"><title>Give this thread a monthly budget line you can drag</title><rect x="-62" y="-9" width="62" height="17" rx="8.5"/><text x="-31" y="3.5" text-anchor="middle">+ Budget</text></g>`;
        }
        s += `<text class="rowlabel" data-thread="${esc(row.name)}" data-line="${thr ? thr.line : ""}" data-fit="${labelW - 16 - (narrow ? 0 : 22)}" x="${labelW - 12}" y="${cy - 2}" ${anchorEnd(row.name)} style="fill:${row.color}"><title>${esc(bidi(row.name))}</title><tspan>${esc(row.name)}</tspan></text>`;
        s += `<text class="rowtotal" x="${labelW - 12}" y="${cy + 14}" text-anchor="end">${row.items.some((t) => t.kind === "actual") ? (row.name === TRANSFERS ? "moved " : "") + fmt(total, 0) : ""}</text>`;
      }
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
        let lane =
          lanes.find((l) => it.x - l.lastX > it.r + l.lastR + 1) ||
          lanes.reduce((a, b) => (a.lastX < b.lastX ? a : b));
        lane.lastX = it.x;
        lane.lastR = it.r;
        it.y = cy + lane.off;
        P[it.t.id] = it;
      }
    });
    // arcs (rhythm, instalment chains, transfers between accounts)
    for (const chain of runtime.derived.links) {
      for (let i = 1; i < chain.length; i++) {
        const a = P[chain[i - 1]],
          b = P[chain[i]];
        if (!a || !b || Math.abs(a.y - b.y) > rowH / 2 + 20) continue;
        const h = Math.min(22, Math.max(6, Math.abs(b.x - a.x) / 5));
        const dash = a.t.kind !== "actual" || b.t.kind !== "actual";
        const d = dimming && !(hl.has(a.t.id) && hl.has(b.t.id));
        s += `<path class="arc${dash ? " dash" : ""}${d ? " dim" : ""}" stroke="${runtime.derived.colorOf[a.t.thread] || "#888"}" d="M${a.x},${a.y - a.r} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - h - 8} ${b.x},${b.y - b.r}"/>`;
      }
    }
    // a card payment points up at the statement it settled
    for (const it of Object.values(P)) {
      const tr = it.t.transfer;
      if (tr?.kind !== "card") continue;
      const ai = accts.indexOf(tr.stmt.account);
      if (ai < 0) continue;
      const xm = X(ms(tr.stmt.period + "-01") + 15 * 864e5),
        ys = covTop + ai * 13 + 8;
      s += `<path class="transferlink${dimming && !hl.has(it.t.id) ? " dim" : ""}" d="M${it.x},${it.y - it.r} C${it.x},${(it.y + ys) / 2} ${xm},${(it.y + ys) / 2} ${xm},${ys}"><title>Pays the ${esc(bidi(tr.stmt.account))} statement for ${monthName(tr.stmt.period)}</title></path>`;
    }
    // beads
    for (const it of Object.values(P)) {
      const t = it.t,
        c = runtime.derived.colorOf[t.thread] || "#888";
      const cls = ["bead"];
      if (dimming && !hl.has(t.id)) cls.push("dim");
      if (sel.has(t.id)) cls.push("sel");
      let attrs;
      if (t.kind === "ghost")
        attrs = `fill="none" stroke="${c}" stroke-width="1.4" stroke-dasharray="3 2.5"`;
      else if (t.kind === "inferred")
        attrs = `fill="${c}" fill-opacity=".22" stroke="${c}" stroke-width="1.2" stroke-dasharray="2 2"`;
      else if (t.kind === "purchase")
        attrs = `fill="none" stroke="${c}" stroke-width="1"`;
      else if (t.amount < 0)
        attrs = `fill="var(--paper)" stroke="${c}" stroke-width="2"`;
      else attrs = `fill="${c}" stroke="var(--paper)" stroke-width="1"`;
      s += `<circle class="${cls.join(" ")}" data-id="${t.id}" cx="${it.x.toFixed(1)}" cy="${it.y}" r="${it.r.toFixed(1)}" ${attrs}/>`;
      if (t.kind === "actual" && t.amount < 0)
        s += `<line x1="${it.x - it.r * 0.5}" x2="${it.x + it.r * 0.5}" y1="${it.y}" y2="${it.y}" stroke="${c}" stroke-width="1.6" pointer-events="none"/>`;
      if (runtime.derived.flagged[t.id])
        s += `<text class="flagmark" x="${it.x}" y="${it.y - it.r - 3}" text-anchor="middle" pointer-events="none">${runtime.derived.flagged[t.id]}</text>`;
      POS.push({ id: t.id, x: it.x, y: it.y, r: it.r });
    }
    // period names that follow the view down once the period lane scrolls away
    for (const p of pers) {
      const a = Math.max(labelW, X(ms(p.start))),
        b = Math.min(W - padR, X(ms(p.end) + 864e5));
      if (b > a)
        s += `<text class="pstick" x="${Math.max(a, labelW) + 4}" y="0" style="--pc:${p.color}" dir="auto">${esc(p.name)}</text>`;
    }
    s += `<rect id="lassoRect" class="lasso" x="0" y="0" width="0" height="0" style="display:none"/></svg>`;
    host.innerHTML = s;
    fitLabels(host);
    placeParkButtons(host, labelW);
    TL = {
      t0,
      t1,
      labelW,
      W,
      padR,
      perTop,
      perBottom,
      top,
      budgetMeta,
      // the selected period first, then the narrowest, so the most
      // specific band wins where periods overlap
      bands: pers
        .map((p) => ({
          id: p.id,
          a: Math.max(labelW, X(ms(p.start))),
          b: Math.min(W - padR, X(ms(p.end) + 864e5)),
        }))
        .filter((p) => p.b > p.a)
        .sort(
          (p, q) =>
            (q.id === state.periodSel) - (p.id === state.periodSel) ||
            p.b - p.a - (q.b - q.a),
        ),
      inv: (x) => t0 + ((x - labelW) / (W - labelW - padR)) * (t1 - t0),
    };
    placeStickyNames(host, TL.perBottom);
  }

  function describe(t) {
    if (t.kind === "purchase") return `${t.why} · ${fmt(t.amount)}`;
    if (t.kind === "ghost" || t.kind === "inferred") return t.why;
    const bits = [fmtDate(t.date)];
    if (t.inst) bits.push(`payment ${t.inst.n} of ${t.inst.of}`);
    if (t.transfer) bits.push(transferText(t));
    if (
      t.orig &&
      (t.orig.currency !== "ILS" || Math.abs(t.orig.amount - t.amount) > 0.01)
    )
      bits.push(
        `originally ${t.orig.currency === "USD" ? "$" : t.orig.currency === "EUR" ? "€" : t.orig.currency === "GBP" ? "£" : "₪"}${Math.abs(t.orig.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      );
    if (t.periods?.length) bits.push(t.periods.join(", "));
    return bits.join(" · ");
  }

  function transferText(t) {
    const tr = t.transfer;
    if (!tr) return "";
    if (tr.kind === "card")
      return `pays the ${tr.stmt.account} statement for ${monthName(tr.stmt.period)} (${fmt(tr.stmt.total)})`;
    if (tr.kind === "pair") {
      const o = runtime.derived.byId.get(tr.other);
      return o
        ? `moved ${tr.dir === "out" ? "to" : "from"} ${o.account}`
        : "moved between your accounts";
    }
    return "marked by you as a transfer";
  }

  function showTip(t, ev) {
    const tip = $("#tip");
    const wrap = $("#tlwrap").getBoundingClientRect();
    tip.innerHTML = `<div class="m" dir="auto">${esc(t.merchant)}</div>${t.renamed ? `<div class="s" dir="auto">${esc(t.original)}</div>` : ""}<div><b>${fmt(t.amount)}</b> <span class="s">${esc(describe(t))}</span></div>${t.note ? `<div class="s" dir="auto">${esc(t.note)}</div>` : ""}`;
    tip.style.display = "block";
    let x = ev.clientX - wrap.left + 14,
      y = ev.clientY - wrap.top + 14;
    if (x + 300 > wrap.width) x = ev.clientX - wrap.left - 300;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  // Starts a budget at about the thread's monthly average.
  function addBudget(name) {
    const ts = runtime.derived.allTxns.filter(
      (t) => t.thread === name && t.amount > 0,
    );
    const months = new Set(
      Object.values(runtime.derived.coverage).flatMap((set) => [...set]),
    );
    const avg = ts.reduce((a, t) => a + t.amount, 0) / Math.max(1, months.size);
    setBudget(name, niceBudget(avg) || 500);
    toast(
      `Budget line added at about your monthly average. Drag the handle on the right to change it.`,
    );
  }

  function removeBudget(name) {
    const th = runtime.derived.R.threads.find((t) => t.name === name);
    if (!th?.budget || state.previewRules != null) return setBudget(name, 0);
    const was = th.budget;
    setBudget(name, 0);
    toast(`Removed the budget for ${name}.`, 9000, {
      label: "Undo",
      fn: () => setBudget(name, was),
    });
  }

  function setBudget(name, value) {
    if (state.previewRules != null) {
      toast(
        "Keep or discard the suggested threads first, then set the budget.",
      );
      return;
    }
    const th = parseRules(state.rules).threads.find((t) => t.name === name);
    if (!th) return;
    const lines = state.rules.split("\n");
    let l = lines[th.line].replace(/\s*\[\s*budget[^\]]*\]/i, "");
    if (value > 0) l += `  [budget ${Math.round(value)}]`;
    lines[th.line] = l;
    state.rules = lines.join("\n");
    actions.save("rules");
    actions.refresh();
  }

  // Keeps period names in view: hidden while the period lane shows, then
  // pinned just below the top of the scrolled timeline.
  // The period band under a point, and which side if it is on an edge.
  function bandAt({ x, y }) {
    if (y < TL.perTop) return null;
    const band = TL.bands.find((b) => x >= b.a - 4 && x <= b.b + 4);
    if (!band) return null;
    const edge =
      Math.abs(x - band.a) <= 4
        ? "start"
        : Math.abs(x - band.b) <= 4
          ? "end"
          : undefined;
    return { id: band.id, edge };
  }

  function wireTimeline() {
    $(".left").addEventListener(
      "scroll",
      () => TL && placeStickyNames($("#tl"), TL.perBottom),
      { passive: true },
    );
    const host = $("#tl");
    let mode = null;
    // "+ Budget" shows only on the row under the pointer, or when focused.
    const showBudgetButton = (y) =>
      host
        .querySelectorAll(".budgetbtn[data-cy]")
        .forEach((b) =>
          b.classList.toggle("show", Math.abs(+b.dataset.cy - y) < ROW_HALF),
        );
    host.addEventListener("pointerleave", () => showBudgetButton(-1e9));
    const pt = (ev) => {
      const r = host.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    host.addEventListener("pointermove", (ev) => {
      showBudgetButton(pt(ev).y);
      if (mode) {
        const { x, y } = pt(ev);
        if (mode.kind === "lasso") {
          const L = $("#lassoRect");
          const x0 = Math.min(x, mode.x),
            y0 = Math.min(y, mode.y),
            w = Math.abs(x - mode.x),
            h = Math.abs(y - mode.y);
          L.setAttribute("x", x0);
          L.setAttribute("y", y0);
          L.setAttribute("width", w);
          L.setAttribute("height", h);
          L.style.display = w + h > 6 ? "" : "none";
          mode.box = [x0, y0, x0 + w, y0 + h];
        } else if (mode.kind === "pnew") {
          const a = Math.max(TL.labelW, Math.min(x, mode.x)),
            b = Math.min(TL.W - TL.padR, Math.max(x, mode.x));
          const R = $("#pDraft");
          R.setAttribute("x", a);
          R.setAttribute("width", b - a);
          R.style.display = b - a > 4 ? "" : "none";
          mode.a = a;
          mode.b = b;
        } else if (mode.kind === "budget") {
          const v = niceBudget(((mode.base - y) / mode.bandH) * mode.bandMax);
          if (v !== state.budgetDrag.value) {
            state.budgetDrag.value = Math.max(0, v);
            renderTimeline();
          }
        } else if (mode.kind === "move" || mode.kind === "resize") {
          const days = Math.round((TL.inv(x) - TL.inv(mode.x)) / 864e5);
          if (Math.abs(x - mode.x) > 3) mode.moved = true;
          if (!mode.moved) return;
          const p = state.periods.find((q) => q.id === mode.id);
          if (!p) return;
          if (mode.kind === "move") {
            p.start = isoFromMs(ms(mode.start) + days * 864e5);
            p.end = isoFromMs(ms(mode.end) + days * 864e5);
          } else if (mode.edge === "start")
            p.start = isoFromMs(
              Math.min(ms(mode.end), ms(mode.start) + days * 864e5),
            );
          else
            p.end = isoFromMs(
              Math.max(ms(mode.start), ms(mode.end) + days * 864e5),
            );
          renderTimeline();
        }
        return;
      }
      const c = ev.target.closest("circle[data-id]");
      if (c) showTip(runtime.derived.byId.get(c.dataset.id), ev);
      else $("#tip").style.display = "none";
      const hit = !c && !ev.shiftKey && TL && bandAt(pt(ev));
      host.style.cursor = !hit ? "" : hit.edge ? "ew-resize" : "grab";
    });
    host.addEventListener(
      "pointerleave",
      () => ($("#tip").style.display = "none"),
    );
    host.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || !host.querySelector("svg") || !TL) return;
      const { x, y } = pt(ev);
      const del = ev.target.closest("[data-pdel],[data-bdel]");
      if (del) {
        ev.preventDefault();
        if (del.dataset.pdel) actions.removePeriod(del.dataset.pdel);
        else removeBudget(del.dataset.bdel);
        return;
      }
      const bh = ev.target.closest(".bhandle");
      if (bh) {
        bh.focus();
        const meta = TL.budgetMeta[bh.dataset.bthread];
        const th = runtime.derived.R.threads.find(
          (t) => t.name === bh.dataset.bthread,
        );
        if (!meta || !th) return;
        state.budgetDrag = {
          thread: th.name,
          value: th.budget,
          bandMax: meta.bandMax,
        };
        mode = { kind: "budget", ...meta, was: th.budget };
        host.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }
      const g = ev.target.closest(
        ev.shiftKey ? ".period:not(.pband)" : ".period",
      );
      // Anywhere in a period's column moves it, and its sides resize it,
      // unless the press lands on a bead or a control. Shift-drag still
      // draws a selection box.
      const hit =
        !g &&
        !ev.shiftKey &&
        !ev.target.closest(
          "circle[data-id],.rowlabel,.parkbtn,.budgetbtn,#parkedLabel",
        ) &&
        bandAt({ x, y });
      if (g || hit) {
        const p = state.periods.find(
          (q) => q.id === (g ? g.dataset.pid : hit.id),
        );
        if (!p) return;
        const edge = g ? ev.target.closest(".pedge")?.dataset.edge : hit.edge;
        mode = {
          kind: edge ? "resize" : "move",
          edge,
          id: p.id,
          x,
          start: p.start,
          end: p.end,
          moved: false,
        };
        host.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }
      if (
        ev.target.closest(
          "circle[data-id],.rowlabel,.cov-on,.acctlabel,.parkbtn,.budgetbtn,#parkedLabel",
        )
      )
        return;
      if (y >= TL.perTop && y <= TL.perBottom && x >= TL.labelW) {
        mode = { kind: "pnew", x };
        host.setPointerCapture(ev.pointerId);
        return;
      }
      mode = { kind: "lasso", x, y, box: null };
      host.setPointerCapture(ev.pointerId);
    });
    host.addEventListener("pointerup", (ev) => {
      const md0 = mode;
      mode = null;
      if (!md0) return;
      if (md0.kind === "budget") {
        const v = state.budgetDrag.value;
        const name = state.budgetDrag.thread;
        state.budgetDrag = null;
        if (v === md0.was) {
          renderTimeline();
          host
            .querySelector(`.bhandle[data-bthread="${CSS.escape(name)}"]`)
            ?.focus();
          return;
        }
        setBudget(name, v);
        if (v > 0)
          toast(
            `${name}: ${fmt(v, 0)} a month. Drag the line again any time, or edit it in Threads.`,
          );
        else toast(`Removed the budget for ${name}.`);
        return;
      }
      if (md0.kind === "move" || md0.kind === "resize") {
        if (md0.moved) {
          state.periodSel = md0.id;
          actions.save("periods");
          actions.refresh();
        } else {
          state.periodSel = state.periodSel === md0.id ? null : md0.id;
          state.selection.clear();
          state.statement = null;
          actions.refresh();
          if (state.periodSel)
            $("#insp").scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
        return;
      }
      if (md0.kind === "pnew") {
        $("#pDraft").style.display = "none";
        if (!md0.a || md0.b - md0.a < 6) return;
        const start = isoFromMs(TL.inv(md0.a)),
          end = isoFromMs(Math.max(TL.inv(md0.a), TL.inv(md0.b) - 864e5));
        actions.addPeriod(start, end);
        return;
      }
      const L = $("#lassoRect");
      if (L) L.style.display = "none";
      const box = md0.box;
      if (!box || box[2] - box[0] + (box[3] - box[1]) < 8) {
        if (!ev.target.closest("circle")) {
          state.selection.clear();
          state.highlight.clear();
          state.statement = null;
          state.periodSel = null;
          actions.refresh();
        }
        return;
      }
      const ids = POS.filter(
        (p) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3],
      ).map((p) => p.id);
      state.selection = new Set(ids);
      state.highlight.clear();
      state.statement = null;
      state.periodSel = null;
      actions.refresh();
    });
    host.addEventListener("click", (ev) => {
      const c = ev.target.closest("circle[data-id]");
      if (c) {
        const id = c.dataset.id;
        if (ev.shiftKey || ev.metaKey) {
          state.selection.has(id)
            ? state.selection.delete(id)
            : state.selection.add(id);
        } else state.selection = new Set([id]);
        state.statement = null;
        state.periodSel = null;
        state.highlight.clear();
        actions.refresh();
        return;
      }
      const bb = ev.target.closest(".budgetbtn");
      if (bb) {
        addBudget(bb.dataset.budget);
        return;
      }
      const pk = ev.target.closest(".parkbtn");
      if (pk) {
        togglePark(pk.dataset.park);
        return;
      }
      if (ev.target.closest("#parkedLabel")) {
        state.view.showParked = true;
        renderTimeline();
        renderParkbar();
        return;
      }
      const lab = ev.target.closest(".rowlabel");
      if (lab) {
        const name = lab.dataset.thread;
        state.highlight = new Set(
          [...runtime.derived.txns, ...runtime.derived.extras]
            .filter((t) => t.thread === name)
            .map((t) => t.id),
        );
        state.selection.clear();
        // The thread's summary opens below; its rules are one click away there.
        state.threadSel = name;
        state.periodSel = null;
        state.statement = null;
        actions.refresh();
        return;
      }
      const tog = ev.target.closest("[data-togacct]");
      if (tog) {
        toggleAccount(tog.dataset.togacct);
        return;
      }
      const cov = ev.target.closest(".cov-on");
      if (cov) {
        state.statement = {
          account: cov.dataset.acct,
          period: cov.dataset.period,
        };
        state.selection.clear();
        state.periodSel = null;
        actions.refresh();
      }
    });
    host.addEventListener("keydown", (e) => {
      const bh = e.target.closest?.(".bhandle");
      if (bh && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        e.stopPropagation();
        removeBudget(bh.dataset.bthread);
        return;
      }
      if (!bh || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const th = runtime.derived.R.threads.find(
        (t) => t.name === bh.dataset.bthread,
      );
      if (!th) return;
      const step = th.budget >= 1000 ? 100 : th.budget >= 100 ? 50 : 10;
      setBudget(
        th.name,
        Math.max(0, th.budget + (e.key === "ArrowUp" ? step : -step)),
      );
      requestAnimationFrame(() =>
        host
          .querySelector(`.bhandle[data-bthread="${CSS.escape(th.name)}"]`)
          ?.focus(),
      );
    });
  }

  // Lights up beads without selecting them. A Set is kept as given, so a
  // caller can tell later whether the highlight is still its own.
  function highlight(ids, { clearSelection = false } = {}) {
    state.highlight = ids instanceof Set ? ids : new Set(ids);
    if (clearSelection) state.selection.clear();
    renderTimeline();
  }
  // Selects beads and lights them up, as clicking a citation does.
  function select(ids) {
    state.selection = new Set(ids);
    state.highlight = new Set(ids);
    actions.refresh();
  }
  // Nothing selected, lit up or open in the inspector.
  function clearFocus() {
    state.selection.clear();
    state.highlight = new Set();
    state.statement = null;
    state.periodSel = null;
    state.threadSel = null;
    actions.refresh();
  }

  // Shows or hides one account's transactions; one account always stays on.
  function toggleAccount(a) {
    const hidden = state.hiddenAccounts;
    if (!hidden.has(a)) {
      const shown = runtime.derived.accounts.filter((x) => !hidden.has(x));
      if (shown.length <= 1) {
        toast("At least one account stays visible.");
        return;
      }
      hidden.add(a);
    } else hidden.delete(a);
    actions.refresh();
    requestAnimationFrame(() =>
      $(`#tl [data-togacct="${CSS.escape(a)}"]`)?.focus(),
    );
  }

  function togglePark(name) {
    const k = name.toLowerCase();
    const has = state.view.parked.some((n) => n.toLowerCase() === k);
    state.view.parked = has
      ? state.view.parked.filter((n) => n.toLowerCase() !== k)
      : [...state.view.parked, name];
    actions.save("view");
    renderTimeline();
    renderParkbar();
    if (!has)
      toast(
        `Parked “${name}”. It still catches its transactions; it just sits on the quiet wire at the bottom.`,
      );
  }

  function renderParkbar() {
    const el = $("#parkbar");
    const known = new Set(
      runtime.derived?.names.map((n) => n.toLowerCase()) || [],
    );
    const parked = state.view.parked.filter((n) => known.has(n.toLowerCase()));
    if (!state.loaded || !parked.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      `<span>Parked:</span>${parked.map((n) => `<button data-unpark="${esc(n)}" title="Unpark" dir="auto">${esc(n)} ↩</button>`).join("")}` +
      `<button data-showparked>${state.view.showParked ? "Fold them back" : "Show them for now"}</button>`;
  }

  function wireParkbar() {
    $("#parkbar").onclick = (e) => {
      const u = e.target.closest("[data-unpark]");
      if (u) {
        togglePark(u.dataset.unpark);
        return;
      }
      if (e.target.closest("[data-showparked]")) {
        state.view.showParked = !state.view.showParked;
        renderTimeline();
        renderParkbar();
      }
    };
    $("#tl").addEventListener("keydown", (e) => {
      const ta = e.target.closest?.("[data-togacct]");
      if (ta && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        toggleAccount(ta.dataset.togacct);
        return;
      }
      const bb = e.target.closest?.(".budgetbtn");
      if (bb && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        addBudget(bb.dataset.budget);
        return;
      }
      const pk = e.target.closest?.(".parkbtn");
      if (pk && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        togglePark(pk.dataset.park);
      }
    });
  }

  return {
    clearFocus,
    highlight,
    renderParkbar,
    renderTimeline,
    select,
    transferText,
    wireParkbar,
    wireTimeline,
  };
}

export const contract = {
  name: "timeline",
  create: createTimeline,
  provides: [
    "clearFocus",
    "highlight",
    "renderParkbar",
    "renderTimeline",
    "select",
    "transferText",
    "wireParkbar",
    "wireTimeline",
  ],
  requires: ["addPeriod", "refresh", "removePeriod", "save"],
  renders: ["renderParkbar", "renderTimeline"],
  wires: ["wireTimeline", "wireParkbar"],
};
