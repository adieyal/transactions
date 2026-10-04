// Dragging across the year's rows gathers the beads inside the dashed box
// (artboard 3: "drag across the timeline to gather several"). The click
// that ends a drag is swallowed, so it doesn't also pick a single bead.
// On touch a drag scrolls the timeline, so gathering starts with a long
// press: hold still for HOLD_MS, then drag. Moving sooner is a scroll.

export const HOLD_MS = 450;
export const SLOP_PX = 8;

// What a touch that went down means so far: still deciding, a scroll (it
// moved before the hold was up), or a gather (it was held still).
export function touchIntent(heldMs, movedPx) {
  if (movedPx > SLOP_PX && heldMs < HOLD_MS) return "scroll";
  return heldMs >= HOLD_MS ? "gather" : "wait";
}

export function wireGather(el, gather) {
  let drag = null;
  let swallow = false;
  const showBox = (d) => {
    d.rows.insertAdjacentHTML("beforeend", `<div class="yr-gather"></div>`);
    d.box = d.rows.lastElementChild;
  };
  const drawBox = (d, x, y) => {
    const r = d.rows.getBoundingClientRect();
    Object.assign(d.box.style, {
      left: `${Math.min(d.x0, x) - r.left}px`,
      top: `${Math.min(d.y0, y) - r.top}px`,
      width: `${Math.abs(x - d.x0)}px`,
      height: `${Math.abs(y - d.y0)}px`,
    });
  };
  const drop = () => {
    clearTimeout(drag?.timer);
    drag?.box?.remove();
    drag = null;
  };
  el.addEventListener("pointerdown", (e) => {
    const rows = e.target.closest(".yr-rows");
    if (!rows || e.button || e.target.closest("button")) return;
    swallow = false;
    drop();
    const touch = e.pointerType === "touch";
    const d = { rows, x0: e.clientX, y0: e.clientY, moved: false, box: null };
    d.touch = touch;
    d.at = e.timeStamp;
    if (touch)
      // Held still: armed. The box shows at the finger, ready to drag.
      d.timer = setTimeout(() => {
        if (drag !== d) return;
        d.armed = true;
        d.moved = true;
        showBox(d);
        drawBox(d, d.x0, d.y0);
      }, HOLD_MS);
    drag = d;
  });
  el.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d) return;
    const dx = e.clientX - d.x0,
      dy = e.clientY - d.y0;
    if (d.touch && !d.armed) {
      const intent = touchIntent(e.timeStamp - d.at, Math.hypot(dx, dy));
      if (intent === "scroll") drop();
      return;
    }
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!d.moved) {
      d.moved = true;
      d.rows.setPointerCapture?.(e.pointerId);
      showBox(d);
    }
    drawBox(d, e.clientX, e.clientY);
  });
  // Once armed, the finger drags the box instead of scrolling the page.
  el.addEventListener(
    "touchmove",
    (e) => {
      if (drag?.armed) e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener("contextmenu", (e) => {
    if (drag?.touch) e.preventDefault();
  });
  const end = (e, keep) => {
    if (!drag) return;
    const d = drag;
    clearTimeout(d.timer);
    drag = null;
    if (!d.moved) return;
    // The click that ends a drag, if the browser sends one, comes at once.
    swallow = true;
    setTimeout(() => (swallow = false));
    const box = d.box.getBoundingClientRect();
    d.box.remove();
    // A long press let go without a drag gathers nothing.
    if (!keep || (d.armed && box.width + box.height < SLOP_PX)) return;
    const ids = [...d.rows.querySelectorAll(".yr-bead[data-id]")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2,
          y = r.top + r.height / 2;
        return (
          x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
        );
      })
      .map((b) => b.dataset.id);
    gather(ids, e.shiftKey);
  };
  el.addEventListener("pointerup", (e) => end(e, true));
  el.addEventListener("pointercancel", (e) => end(e, false));
  el.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
}
