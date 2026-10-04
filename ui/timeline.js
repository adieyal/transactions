import {
  MONTHS,
  addMonths,
  esc,
  fmt,
  fmtDate,
  fmtByCurrency,
  fmtShort,
  monthName,
  monthOf,
  ms,
} from "../helpers.js";
import { TRANSFERS } from "../transactions/constants.js";
import { layoutTimeline, niceBudget } from "./timeline-layout.js";
import { wireTimelineDrag } from "./timeline-drag.js";
import { describeTransfer, showBeadTip } from "./timeline-text.js";
import { $, html, toast } from "./dom.js";
import { setBudget as setThreadBudget } from "../transactions/rules-edit.js";
import { name as bidi } from "../story/copy.js";
import { waitingForCurrency } from "../story/currency.js";
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

  function renderTimeline() {
    const host = $("#tl");
    if (!state.loaded) {
      host.innerHTML = html`<div class="empty"><div><p>Opening your ledger…</p></div></div>`;
      return;
    }
    if (!runtime.derived.txns.length && runtime.derived.allTxns?.length) {
      host.innerHTML = html`<div class="empty" style="min-height:220px"><div><p>Nothing matches “${state.query.trim()}”.</p><button class="btn quiet" id="emptyClear">Clear the filter</button></div></div>`;
      POS = [];
      TL = null;
      return;
    }
    if (!runtime.derived.txns.length && runtime.derived.unpriced) {
      host.innerHTML = html`<div class="empty"><div><h2>Which currency are your statements in?</h2><p>${waitingForCurrency(runtime.derived.unpriced)}</p><button class="btn" id="emptyCurrency">Choose the currency</button></div></div>`;
      POS = [];
      TL = null;
      return;
    }
    if (!runtime.derived.txns.length) {
      host.innerHTML = html`<div class="empty"><div><h2>Drop statements here</h2><p>Some statement exports are recognised as they are. For any other, you show Transactions the columns and the currency once, and it remembers that format.</p><button class="btn" id="emptyAdd">Choose files</button></div></div>`;
      POS = [];
      TL = null;
      return;
    }
    const L = layoutTimeline({
      derived: runtime.derived,
      state,
      today: runtime.today,
      width: host.clientWidth,
    });
    const { W, H, narrow, labelW, padR, X, accts, covTop, axisY, expY } = L;
    const { pers, laneOf, laneH, perTop, perBottom, periodX } = L;
    const hl = state.highlight,
      sel = state.selection,
      dimming = hl.size > 0;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Transactions on a timeline, one row per thread">`;
    const xToday = X(ms(runtime.today));
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
      const { a, b } = periodX(p);
      if (b > a)
        s += `<rect class="pfill" x="${a}" y="${perTop}" width="${Math.max(2, b - a)}" height="${H - perTop}" style="--pc:${p.color}"/>`;
    }
    if (selP) {
      const { a, b } = periodX(selP);
      s += `<g class="period pband" data-pid="${selP.id}" style="--pc:${selP.color}"><rect class="pshade" x="${a}" y="${perTop}" width="${Math.max(2, b - a)}" height="${H - perTop}"/><rect class="pedge" data-edge="start" x="${a - 4}" y="${perTop}" width="8" height="${H - perTop}"/><rect class="pedge" data-edge="end" x="${b - 4}" y="${perTop}" width="8" height="${H - perTop}"/></g>`;
    }
    // months
    L.monthsShown.forEach((mm, i) => {
      const x0 = Math.max(labelW, X(ms(mm))),
        x1 = Math.min(W - padR, X(ms(addMonths(mm, 1))));
      if (X(ms(mm)) >= labelW)
        s += `<line class="gridline" x1="${x0}" x2="${x0}" y1="${axisY + 4}" y2="${H}"/>`;
      const [yy, mo] = mm.split("-").map(Number);
      if (i % L.every === 0 && x1 - x0 > (X(ms(mm)) < labelW ? 64 : 20))
        s += `<text class="axis" data-thin x="${x0 + 4}" y="${axisY}">${MONTHS[mo - 1]}${mo === 1 || i === 0 ? " " + yy : ""}</text>`;
      accts.forEach((a, ai) => {
        const y = covTop + ai * 13;
        const has = runtime.derived.coverage[a]?.has(monthOf(mm));
        if (x1 - x0 > 2)
          s += has
            ? `<rect class="cov-on${state.hiddenAccounts.has(a) ? " hidden-acct" : ""}" data-acct="${esc(a)}" data-period="${monthOf(mm)}" x="${x0 + 1}" y="${y}" width="${Math.max(0, x1 - x0 - 2)}" height="8" rx="2"><title>${esc(a)}: statement for ${monthName(monthOf(mm))}</title></rect>`
            : mm < runtime.today
              ? `<rect class="cov-off" x="${x0 + 1.5}" y="${y + 0.5}" width="${Math.max(0, x1 - x0 - 3)}" height="7" rx="2"><title>No ${monthName(monthOf(mm))} statement for ${esc(bidi(a))}</title></rect>`
              : "";
      });
      const ex = L.expByMonth[monthOf(mm)];
      if (ex && x1 - x0 > 40)
        s += `<text class="exp" data-thin x="${(x0 + x1) / 2}" y="${expY}" text-anchor="middle"><title>Expected charges this month</title>≈ ${fmtByCurrency(ex, 0, fmtShort)}</text>`;
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
      const { a: x0, b: x1 } = periodX(p);
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
    for (const row of L.visibleRows) s += rowSVG(row, L);
    // arcs (rhythm, instalment chains, transfers between accounts)
    for (const { a, b, h, dash } of L.arcs) {
      const d = dimming && !(hl.has(a.t.id) && hl.has(b.t.id));
      s += `<path class="arc${dash ? " dash" : ""}${d ? " dim" : ""}" stroke="${runtime.derived.colorOf[a.t.thread] || "#888"}" d="M${a.x},${a.y - a.r} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - h - 8} ${b.x},${b.y - b.r}"/>`;
    }
    // a card payment points up at the statement it settled
    for (const { it, stmt, xm, ys } of L.cardLinks)
      s += `<path class="transferlink${dimming && !hl.has(it.t.id) ? " dim" : ""}" d="M${it.x},${it.y - it.r} C${it.x},${(it.y + ys) / 2} ${xm},${(it.y + ys) / 2} ${xm},${ys}"><title>Pays the ${esc(bidi(stmt.account))} statement for ${monthName(stmt.period)}</title></path>`;
    // beads
    for (const it of L.beads)
      s += beadSVG(it, dimming && !hl.has(it.t.id), sel.has(it.t.id));
    POS = L.beads.map((it) => ({ id: it.t.id, x: it.x, y: it.y, r: it.r }));
    // period names that follow the view down once the period lane scrolls away
    for (const p of pers) {
      const { a, b } = periodX(p);
      if (b > a)
        s += `<text class="pstick" x="${Math.max(a, labelW) + 4}" y="0" style="--pc:${p.color}" dir="auto">${esc(p.name)}</text>`;
    }
    s += `<rect id="lassoRect" class="lasso" x="0" y="0" width="0" height="0" style="display:none"/></svg>`;
    host.innerHTML = s;
    fitLabels(host);
    placeParkButtons(host, labelW);
    TL = L;
    placeStickyNames(host, TL.perBottom);
  }

  // A thread's wire, label and total, its budget band, and its controls.
  function rowSVG(row, { W, narrow, labelW, padR }) {
    const cy = row.cy;
    if (row.name === "__parked")
      return (
        `<line class="wire parked" x1="${labelW}" x2="${W - padR}" y1="${cy}" y2="${cy}"/>` +
        `<text class="parkedlabel" id="parkedLabel" x="${labelW - 12}" y="${cy + 4}" text-anchor="end"><title>Show parked threads on their own wires for now</title>${row.parked.length} parked</text>`
      );
    let s = "";
    const thr = row.thread;
    if (row.band) {
      // monthly spend against the budget, drawn behind the beads
      const { budget, base, bandH, yv, yb, bars } = row.band;
      for (const { k, a, b, sp, ex, over } of bars) {
        if (sp > 0)
          s += `<rect class="bbar${over ? " over" : ""}" x="${a}" y="${yv(sp)}" width="${b - a}" height="${base - yv(sp)}" style="--c:${row.color}"><title>${monthName(k)}: ${fmt(sp, 0, row.band.currency)} of ${fmt(budget, 0, row.band.currency)}</title></rect>`;
        if (ex > 0)
          s += `<rect class="bexp${over ? " over" : ""}" x="${a}" y="${yv(sp + ex)}" width="${b - a}" height="${yv(sp) - yv(sp + ex)}" style="--c:${row.color}"><title>${monthName(k)}: ${fmt(ex, 0, row.band.currency)} expected</title></rect>`;
        if (over && b - a > 34)
          s += `<text class="bover" x="${(a + b) / 2}" y="${Math.max(yv(sp + ex) - 3, cy - bandH / 2 + 9)}" text-anchor="middle">${fmtShort(sp + ex, row.band.currency)}</text>`;
      }
      s += `<line class="bline" x1="${labelW}" x2="${W - padR - 8}" y1="${yb}" y2="${yb}" stroke="${row.color}"/>`;
      const blabel = `${fmt(budget, 0, row.band.currency)} a month`,
        bx = labelW + 4 + blabel.length * 6 + 8;
      s += `<text class="blabel" x="${labelW + 4}" y="${yb - 4}">${blabel}</text>`;
      s += `<g class="xbtn" data-bdel="${esc(row.name)}" role="button" aria-label="Remove the budget for ${esc(row.name)}"><title>Remove this budget</title><circle cx="${bx}" cy="${yb - 8}" r="6"/><path d="M${bx - 2.5},${yb - 10.5}l5,5m0,-5l-5,5"/></g>`;
      s += `<g class="bhandle" data-bthread="${esc(row.name)}" tabindex="0" role="slider" aria-label="Budget for ${esc(row.name)}" aria-valuenow="${budget}"><title>Drag up or down to set the monthly budget</title><circle cx="${W - padR - 6}" cy="${yb}" r="6" stroke="${row.color}"/></g>`;
    }
    s += `<line class="wire" x1="${labelW}" x2="${W - padR}" y1="${cy}" y2="${cy}"/>`;
    if (!narrow) {
      // An eye beside the thread name parks it; placeParkButtons moves it
      // flush against the rendered name.
      const parked = row.isParked;
      s += `<g class="parkbtn${parked ? " parked" : ""}" data-park="${esc(row.name)}" data-for-y="${cy - 2}" transform="translate(${labelW - 12 - row.name.length * 7 - 14},${cy - 6})" tabindex="0" role="button" aria-label="${parked ? "Unpark" : "Park"} ${esc(row.name)}"><title>${parked ? "Unpark this thread" : "Park this thread: fold it into one quiet wire at the bottom"}</title><rect x="-9" y="-8" width="18" height="16" rx="4"/><path d="M-6,0 Q0,-6 6,0 Q0,6 -6,0Z"/><circle r="1.8"/>${parked ? `<path d="M-6,5 L6,-5"/>` : ""}</g>`;
      // Adding a budget sits at the right end, where its drag handle will be.
      if (thr && thr.budget == null && !row.drag)
        s += `<g class="budgetbtn" data-budget="${esc(row.name)}" data-cy="${cy}" transform="translate(${W - padR - 4},${cy - 16})" tabindex="0" role="button" aria-label="Set a budget for ${esc(row.name)}"><title>Give this thread a monthly budget line you can drag</title><rect x="-62" y="-9" width="62" height="17" rx="8.5"/><text x="-31" y="3.5" text-anchor="middle">+ Budget</text></g>`;
    }
    const out = row.items.filter((t) => t.kind === "actual" && !t.inflow);
    s += `<text class="rowlabel" data-thread="${esc(row.name)}" data-line="${thr ? thr.line : ""}" data-fit="${labelW - 16 - (narrow ? 0 : 22)}" x="${labelW - 12}" y="${cy - 2}" ${anchorEnd(row.name)} style="fill:${row.color}"><title>${esc(bidi(row.name))}</title><tspan>${esc(row.name)}</tspan></text>`;
    s += `<text class="rowtotal" x="${labelW - 12}" y="${cy + 14}" text-anchor="end">${row.items.some((t) => t.kind === "actual") ? (row.name === TRANSFERS ? "moved " : "") + (out.length ? fmtByCurrency(out, 0) : fmt(0, 0, row.items.find((t) => t.kind === "actual").currency)) : ""}</text>`;
    return s;
  }

  // One bead: solid for a charge, hollow with a bar for a refund, dashed for
  // something expected or worked out.
  function beadSVG({ t, x, y, r }, dim, selected) {
    const c = runtime.derived.colorOf[t.thread] || "#888";
    const cls = ["bead"];
    if (dim) cls.push("dim");
    if (selected) cls.push("sel");
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
    let s = `<circle class="${cls.join(" ")}" data-id="${t.id}" cx="${x.toFixed(1)}" cy="${y}" r="${r.toFixed(1)}" ${attrs}/>`;
    if (t.kind === "actual" && t.amount < 0)
      s += `<line x1="${x - r * 0.5}" x2="${x + r * 0.5}" y1="${y}" y2="${y}" stroke="${c}" stroke-width="1.6" pointer-events="none"/>`;
    return s;
  }

  const transferText = (t) => describeTransfer(t, runtime.derived.byId);
  const showTip = (t, ev) => showBeadTip(t, ev, runtime.derived.byId);

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
    const rules = setThreadBudget(state.rules, name, value);
    if (rules === state.rules) return;
    state.rules = rules;
    actions.save("rules");
    actions.refresh();
  }

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
    // "+ Budget" shows only on the row under the pointer, or when focused.
    const showBudgetButton = (y) =>
      host
        .querySelectorAll(".budgetbtn[data-cy]")
        .forEach((b) =>
          b.classList.toggle("show", Math.abs(+b.dataset.cy - y) < ROW_HALF),
        );
    host.addEventListener("pointerleave", () => showBudgetButton(-1e9));
    const drag = wireTimelineDrag(host, runtime, actions, {
      layout: () => TL,
      positions: () => POS,
      renderTimeline,
      setBudget,
      removeBudget,
      bandAt,
    });
    const pt = (ev) => {
      const r = host.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    host.addEventListener("pointermove", (ev) => {
      showBudgetButton(pt(ev).y);
      if (drag.active()) return;
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
    host.addEventListener("click", (ev) => {
      // The empty states' buttons.
      if (ev.target.closest("#emptyClear")) return $("#qClear").click();
      if (ev.target.closest("#emptyAdd")) return $("#file").click();
      if (ev.target.closest("#emptyCurrency")) return actions.askCurrencies();
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
    el.innerHTML = html`<span>Parked:</span>${parked.map((n) => html`<button data-unpark="${n}" title="Unpark" dir="auto">${n} ↩</button>`)}<button data-showparked>${state.view.showParked ? "Fold them back" : "Show them for now"}</button>`;
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
  requires: ["addPeriod", "askCurrencies", "refresh", "removePeriod", "save"],
  renders: ["renderParkbar", "renderTimeline"],
  wires: ["wireTimeline", "wireParkbar"],
};
