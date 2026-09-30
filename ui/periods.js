import { $, TODAY, esc, fmt, ms } from "../helpers.js";
import { toast } from "./dom.js";

export function createPeriods(runtime, actions) {
  const { state, caps } = runtime;
  function periodStats(p) {
    const inside = runtime.derived.allTxns.filter(
      (t) => !t.transfer && t.date >= p.start && t.date <= p.end,
    );
    const out = inside.filter((t) => t.amount > 0);
    const sum = out.reduce((a, t) => a + t.amount, 0);
    const g = {};
    out.forEach((t) => (g[t.thread] = (g[t.thread] || 0) + t.amount));
    const days = Math.round((ms(p.end) - ms(p.start)) / 864e5) + 1;
    return {
      inside,
      out,
      sum,
      byThread: Object.entries(g).sort((a, b) => b[1] - a[1]),
      biggest: [...out].sort((a, b) => b.amount - a.amount).slice(0, 6),
      days,
    };
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
      <p class="sub" style="margin:8px 0 4px">${st.days} day${st.days > 1 ? "s" : ""} · ${st.out.length} charges · ${fmt(st.sum, 0)} out${overl.length ? ` · overlaps <span dir="auto">${overl.map((q) => esc(q.name)).join(", ")}</span>` : ""}. Not everything in these dates has to belong; this is context.</p>
      ${
        st.byThread.length
          ? `<div class="bars" style="margin:6px 0">${st.byThread
              .slice(0, 6)
              .map(
                ([n, v]) =>
                  `<button class="bar" data-ids="${esc(
                    st.out
                      .filter((t) => t.thread === n)
                      .map((t) => t.id)
                      .join(","),
                  )}"><span class="l" dir="auto">${esc(n)}</span><span class="t"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></span><span class="v">${fmt(v, 0)}</span></button>`,
              )
              .join("")}</div>`
          : ""
      }
      ${st.biggest.length ? `<div class="sub" style="margin-top:6px">Biggest: ${st.biggest.map((t) => `<button class="cite" data-cite="${t.id}"><span dir="auto">${esc(t.merchant.slice(0, 22))}</span> ${fmt(t.amount, 0)}</button>`).join(" ")}</div>` : ""}
    </div><div>
      <div class="sub" style="margin-bottom:4px">The story. What was going on?</div>
      ${
        editing
          ? `<textarea class="note story" id="pStory" dir="auto" placeholder="e.g. Moved into the new flat. Most of the Home Center and IKEA runs are furniture and fixing up.">${esc(p.story || "")}</textarea>`
          : `<div class="storyview" dir="auto">${actions.md(p.story)}</div>`
      }
      <div class="row-actions">${!editing ? `<button class="btn small quiet" id="pEdit">Edit the story</button>` : ""}${caps.sample ? `<button class="btn small quiet" id="pDraftStory">${p.story ? "Rework it with " : "Draft it with "}${actions.AI()}</button>` : ""}
        <button class="btn small quiet" id="pFilter">Show only this period</button><button class="btn small quiet" id="pRemove">Remove period</button></div>
      <p class="sub" id="pNote"></p>
    </div></div>`;
    const upd = () => {
      actions.savePeriods();
      actions.refreshSoon();
    };
    $("#pName").addEventListener("input", (e) => {
      p.name = e.target.value.trim() || "Untitled period";
      upd();
    });
    $("#pStart").addEventListener("change", (e) => {
      if (e.target.value) {
        p.start = e.target.value;
        if (p.end < p.start) p.end = p.start;
        upd();
        actions.renderInspector();
      }
    });
    $("#pEnd").addEventListener("change", (e) => {
      if (e.target.value) {
        p.end = e.target.value;
        if (p.end < p.start) p.start = p.end;
        upd();
        actions.renderInspector();
      }
    });
    $("#pStory")?.addEventListener("input", (e) => {
      p.story = e.target.value;
      actions.savePeriods();
    });
    $("#pStory")?.addEventListener("blur", () => {
      if (p.story) {
        state.storyEdit = null;
        actions.renderInspector();
      }
    });
    $("#pEdit")?.addEventListener("click", () => {
      state.storyEdit = p.id;
      actions.renderInspector();
      $("#pStory")?.focus();
    });
    $("#pFilter").onclick = () => {
      const q = "@" + p.name.split(/\s+/)[0];
      $("#q").value = q;
      state.query = q;
      actions.refresh();
    };
    $("#pRemove").onclick = () => {
      const i = state.periods.indexOf(p);
      state.periods.splice(i, 1);
      state.periodSel = null;
      actions.savePeriods();
      actions.refresh();
      toast(`Removed “${p.name}”.`, 9000, {
        label: "Undo",
        fn: () => {
          state.periods.splice(i, 0, p);
          state.periodSel = p.id;
          actions.savePeriods();
          actions.refresh();
        },
      });
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
      .forEach(
        (t) =>
          (typical[t.thread] = (typical[t.thread] || 0) + t.amount / months),
      );
    const overl = state.periods.filter(
      (q) => q.id !== p.id && q.start <= p.end && q.end >= p.start,
    );
    const input = `You're helping one person keep a record of their own life through their card and bank statements, in a personal tool called Transactions. They marked a stretch of time and want a short story of what was going on.
Period: "${p.name}", ${p.start} to ${p.end} (${st.days} days). Today is ${TODAY}.
${p.story ? `What they already wrote (keep their words and facts; weave the data around them):\n${p.story}\n` : ""}${overl.length ? `Other periods overlapping it: ${overl.map((q) => `"${q.name}" ${q.start}–${q.end}${q.story ? ` (${q.story.slice(0, 200)})` : ""}`).join("; ")}\n` : ""}
Charges in those dates (id | date | merchant | original description | ₪ amount | thread | their note):
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
      t.thread,
      t.note,
    ].join(" | "),
  )
  .join("\n")}
Spend by thread in the period: ${st.byThread.map(([n, v]) => `${n} ₪${v.toFixed(0)}`).join(", ") || "none"}.
A typical month for them, by thread: ${Object.entries(typical)
      .map(([n, v]) => `${n} ₪${v.toFixed(0)}`)
      .join(", ")}.
Statement months available: ${actions.coverageText()}.

Write 80 to 180 words in the first person, as the person's own plain notes: what was going on, what the money went on, anything unusual compared with a typical month. Not everything in the dates belongs to this period, so leave out charges that are clearly routine. Stay with what the data and their notes support; don't invent reasons. Cite up to 6 specific transactions inline as [[id]]. Reply with only the story text.`;
    const before = p.story;
    try {
      const r = await caps.sample(input, {
        modelTier: "default",
        cache: false,
      });
      p.story = r.text.trim();
      state.storyEdit = null;
      actions.savePeriods();
      actions.renderInspector();
      toast("Story drafted. Edit it however you like.", 9000, {
        label: "Undo",
        fn: () => {
          p.story = before;
          actions.savePeriods();
          actions.renderInspector();
        },
      });
    } catch (e) {
      if ($("#pNote")) $("#pNote").textContent = actions.sampleErr(e);
      if ($("#pDraftStory")) $("#pDraftStory").disabled = false;
    }
  }

  return { renderPeriodInspector };
}
