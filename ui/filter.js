import { $, debounce, esc, fmt } from "../helpers.js";

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
    const sum = runtime.derived.txns.reduce((a, t) => a + t.amount, 0);
    const qi = $("#qInfo");
    if (!q) qi.innerHTML = "";
    else if (!qi.querySelector("#qTagForm input:focus")) {
      qi.innerHTML = `${runtime.derived.txns.length} of ${runtime.derived.allTxns.length} match, ${fmt(sum, 0)}${
        runtime.derived.txns.length
          ? ` · <span id="qTagForm"><input placeholder="#tag" aria-label="Tag everything that matches" list="allTags2"><datalist id="allTags2">${Object.keys(
              runtime.derived.tags,
            )
              .map((t) => `<option value="${esc(t)}">`)
              .join(
                "",
              )}</datalist><button class="btn small quiet">Tag all ${runtime.derived.txns.length}</button></span>`
          : ""
      }`;
      const f = $("#qTagForm");
      if (f) {
        const inp = f.querySelector("input");
        const go = () => {
          const tags = actions.parseTags(inp.value);
          if (!tags.length) {
            inp.focus();
            return;
          }
          const ids = runtime.derived.txns.map((t) => t.id);
          actions.bulkTag(ids, tags, []);
        };
        f.querySelector("button").onclick = go;
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go();
          }
        });
      }
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
          `<button class="tag" data-tag="${esc(t)}" aria-pressed="${active.has(t)}" title="${n} note${n > 1 ? "s" : ""}" dir="auto">${esc(t)}</button>`,
      )
      .join("");
  }

  function wireFilter() {
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

  return { renderFilterBar, wireFilter, renders: [renderFilterBar] };
}
