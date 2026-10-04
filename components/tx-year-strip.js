import { daysIn } from "../story/one-month.js";

// The time under the pointer on the year's Periods strip, in ms, for
// moving and resizing periods (components/period-edit.js).
export function stripTime(strip, x) {
  const { f } = at(strip, x);
  const cols = strip.dataset.cols.split(",");
  const i = Math.floor(f * cols.length);
  const days = (f * cols.length - i) * daysIn(cols[i]);
  return Date.parse(`${cols[i]}-01T00:00:00Z`) + days * 864e5;
}
function at(strip, x) {
  const r = strip.getBoundingClientRect();
  const f = Math.min(0.9999, Math.max(0, (x - r.left) / r.width));
  const cols = strip.dataset.cols.split(",");
  const i = Math.floor(f * cols.length);
  const days = daysIn(cols[i]);
  const d = Math.floor((f * cols.length - i) * days) + 1;
  return { f, iso: `${cols[i]}-${String(d).padStart(2, "0")}` };
}

// Dragging along the Periods strip marks a period, through the app's
// own addPeriod (tx-mark-period), as on artboard 2.
export function wireYearStrip(el) {
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    const strip = e.target.closest(".yr-periods");
    if (!strip || e.target.closest("button") || e.button) return;
    const a = at(strip, e.clientX);
    drag = { strip, x: e.clientX, a, b: a, moved: false };
    drag.ghost = strip.querySelector(".yr-pnew");
    strip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    drag.b = at(drag.strip, e.clientX);
    if (!drag.moved) return;
    const [a, b] = [drag.a.f, drag.b.f].sort((x, y) => x - y);
    Object.assign(drag.ghost.style, {
      left: `${(a * 100).toFixed(2)}%`,
      width: `${((b - a) * 100).toFixed(2)}%`,
    });
    drag.ghost.hidden = false;
  });
  const end = (keep) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ghost.hidden = true;
    if (!keep || !d.moved) return;
    const [start, end] = [d.a.iso, d.b.iso].sort();
    el.dispatchEvent(
      new CustomEvent("tx-mark-period", {
        bubbles: true,
        detail: { start, end },
      }),
    );
  };
  el.addEventListener("pointerup", () => end(true));
  el.addEventListener("pointercancel", () => end(false));
}
