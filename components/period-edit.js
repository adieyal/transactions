import { esc } from "../helpers.js";
import { dateRange } from "../story/copy.js";
import {
  dragTo,
  periodAt,
  periodLanes,
  startDrag,
} from "../transactions/period-drag.js";

// Editing a named period on the Periods strip of the canvas views
// (tx-year-band, tx-one-month), with the old timeline's own rules
// (transactions/period-drag.js): grab a period anywhere along its column or
// its name to move it, or within 4px of either side, the whole height of
// the timeline, to resize it. It moves by whole days and redraws as it
// goes, so periods it comes to overlap stack on another row. Click the name
// for a card to rename or delete it; deleting goes through the app's
// removePeriod, which offers Undo.

// Periods and busy stretches packed into rows of the strip, as on the old
// timeline, so no two names overlap: each takes its dates or its name,
// whichever is wider, and lane 0 is at the top. Called after each render.
const LANE = 28;
export function stackPeriods(host, strip) {
  const s = host.querySelector(strip);
  const chips = s ? [...s.querySelectorAll(":scope > button")] : [];
  if (!chips.length) return;
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

const DAY = 86400000;
const shift = (iso, days) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);

// strip: the strip's selector, and bands: the selector of the periods'
// columns (each with data-pid). inv(strip, clientX): the time at x, in ms.
// redraw(): draw the view again. Returns nothing; listens on host.
export function wirePeriodEdit(
  host,
  { strip, bands, inv, redraw, state, actions },
) {
  let drag = null;
  let dragged = false;
  let frame = 0;
  const periodOf = (id) => state.periods.find((p) => p.id === id);
  const columns = () =>
    [...host.querySelectorAll(`${bands}[data-pid]`)].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.pid, a: r.left, b: r.right };
    });
  // A press on a period's name, or in its column below the strip, unless it
  // lands on a bead or another control. Shift-drag still gathers.
  const hitAt = (e) => {
    const chip = e.target.closest(`${strip} [data-period]`);
    if (chip) {
      const hit = periodAt(columns(), e.clientX, state.periodSel);
      return hit?.id === chip.dataset.period
        ? hit
        : { id: chip.dataset.period, edge: undefined };
    }
    if (
      e.shiftKey ||
      !e.target.closest(".yr-rows, .om-rows") ||
      e.target.closest("[data-id], button, input, a")
    )
      return null;
    return periodAt(columns(), e.clientX, state.periodSel);
  };
  const draw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  };

  host.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button) return;
      dragged = false;
      const hit = hitAt(e);
      const p = hit && periodOf(hit.id);
      if (!p || !host.querySelector(strip)) return;
      drag = { ...startDrag(p, e.clientX, hit.edge), p };
      // Ahead of the strip's marking and the rows' gathering.
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  host.addEventListener("pointermove", (e) => {
    if (!drag) {
      const hit = e.buttons ? null : hitAt(e);
      host.style.cursor = !hit ? "" : hit.edge ? "ew-resize" : "grab";
      return;
    }
    const was = drag.moved;
    const to = dragTo(drag, e.clientX, (x) =>
      inv(host.querySelector(strip), x),
    );
    // Captured only once it moves, so a plain click still lands on the name.
    if (drag.moved && !was) host.setPointerCapture(e.pointerId);
    if (!to || (to.start === drag.p.start && to.end === drag.p.end)) return;
    Object.assign(drag.p, to);
    draw();
  });
  const finish = (keep) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    dragged = true;
    if (!keep) [d.p.start, d.p.end] = [d.start, d.end];
    else actions.save("periods");
    actions.refresh();
  };
  host.addEventListener("pointerup", () => finish(true));
  host.addEventListener("pointercancel", () => finish(false));

  // The chip's keys: Enter opens the card, arrows move the period a day,
  // and Shift with an arrow moves its end.
  host.addEventListener("keydown", (e) => {
    const chip = e.target.closest?.("[data-period]");
    if (chip && chip.closest(strip) && /^Arrow(Left|Right)$/.test(e.key)) {
      const p = periodOf(chip.dataset.period);
      if (!p) return;
      const n = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey) {
        const end = shift(p.end, n);
        if (end >= p.start) p.end = end;
      } else [p.start, p.end] = [shift(p.start, n), shift(p.end, n)];
      e.preventDefault();
      actions.save("periods");
      actions.refresh();
      host.querySelector(`[data-period="${CSS.escape(p.id)}"]`)?.focus();
    } else if (e.key === "Escape" && host.querySelector(".cv-pedit")) {
      const id = host.querySelector(".cv-pedit").dataset.pid;
      closeCard();
      host.querySelector(`[data-period="${CSS.escape(id)}"]`)?.focus();
    }
  });

  function closeCard() {
    host.querySelector(".cv-pedit")?.remove();
  }
  function openCard(id) {
    const p = periodOf(id);
    const chip = host.querySelector(
      `${strip} [data-period="${CSS.escape(id)}"]`,
    );
    if (!p || !chip) return;
    closeCard();
    const tip = host.querySelector(":scope > .cv-tip");
    if (tip) tip.hidden = true;
    const r = chip.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(r.left, host.getBoundingClientRect().right - 352),
    );
    host.insertAdjacentHTML(
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
    const input = host.querySelector("#cv-pname");
    input.focus();
    input.select();
  }
  host.addEventListener(
    "click",
    (e) => {
      const chip = e.target.closest("[data-period]");
      if (chip?.closest(strip)) {
        e.stopPropagation();
        if (dragged) dragged = false;
        else openCard(chip.dataset.period);
        return;
      }
      const card = e.target.closest(".cv-pedit");
      if (!card) return;
      e.stopPropagation();
      const p = periodOf(card.dataset.pid);
      if (!p) return closeCard();
      if (e.target.closest("[data-pedit-save]")) {
        const name = card.querySelector("#cv-pname").value.trim();
        if (name) p.name = name;
        closeCard();
        actions.save("periods");
        actions.refresh();
      } else if (e.target.closest("[data-pedit-delete]")) {
        closeCard();
        actions.removePeriod(p.id);
      } else if (e.target.closest("[data-pedit-open]")) {
        closeCard();
        host.dispatchEvent(
          new CustomEvent("tx-open-period", {
            bubbles: true,
            detail: { id: p.id },
          }),
        );
      } else if (e.target.closest("[data-pedit-close]")) closeCard();
    },
    true,
  );
  host.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "cv-pname")
      host.querySelector("[data-pedit-save]")?.click();
  });
}
