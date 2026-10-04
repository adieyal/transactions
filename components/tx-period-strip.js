import { esc } from "../helpers.js";
import { dateRange } from "../story/copy.js";
import {
  dragTo,
  monthsScale,
  nudge,
  periodAt,
  startDrag,
} from "../transactions/period-drag.js";
import { periodLanes } from "../transactions/period-lanes.js";
import { editPeriod } from "../model/index.js";
import { subscribeWhileConnected } from "./base.js";
import { refIds, togglePin, wireLinkedRefs } from "./linked-ref.js";

// <tx-period-strip months="YYYY-MM,…" variant="year|month" stretches="[…]">:
// the Periods strip, the one implementation every canvas view embeds (ADR
// 0011). It draws the named periods over those months, each month an equal
// column, and owns every period interaction, with the old timeline's rules
// (transactions/period-lanes.js, transactions/period-drag.js):
// - drag along the strip to mark a new period (a tx-mark-period event);
// - grab a period's name, or anywhere in its column, to move it, and within
//   4px of a side, the whole height, to resize it, by whole days;
// - names that would overlap stack on rows of 28px, as the drag goes;
// - click a name for a card to rename it, open its details (tx-open-period)
//   or delete it (removePeriod, with Undo); arrows move it a day, and Shift
//   with an arrow its end.
// Whatever the element wraps (a view's thread rows) is the rest of the
// periods' columns: the tints are drawn behind it, and presses on it move
// and resize. Busy stretches the view found come in as JSON: [{ from, to,
// label, aria, data: { "data-…": value } }], drawn as dashed outlines with
// their chip; the view answers their clicks.
const LANE = 28;
const LOOK = {
  year: {
    row: "yr-periodsrow",
    gutter: `<div class="yr-gutter"></div>`,
    strip: "yr-periods",
    chip: "yr-pchip",
    schip: "yr-schip",
    q: "yr-q",
    band: "yr-pband",
    sband: "yr-sband",
    ghost: "yr-pnew",
  },
  month: {
    row: "om-periodsrow",
    gutter: `<div class="om-periodslabel">Periods</div>`,
    strip: "om-periods",
    chip: "om-pchip",
    schip: "om-schip",
    q: "om-q",
    band: "om-pband",
    sband: "om-sband",
    ghost: "om-pnew",
  },
};

export function createPeriodStrip(runtime, actions) {
  const { state } = runtime;
  const periodOf = (id) => state.periods.find((p) => p.id === id);
  // A name nudged from the keyboard keeps its focus across the refresh,
  // which may draw a new element in this one's place.
  let refocus = null;
  // A name clicked pins its payments (linked-ref.js) and opens its card;
  // the pin refreshes the view, so the card opens in the next render.
  let reopen = null;

  function definePeriodStrip() {
    if (customElements.get("tx-period-strip")) return;
    customElements.define(
      "tx-period-strip",
      class extends HTMLElement {
        connectedCallback() {
          if (!this.wired) this.wire();
          subscribeWhileConnected(this, runtime.store, (change) => {
            if (change !== "highlight") this.render();
          });
          this.render();
        }
        get look() {
          return LOOK[this.getAttribute("variant")] || LOOK.month;
        }
        get scale() {
          const cols = (this.getAttribute("months") || "")
            .split(",")
            .filter(Boolean);
          return cols.length ? monthsScale(cols) : null;
        }
        // The strip and the tints, before whatever the element wraps.
        render() {
          this.querySelectorAll(":scope > .ps-own").forEach((n) => n.remove());
          const sc = this.scale;
          if (!sc || !state.periods) return;
          const L = this.look;
          const pct = (f) => (f * 100).toFixed(2);
          const span = (a, b) =>
            `left: ${pct(sc.at(a))}%; width: ${pct(Math.max(sc.end(b) - sc.at(a), 0.008))}%`;
          const named = state.periods.filter(
            (p) => p.start <= sc.to && p.end >= sc.from,
          );
          let stretches = [];
          try {
            stretches = JSON.parse(this.getAttribute("stretches") || "[]");
          } catch {
            stretches = [];
          }
          const chips = [
            ...named.map(
              (p) =>
                `<button class="${L.chip}" data-period="${esc(p.id)}" data-ref data-period-ref="${esc(p.id)}" data-tip="${esc(`${p.name}: a period you named. Drag to move it, drag a side to change its dates, or click to rename or delete it.`)}" style="left: ${pct(sc.at(p.start))}%; min-width: ${pct(Math.max(sc.end(p.end) - sc.at(p.start), 0.008))}%">${esc(p.name)}</button>`,
            ),
            ...stretches.map(
              (s) =>
                `<button class="sp ${L.schip}" ${Object.entries(s.data || {})
                  .filter(([k]) => /^data-[a-z-]+$/.test(k))
                  .map(([k, v]) => `${k}="${esc(v)}"`)
                  .join(
                    " ",
                  )} aria-label="${esc(s.aria)}" style="left: ${pct(sc.at(s.from))}%">${esc(s.label)}<span aria-hidden="true" class="${L.q}">?</span></button>`,
            ),
          ].join("");
          const hint = this.getAttribute("hint");
          const empty = !chips;
          this.insertAdjacentHTML(
            "afterbegin",
            `<div class="ps-own ${L.row}">${L.gutter}<div class="ps-strip ${L.strip}${empty ? "" : " filled"}" data-tip="Drag along this strip to mark a period">${empty && hint ? esc(hint) : chips}<div class="${L.ghost}" hidden></div></div></div>
            <div class="ps-own ps-bands" aria-hidden="true">${[
              ...named.map(
                (p) =>
                  `<div class="${L.band}" data-pid="${esc(p.id)}" style="${span(p.start, p.end)}"></div>`,
              ),
              ...stretches.map(
                (s) =>
                  `<div class="${L.sband}" style="${span(s.from, s.to)}"></div>`,
              ),
            ].join("")}</div>`,
          );
          this.stack();
          this.placeBands();
          if (reopen && this.chip(reopen)) {
            const id = reopen;
            reopen = null;
            this.openCard(id);
          }
          const back = refocus && this.chip(refocus);
          if (back) {
            refocus = null;
            back.focus();
          }
        }
        get strip() {
          return this.querySelector(":scope > .ps-own .ps-strip");
        }
        // Names that would overlap go on rows of their own: each takes its
        // dates or its name, whichever is wider, and lane 0 is at the top.
        stack() {
          const s = this.strip;
          const chips = [...s.querySelectorAll(":scope > button")];
          const { laneOf, lanes } = periodLanes(
            chips.map((c, i) => ({
              id: i,
              start: c.offsetLeft,
              end: c.offsetLeft + c.offsetWidth + 6,
            })),
          );
          if (lanes < 2) return;
          s.style.height = `${lanes * LANE}px`;
          chips.forEach((c, i) => {
            const bottom = parseFloat(getComputedStyle(c).bottom) || 0;
            c.style.bottom = `${(lanes - 1 - laneOf[i]) * LANE + bottom}px`;
          });
        }
        // The tints line up with the strip and run the height of what the
        // element wraps.
        placeBands() {
          const s = this.strip,
            row = s.parentElement,
            b = this.querySelector(":scope > .ps-bands");
          Object.assign(b.style, {
            left: `${s.offsetLeft}px`,
            width: `${s.offsetWidth}px`,
            top: `${row.offsetTop + row.offsetHeight}px`,
          });
        }
        // Each period's column in client px, for periodAt.
        columns() {
          const r = this.strip.getBoundingClientRect(),
            sc = this.scale;
          return state.periods.map((p) => ({
            id: p.id,
            a: r.left + sc.at(p.start) * r.width,
            b: r.left + sc.end(p.end) * r.width,
          }));
        }
        fraction(x) {
          const r = this.strip.getBoundingClientRect();
          return (x - r.left) / r.width;
        }
        // A press on a name, or in a period's column below the strip,
        // unless it lands on a bead or another control. Shift-drag is left
        // to the view (it gathers).
        hitAt(e) {
          const chip = e.target.closest?.(".ps-strip [data-period]");
          if (chip && chip.closest("tx-period-strip") === this) {
            const hit = periodAt(this.columns(), e.clientX, state.periodSel);
            return hit?.id === chip.dataset.period
              ? hit
              : { id: chip.dataset.period, edge: undefined };
          }
          if (
            e.shiftKey ||
            !e.target.closest ||
            e.target.closest(".ps-own, [data-id], button, input, a, label")
          )
            return null;
          return periodAt(this.columns(), e.clientX, state.periodSel);
        }
        wire() {
          this.wired = true;
          let drag = null,
            draw = null,
            dragged = false;
          this.addEventListener("pointerdown", (e) => {
            if (e.button || !this.scale) return;
            dragged = false;
            const hit = this.hitAt(e);
            const p = hit && periodOf(hit.id);
            if (p) {
              drag = { ...startDrag(p, e.clientX, hit.edge), p };
              e.stopPropagation();
              e.preventDefault();
              return;
            }
            // On the strip itself: mark a new period.
            const s = e.target.closest?.(".ps-strip");
            if (!s || s !== this.strip || e.target.closest("button")) return;
            draw = { x: e.clientX, f: this.fraction(e.clientX), moved: false };
            s.setPointerCapture(e.pointerId);
            e.stopPropagation();
            e.preventDefault();
          });
          this.addEventListener("pointermove", (e) => {
            if (draw) {
              if (Math.abs(e.clientX - draw.x) > 4) draw.moved = true;
              if (!draw.moved) return;
              const [a, b] = [draw.f, this.fraction(e.clientX)]
                .map((f) => Math.min(1, Math.max(0, f)))
                .sort((x, y) => x - y);
              const g = this.querySelector(`.${this.look.ghost}`);
              Object.assign(g.style, {
                left: `${(a * 100).toFixed(2)}%`,
                width: `${((b - a) * 100).toFixed(2)}%`,
              });
              g.hidden = false;
              return;
            }
            if (!drag) {
              const hit = e.buttons ? null : this.hitAt(e);
              this.style.cursor = !hit ? "" : hit.edge ? "ew-resize" : "grab";
              return;
            }
            const was = drag.moved;
            const to = dragTo(drag, e.clientX, (x) =>
              this.scale.inv(this.fraction(x)),
            );
            // Captured only once it moves, so a click still lands on the name.
            if (drag.moved && !was) this.setPointerCapture(e.pointerId);
            if (!to || (to.start === drag.p.start && to.end === drag.p.end))
              return;
            Object.assign(drag.p, to);
            this.render();
          });
          const finish = (e, keep) => {
            if (draw) {
              const d = draw;
              draw = null;
              const g = this.querySelector(`.${this.look.ghost}`);
              if (g) g.hidden = true;
              if (!keep || !d.moved) return;
              const sc = this.scale;
              const [a, b] = [d.f, this.fraction(e.clientX)].sort(
                (x, y) => x - y,
              );
              this.dispatchEvent(
                new CustomEvent("tx-mark-period", {
                  bubbles: true,
                  detail: { start: sc.dateAt(a), end: sc.dateAt(b) },
                }),
              );
              return;
            }
            if (!drag) return;
            const d = drag;
            drag = null;
            if (!d.moved) return;
            dragged = true;
            // The drag moved the period live; the command records it from
            // where it started.
            const to = { start: d.p.start, end: d.p.end };
            [d.p.start, d.p.end] = [d.start, d.end];
            if (keep) actions.commit(editPeriod(state, { id: d.p.id, ...to }));
            else actions.refresh();
          };
          this.addEventListener("pointerup", (e) => finish(e, true));
          this.addEventListener("pointercancel", (e) => finish(e, false));

          // The name's keys: Enter opens the card, arrows move the period a
          // day, and Shift with an arrow moves its end.
          this.addEventListener("keydown", (e) => {
            const chip = e.target.closest?.(".ps-strip [data-period]");
            if (chip && /^Arrow(Left|Right)$/.test(e.key)) {
              const p = periodOf(chip.dataset.period);
              if (!p) return;
              const to = nudge(p, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
              e.preventDefault();
              e.stopPropagation();
              refocus = p.id;
              actions.commit(editPeriod(state, { id: p.id, ...to }));
            } else if (e.key === "Escape" && this.querySelector(".cv-pedit")) {
              const id = this.querySelector(".cv-pedit").dataset.pid;
              this.closeCard();
              this.chip(id)?.focus();
            } else if (e.key === "Enter" && e.target.id === "cv-pname") {
              this.querySelector("[data-pedit-save]")?.click();
            }
          });
          this.addEventListener("click", (e) => {
            const chip = e.target.closest(".ps-strip [data-period]");
            if (chip) {
              // Ahead of this element's own linked-ref listener.
              e.stopImmediatePropagation();
              if (dragged) return void (dragged = false);
              const ids = refIds(chip, runtime);
              const pinned =
                ids.length &&
                ids.length === state.selection.size &&
                ids.every((i) => state.selection.has(i));
              reopen = pinned ? null : chip.dataset.period;
              if (pinned) this.closeCard();
              if (ids.length) togglePin(chip, runtime);
              else this.openCard(chip.dataset.period);
              return;
            }
            const card = e.target.closest(".cv-pedit");
            if (!card) return;
            e.stopPropagation();
            const p = periodOf(card.dataset.pid);
            if (!p) return this.closeCard();
            if (e.target.closest("[data-pedit-save]")) {
              const name = card.querySelector("#cv-pname").value.trim();
              this.closeCard();
              if (name) actions.commit(editPeriod(state, { id: p.id, name }));
              else actions.refresh();
            } else if (e.target.closest("[data-pedit-delete]")) {
              this.closeCard();
              actions.removePeriod(p.id);
            } else if (e.target.closest("[data-pedit-open]")) {
              this.closeCard();
              this.dispatchEvent(
                new CustomEvent("tx-open-period", {
                  bubbles: true,
                  detail: { id: p.id },
                }),
              );
            } else if (e.target.closest("[data-pedit-close]")) this.closeCard();
          });
          // Hover, focus, pin and Escape, as on every linked reference.
          wireLinkedRefs(this, runtime);
        }
        chip(id) {
          return this.querySelector(
            `.ps-strip [data-period="${CSS.escape(id)}"]`,
          );
        }
        closeCard() {
          this.querySelector(".cv-pedit")?.remove();
        }
        openCard(id) {
          const p = periodOf(id),
            chip = this.chip(id);
          if (!p || !chip) return;
          this.closeCard();
          const r = chip.getBoundingClientRect();
          const left = Math.max(
            12,
            Math.min(r.left, this.getBoundingClientRect().right - 352),
          );
          this.insertAdjacentHTML(
            "beforeend",
            `<div class="cv-pedit" role="dialog" aria-label="Edit ${esc(p.name)}" data-pid="${esc(p.id)}" style="left: ${esc(Math.round(left))}px; top: ${esc(Math.round(r.bottom + 6))}px">
              <label class="cv-pelabel" for="cv-pname">Name</label>
              <input id="cv-pname" value="${esc(p.name)}" dir="auto">
              <p class="cv-pedates">${esc(dateRange(p.start, p.end))}. Drag the name to move it, or its sides to change the dates.</p>
              <div class="cv-perow">
                <button class="bn-dark" data-pedit-save>Save</button>
                <button class="bn-small" data-pedit-open>Open details</button>
                <button class="bn-small" data-pedit-delete>Delete period</button>
                <button class="bn-small" data-pedit-close>Close</button>
              </div>
            </div>`,
          );
          const input = this.querySelector("#cv-pname");
          input.focus();
          input.select();
        }
      },
    );
  }

  return { definePeriodStrip };
}

export const contract = {
  name: "tx-period-strip",
  create: createPeriodStrip,
  provides: ["definePeriodStrip"],
  requires: ["commit", "refresh", "removePeriod"],
  renders: [],
  wires: ["definePeriodStrip"],
};
