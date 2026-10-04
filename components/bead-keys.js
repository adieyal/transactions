// The keyboard on a timeline's beads: one Tab stop for the whole timeline,
// then arrows. Left and Right move along a thread's row, Up and Down to the
// nearest bead in the row above or below, Home and End to a row's ends, and
// Enter or Space click the bead (Shift adds it, as Shift-click does).
// Focusing a bead shows its tooltip (components/tip.js), as hovering does.

// After each render: every bead out of the Tab order but one, the bead
// last focused if it is still drawn, else the first.
const last = new WeakMap(),
  refocus = new WeakSet();
export function beadStops(host, bead) {
  const all = [...host.querySelectorAll(bead)];
  if (!all.length) return;
  const keep =
    all.find((b) => b.dataset.id === last.get(host)) ??
    rowsOf(host, bead)[0][0];
  for (const b of all) b.tabIndex = b === keep ? 0 : -1;
  // A bead clicked from the keyboard keeps its focus across the redraw.
  if (refocus.has(host)) {
    refocus.delete(host);
    keep.focus();
  }
}

// The beads by row, each row in order along the timeline.
function rowsOf(host, bead) {
  const rows = new Map();
  for (const b of host.querySelectorAll(bead)) {
    const row = b.parentElement;
    rows.set(row, [...(rows.get(row) ?? []), b]);
  }
  const x = (b) => b.getBoundingClientRect().left;
  return [...rows.values()].map((r) => r.sort((a, b) => x(a) - x(b)));
}

export function wireBeadKeys(host, bead) {
  host.addEventListener("focusin", (e) => {
    const b = e.target.closest?.(bead);
    if (b) last.set(host, b.dataset.id);
  });
  host.addEventListener("keydown", (e) => {
    const b = e.target.closest?.(bead);
    if (!b || !host.contains(b)) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      refocus.add(host);
      b.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: e.shiftKey }),
      );
      return;
    }
    const rows = rowsOf(host, bead);
    const r = rows.findIndex((row) => row.includes(b));
    const i = rows[r].indexOf(b);
    const cx = (el) => {
      const q = el.getBoundingClientRect();
      return q.left + q.width / 2;
    };
    const near = (row) =>
      row.reduce((m, el) =>
        Math.abs(cx(el) - cx(b)) < Math.abs(cx(m) - cx(b)) ? el : m,
      );
    const to =
      e.key === "ArrowLeft"
        ? rows[r][i - 1]
        : e.key === "ArrowRight"
          ? rows[r][i + 1]
          : e.key === "Home"
            ? rows[r][0]
            : e.key === "End"
              ? rows[r].at(-1)
              : e.key === "ArrowUp" && r > 0
                ? near(rows[r - 1])
                : e.key === "ArrowDown" && r < rows.length - 1
                  ? near(rows[r + 1])
                  : null;
    if (!/^(Arrow|Home|End)/.test(e.key)) return;
    e.preventDefault();
    if (!to) return;
    b.tabIndex = -1;
    to.tabIndex = 0;
    last.set(host, to.dataset.id);
    to.focus();
  });
}
