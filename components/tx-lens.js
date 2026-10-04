import { html, raw } from "../ui/dom.js";
import { sameIds } from "../ui/highlight.js";
import { emitHighlight, subscribeWhileConnected } from "./base.js";

// <tx-lens lens="…">: one lens's view, run in the sandbox on the derived
// transactions as they are now. With `titled` it shows the lens's title too.
// Clicking a bar or row asks for a highlight with tx-highlight; each run ends
// with a tx-lens-ran event saying whether it failed. Draws only inside
// itself (ADR 0009).
export function createLensComponent(runtime, actions) {
  const { state } = runtime;

  function defineLens() {
    if (customElements.get("tx-lens")) return;
    customElements.define(
      "tx-lens",
      class extends HTMLElement {
        static observedAttributes = ["lens"];
        constructor() {
          super();
          this.ran = null;
          this.generation = 0;
          this.wired = false;
        }
        connectedCallback() {
          if (!this.wired) this.wire();
          subscribeWhileConnected(this, runtime.store, (change) =>
            change === "highlight" ? this.mark() : this.update(),
          );
          this.update();
        }
        attributeChangedCallback() {
          if (this.isConnected) this.update();
        }
        // Runs the lens again when its code or the transactions changed.
        update() {
          if (!state.loaded || !runtime.derived || !this.checkVisibility())
            return;
          const id = this.getAttribute("lens");
          const l = state.lenses.find((x) => x.id === id);
          if (!l) {
            this.ran = null;
            this.innerHTML = html`<p class="sub">There's no lens called ${id ?? ""}.</p>`;
            return;
          }
          if (
            this.ran?.derived === runtime.derived &&
            this.ran.code === l.code &&
            this.ran.title === l.title
          )
            return;
          this.ran = { derived: runtime.derived, code: l.code, title: l.title };
          this.run(l);
        }
        async run(l) {
          const run = ++this.generation;
          const title = this.hasAttribute("titled")
            ? html`<h3 dir="auto">${l.title}</h3>`
            : "";
          if (!this.querySelector(".lensview"))
            this.innerHTML = html`${title}<div class="lensview"><p class="sub">Running…</p></div>`;
          let body = "",
            error = null;
          try {
            body = actions.renderView(await actions.runLens(l.code));
          } catch (e) {
            error = e.message || String(e);
          }
          if (run !== this.generation) return;
          this.innerHTML = html`${title}<div class="lensview">${raw(body)}${
            error ? html`<div class="err">${error}</div>` : ""
          }</div>`;
          this.mark();
          this.dispatchEvent(
            new CustomEvent("tx-lens-ran", {
              bubbles: true,
              detail: { lens: l.id, error },
            }),
          );
        }
        // Bars and rows whose transactions are lit up on the timeline.
        mark() {
          this.querySelectorAll("[data-ids]").forEach((b) =>
            b.classList.toggle(
              "on",
              sameIds(
                b.dataset.ids ? b.dataset.ids.split(",") : [],
                state.highlight,
              ),
            ),
          );
        }
        wire() {
          this.wired = true;
          this.addEventListener("click", (e) => {
            const b = e.target.closest("[data-ids]");
            if (!b) return;
            const ids = b.dataset.ids ? b.dataset.ids.split(",") : [];
            emitHighlight(this, sameIds(ids, state.highlight) ? [] : ids, {
              clearSelection: true,
            });
          });
        }
      },
    );
  }

  return { defineLens };
}

export const contract = {
  name: "tx-lens",
  create: createLensComponent,
  provides: ["defineLens"],
  requires: ["renderView", "runLens"],
  renders: [],
  wires: ["defineLens"],
};
