import { debounce, esc, fmt, monthName } from "../helpers.js";
import { $, html, paneShown, toast } from "./dom.js";
import { runLens as runLensCode } from "../lens-api.js";

export function createLenses(runtime, actions) {
  const { state, caps } = runtime;
  // A lens runs on the derived transactions as they are now.
  const runLens = (code) =>
    runLensCode(code, runtime.derived, state, runtime.today);

  function renderView(v) {
    if (v.kind === "bars") {
      const items = (v.items || []).slice(0, 40);
      const max = Math.max(1e-9, ...items.map((i) => Math.abs(+i.value || 0)));
      if (!items.length) return `<p class="sub">Nothing to show yet.</p>`;
      return `<div class="bars">${items.map((i) => `<button class="bar" data-ids="${esc((i.ids || []).join(","))}"><span class="l" dir="auto">${esc(/^\d{4}-\d{2}$/.test(i.label) ? monthName(i.label) : i.label)}</span><span class="t"><i style="width:${((Math.abs(+i.value || 0) / max) * 100).toFixed(1)}%"></i></span><span class="v">${v.unit === "" ? esc(i.value) : fmt(+i.value || 0, 0)}</span></button>`).join("")}</div>`;
    }
    if (v.kind === "table") {
      const rows = (v.rows || []).slice(0, 60);
      const isNum = (c) =>
        typeof c === "number" ||
        /^\s*[−-]?\s*[₪$€£]?\s*[−-]?[\d.,]+\s*(%|×|x)?\s*$|^\d{4}-\d{2}(-\d{2})?$/.test(
          String(c ?? ""),
        );
      const numCol = (v.columns || []).map(
        (_, j) =>
          rows.length &&
          rows.every((r) => r[j] == null || r[j] === "" || isNum(r[j])),
      );
      const cell = (c, j) =>
        `<td${numCol[j] || isNum(c) ? ` class="num"` : ` dir="auto"`}>${esc(typeof c === "number" ? (Number.isInteger(c) ? c : c.toFixed(2)) : c)}</td>`;
      return `<div class="scroll"><table class="ltable"><thead><tr>${(v.columns || []).map((c, j) => `<th${numCol[j] ? ` class="num"` : ""}>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr${v.rowIds?.[i] ? ` data-ids="${esc(v.rowIds[i].join(","))}"` : ""}>${r.map(cell).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    if (v.kind === "number")
      return `<div class="lnum"${v.ids ? ` data-ids="${esc(v.ids.join(","))}" style="cursor:pointer"` : ""}>${typeof v.value === "number" ? fmt(v.value, 0) : esc(v.value)}</div><div class="sub">${esc(v.label || "")}</div>`;
    if (v.kind === "text")
      return `<p dir="auto" style="margin:0">${esc(v.text)}</p>`;
    throw new Error(
      `Unknown view kind “${v.kind}”. Use bars, table, number or text.`,
    );
  }

  function renderLenses() {
    if (!paneShown("lenses")) return;
    const el = $("#lenses");
    if (!state.loaded || !runtime.derived.allTxns.length) {
      el.innerHTML = "";
      return;
    }
    let h = `<p class="lead">Small programs over your transactions. Click a bar or row to light up its beads on the timeline.${runtime.derived.filtered ? ` <b>Showing only what matches the filter.</b>` : ""}</p><div class="lens-grid">`;
    state.lenses.forEach((l) => {
      let body,
        err = null,
        view = null;
      try {
        view = runLens(l.code);
        body = renderView(view);
      } catch (e) {
        err = e.message || String(e);
        body = "";
      }
      h += `<article class="lens" data-lens="${l.id}"><h3><span contenteditable="true" spellcheck="false" data-title="${l.id}">${esc(l.title)}</span></h3>${body}${err ? `<div class="err">${esc(err)}</div>` : ""}
      <div class="foot"><button data-edit="${l.id}">Edit code</button>${caps.sample ? html`<button data-fix="${l.id}">${err ? "Fix with " : "Change with "}${actions.AI()}</button>` : ""}<button data-del="${l.id}">Remove</button></div></article>`;
    });
    h += `<div class="newlens">${
      caps.sample
        ? `${html`<label class="sub" for="lensBrief">Describe a new lens and ${actions.AI()} will write it. You can read and edit the result.</label>`}<textarea id="lensBrief" placeholder="e.g. Pet costs month by month, vet vs everything else"></textarea><div class="row-actions" style="margin:0"><button class="btn small" id="lensGo">Write the lens</button><span class="sub" id="lensNote"></span></div>`
        : `<p class="sub" style="margin:0">No AI assistant is set up here (see More → AI assistant settings), but you can still write lenses by hand.</p>`
    }<button class="btn small quiet" id="lensBlank">Start a blank lens</button></div></div>`;
    el.innerHTML = h;
  }

  function wireLenses() {
    const el = $("#lenses");
    el.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-ids]");
      if (b) {
        const ids = b.dataset.ids ? b.dataset.ids.split(",") : [];
        const same =
          ids.length &&
          ids.length === state.highlight.size &&
          ids.every((i) => state.highlight.has(i));
        actions.highlight(same ? [] : ids, { clearSelection: true });
        el.querySelectorAll(".bar.on,tr.on").forEach((x) =>
          x.classList.remove("on"),
        );
        if (!same) b.classList.add("on");
        return;
      }
      const t = ev.target.closest("[data-edit]");
      if (t) {
        actions.openLensEditor(t.dataset.edit);
        return;
      }
      const d = ev.target.closest("[data-del]");
      if (d) {
        const l = state.lenses.find((x) => x.id === d.dataset.del);
        if (!confirm(`Remove “${l.title}”?`)) return;
        state.lenses = state.lenses.filter((x) => x !== l);
        actions.save("lenses");
        renderLenses();
        return;
      }
      const f = ev.target.closest("[data-fix]");
      if (f) {
        const l = state.lenses.find((x) => x.id === f.dataset.fix);
        let err = null;
        try {
          runLens(l.code);
        } catch (e) {
          err = e.message;
        }
        const brief = err ? null : prompt("What should change?", "");
        if (!err && !brief) return;
        f.textContent = actions.AI() + " is working…";
        f.disabled = true;
        try {
          const r = await actions.writeLens(brief || l.title, {
            code: l.code,
            error: err,
            change: brief,
          });
          l.code = r.code;
          if (r.title && !brief) l.title = l.title || r.title;
          actions.save("lenses");
        } catch (e) {
          toast(actions.sampleErr(e));
        }
        renderLenses();
        return;
      }
      if (ev.target.id === "lensBlank") {
        const l = {
          id: "l" + Date.now().toString(36),
          title: "Untitled lens",
          code: `// txns: your transactions. lib: sum, groupBy, month, fmt, expected, threads.\nreturn { kind: "number", value: lib.sum(txns, t => t.amount), label: "Everything on your statements" };`,
        };
        state.lenses.push(l);
        actions.save("lenses");
        renderLenses();
        actions.openLensEditor(l.id);
        return;
      }
      if (ev.target.id === "lensGo") {
        const brief = $("#lensBrief").value.trim();
        if (!brief) {
          $("#lensBrief").focus();
          return;
        }
        const btn = ev.target;
        btn.disabled = true;
        $("#lensNote").textContent =
          actions.AI() + " is writing it. This can take up to a minute.";
        try {
          const r = await actions.writeLens(brief);
          const l = {
            id: "l" + Date.now().toString(36),
            title: r.title || brief.slice(0, 40),
            code: r.code,
          };
          state.lenses.push(l);
          actions.save("lenses");
          renderLenses();
        } catch (e) {
          $("#lensNote").textContent = actions.sampleErr(e);
          btn.disabled = false;
        }
      }
    });
    el.addEventListener("input", (ev) => {
      const t = ev.target.closest("[data-title]");
      if (t) {
        const l = state.lenses.find((x) => x.id === t.dataset.title);
        l.title = t.textContent.trim() || "Untitled lens";
        actions.save("lenses");
      }
    });
  }

  // Re-runs one lens card in place, e.g. while its code is being edited.
  const rerunLens = debounce((id) => {
    const art = $(`#lenses [data-lens="${id}"]`);
    const l = state.lenses.find((x) => x.id === id);
    if (!art || !l) return;
    let body = "",
      err = null;
    try {
      body = renderView(runLens(l.code));
    } catch (e) {
      err = e.message || String(e);
    }
    art
      .querySelectorAll(
        ".bars,.ltable,.lnum,.lnum+.sub,.err,article>p,article>div[style]",
      )
      .forEach((n) => n.remove());
    art
      .querySelector("h3")
      .insertAdjacentHTML(
        "afterend",
        body + (err ? `<div class="err">${esc(err)}</div>` : ""),
      );
    art.querySelector("[data-title]").textContent = l.title;
    const fx = art.querySelector("[data-fix]");
    if (fx)
      fx.textContent = err
        ? "Fix with " + actions.AI()
        : "Change with " + actions.AI();
  }, 250);

  return {
    renderLenses,
    renderView,
    rerunLens,
    runLens,
    wireLenses,
  };
}

export const contract = {
  name: "lenses",
  create: createLenses,
  provides: [
    "renderLenses",
    "renderView",
    "rerunLens",
    "runLens",
    "wireLenses",
  ],
  requires: [
    "AI",
    "highlight",
    "openLensEditor",
    "sampleErr",
    "save",
    "writeLens",
  ],
  renders: ["renderLenses"],
  wires: ["wireLenses"],
};
