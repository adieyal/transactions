import { esc } from "../helpers.js";
import { coveredMonths } from "../story/moments.js";
import { summarizeMonth } from "../story/summary.js";
import { polishFacts, polishSummary } from "../story/assist.js";
import { monthLong } from "../story/copy.js";
import { waitingForCurrency } from "../story/currency.js";
import { phraseHTML, wireHoverHighlight } from "./highlight.js";
import { $, html, paneShown, raw } from "./dom.js";
import { markdown } from "./markdown.js";

export function createMonth(runtime, actions) {
  const { state, caps } = runtime;
  // Polished versions for this session only, per month. Each remembers the
  // facts it was made from, so it's dropped as soon as the summary changes.
  const polished = {},
    notes = {},
    original = new Set();
  let polishing = null;
  const months = () => (runtime.derived ? coveredMonths(runtime.derived) : []);

  // Opens on the latest month with statements.
  function current() {
    const ms = months();
    if (!ms.includes(state.monthView)) state.monthView = ms.at(-1) ?? null;
    return state.monthView;
  }

  const partHTML = (p) => phraseHTML(p, esc);

  function sectionHTML(s, i, all) {
    if (s.kind === "question") {
      const first = all.findIndex((x) => x.kind === "question") === i;
      return `${first ? `<p class="mqhead">Optional questions</p>` : ""}<ul class="qlist">${actions.questionCard(s.moment, "month")}</ul>`;
    }
    if (s.kind === "yours")
      return `<figure class="yours"><figcaption>${esc(s.label)}</figcaption><div class="yourtext" dir="auto">${markdown(s.parts[0].text, runtime.derived.byId)}</div></figure>`;
    return `<p class="mp mp-${s.kind}" dir="auto">${s.parts.map(partHTML).join("")}</p>`;
  }

  function renderMonth() {
    const el = $("#month");
    if (!el || !state.loaded || !paneShown("month")) return;
    const ms = months();
    const { unpriced } = runtime.derived;
    const waiting = unpriced
      ? `<p class="mwaiting" role="status">${esc(waitingForCurrency(unpriced))} <button class="btn small" data-mcurrency>Choose the currency</button></p>`
      : "";
    if (!ms.length) {
      el.innerHTML = waiting
        ? html`${raw(waiting)}`
        : html`<p class="sub">No statements yet. Add some and a summary of each month appears here.</p>`;
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
    const facts = polishFacts(sections);
    const p = polished[m]?.facts === facts ? polished[m] : null;
    const usePolish = p && !original.has(m);
    const body = usePolish
      ? `<p class="mp mp-polished" dir="auto">${p.sentences.map((x) => partHTML(x)).join(" ")}</p>
        <p class="sub mpnote">Polished by ${esc(actions.AI())} from this month's figures, with every sentence tied to its transactions. <button class="linkish" data-moriginal>Show the original</button></p>
        ${sections
          .filter((x) => x.kind === "yours" || x.kind === "question")
          .map(sectionHTML)
          .join("")}`
      : sections.map(sectionHTML).join("");
    const controls = caps.sample
      ? `<div class="row-actions mpolish">${
          usePolish
            ? ""
            : `<button class="btn small quiet" data-mpolish title="Sends this month's figures and transaction ids to ${esc(actions.AI())}"${polishing === m ? " disabled" : ""}>${polishing === m ? "Polishing…" : "Polish this summary"}</button>`
        }${p && !usePolish ? `<button class="linkish" data-mpolished>Show the polished version</button>` : ""}</div>${notes[m] ? `<p class="sub mpnote">${esc(notes[m])}</p>` : ""}`
      : "";
    el.innerHTML = html`<div class="mnav">
        <button class="mstep" data-mstep="-1" aria-label="Previous month"${i <= 0 ? " disabled" : ""}>‹</button>
        <span class="mkick">Your month</span>
        <button class="mstep" data-mstep="1" aria-label="Next month"${i >= ms.length - 1 ? " disabled" : ""}>›</button>
      </div>
      <h2 class="mtitle">${monthLong(m)}</h2>${raw(waiting)}
      <div class="msum">${raw(body)}</div>${raw(controls)}
      <p class="sub">Hover or tab to underlined text to find it on the timeline.</p>`;
  }

  // Only ever from a press of Polish this summary.
  async function polish() {
    const m = current();
    if (!caps.sample || polishing) return;
    const sections = summarizeMonth(
      runtime.derived,
      state,
      m,
      actions.openQuestions(),
    );
    polishing = m;
    delete notes[m];
    renderMonth();
    try {
      const r = await polishSummary(caps.sample, sections, m);
      if (r.ok) {
        polished[m] = { facts: polishFacts(sections), sentences: r.sentences };
        original.delete(m);
      } else notes[m] = `Kept the original summary: ${r.reason}.`;
    } catch (e) {
      notes[m] = actions.sampleErr(e);
    }
    polishing = null;
    renderMonth();
  }

  function step(d) {
    const ms = months();
    const i = ms.indexOf(current()) + d;
    if (i < 0 || i >= ms.length) return;
    state.monthView = ms[i];
    renderMonth();
    actions.resetPanelScroll();
  }

  function wireMonth() {
    const el = $("#month");
    wireHoverHighlight(el, runtime, actions);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mstep]");
      if (b) step(+b.dataset.mstep);
      if (e.target.closest("[data-mpolish]")) polish();
      if (e.target.closest("[data-mcurrency]")) actions.askCurrencies();
      if (e.target.closest("[data-moriginal]")) {
        original.add(current());
        renderMonth();
      }
      if (e.target.closest("[data-mpolished]")) {
        original.delete(current());
        renderMonth();
      }
    });
    actions.wireCards(el, "month");
  }

  return { renderMonth, wireMonth };
}

export const contract = {
  name: "month",
  create: createMonth,
  provides: ["renderMonth", "wireMonth"],
  requires: [
    "AI",
    "askCurrencies",
    "highlight",
    "openQuestions",
    "questionCard",
    "resetPanelScroll",
    "sampleErr",
    "wireCards",
  ],
  renders: ["renderMonth"],
  wires: ["wireMonth"],
};
