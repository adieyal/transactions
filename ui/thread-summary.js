import { MONTHS, esc, fmt, fmtByCurrency, monthName } from "../helpers.js";
import { $ } from "./dom.js";
import { summarizeThread } from "../story/thread-story.js";
import { dayShort, money } from "../story/copy.js";
import { phraseHTML } from "./highlight.js";
import { TRANSFERS } from "../transactions/constants.js";

// Clicking a thread's name on the timeline: a short summary, a month strip
// and every transaction blow by blow.
export function createThreadSummary(runtime, actions) {
  const { state } = runtime;

  function renderThreadInspector(el, name) {
    const derived = runtime.derived;
    const { sections, strips, items } = summarizeThread(derived, state, name);
    const color = derived.colorOf[name] || "var(--ink)";
    const rule = derived.R.threads.find((t) => t.name === name);
    const spent = items.filter((t) => !t.inflow);
    // One strip per currency, each scaled on its own.
    const stripOf = ({ currency, months }) => {
      const max = Math.max(1, ...months.map((m) => Math.abs(m.total)));
      return months
        .map((m) => {
          const label = MONTHS[+m.month.slice(5) - 1];
          const bar = `<i style="height:${Math.max(m.count ? 3 : 0, Math.round((Math.abs(m.total) / max) * 44))}px;background:${color}"></i><b>${label}</b>`;
          return m.count
            ? `<span class="sp tm" tabindex="0" data-ids="${esc(m.txnIds.join(","))}" title="${esc(`${monthName(m.month)} · ${m.count} · ${money(m.total, currency)}`)}">${bar}</span>`
            : `<span class="tm" title="${esc(monthName(m.month))} · nothing">${bar}</span>`;
        })
        .join("");
    };
    const blow = items
      .map((t) => {
        const context = [
          ...t.periods.map((p) => `During “${esc(p)}”`),
          ...(t.note
            ? [`<span class="bw-note" dir="auto">${esc(t.note)}</span>`]
            : []),
        ].join(" · ");
        return `<li class="sp" tabindex="0" data-ids="${esc(t.id)}"><span class="bw-date">${dayShort(t.date)} ${t.date.slice(0, 4)}</span><span class="bw-m" dir="auto">${esc(t.merchant)}</span><span class="bw-a">${fmt(t.amount, 0, t.currency)}</span>${context ? `<span class="bw-ctx">${context}</span>` : ""}</li>`;
      })
      .join("");
    el.innerHTML = `<div class="ins-grid"><div>
        <div class="ins-label">Thread</div>
        <div class="tname" dir="auto" style="color:${color}">${esc(name)}</div>
        <div class="sub">${items.length} transaction${items.length === 1 ? "" : "s"}${name === TRANSFERS ? "" : ` · ${spent.length ? fmtByCurrency(spent, 0) : ""}`}${rule?.budget != null && strips.length === 1 ? ` · budget ${money(rule.budget, strips[0].currency)} a month` : rule?.budget != null ? ` · budget ${rule.budget} a month in each currency` : ""}</div>
        <div class="tsum">${sections
          .map(
            (s) =>
              `<p dir="auto">${s.parts.map((p) => phraseHTML(p, esc)).join("")}</p>`,
          )
          .join("")}</div>
        ${strips.map((s) => `<div class="tstrip" aria-label="Month by month${strips.length > 1 ? `, ${esc(s.currency)}` : ""}">${stripOf(s)}</div>`).join("")}
        <div class="row-actions">${rule ? `<button class="btn small quiet" id="tRules">Edit rules</button>` : ""}<button class="btn small quiet" id="tClose">Close</button></div>
      </div><div>
        <div class="ins-label">Blow by blow</div>
        ${items.length ? `<ol class="blow">${blow}</ol>` : `<p class="sub">Nothing in this thread yet.</p>`}
      </div></div>`;
    $("#tRules")?.addEventListener("click", () =>
      actions.selectRuleLine(rule.line),
    );
    $("#tClose").onclick = () => {
      state.threadSel = null;
      state.highlight = new Set();
      actions.refresh();
    };
  }

  return { renderThreadInspector };
}

export const contract = {
  name: "thread-summary",
  create: createThreadSummary,
  provides: ["renderThreadInspector"],
  requires: ["refresh", "selectRuleLine"],
  renders: [],
  wires: [],
};
