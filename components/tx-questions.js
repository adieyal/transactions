import { MAX_SHOWN } from "../story/moments.js";
import { plural, privacyText } from "../story/copy.js";
import { html, raw } from "../ui/dom.js";
import { sameIds } from "../ui/highlight.js";
import { subscribeWhileConnected } from "./base.js";

// <tx-questions limit="5">: the open questions, the highest-ranked `limit`
// shown and the rest folded under More questions. The cards and their
// answers come from ui/questions.js (questionCard, wireCards) until R13 makes
// a card its own component. Draws only inside itself (ADR 0009).
export function createQuestionsComponent(runtime, actions) {
  const { state } = runtime;
  let count = 0;

  function defineQuestions() {
    if (customElements.get("tx-questions")) return;
    customElements.define(
      "tx-questions",
      class extends HTMLElement {
        static observedAttributes = ["limit"];
        constructor() {
          super();
          // The list its cards belong to, so a card's text field opens only
          // in the list where it was pressed.
          this.where = count++ ? `questions-${count}` : "questions";
          // Whether "More questions" was left open, kept across re-renders.
          this.moreOpen = false;
          this.wired = false;
        }
        connectedCallback() {
          if (!this.wired) this.wire();
          subscribeWhileConnected(this, runtime.store, (change) =>
            change === "highlight" ? this.mark() : this.render(),
          );
          this.render();
        }
        attributeChangedCallback() {
          if (this.isConnected) this.render();
        }
        render() {
          if (!state.loaded || !this.checkVisibility()) return;
          const open = actions.openQuestions();
          const limit = Math.max(1, +this.getAttribute("limit") || MAX_SHOWN);
          const answers = Object.values(state.answers || {});
          const answered = answers.filter(
            (a) => a.status === "answered",
          ).length;
          const skipped = answers.length - answered;
          const privacy = privacyText(actions.Store.backend.kind);
          const cards = (ms) =>
            raw(ms.map((m) => actions.questionCard(m, this.where)).join(""));
          const rest = open.slice(limit);
          let body;
          if (!runtime.derived?.allTxns.length)
            body = html`<p class="sub">No statements yet. Questions appear here once you add some.</p>`;
          else if (!open.length)
            body = html`<p class="sub">No more questions for now. New ones may appear when you add statements.</p>`;
          else
            body = html`<ul class="qlist">${cards(open.slice(0, limit))}</ul>${
              rest.length
                ? html`<details class="qmore"${raw(this.moreOpen ? " open" : "")}><summary>More questions (${rest.length})</summary><ul class="qlist">${cards(rest)}</ul></details>`
                : ""
            }`;
          this.innerHTML = html`<p class="lead">Your statements show where money went. Here are a few things a short note would explain. Answer any you like, or none at all.</p>
            <div class="qprivacy">${privacy.banner}</div>
            ${body}${
              answers.length
                ? html`<p class="sub">You've answered ${plural(answered, "question")} and skipped ${skipped}. Skipped questions don't come back.</p>`
                : ""
            }`;
          // A card's text field open in the folded part keeps it open.
          const form = this.querySelector("[data-qform]");
          if (form?.closest(".qmore")) form.closest(".qmore").open = true;
          this.mark();
          form?.querySelector("[data-qtext]")?.focus();
        }
        // Cards whose transactions are lit up on the timeline.
        mark() {
          this.querySelectorAll(".qcard").forEach((c) =>
            c.classList.toggle(
              "on",
              sameIds(c.dataset.ids.split(","), state.highlight),
            ),
          );
        }
        wire() {
          this.wired = true;
          actions.wireCards(this, this.where);
          this.addEventListener(
            "toggle",
            (e) => {
              if (e.target.matches?.(".qmore")) this.moreOpen = e.target.open;
            },
            true,
          );
        }
      },
    );
  }

  return { defineQuestions };
}

export const contract = {
  name: "tx-questions",
  create: createQuestionsComponent,
  provides: ["defineQuestions"],
  requires: ["Store", "openQuestions", "questionCard", "wireCards"],
  renders: [],
  wires: ["defineQuestions"],
};
