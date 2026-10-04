// Dragging across the year's rows gathers the beads inside the dashed box
// (artboard 3: "drag across the timeline to gather several"). The click
// that ends a drag is swallowed, so it doesn't also pick a single bead.
export function wireGather(el, gather) {
  let drag = null;
  let swallow = false;
  el.addEventListener("pointerdown", (e) => {
    const rows = e.target.closest(".yr-rows");
    if (!rows || e.button || e.target.closest("button")) return;
    swallow = false;
    drag = { rows, x0: e.clientX, y0: e.clientY, moved: false, box: null };
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0,
      dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.rows.setPointerCapture?.(e.pointerId);
      drag.rows.insertAdjacentHTML(
        "beforeend",
        `<div class="yr-gather"></div>`,
      );
      drag.box = drag.rows.lastElementChild;
    }
    const r = drag.rows.getBoundingClientRect();
    Object.assign(drag.box.style, {
      left: `${Math.min(drag.x0, e.clientX) - r.left}px`,
      top: `${Math.min(drag.y0, e.clientY) - r.top}px`,
      width: `${Math.abs(dx)}px`,
      height: `${Math.abs(dy)}px`,
    });
  });
  const end = (e, keep) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    // The click that ends a drag, if the browser sends one, comes at once.
    swallow = true;
    setTimeout(() => (swallow = false));
    const box = d.box.getBoundingClientRect();
    d.box.remove();
    if (!keep) return;
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
