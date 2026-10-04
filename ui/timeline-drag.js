import { fmt, ms } from "../helpers.js";
import { $, toast } from "./dom.js";
import { isoFromMs, niceBudget } from "./timeline-layout.js";

// Dragging on the timeline: drawing a period on the period strip, moving or
// resizing a period, dragging a budget line, and the selection box. ui/
// timeline.js gives it the layout of the last render (ctx.layout) and the
// bead positions (ctx.positions); it changes state and redraws or refreshes.
// Returns active(), true while a drag is under way.
export function wireTimelineDrag(host, runtime, actions, ctx) {
  const { state } = runtime;
  const { renderTimeline, setBudget, removeBudget, bandAt } = ctx;
  let mode = null;
  const pt = (ev) => {
    const r = host.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  host.addEventListener("pointermove", (ev) => {
    if (!mode) return;
    const TL = ctx.layout();
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
  });
  host.addEventListener("pointerdown", (ev) => {
    const TL = ctx.layout();
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
    const TL = ctx.layout();
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
          `${name}: ${fmt(v, 0, runtime.derived.allTxns.find((t) => t.thread === name)?.currency)} a month. Drag the line again any time, or edit it in Threads.`,
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
    const ids = ctx
      .positions()
      .filter(
        (p) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3],
      )
      .map((p) => p.id);
    state.selection = new Set(ids);
    state.highlight.clear();
    state.statement = null;
    state.periodSel = null;
    actions.refresh();
  });
  return { active: () => !!mode };
}
