import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { linter, lintGutter } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { $, debounce, esc } from "../helpers.js";
import {
  ARRAY_METHODS,
  LIB_MEMBERS,
  TXN_FIELDS,
  VIEW_KINDS,
} from "../lens-api.js";

// Colours come from CSS variables so the editor follows light and dark themes.
const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.operatorKeyword,
    ],
    color: "var(--syn-kw)",
  },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-str)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syn-num)" },
  { tag: tags.comment, color: "var(--syn-com)", fontStyle: "italic" },
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: "var(--syn-prop)",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syn-fn)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--syn-def)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    background: "var(--panel)",
    color: "var(--ink)",
  },
  ".cm-scroller": { fontFamily: "var(--code)", lineHeight: "1.55" },
  ".cm-gutters": {
    background: "var(--panel)",
    color: "var(--ink-3)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    background: "color-mix(in srgb, var(--wire) 18%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--focus) 28%, transparent)",
  },
  ".cm-tooltip": {
    background: "var(--raised)",
    border: "1px solid var(--wire)",
    color: "var(--ink)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    background: "var(--focus)",
    color: "#fff",
  },
  ".cm-completionInfo": {
    maxWidth: "320px",
    fontFamily: "var(--ui)",
    fontSize: "12.5px",
  },
  // Find and replace (Ctrl+F), styled like the rest of the app.
  ".cm-panels": {
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--ui)",
  },
  ".cm-panels-bottom": { borderTop: "1px solid var(--grid)" },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px 8px",
    padding: "10px 40px 10px 14px",
    fontSize: "13px",
  },
  ".cm-search br": { flexBasis: "100%", height: 0, content: '""' },
  ".cm-textfield": {
    font: "13px var(--code)",
    color: "var(--ink)",
    background: "var(--raised)",
    border: "1px solid var(--wire)",
    borderRadius: "6px",
    padding: "4px 8px",
    margin: 0,
    width: "220px",
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "var(--focus)" },
  ".cm-button": {
    font: "500 13px var(--ui)",
    color: "var(--ink)",
    backgroundImage: "none",
    background: "transparent",
    border: "1px solid var(--wire)",
    borderRadius: "6px",
    padding: "3px 10px",
    margin: 0,
    textTransform: "none",
    cursor: "pointer",
  },
  ".cm-button:hover": { borderColor: "var(--ink-3)" },
  ".cm-button:active": { backgroundImage: "none", background: "var(--grid)" },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "13px",
    color: "var(--ink-2)",
    margin: 0,
  },
  ".cm-search label input": { margin: 0, accentColor: "var(--focus)" },
  ".cm-search button[name=close]": {
    top: "8px",
    right: "10px",
    width: "26px",
    height: "26px",
    borderRadius: "6px",
    fontSize: "18px",
    color: "var(--ink-3)",
    cursor: "pointer",
  },
  ".cm-search button[name=close]:hover": {
    background: "var(--grid)",
    color: "var(--ink)",
  },
});

const option = (m, type) => ({
  label: m.name,
  type,
  detail: m.type || (m.sig !== m.name ? m.sig : ""),
  info: m.doc,
});

// Suggests lib members after "lib.", array methods after "txns." and other
// arrays, transaction fields after any other "x.", and view kinds in strings.
function lensCompletions(ctx) {
  const kind = ctx.matchBefore(/kind:\s*["'][\w]*$/);
  if (kind) {
    const word = ctx.matchBefore(/[\w]*$/);
    return {
      from: word.from,
      options: VIEW_KINDS.map((v) => ({
        label: v.kind,
        type: "enum",
        detail: v.shape,
        info: v.doc,
      })),
    };
  }
  const member = ctx.matchBefore(/([\w$]+)\.([\w$]*)$/);
  if (member) {
    const obj = member.text.split(".")[0];
    const from = member.from + obj.length + 1;
    if (obj === "lib")
      return {
        from,
        options: LIB_MEMBERS.map((m) =>
          option(m, m.sig.includes("(") ? "function" : "property"),
        ),
      };
    if (
      [
        "txns",
        "expected",
        "transfers",
        "threads",
        "accounts",
        "periods",
      ].includes(obj) ||
      /s$/.test(obj)
    )
      return { from, options: ARRAY_METHODS.map((m) => option(m, "method")) };
    return { from, options: TXN_FIELDS.map((m) => option(m, "property")) };
  }
  const word = ctx.matchBefore(/[\w$]+$/);
  if (!word && !ctx.explicit) return null;
  return {
    from: word ? word.from : ctx.pos,
    options: [
      {
        label: "txns",
        type: "variable",
        detail: "array",
        info: "Your transactions, after the filter and account choices.",
      },
      {
        label: "lib",
        type: "variable",
        detail: "helpers",
        info: "sum, groupBy, month, fmt, expected, periods, budgets and more.",
      },
    ],
  };
}

// Marks the places the parser could not read, with the browser's own message.
function syntaxProblems(view) {
  const code = view.state.doc.toString();
  let message = null;
  try {
    new Function("txns", "lib", code);
  } catch (e) {
    message = e.message;
  }
  if (!message) return [];
  const found = [];
  syntaxTree(view.state).iterate({
    enter: (n) => {
      if (n.type.isError && found.length < 3) {
        const from = Math.min(n.from, code.length);
        found.push({
          from,
          to: Math.min(Math.max(n.to, from + 1), code.length),
          severity: "error",
          message,
        });
      }
    },
  });
  if (!found.length)
    found.push({
      from: 0,
      to: Math.min(1, code.length),
      severity: "error",
      message,
    });
  return found;
}

export function createLensEditor(runtime, actions) {
  const { state } = runtime;
  let view = null,
    lensId = null;

  const lens = () => state.lenses.find((l) => l.id === lensId);

  function renderReference() {
    const row = (name, detail, doc) =>
      `<li><button class="ref-ins" data-ins="${esc(name)}"><code>${esc(name)}</code></button>${detail ? ` <span class="ref-t">${esc(detail)}</span>` : ""}<div class="ref-d">${esc(doc)}</div></li>`;
    return `<details open><summary><code>txns</code> · each transaction <code>t</code></summary><ul>${TXN_FIELDS.map((f) => row(f.name, f.type, f.doc)).join("")}</ul></details>
      <details open><summary><code>lib</code> · helpers and context</summary><ul>${LIB_MEMBERS.map((m) => row("lib." + m.name, m.sig.includes("(") ? m.sig : "", m.doc)).join("")}</ul></details>
      <details open><summary>Return one of these views</summary><ul>${VIEW_KINDS.map((v) => `<li><code>${esc(v.shape)}</code><div class="ref-d">${esc(v.doc)}</div></li>`).join("")}</ul></details>`;
  }

  function renderPreview() {
    const l = lens();
    if (!l) return;
    let html = "",
      err = null,
      syntax = false;
    try {
      html = actions.renderView(actions.runLens(l.code));
    } catch (e) {
      err = e.message || String(e);
      syntax = e instanceof SyntaxError;
    }
    $("#lensPreview").innerHTML = err
      ? `<div class="err">${esc(err)}</div>`
      : html;
    $("#lensStatus").textContent = !err
      ? "Runs"
      : syntax
        ? "Syntax error, marked in the code"
        : "Error when running";
    $("#lensStatus").className = "lens-status " + (err ? "bad" : "ok");
  }

  const update = debounce(() => {
    const l = lens();
    if (!l) return;
    l.code = view.state.doc.toString();
    actions.save("lenses");
    renderPreview();
    actions.rerunLens(l.id);
  }, 250);

  function openLensEditor(id) {
    const l = state.lenses.find((x) => x.id === id);
    if (!l) return;
    lensId = id;
    const dlg = $("#lensDlg");
    $("#lensTitle").value = l.title;
    $("#lensRef").innerHTML = renderReference();
    view?.destroy();
    view = new EditorView({
      doc: l.code,
      parent: $("#lensCode"),
      extensions: [
        basicSetup,
        EditorState.phrases.of({
          next: "Next",
          previous: "Previous",
          all: "All",
          "match case": "Match case",
          regexp: "Regex",
          "by word": "Whole word",
          replace: "Replace",
          "replace all": "Replace all",
          close: "Close",
        }),
        keymap.of([indentWithTab]),
        javascript(),
        javascriptLanguage.data.of({ autocomplete: lensCompletions }),
        syntaxHighlighting(highlight),
        theme,
        lintGutter(),
        linter(syntaxProblems, { delay: 300 }),
        EditorView.updateListener.of((u) => u.docChanged && update()),
      ],
    });
    renderPreview();
    dlg.showModal();
    view.focus();
  }

  function closeLensEditor() {
    const l = lens();
    if (l && view) {
      l.code = view.state.doc.toString();
      actions.save("lenses");
    }
    view?.destroy();
    view = null;
    lensId = null;
    $("#lensDlg").close();
    actions.renderLenses();
  }

  function wireLensEditor() {
    const dlg = $("#lensDlg");
    $("#lensDone").onclick = closeLensEditor;
    dlg.addEventListener("cancel", (e) => {
      // Escape first closes an open autocomplete list; only then the dialog.
      if (dlg.querySelector(".cm-tooltip-autocomplete")) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      closeLensEditor();
    });
    $("#lensTitle").addEventListener("input", () => {
      const l = lens();
      if (!l) return;
      l.title = $("#lensTitle").value.trim() || "Untitled lens";
      actions.save("lenses");
      actions.rerunLens(l.id);
    });
    $("#lensRef").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ins]");
      if (!b || !view) return;
      view.dispatch(view.state.replaceSelection(b.dataset.ins));
      view.focus();
    });
  }

  return { openLensEditor, wireLensEditor };
}
