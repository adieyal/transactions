import { esc } from "../helpers.js";
import { coveredMonths } from "../story/moments.js";
import { summarizeMonth } from "../story/summary.js";
import { polishFacts, polishSummary } from "../story/assist.js";
import { monthLong } from "../story/copy.js";
import { waitingForCurrency } from "../story/currency.js";
import { phraseHTML, sameIds } from "../ui/highlight.js";
import { wireLinkedRefs } from "./linked-ref.js";
import { html, raw } from "../ui/dom.js";
import { markdown } from "../ui/markdown.js";
import { subscribeWhileConnected } from "./base.js";

// <tx-month month="YYYY-MM">: one month's summary. Without a month it shows
// the app's month (state.monthView) and its arrows move that; with one, its
// arrows move only this element. It draws only inside itself and asks for
// highlights with a tx-highlight event (ADR 0009).
export function createMonthComponent(runtime, actions) {
  const { state, caps } = runtime;
  // Polished versions for this session only, per month, shared by every
  // <tx-month>. Each remembers the facts it was made from, so it's dropped as
  // soon as the summary changes.
  const polished = {},
    notes = {},
    original = new Set();
  let polishing = null;
  let count = 0;
  // Every <tx-month> in the page, so a polish shows in each one that shares
  // its month without telling the store.
  const shown = new Set();
  const renderAll = () => shown.forEach((el) => el.render());
  const months = () => (runtime.derived ? coveredMonths(runtime.derived) : []);
  const partHTML = (p) => phraseHTML(p, esc);

  function defineMonth() {
    if (customElements.get("tx-month")) return;
    customElements.define(
      "tx-month",
      class extends HTMLElement {
        static observedAttributes = ["month"];
        constructor() {
          super();
          // The list its question cards belong to, so a card's text field
          // opens only where it was pressed.
          this.where = count++ ? `month-${count}` : "month";
          this.wired = false;
        }
        connectedCallback() {
          if (!this.wired) this.wire();
          shown.add(this);
          subscribeWhileConnected(this, runtime.store, (change) =>
            change === "highlight" ? this.mark() : this.render(),
          );
          this.render();
        }
        disconnectedCallback() {
          shown.delete(this);
        }
        attributeChangedCallback() {
          if (this.isConnected) this.render();
        }
        // The month shown: its own, or the app's. Opens on the latest month
        // with statements.
        current() {
          const ms = months();
          const own = this.getAttribute("month");
          if (own) return ms.includes(own) ? own : null;
          if (!ms.includes(state.monthView))
            state.monthView = ms.at(-1) ?? null;
          return state.monthView;
        }
        sectionHTML(s, i, all) {
          if (s.kind === "question") {
            const first = all.findIndex((x) => x.kind === "question") === i;
            return `${first ? `<p class="mqhead">Optional questions</p>` : ""}<ul class="qlist">${actions.questionCard(s.moment, this.where)}</ul>`;
          }
          if (s.kind === "yours")
            return `<figure class="yours"><figcaption>${esc(s.label)}</figcaption><div class="yourtext" dir="auto">${markdown(s.parts[0].text, runtime.derived.byId)}</div></figure>`;
          return `<p class="mp mp-${s.kind}" dir="auto">${s.parts.map(partHTML).join("")}</p>`;
        }
        render() {
          if (!state.loaded || !this.checkVisibility()) return;
          const ms = months();
          const { unpriced } = runtime.derived;
          const waiting = unpriced
            ? `<p class="mwaiting" role="status">${esc(waitingForCurrency(unpriced))} <button class="btn small" data-mcurrency>Choose the currency</button></p>`
            : "";
          if (!ms.length) {
            this.innerHTML = waiting
              ? html`${raw(waiting)}`
              : html`<p class="sub">No statements yet. Add some and a summary of each month appears here.</p>`;
            return;
          }
          const m = this.current();
          if (!m) {
            this.innerHTML = html`<p class="sub">
              No statements cover ${this.getAttribute("month")}.
            </p>`;
            return;
          }
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
          .map((s, j, all) => this.sectionHTML(s, j, all))
          .join("")}`
            : sections.map((s, j, all) => this.sectionHTML(s, j, all)).join("");
          const controls = caps.sample
            ? `<div class="row-actions mpolish">${
                usePolish
                  ? ""
                  : `<button class="btn small quiet" data-mpolish title="Sends this month's figures and transaction ids to ${esc(actions.AI())}"${polishing === m ? " disabled" : ""}>${polishing === m ? "Polishing…" : "Polish this summary"}</button>`
              }${p && !usePolish ? `<button class="linkish" data-mpolished>Show the polished version</button>` : ""}</div>${notes[m] ? `<p class="sub mpnote">${esc(notes[m])}</p>` : ""}`
            : "";
          this.innerHTML = html`<div class="mnav">
              <button class="mstep" data-mstep="-1" aria-label="Previous month"${i <= 0 ? " disabled" : ""}>‹</button>
              <span class="mkick">Your month</span>
              <button class="mstep" data-mstep="1" aria-label="Next month"${i >= ms.length - 1 ? " disabled" : ""}>›</button>
            </div>
            <h2 class="mtitle">${monthLong(m)}</h2>${raw(waiting)}
            <div class="msum">${raw(body)}</div>${raw(controls)}
            <p class="sub">Hover or tab to underlined text to find it on the timeline.</p>`;
          this.mark();
        }
        // Phrases whose transactions are lit up on the timeline.
        mark() {
          this.querySelectorAll(".sp[data-ids]").forEach((sp) =>
            sp.classList.toggle(
              "on",
              sameIds(sp.dataset.ids.split(","), state.highlight),
            ),
          );
        }
        // Only ever from a press of Polish this summary.
        async polish() {
          const m = this.current();
          if (!caps.sample || polishing || !m) return;
          const sections = summarizeMonth(
            runtime.derived,
            state,
            m,
            actions.openQuestions(),
          );
          polishing = m;
          delete notes[m];
          renderAll();
          try {
            const r = await polishSummary(caps.sample, sections, m);
            if (r.ok) {
              polished[m] = {
                facts: polishFacts(sections),
                sentences: r.sentences,
              };
              original.delete(m);
            } else notes[m] = `Kept the original summary: ${r.reason}.`;
          } catch (e) {
            notes[m] = actions.sampleErr(e);
          }
          polishing = null;
          renderAll();
        }
        step(d) {
          const ms = months();
          const i = ms.indexOf(this.current()) + d;
          if (i < 0 || i >= ms.length) return;
          if (this.hasAttribute("month")) {
            this.setAttribute("month", ms[i]);
            return;
          }
          state.monthView = ms[i];
          actions.redraw();
          actions.resetPanelScroll();
        }
        wire() {
          this.wired = true;
          wireLinkedRefs(this, runtime);
          this.addEventListener("click", (e) => {
            const b = e.target.closest("[data-mstep]");
            if (b) this.step(+b.dataset.mstep);
            if (e.target.closest("[data-mpolish]")) this.polish();
            if (e.target.closest("[data-mcurrency]")) actions.askCurrencies();
            if (e.target.closest("[data-moriginal]")) {
              original.add(this.current());
              this.render();
            }
            if (e.target.closest("[data-mpolished]")) {
              original.delete(this.current());
              this.render();
            }
          });
          actions.wireCards(this, this.where);
        }
      },
    );
  }

  return { defineMonth };
}

export const contract = {
  name: "tx-month",
  create: createMonthComponent,
  provides: ["defineMonth"],
  requires: [
    "AI",
    "askCurrencies",
    "openQuestions",
    "questionCard",
    "redraw",
    "resetPanelScroll",
    "sampleErr",
    "wireCards",
  ],
  renders: [],
  wires: ["defineMonth"],
};
