import { esc, fmtDate, fnv } from "../helpers.js";
import { $, benchHidden, paneShown, toast } from "./dom.js";
import { markdown } from "./markdown.js";
import { coverageText } from "../assistant/prompts.js";
import { latestPayment } from "../story/saved-question.js";
import { addReport as add, removeReport } from "../model/index.js";

export function createReports(runtime, actions) {
  const { state, caps } = runtime;
  const dataKey = () => fnv(Object.keys(state.batches).sort().join(","));

  const staleReports = () =>
    state.reports.filter((r) => r.dataKey !== dataKey());

  function renderReports() {
    if (benchHidden(state)) return;
    const el = $("#reports");
    if (!el || !paneShown("reports")) return;
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
      ${r.running && r.draft ? `<div class="a" dir="auto">${markdown(r.draft, runtime.derived.byId)}</div>` : r.answer ? `<div class="a" dir="auto">${markdown(r.answer, runtime.derived.byId)}</div>` : ""}
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
      // A command may have replaced the saved list while this ran.
      r = state.reports.find((x) => x.id === r.id) || r;
      r.answer = text;
      r.by = actions.AI();
      r.ranAt = runtime.today;
      r.dataKey = dataKey();
      r.coverage = coverageText(runtime.derived);
      r.prevThrough = r.through || "";
      r.through = latestPayment(runtime.derived);
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

  // open: false when saved from the chat, which stays where it is. Returns
  // the change record, for the chat's Undo.
  function addReport(q, answer, { open = true } = {}) {
    const report = {
      id: "r" + Date.now().toString(36),
      q,
      answer: answer || "",
      ranAt: answer ? runtime.today : "",
      dataKey: answer ? dataKey() : "",
      coverage: answer ? coverageText(runtime.derived) : "",
      by: answer ? actions.AI() : "",
      through: answer ? latestPayment(runtime.derived) : "",
    };
    const change = actions.commit(add(state, { report }), { refresh: "none" });
    if (open) actions.openTab("reports");
    return change;
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
        const change = actions.commit(
          removeReport(state, { id: rm.dataset.rmrep }),
          { refresh: "none" },
        );
        renderReports();
        toast(change.summary, 9000, {
          label: "Undo",
          fn: () => {
            actions.undo(change, { refresh: "none" });
            renderReports();
          },
        });
        return;
      }
      const c = e.target.closest("[data-cite]");
      if (c) {
        state.periodSel = null;
        actions.select([c.dataset.cite]);
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

  return {
    addReport,
    renderReports,
    runReport,
    runStale,
    staleReports,
    wireReports,
  };
}

export const contract = {
  name: "reports",
  create: createReports,
  provides: [
    "addReport",
    "renderReports",
    "runReport",
    "runStale",
    "staleReports",
    "wireReports",
  ],
  requires: [
    "AI",
    "buildIntro",
    "callAssistant",
    "commit",
    "noAssistant",
    "openTab",
    "sampleErr",
    "save",
    "select",
    "undo",
  ],
  renders: ["renderReports"],
  wires: ["wireReports"],
};
