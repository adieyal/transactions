// Labels on the timeline that need the browser to measure them: names that
// must fit beside the wires, and axis labels that must not run together.

// A label that ends at x: a name that starts right to left (Hebrew, Arabic)
// is laid out right to left, so its words keep their order and anything cut
// off goes at its far (left) end.
const RTL = /^[^\p{L}]*[֐-ࣿיִ-﷿ﹰ-﻿]/u;
export const anchorEnd = (s) =>
  RTL.test(s) ? `direction="rtl" text-anchor="start"` : `text-anchor="end"`;

// Leaves out axis labels (text marked data-thin) that would touch the one
// before or run past the right edge, then shortens labels marked data-fit
// to their width. A shortened label keeps its full name in its title.
export function fitLabels(host) {
  const right = host.querySelector("svg")?.getBoundingClientRect().right;
  for (const cls of ["axis", "exp"]) {
    let end = -Infinity;
    host.querySelectorAll(`text.${cls}[data-thin]`).forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.left < end + 8 || box.right > right) el.remove();
      else end = box.right;
    });
  }
  host.querySelectorAll("text[data-fit]").forEach((el) => {
    const span = el.querySelector("tspan");
    const max = +el.dataset.fit;
    let text = span.textContent;
    while (el.getComputedTextLength() > max && text.length > 2) {
      text = text.slice(0, -1);
      span.textContent = text.trimEnd() + "…";
    }
  });
}

// Puts each park eye just left of its thread name, now that names have width.
export function placeParkButtons(host, labelW) {
  host.querySelectorAll(".parkbtn[data-park]").forEach((b) => {
    const lab = host.querySelector(
      `.rowlabel[data-thread="${CSS.escape(b.dataset.park)}"]`,
    );
    if (!lab) return;
    const x = labelW - 12 - lab.getComputedTextLength() - 14;
    b.setAttribute("transform", `translate(${x},${b.dataset.forY - 4})`);
  });
}

// Keeps period names in view at the top of the scrolled timeline, while the
// timeline itself is still on screen below them.
export function placeStickyNames(host, perBottom) {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const top =
    document.querySelector(".left").getBoundingClientRect().top -
    svg.getBoundingClientRect().top;
  const show = top > perBottom && top + 24 < svg.getBoundingClientRect().height;
  svg.querySelectorAll(".pstick").forEach((t) => {
    t.style.display = show ? "" : "none";
    if (show) t.setAttribute("y", top + 16);
  });
}
