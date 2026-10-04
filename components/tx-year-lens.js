import { esc } from "../helpers.js";

// The bench's lens view (artboard 3): the lens's title, its code as written,
// a preview that runs it, and the drawn reference rows. Edit opens the full
// editor (ui/lens-editor.js), so nothing it can do is lost.

const REFERENCE = [
  ["id", "Unique id. Pass ids to a view to light up beads."],
  ["date", `"YYYY-MM-DD", the purchase date.`],
  [
    "merchant · original",
    "Display name, and the description exactly as on the statement.",
  ],
  ["amount", "Positive is money out; negative is a refund or money in."],
  ["thread · tags · note · period", "Your threads, tags, notes and periods."],
  ["lib.expected", "Charges that repeat, projected ahead."],
];

export function lensViewHTML(ui, runtime) {
  const l =
    ui.lensView && runtime.state.lenses.find((x) => x.id === ui.lensView);
  if (!l) return "";
  return `<dialog class="bn-lensview" aria-label="${esc(l.title)}">
    <div class="bn-lv-head">
      <h2 dir="auto">${esc(l.title)}</h2>
      <span class="bn-lv-hint">The body of a function (txns, lib) =&gt; view. Type lib. or t. for suggestions.</span>
      <button class="bn-small" data-lens-open-editor="${esc(l.id)}">Edit</button>
      <button class="bn-dark" data-lens-done>Done</button>
    </div>
    <div class="bn-lv-body">
      <pre class="bn-lv-code">${esc(l.code)}</pre>
      <div class="bn-lv-side">
        <div class="bn-lv-label"><span>Preview</span><span class="bn-lv-status"></span></div>
        <tx-lens lens="${esc(l.id)}"></tx-lens>
        <h3>txns · each transaction t</h3>
        <dl>${REFERENCE.map(([dt, dd]) => `<dt>${esc(dt)}</dt><dd>${esc(dd)}</dd>`).join("")}</dl>
      </div>
    </div>
  </dialog>`;
}

// Opens the view after each draw; Escape closes it.
export function showLensView(host, ui) {
  const dlg = host.querySelector("dialog.bn-lensview");
  if (!dlg || dlg.open) return;
  dlg.showModal();
  // The preview skips runs while hidden, so it runs once the view is open.
  dlg.querySelector("tx-lens")?.update();
  dlg.addEventListener("close", () => (ui.lensView = null), { once: true });
}

// The preview's status, as the editor words it.
export function wireLensView(host) {
  host.addEventListener("tx-lens-ran", (e) => {
    const status = e.target
      .closest(".bn-lensview")
      ?.querySelector(".bn-lv-status");
    if (!status) return;
    status.textContent = e.detail.error ? "Error when running" : "Runs";
    status.classList.toggle("bad", !!e.detail.error);
  });
}

// Returns true when the click was the lens view's.
export function lensViewClick(d, ui, actions) {
  if (d.lensEdit) ui.lensView = d.lensEdit;
  else if ("lensDone" in d) ui.lensView = null;
  else if (d.lensOpenEditor) {
    ui.lensView = null;
    actions.openLensEditor(d.lensOpenEditor);
  } else return false;
  return true;
}
