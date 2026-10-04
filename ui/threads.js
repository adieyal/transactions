import { esc, fmtShort } from "../helpers.js";
import { $, html, paneShown } from "./dom.js";

export function createThreads(runtime, actions) {
  const { state } = runtime;
  function renderEditor() {
    if (!paneShown("threads")) return;
    const ta = $("#rules");
    const text = state.previewRules ?? state.rules;
    if (ta.value !== text) ta.value = text;
    ta.readOnly = state.previewRules != null;
    $("#editor").classList.toggle("preview", state.previewRules != null);
    $("#previewbar").classList.toggle("on", state.previewRules != null);
    $("#previewmsg").innerHTML =
      state.previewRules != null
        ? html`<b>${actions.AI()}'s suggestion is showing on the timeline.</b> ${state.previewSummary}`
        : "";
    const lines = text.split("\n");
    const counts = {};
    for (const [ln, ts] of Object.entries(runtime.derived?.lineHits || {}))
      counts[ln] = ts.length;
    const threadAt = {};
    (runtime.derived?.R.threads || []).forEach((t) => (threadAt[t.line] = t));
    const tsByThread = {};
    (runtime.derived?.txns || []).forEach((t) =>
      (tsByThread[t.thread] ||= []).push(t),
    );
    let g = "";
    lines.forEach((l, i) => {
      const err = runtime.derived?.R.errors[i];
      if (err) g += `<div class="bad" title="${esc(err)}">!</div>`;
      else if (threadAt[i]) {
        const ts = tsByThread[threadAt[i].name] || [];
        const sum = ts
          .filter((t) => !t.inflow)
          .reduce((a, t) => a + t.amount, 0);
        g += `<div class="th" title="${ts.length} transactions">${ts.length ? fmtShort(sum) : "–"}</div>`;
      } else if (/^\s+\S/.test(l) && !l.trim().startsWith("//"))
        g += `<div class="${counts[i] ? "" : "zero"}">${counts[i] || 0}</div>`;
      else g += `<div></div>`;
    });
    $("#gutter").innerHTML = g;
    syncGutter();
  }

  function syncGutter() {
    $("#gutter").style.transform = `translateY(${-$("#rules").scrollTop}px)`;
  }

  function selectRuleLine(line, count = 1) {
    actions.openTab("threads");
    const ta = $("#rules");
    const lines = ta.value.split("\n");
    let s = 0;
    for (let i = 0; i < line; i++) s += lines[i].length + 1;
    let e = s;
    for (let i = line; i < Math.min(lines.length, line + count); i++)
      e += lines[i].length + 1;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(s, Math.max(s, e - 1));
    ta.scrollTop = Math.max(0, line * 22 - 80);
    syncGutter();
    caretHighlight();
  }

  function caretLine() {
    const ta = $("#rules");
    return ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
  }

  function caretHighlight() {
    if (document.activeElement !== $("#rules") || !runtime.derived) return;
    const ln = caretLine();
    const th = runtime.derived.R.threads.find((t) => t.line === ln);
    let ids = [];
    if (th)
      ids = [...runtime.derived.txns, ...runtime.derived.extras]
        .filter((t) => t.thread === th.name)
        .map((t) => t.id);
    else if (runtime.derived.lineHits[ln]) {
      const hit = new Set(runtime.derived.lineHits[ln].map((t) => t.key));
      ids = [...runtime.derived.txns, ...runtime.derived.extras]
        .filter(
          (t) => t.matchLine === ln || (t.kind !== "actual" && hit.has(t.key)),
        )
        .map((t) => t.id);
    }
    const same =
      ids.length === state.highlight.size &&
      ids.every((i) => state.highlight.has(i));
    if (!same) {
      actions.highlight(ids);
    }
  }

  return {
    caretHighlight,
    renderEditor,
    selectRuleLine,
    syncGutter,
  };
}

export const contract = {
  name: "threads",
  create: createThreads,
  provides: ["caretHighlight", "renderEditor", "selectRuleLine", "syncGutter"],
  requires: ["AI", "highlight", "openTab"],
  renders: ["renderEditor"],
  wires: [],
};
