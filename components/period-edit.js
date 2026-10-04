import { esc } from "../helpers.js";
import { dateRange } from "../story/copy.js";

// Editing a named period on the Periods strip of the canvas views
// (tx-year-band, tx-one-month), as the timeline before the canvas allowed:
// drag its chip to move it, drag a side handle to resize it, and click the
// chip for a card to rename or delete it. Deleting goes through the app's
// removePeriod, which offers Undo. The person asked for these back after
// testing the canvas.

// The two side handles of a period; left and right are percentages.
export const handlesHTML = (id, left, right) =>
  ["start", "end"]
    .map(
      (edge, i) =>
        `<button class="cv-phandle" data-pedge="${edge}" data-pid="${esc(id)}" tabindex="-1" aria-hidden="true" style="left: ${esc([left, right][i])}%"></button>`,
    )
    .join("");

const DAY = 86400000;
const shift = (iso, days) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
const between = (a, b) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY,
  );

// isoAt(strip, clientX): the date under the pointer on a strip.
// strip: the strip's selector. Returns nothing; listens on host.
export function wirePeriodEdit(host, { strip, isoAt, state, actions }) {
  let drag = null;
  let dragged = false;
  const periodOf = (id) => state.periods.find((p) => p.id === id);
  const parts = (id) =>
    host.querySelectorAll(
      `[data-pid="${CSS.escape(id)}"], [data-period="${CSS.escape(id)}"]`,
    );

  host.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    dragged = false;
    const handle = e.target.closest(".cv-phandle");
    const chip = !handle && e.target.closest("[data-period]");
    const el = handle || chip;
    const s = el?.closest(strip);
    if (!s) return;
    const id = handle ? handle.dataset.pid : chip.dataset.period;
    const p = periodOf(id);
    if (!p) return;
    drag = {
      id,
      p,
      s,
      edge: handle?.dataset.pedge,
      x0: e.clientX,
      from: isoAt(s, e.clientX),
      moved: false,
    };
    e.preventDefault();
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    // Captured only once it moves, so a plain click still lands on the chip.
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      drag.s.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    if (drag.edge) {
      // A ghost from the fixed side to the pointer.
      const r = drag.s.getBoundingClientRect();
      const other = host.querySelector(
        `.cv-phandle[data-pid="${CSS.escape(drag.id)}"][data-pedge="${drag.edge === "start" ? "end" : "start"}"]`,
      );
      const ox = other.getBoundingClientRect().left + 1 - r.left;
      const px = Math.min(r.width, Math.max(0, e.clientX - r.left));
      const ghost = drag.s.querySelector(".yr-pnew, .om-pnew");
      Object.assign(ghost.style, {
        left: `${Math.min(ox, px)}px`,
        width: `${Math.abs(px - ox)}px`,
      });
      ghost.hidden = false;
    } else parts(drag.id).forEach((el) => (el.style.translate = `${dx}px 0`));
  });
  const finish = (e, keep) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    dragged = true;
    if (!keep) return actions.refresh();
    const to = isoAt(d.s, e.clientX);
    if (d.edge) {
      const fixed = d.edge === "start" ? d.p.end : d.p.start;
      [d.p.start, d.p.end] = [fixed, to].sort();
    } else {
      const n = between(d.from, to);
      d.p.start = shift(d.p.start, n);
      d.p.end = shift(d.p.end, n);
    }
    actions.save("periods");
    actions.refresh();
  };
  host.addEventListener("pointerup", (e) => finish(e, true));
  host.addEventListener("pointercancel", (e) => finish(e, false));

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
      if (e.target.closest(".cv-phandle")) return e.stopPropagation();
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
