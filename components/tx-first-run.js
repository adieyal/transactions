import { createDemoData, demoMoments } from "../demo.js";
import { createRuntime } from "../state.js";
import { exampleStrip } from "../story/example.js";
import { deriveTransactions } from "../transactions/derive.js";
import { html } from "../ui/dom.js";

const ACCEPT = ".xls,.xlsx,.csv,.txt,.html,.htm";

// <tx-first-run>: the page shown while there are no statements (artboard 1).
// Its files go to the import flow with a bubbling tx-import-files event, and
// "Open Sam's year" asks for the example with tx-open-example; main.js
// answers both (ADR 0009).
export function createFirstRunComponent(runtime) {
  // The example card's strip, drawn from the same demo the button opens.
  let strip = null;
  function exampleYear() {
    if (!strip) {
      const today = runtime.today;
      const derived = deriveTransactions(
        { ...createRuntime({ today }).state, ...createDemoData(today) },
        { today },
      );
      strip = exampleStrip(derived, demoMoments(today));
    }
    return strip;
  }

  // A label that would overflow the strip ends at its right edge instead.
  function fitMoments(line) {
    const width = line.clientWidth;
    line.querySelectorAll(".fr-moment").forEach((el) => {
      el.style.transform = "";
      const over = el.offsetLeft + el.offsetWidth - width;
      if (over > 0) el.style.transform = `translateX(-${over}px)`;
    });
  }

  function stripHTML({ rows, moments }) {
    const momentHTML = moments.map(
      (m) =>
        // Its left edge at its date, as drawn; fitMoments pulls back only a
        // label that would run past the strip's end.
        html`<div class="fr-moment" style="left: ${m.left}%">${m.label}</div>`,
    );
    const rowHTML = rows.map(
      (r) =>
        html`<div class="fr-row"><div class="fr-line"></div>${r.dots.map(
          (d) =>
            html`<div class="fr-dot" style="left: ${d.left}%; width: ${d.size}px; height: ${d.size}px; background: ${r.color}"></div>`,
        )}</div>`,
    );
    return html`<div class="fr-strip" aria-hidden="true"><div class="fr-moments">${momentHTML}</div>${rowHTML}</div>`;
  }

  function pageHTML() {
    return html`<main class="fr-main">
  <div class="fr-top">
    <div class="fr-lead">
      <h1 class="fr-h1">Your spending, told as a story</h1>
      <p class="fr-intro">Add a bank or card statement. Every payment appears along time, and you get a plain-language account of what happened. You add the parts only you know: what a stretch was for, and what a payment meant.</p>
      <div class="fr-drop">
        <div class="fr-rule" aria-hidden="true" style="top: 30px"></div>
        <div class="fr-rule" aria-hidden="true" style="top: 60px"></div>
        <div class="fr-rule" aria-hidden="true" style="bottom: 30px"></div>
        <div class="fr-dropin">
          <div class="fr-droptitle">Drop statements here</div>
          <p class="fr-dropnote">CSV, spreadsheet, text or HTML exports, from any bank, in any language and currency.</p>
          <label class="fr-choose">Choose files<input class="fr-files" type="file" multiple accept="${ACCEPT}"></label>
        </div>
      </div>
      <div class="fr-notes">
        <p>Your statements stay in this browser. Nothing is uploaded, and nothing goes to an assistant unless you press a button.</p>
        <p>More months tell a better story. Most banks let you export three to twelve months in one file.</p>
      </div>
    </div>
    <aside class="fr-example" aria-label="An example year">
      <div class="fr-kicker">Not ready yet?</div>
      <h2 class="fr-h2">See an example year</h2>
      <p class="fr-exnote">Sam is made up. Sam’s year has a car repair, a house move and a holiday in it, so you can see what the story does before you add your own.</p>
      ${stripHTML(exampleYear())}
      <button class="fr-open" type="button">Open Sam’s year</button>
      <p class="fr-fine">The example is fictional. It stays separate from your own statements and disappears when you add them.</p>
    </aside>
  </div>
  <section class="fr-grows" aria-label="What appears as you add statements">
    <h2 class="fr-h2">What appears as you add statements</h2>
    <div class="fr-grid">
      <div class="fr-card"><div class="fr-cardtitle">One month</div><div class="fr-cardtext">The shape of your month: busy days and weeks, and where the money went.</div></div>
      <div class="fr-card"><div class="fr-cardtitle">Two months</div><div class="fr-cardtext">How one month compares with the one before.</div></div>
      <div class="fr-card"><div class="fr-cardtitle">Three months or more</div><div class="fr-cardtext">What a typical month looks like, and which payments repeat.</div></div>
      <div class="fr-card"><div class="fr-cardtitle">A year</div><div class="fr-cardtext">Your year on one line, and the stretches that stood out.</div></div>
    </div>
  </section>
</main>`;
  }

  function defineFirstRun() {
    if (customElements.get("tx-first-run")) return;
    customElements.define(
      "tx-first-run",
      class extends HTMLElement {
        connectedCallback() {
          if (this.wired) return;
          this.wired = true;
          this.innerHTML = String(pageHTML());
          // Measured whenever the strip gets its size, including when the
          // page is first shown.
          const line = this.querySelector(".fr-moments");
          if (line) new ResizeObserver(() => fitMoments(line)).observe(line);
          this.addEventListener("change", (e) => {
            if (!e.target.matches(".fr-files")) return;
            const files = [...e.target.files];
            e.target.value = "";
            if (files.length)
              this.dispatchEvent(
                new CustomEvent("tx-import-files", {
                  bubbles: true,
                  detail: { files },
                }),
              );
          });
          this.addEventListener("click", (e) => {
            if (e.target.closest(".fr-open"))
              this.dispatchEvent(
                new CustomEvent("tx-open-example", { bubbles: true }),
              );
          });
        }
      },
    );
  }

  return { defineFirstRun };
}

export const contract = {
  name: "tx-first-run",
  create: createFirstRunComponent,
  provides: ["defineFirstRun"],
  requires: [],
  renders: [],
  wires: ["defineFirstRun"],
};
