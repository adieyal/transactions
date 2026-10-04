import { $, TODAY, esc, fmtDate, fnv } from "../helpers.js";
import { toast } from "./dom.js";

export function createReports(runtime, actions) {
  const { state, caps } = runtime;
  const dataKey = () => fnv(Object.keys(state.batches).sort().join(","));

  const staleReports = () =>
    state.reports.filter((r) => r.dataKey !== dataKey());

  function renderReports() {
    const el = $("#reports");
    if (!el) return;
    const stale = staleReports().length;
    let h = caps.sample
      ? ""
      : actions.noAssistant(
          "Reports need an assistant to run.",
          "You can save questions now, and they'll run once one is connected.",
        );
    $("#repSave").textContent = caps.sample ? "Save and run" : "Save";
    if (!state.reports.length)
      h += `<p class="sub">Nothing saved yet. Save a question below, or use “Save as a report” under any answer in Ask.</p><div class="suggestions">${["Anything new or unusual since the last statement?", "How did this month compare with a typical month, thread by thread?", "Which subscriptions changed price or appeared for the first time?"].map((s) => `<button data-repsug="${esc(s)}">${esc(s)}</button>`).join("")}</div>`;
    else if (stale && caps.sample)
      h = `<div class="row-actions" style="margin:0 0 10px"><span class="sub">${stale} report${stale > 1 ? "s have" : " has"} new statements since the last run.</span><button class="btn small" id="runStale">Run ${stale > 1 ? "them" : "it"}</button></div>`;
    h += state.reports
      .map(
        (r) => `<article class="report" data-rid="${r.id}">
      <h3 dir="auto">${esc(r.q)}</h3>
      <div class="sub">${r.running ? "Running…" : r.ranAt ? `Last run ${fmtDate(r.ranAt)}${r.dataKey !== dataKey() ? " · <b>new statements since</b>" : ""}` : "Not run yet"}</div>
      ${r.running && r.draft ? `<div class="a" dir="auto">${actions.md(r.draft)}</div>` : r.answer ? `<div class="a" dir="auto">${actions.md(r.answer)}</div>` : ""}
      ${r.error ? `<p class="sub">${esc(r.error)}</p>` : ""}
      <div class="a-actions">${caps.sample && !r.running ? `<button class="linkish" data-run="${r.id}">Run again</button>` : ""}<button class="linkish" data-rmrep="${r.id}">Remove</button></div></article>`,
      )
      .join("");
    el.innerHTML = h;
  }

  async function runReport(r) {
    if (!caps.sample || r.running) return;
    r.running = true;
    r.draft = "";
    r.error = "";
    renderReports();
    const prev = r.answer
      ? `\nThis report was last run on ${r.ranAt}, when the statements covered: ${r.coverage || "unknown"}. The answer then was:\n${r.answer}\nOpen with what's new or different since then (new statements, changed figures), then answer the question as things stand now.`
      : "";
    const input = [
      { role: "user", content: actions.buildIntro(false) },
      {
        role: "user",
        content: `This is a saved report the person re-runs whenever they add statements.\nReport question: ${r.q}${prev}`,
      },
    ];
    const reply = { content: "" };
    try {
      const text = await actions.callAssistant(input, reply, {
        write: false,
        onText: (t) => {
          r.draft = t;
          renderReports();
        },
      });
      r.answer = text;
      r.ranAt = TODAY;
      r.dataKey = dataKey();
      r.coverage = actions.coverageText();
    } catch (e) {
      r.error = actions.sampleErr(e);
    }
    r.running = false;
    r.draft = "";
    actions.save("reports");
    renderReports();
  }

  async function runStale() {
    for (const r of staleReports()) await runReport(r);
  }

  function addReport(q, answer) {
    state.reports.push({
      id: "r" + Date.now().toString(36),
      q,
      answer: answer || "",
      ranAt: answer ? TODAY : "",
      dataKey: answer ? dataKey() : "",
      coverage: answer ? actions.coverageText() : "",
    });
    actions.save("reports");
    actions.openTab("reports");
  }

  function wireReports() {
    $("#reports").addEventListener("click", (e) => {
      if (e.target.id === "runStale") {
        runStale();
        return;
      }
      const sg = e.target.closest("[data-repsug]");
      if (sg) {
        addReport(sg.dataset.repsug);
        runReport(state.reports.at(-1));
        return;
      }
      const run = e.target.closest("[data-run]");
      if (run) {
        runReport(state.reports.find((r) => r.id === run.dataset.run));
        return;
      }
      const rm = e.target.closest("[data-rmrep]");
      if (rm) {
        const i = state.reports.findIndex((r) => r.id === rm.dataset.rmrep);
        const [r] = state.reports.splice(i, 1);
        actions.save("reports");
        renderReports();
        toast("Report removed.", 9000, {
          label: "Undo",
          fn: () => {
            state.reports.splice(i, 0, r);
            actions.save("reports");
            renderReports();
          },
        });
        return;
      }
      const c = e.target.closest("[data-cite]");
      if (c) {
        state.selection = new Set([c.dataset.cite]);
        state.highlight = new Set([c.dataset.cite]);
        state.periodSel = null;
        actions.refresh();
        $("#tlwrap").scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    $("#repSave").onclick = () => {
      const q = $("#repInput").value.trim();
      if (!q) {
        $("#repInput").focus();
        return;
      }
      $("#repInput").value = "";
      addReport(q);
      if (caps.sample) runReport(state.reports.at(-1));
    };
    $("#repInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#repSave").click();
      }
    });
  }

  return { addReport, renderReports, runStale, staleReports, wireReports };
}
