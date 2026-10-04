import { $, esc } from "../helpers.js";
import { coveredMonths } from "../story/moments.js";
import { summarizeMonth } from "../story/summary.js";
import { monthLong } from "../story/copy.js";

export function createMonth(runtime, actions) {
  const { state } = runtime;
  // The ids lit up by hovering or focusing a sentence, so leaving it only
  // clears what it set.
  let hovered = null;

  const months = () => (runtime.derived ? coveredMonths(runtime.derived) : []);

  // Opens on the latest month with statements.
  function current() {
    const ms = months();
    if (!ms.includes(state.monthView)) state.monthView = ms.at(-1) ?? null;
    return state.monthView;
  }

  const partHTML = (p) =>
    p.txnIds?.length
      ? `<span class="sp" tabindex="0" data-ids="${esc(p.txnIds.join(","))}">${esc(p.text)}</span>`
      : esc(p.text);

  function sectionHTML(s, i, all) {
    if (s.kind === "question") {
      const first = all.findIndex((x) => x.kind === "question") === i;
      return `${first ? `<p class="mqhead">Optional questions</p>` : ""}<ul class="qlist">${actions.questionCard(s.moment, "month")}</ul>`;
    }
    if (s.kind === "yours")
      return `<figure class="yours"><figcaption>${esc(s.label)}</figcaption><div class="yourtext" dir="auto">${actions.md(s.parts[0].text)}</div></figure>`;
    return `<p class="mp mp-${s.kind}" dir="auto">${s.parts.map(partHTML).join("")}</p>`;
  }

  function renderMonth() {
    const el = $("#month");
    if (!el || !state.loaded) return;
    const ms = months();
    if (!ms.length) {
      el.innerHTML = `<p class="sub">No statements yet. Add some and a summary of each month appears here.</p>`;
      return;
    }
    const m = current();
    const i = ms.indexOf(m);
    const sections = summarizeMonth(
      runtime.derived,
      state,
      m,
      actions.openQuestions(),
    );
    el.innerHTML = `<div class="mnav">
        <button class="mstep" data-mstep="-1" aria-label="Previous month"${i <= 0 ? " disabled" : ""}>‹</button>
        <span class="mkick">Your month</span>
        <button class="mstep" data-mstep="1" aria-label="Next month"${i >= ms.length - 1 ? " disabled" : ""}>›</button>
      </div>
      <h2 class="mtitle">${esc(monthLong(m))}</h2>
      <div class="msum">${sections.map(sectionHTML).join("")}</div>
      <p class="sub">Hover or tab to underlined text to find it on the timeline.</p>`;
    hovered = null;
  }

  function step(d) {
    const ms = months();
    const i = ms.indexOf(current()) + d;
    if (i < 0 || i >= ms.length) return;
    state.monthView = ms[i];
    renderMonth();
  }

  function wireMonth() {
    const el = $("#month");
    const target = (node) => {
      const sp = node?.closest?.(".sp, [data-cite]");
      return sp && el.contains(sp) ? sp : null;
    };
    function show(sp) {
      const ids = sp.dataset.ids
        ? sp.dataset.ids.split(",")
        : [sp.dataset.cite];
      el.querySelectorAll(".sp.on").forEach((x) => x.classList.remove("on"));
      sp.classList.add("on");
      hovered = new Set(ids);
      state.highlight = hovered;
      actions.renderTimeline();
    }
    function hide(sp) {
      sp.classList.remove("on");
      if (hovered && state.highlight === hovered) {
        state.highlight = new Set();
        actions.renderTimeline();
      }
      hovered = null;
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
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mstep]");
      if (b) step(+b.dataset.mstep);
    });
    actions.wireCards(el, "month");
  }

  return { renderMonth, wireMonth };
}
