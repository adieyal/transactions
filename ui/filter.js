import { debounce, fmtByCurrency } from "../helpers.js";
import { $, html } from "./dom.js";

export function createFilter(runtime, actions) {
  const { state } = runtime;
  function renderFilterBar() {
    const box = $("#searchBox"),
      q = state.query.trim();
    box.classList.toggle("on", !!q);
    $("#qClear").hidden = !q;
    if ($("#q").value !== state.query) $("#q").value = state.query;
    const has = state.loaded && runtime.derived?.allTxns?.length;
    $(".filterbar").style.display = has ? "" : "none";
    if (!has) return;
    const qi = $("#qInfo");
    if (!q) qi.innerHTML = "";
    else if (!qi.querySelector("#qTagForm input:focus")) {
      const n = runtime.derived.txns.length;
      const sums = n ? ", " + fmtByCurrency(runtime.derived.txns, 0) : "";
      qi.innerHTML = html`${n} of ${runtime.derived.allTxns.length} match${sums}${
        n
          ? html` · <span id="qTagForm"><input placeholder="#tag" aria-label="Tag everything that matches" list="allTags2"><datalist id="allTags2">${Object.keys(
              runtime.derived.tags,
            ).map(
              (t) => html`<option value="${t}">`,
            )}</datalist><button class="btn small quiet">Tag all ${n}</button></span>`
          : ""
      }`;
    }
    const active = new Set(
      q
        .toLowerCase()
        .split(/\s+/)
        .filter((x) => x.startsWith("#")),
    );
    $("#qTags").innerHTML = Object.entries(runtime.derived.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(
        ([t, n]) =>
          html`<button class="tag" data-tag="${t}" aria-pressed="${active.has(t)}" title="${n} note${n > 1 ? "s" : ""}" dir="auto">${t}</button>`,
      )
      .join("");
  }

  function wireFilter() {
    // "Tag all" beside the match count, which is redrawn as the filter changes.
    const tagAll = () => {
      const inp = $("#qTagForm input");
      const tags = actions.parseTags(inp.value);
      if (!tags.length) {
        inp.focus();
        return;
      }
      actions.bulkTag(
        runtime.derived.txns.map((t) => t.id),
        tags,
        [],
      );
    };
    $("#qInfo").addEventListener("click", (e) => {
      if (e.target.closest("#qTagForm button")) tagAll();
    });
    $("#qInfo").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.closest("#qTagForm input")) {
        e.preventDefault();
        tagAll();
      }
    });
    const input = $("#q");
    const redraw = debounce(() => {
      state.selection.clear();
      state.highlight = new Set();
      actions.refresh();
    }, 120);
    const apply = () => {
      state.query = input.value;
      redraw();
    };
    input.addEventListener("input", apply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        input.value = "";
        apply();
      }
    });
    $("#qClear").onclick = () => {
      input.value = "";
      apply();
      input.focus();
    };
    $("#qTags").onclick = (e) => {
      const b = e.target.closest("[data-tag]");
      if (!b) return;
      const t = b.dataset.tag;
      const parts = input.value.split(/\s+/).filter(Boolean);
      input.value = (
        parts.some((p) => p.toLowerCase() === t)
          ? parts.filter((p) => p.toLowerCase() !== t)
          : [...parts, t]
      ).join(" ");
      apply();
    };
    addEventListener("keydown", (e) => {
      if (
        e.key === "/" &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) &&
        !document.activeElement?.isContentEditable
      ) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  return { renderFilterBar, wireFilter };
}

export const contract = {
  name: "filter",
  create: createFilter,
  provides: ["renderFilterBar", "wireFilter"],
  requires: ["bulkTag", "parseTags", "refresh"],
  renders: ["renderFilterBar"],
  wires: ["wireFilter"],
};
