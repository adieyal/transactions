// Hovering or focusing a phrase that carries data-ids (or a [[id]]
// citation) lights up its beads on the timeline. Leaving it puts back
// whatever was lit before, such as a thread picked from the timeline.
export function wireHoverHighlight(el, runtime, actions) {
  const { state } = runtime;
  let hovered = null,
    before = null;
  const target = (node) => {
    const sp = node?.closest?.(".sp, [data-cite]");
    return sp && el.contains(sp) ? sp : null;
  };
  function show(sp) {
    const ids = sp.dataset.ids ? sp.dataset.ids.split(",") : [sp.dataset.cite];
    el.querySelectorAll(".sp.on").forEach((x) => x.classList.remove("on"));
    sp.classList.add("on");
    if (!(hovered && state.highlight === hovered)) before = state.highlight;
    hovered = new Set(ids);
    state.highlight = hovered;
    actions.renderTimeline();
  }
  function hide(sp) {
    sp.classList.remove("on");
    if (hovered && state.highlight === hovered) {
      state.highlight = before ?? new Set();
      actions.renderTimeline();
    }
    hovered = before = null;
  }
  el.addEventListener("mouseover", (e) => {
    const sp = target(e.target);
    if (sp && !sp.contains(e.relatedTarget)) show(sp);
  });
  el.addEventListener("mouseout", (e) => {
    const sp = target(e.target);
    if (sp && !sp.contains(e.relatedTarget)) hide(sp);
  });
  el.addEventListener("focusin", (e) => {
    const sp = target(e.target);
    if (sp) show(sp);
  });
  el.addEventListener("focusout", (e) => {
    const sp = target(e.target);
    if (sp) hide(sp);
  });
}

// A phrase that lights up its transactions, or plain text when it has none.
export const phraseHTML = (p, esc) =>
  p.txnIds?.length
    ? `<span class="sp" tabindex="0" data-ids="${esc(p.txnIds.join(","))}">${esc(p.text)}</span>`
    : esc(p.text);
