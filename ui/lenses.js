import { debounce, esc, fmt, monthName } from "../helpers.js";
import { $, benchHidden, html, paneShown, toast } from "./dom.js";
import { lensInput, viewProblem } from "../lens-api.js";
import { newLensSandbox } from "./lens-sandbox.js";
import {
  addLens,
  editLens,
  removeLens,
  restoreStarterLenses as restore,
} from "../model/index.js";

export function createLenses(runtime, actions) {
  const { state, caps } = runtime;
  // A lens runs in the sandbox (ui/lens-sandbox.js), on the derived
  // transactions as they are now. The frame is made on first use.
  let sandbox = null;
  const runLens = (code) =>
    (sandbox ||= newLensSandbox()).run(
      code,
      lensInput(runtime.derived, state, runtime.today),
    );

  // A lens value in the currency it names, or the workspace's only one. With
  // several currencies and none named, it is shown as a plain number.
  function amount(value, currency) {
    const all = [...new Set(runtime.derived.allTxns.map((t) => t.currency))];
    const c = currency ?? (all.length === 1 ? all[0] : null);
    return c ? fmt(value, 0, c) : Math.round(value).toLocaleString("en-US");
  }

  function renderView(v) {
    const problem = viewProblem(v);
    if (problem) throw new Error(problem);
    if (v.kind === "bars") {
      const items = (v.items || []).slice(0, 40);
      const max = Math.max(1e-9, ...items.map((i) => Math.abs(+i.value || 0)));
      if (!items.length) return `<p class="sub">Nothing to show yet.</p>`;
      return `<div class="bars">${items.map((i) => `<button class="bar" data-ids="${esc((i.ids || []).join(","))}"><span class="l" dir="auto">${esc(/^\d{4}-\d{2}$/.test(i.label) ? monthName(i.label) : i.label)}</span><span class="t"><i style="width:${((Math.abs(+i.value || 0) / max) * 100).toFixed(1)}%"></i></span><span class="v">${v.unit === "" ? esc(i.value) : esc(amount(+i.value || 0, i.currency))}</span></button>`).join("")}</div>`;
    }
    if (v.kind === "table") {
      const rows = (v.rows || []).slice(0, 60);
      const isNum = (c) =>
        typeof c === "number" ||
        /^\s*[−-]?\s*[^\d\s−-]{0,3}\s*[−-]?[\d.,]+\s*(%|×|x)?\s*$|^\d{4}-\d{2}(-\d{2})?$/.test(
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
      return `<div class="lnum"${v.ids ? ` data-ids="${esc(v.ids.join(","))}" style="cursor:pointer"` : ""}>${typeof v.value === "number" ? esc(amount(v.value, v.currency)) : esc(v.value)}</div><div class="sub">${esc(v.label || "")}</div>`;
    return `<p dir="auto" style="margin:0">${esc(v.text)}</p>`;
  }

  function renderLenses() {
    if (benchHidden(state) || !paneShown("lenses")) return;
    const el = $("#lenses");
    if (!state.loaded || !runtime.derived.allTxns.length) {
      el.innerHTML = "";
      return;
    }
    let h = `<p class="lead">Small programs over your transactions. Click a bar or row to light up its beads on the timeline.${runtime.derived.filtered ? ` <b>Showing only what matches the filter.</b>` : ""}</p><div class="lens-grid">`;
    state.lenses.forEach((l) => {
      h += `<article class="lens" data-lens="${l.id}"><h3><span contenteditable="true" spellcheck="false" data-title="${l.id}">${esc(l.title)}</span></h3>${l.fromBackup ? `<p class="lensfrom">From your backup</p>` : ""}<tx-lens class="lensbody" lens="${esc(l.id)}"></tx-lens>
      <div class="foot"><button data-edit="${l.id}">Edit code</button>${caps.sample ? html`<button data-fix="${l.id}">Change with ${actions.AI()}</button>` : ""}<button data-del="${l.id}">Remove</button></div></article>`;
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
      // A bar or row: its <tx-lens> asks for the highlight itself.
      if (ev.target.closest("[data-ids]")) return;
      const t = ev.target.closest("[data-edit]");
      if (t) {
        actions.openLensEditor(t.dataset.edit);
        return;
      }
      const d = ev.target.closest("[data-del]");
      if (d) {
        const l = state.lenses.find((x) => x.id === d.dataset.del);
        if (!confirm(`Remove “${l.title}”?`)) return;
        actions.commit(removeLens(state, { id: l.id }), { refresh: "none" });
        renderLenses();
        return;
      }
      const f = ev.target.closest("[data-fix]");
      if (f) {
        const l = state.lenses.find((x) => x.id === f.dataset.fix);
        let err = null;
        try {
          await runLens(l.code);
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
          actions.commit(
            editLens(state, {
              id: l.id,
              code: r.code,
              title: r.title && !brief ? l.title || r.title : undefined,
            }),
            { refresh: "none" },
          );
        } catch (e) {
          toast(actions.sampleErr(e));
        }
        renderLenses();
        return;
      }
      if (ev.target.id === "lensBlank") {
        addBlankLens();
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
          const lens = {
            id: "l" + Date.now().toString(36),
            title: r.title || brief.slice(0, 40),
            code: r.code,
          };
          actions.commit(addLens(state, lens), { refresh: "none" });
          renderLenses();
        } catch (e) {
          $("#lensNote").textContent = actions.sampleErr(e);
          btn.disabled = false;
        }
      }
    });
    // Each card's lens says whether it ran, for its Fix button.
    el.addEventListener("tx-lens-ran", (ev) => {
      const fx = ev.target.closest(".lens")?.querySelector("[data-fix]");
      if (fx)
        fx.textContent =
          (ev.detail.error ? "Fix with " : "Change with ") + actions.AI();
    });
    el.addEventListener("input", (ev) => {
      const t = ev.target.closest("[data-title]");
      if (t) {
        const title = t.textContent.trim() || "Untitled lens";
        actions.commit(editLens(state, { id: t.dataset.title, title }), {
          refresh: "none",
        });
      }
    });
  }

  // Re-runs one lens card in place, e.g. while its code is being edited.
  const rerunLens = debounce((id) => {
    const art = $(`#lenses [data-lens="${CSS.escape(id)}"]`);
    const l = state.lenses.find((x) => x.id === id);
    if (!art || !l) return;
    art.querySelector("[data-title]").textContent = l.title;
    art.querySelector("tx-lens")?.update();
  }, 250);

  function addBlankLens() {
    const l = {
      id: "l" + Date.now().toString(36),
      title: "Untitled lens",
      code: `// txns: your transactions. lib: sum, groupBy, month, fmt, expected, threads.\nreturn { kind: "number", value: lib.sum(txns, t => t.amount), label: "Everything on your statements" };`,
    };
    actions.commit(addLens(state, l), { refresh: "none" });
    renderLenses();
    actions.refresh();
    actions.openLensEditor(l.id);
  }

  // Puts back any starter lens that was removed; the person's own stay.
  function restoreStarterLenses() {
    const change = actions.commit(restore(state), { refresh: "none" });
    if (!change) return toast("The starter lenses are all here.");
    renderLenses();
    actions.refresh();
  }

  return {
    addBlankLens,
    restoreStarterLenses,
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
    "addBlankLens",
    "restoreStarterLenses",
    "renderLenses",
    "renderView",
    "rerunLens",
    "runLens",
    "wireLenses",
  ],
  requires: [
    "AI",
    "openLensEditor",
    "commit",
    "refresh",
    "sampleErr",
    "writeLens",
  ],
  renders: ["renderLenses"],
  wires: ["wireLenses"],
};
