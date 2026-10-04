import { esc } from "../helpers.js";
import { beadTipHTML } from "../ui/timeline-text.js";

// The white tooltip the timeline had before the canvas (8d87cd2's #tip),
// for the canvas views: the person asked for it back over the native title
// tooltip, which waits and can't be styled. It shows at once on hover and on
// keyboard focus. A bead with a transaction gets the old bead tooltip;
// anything else with data-tip shows that text. Screen readers keep each
// element's own aria-label; the tooltip is aria-hidden.

const TARGET = "[data-tip]";
const WIDTH = 300;

export function wireTip(host, byId) {
  const box = () => {
    let tip = host.querySelector(":scope > .cv-tip");
    if (!tip) {
      host.insertAdjacentHTML(
        "beforeend",
        '<div class="cv-tip" aria-hidden="true" hidden></div>',
      );
      tip = host.lastElementChild;
    }
    return tip;
  };
  const content = (el) => {
    const t = el.dataset.id && byId()?.get(el.dataset.id);
    return t ? String(beadTipHTML(t, byId())) : esc(el.dataset.tip);
  };
  const place = (tip, x, y) => {
    const right = host.getBoundingClientRect().right;
    tip.style.left = `${x + 14 + WIDTH > right ? Math.max(4, x - 14 - WIDTH) : x + 14}px`;
    tip.style.top = `${y + 14}px`;
  };
  let current = null;
  const show = (el, x, y) => {
    const tip = box();
    if (current !== el) tip.innerHTML = content(el);
    current = el;
    tip.hidden = false;
    place(tip, x, y);
  };
  const hide = () => {
    current = null;
    const tip = host.querySelector(":scope > .cv-tip");
    if (tip) tip.hidden = true;
  };
  host.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(TARGET);
    if (el && host.contains(el)) show(el, e.clientX, e.clientY);
    else if (current) hide();
  });
  host.addEventListener("pointerleave", hide);
  host.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(TARGET);
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(el, r.left, r.bottom - 8);
  });
  host.addEventListener("focusout", hide);
}
