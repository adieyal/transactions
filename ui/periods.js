import { esc, fmt, fmtByCurrency } from "../helpers.js";
import { $, html, toast } from "./dom.js";
import {
  addPeriod as add,
  editPeriod,
  removePeriod as remove,
} from "../model/index.js";
import { periodStats as statsFor } from "../transactions/period-stats.js";
import { periodNotes, summarizePeriod } from "../story/period-story.js";
import { dayShort } from "../story/copy.js";
import { phraseHTML } from "./highlight.js";
import { markdown } from "./markdown.js";
import { coverageText } from "../assistant/prompts.js";

export function createPeriods(runtime, actions) {
  const { state, caps } = runtime;
  const periodStats = (p) => statsFor(runtime.derived.allTxns, p);

  // The notes on the period's transactions: the person's words, shown as
  // written, each lighting up its transaction.
  function notesHTML(p) {
    const notes = periodNotes(runtime.derived, p, {
      regular: state.periodRegular,
    });
    if (!notes.length)
      return `<div class="ins-label">Your notes</div><p class="sub">No notes on these transactions yet. Click a bead to add one.</p>`;
    return `<div class="ins-label">Your notes</div><ul class="pnotes">${notes
      .map(
        (n) =>
          `<li><span class="sp" tabindex="0" data-ids="${esc(n.id)}"><span class="pn-when">${dayShort(n.date)}</span> <span dir="auto">${esc(n.merchant)}</span> ${fmt(n.amount, 0, n.currency)}</span><span class="pn-text" dir="auto">${esc(n.note)}</span></li>`,
      )
      .join("")}</ul>`;
  }

  function renderPeriodInspector(el, p) {
    const st = periodStats(p);
    const overl = state.periods.filter(
      (q) => q.id !== p.id && q.start <= p.end && q.end >= p.start,
    );
    const editing = state.storyEdit === p.id || !p.story;
    const max = Math.max(1, ...st.byThread.map((x) => x[1]));
    el.innerHTML = `<div class="ins-grid"><div>
      <input id="pName" class="pname" dir="auto" value="${esc(p.name)}" aria-label="Period name" style="border-bottom-color:${p.color}">
      <div class="row-actions" style="margin-top:6px"><label class="sub">From <input type="date" id="pStart" value="${p.start}"></label><label class="sub">to <input type="date" id="pEnd" value="${p.end}"></label></div>
      <p class="sub" style="margin:8px 0 4px">${st.days} day${st.days > 1 ? "s" : ""} · ${st.out.length} charges · ${fmtByCurrency(st.out, 0)} out in all${overl.length ? ` · overlaps <span dir="auto">${overl.map((q) => esc(q.name)).join(", ")}</span>` : ""}. Not everything in these dates has to belong; this is context.</p>
      ${
        st.byThread.length
          ? `<div class="bars" style="margin:6px 0">${st.byThread
              .slice(0, 6)
              .map(
                ([n, v, c]) =>
                  `<button class="bar" data-ids="${esc(
                    st.out
                      .filter((t) => t.thread === n && t.currency === c)
                      .map((t) => t.id)
                      .join(","),
                  )}"><span class="l" dir="auto">${esc(n)}</span><span class="t"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></span><span class="v">${fmt(v, 0, c)}</span></button>`,
              )
              .join("")}</div>`
          : ""
      }
      ${st.biggest.length ? `<div class="sub" style="margin-top:6px">Biggest: ${st.biggest.map((t) => `<button class="cite" data-cite="${t.id}"><span dir="auto">${esc(t.merchant.slice(0, 22))}</span> ${fmt(t.amount, 0, t.currency)}</button>`).join(" ")}</div>` : ""}
    </div><div>
      <div class="ins-label">Your description <span class="sub">In your own words, if you like. Only you can see it.</span></div>
      ${
        editing
          ? `<textarea class="note story" id="pStory" dir="auto" placeholder="e.g. Moved into the new flat. Most of the Home Center and IKEA runs are furniture and fixing up.">${esc(p.story || "")}</textarea>`
          : `<div class="storyview" dir="auto">${markdown(p.story, runtime.derived.byId)}</div>`
      }
      <div class="row-actions">${!editing ? `<button class="btn small quiet" id="pEdit">Edit</button>` : ""}${caps.sample ? html`<button class="btn small quiet" id="pDraftStory">${p.story ? "Rework it with " : "Draft it with "}${actions.AI()}</button>` : ""}</div>
      <p class="sub" id="pNote"></p>
      <div class="ins-label">Summary</div>
      <div class="psum">${summarizePeriod(runtime.derived, state, p, {
        regular: state.periodRegular,
      })
        .map(
          (sec) =>
            `<p dir="auto">${sec.parts.map((x) => phraseHTML(x, esc)).join("")}</p>`,
        )
        .join("")}</div>
      <label class="pregular"><input type="checkbox" id="pRegular"${state.periodRegular ? " checked" : ""}> Also list regular spending in these dates</label>
      ${notesHTML(p)}
      <div class="row-actions"><button class="btn small quiet" id="pFilter">Show only this period</button><button class="btn small quiet" id="pRemove">Remove period</button></div>
    </div></div>`;
    // Each edit is a command on the period as it is now, not as drawn.
    const now = () => state.periods.find((q) => q.id === p.id) || p;
    const edit = (fields, refresh = "soon") =>
      actions.commit(editPeriod(state, { id: p.id, ...fields }), { refresh });
    $("#pName").addEventListener("input", (e) =>
      edit({ name: e.target.value.trim() || "Untitled period" }),
    );
    $("#pStart").addEventListener("change", (e) => {
      const start = e.target.value;
      if (start)
        edit({ start, end: now().end < start ? start : now().end }, "now");
    });
    $("#pEnd").addEventListener("change", (e) => {
      const end = e.target.value;
      if (end)
        edit({ end, start: end < now().start ? end : now().start }, "now");
    });
    $("#pStory")?.addEventListener("input", (e) =>
      edit({ story: e.target.value }, "none"),
    );
    $("#pStory")?.addEventListener("blur", () => {
      if (now().story) {
        state.storyEdit = null;
        actions.refresh();
      }
    });
    $("#pEdit")?.addEventListener("click", () => {
      state.storyEdit = p.id;
      actions.refresh();
      $("#pStory")?.focus();
    });
    $("#pFilter").onclick = () => {
      const q = "@" + p.name.split(/\s+/)[0];
      $("#q").value = q;
      state.query = q;
      actions.refresh();
    };
    $("#pRemove").onclick = () => removePeriod(p.id);
    $("#pRegular").onchange = (e) => {
      state.periodRegular = e.target.checked;
      actions.refresh();
    };
    $("#pDraftStory")?.addEventListener("click", () => draftStory(p));
  }

  async function draftStory(p) {
    const btn = $("#pDraftStory");
    const note = $("#pNote");
    btn.disabled = true;
    note.textContent = `${actions.AI()} is reading what happened in those dates…`;
    const st = periodStats(p);
    const months =
      new Set(Object.values(runtime.derived.coverage).flatMap((s) => [...s]))
        .size || 1;
    const typical = {};
    runtime.derived.allTxns
      .filter((t) => !t.transfer && t.amount > 0)
      .forEach((t) => {
        const k = t.thread + "\n" + t.currency;
        typical[k] = (typical[k] || 0) + t.amount / months;
      });
    const overl = state.periods.filter(
      (q) => q.id !== p.id && q.start <= p.end && q.end >= p.start,
    );
    const input = `You're helping one person keep a record of their own life through their card and bank statements, in a personal tool called Transactions. They marked a stretch of time and want a short story of what was going on.
Period: "${p.name}", ${p.start} to ${p.end} (${st.days} days). Today is ${runtime.today}.
${p.story ? `What they already wrote (keep their words and facts; weave the data around them):\n${p.story}\n` : ""}${overl.length ? `Other periods overlapping it: ${overl.map((q) => `"${q.name}" ${q.start}–${q.end}${q.story ? ` (${q.story.slice(0, 200)})` : ""}`).join("; ")}\n` : ""}
Charges in those dates (id | date | merchant | original description | amount | currency | thread | their note):
${st.inside
  .slice()
  .sort((a, b) => b.amount - a.amount)
  .slice(0, 250)
  .map((t) =>
    [
      t.id,
      t.date,
      t.merchant,
      t.original !== t.merchant ? t.original : "",
      t.amount,
      t.currency,
      t.thread,
      t.note,
    ].join(" | "),
  )
  .join("\n")}
Spend by thread in the period: ${st.byThread.map(([n, v, c]) => `${n} ${fmt(v, 0, c)}`).join(", ") || "none"}.
A typical month for them, by thread: ${Object.entries(typical)
      .map(([k, v]) => `${k.split("\n")[0]} ${fmt(v, 0, k.split("\n")[1])}`)
      .join(", ")}.
Statement months available: ${coverageText(runtime.derived)}.

Write 80 to 180 words in the first person, as the person's own plain notes: what was going on, what the money went on, anything unusual compared with a typical month. Not everything in the dates belongs to this period, so leave out charges that are clearly routine. Stay with what the data and their notes support; don't invent reasons. Cite up to 6 specific transactions inline as [[id]]. Reply with only the story text.`;
    try {
      const r = await caps.sample(input, {
        modelTier: "default",
        cache: false,
      });
      state.storyEdit = null;
      const change = actions.commit(
        editPeriod(state, { id: p.id, story: r.text.trim() }),
      );
      toast("Story drafted. Edit it however you like.", 9000, {
        label: "Undo",
        fn: () => actions.undo(change),
      });
    } catch (e) {
      if ($("#pNote")) $("#pNote").textContent = actions.sampleErr(e);
      if ($("#pDraftStory")) $("#pDraftStory").disabled = false;
    }
  }

  function removePeriod(id) {
    if (!state.periods.some((q) => q.id === id)) return;
    if (state.periodSel === id) state.periodSel = null;
    const change = actions.commit(remove(state, { id }));
    toast(change.summary, 9000, {
      label: "Undo",
      fn: () => {
        state.periodSel = id;
        actions.undo(change);
      },
    });
  }

  // Adds a period. Without a name it opens with "New period" selected, ready
  // to type over; with one (from an answered question) it is saved as is.
  function addPeriod(start, end, { name = "", story = "" } = {}) {
    const id = "p" + Date.now().toString(36);
    state.selection.clear();
    state.statement = null;
    if (!name) state.periodSel = id;
    actions.commit(add(state, { id, name, start, end, story }));
    const p = state.periods.find((q) => q.id === id);
    const n = !name && $("#pName");
    if (n) {
      n.focus();
      n.select();
    }
    return p;
  }

  // Opens a period in the inspector, in place of any selection or statement.
  function openPeriod(id) {
    state.periodSel = id;
    state.selection.clear();
    state.statement = null;
    actions.refresh();
  }

  return { addPeriod, openPeriod, removePeriod, renderPeriodInspector };
}

export const contract = {
  name: "periods",
  create: createPeriods,
  provides: [
    "addPeriod",
    "openPeriod",
    "removePeriod",
    "renderPeriodInspector",
  ],
  requires: ["AI", "commit", "refresh", "sampleErr", "undo"],
  renders: [],
  wires: [],
};
