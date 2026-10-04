import { createBackup } from "../backup.js";
import { $, TODAY, debounce } from "../helpers.js";
import { toast } from "./dom.js";
import { STARTER_LENSES } from "../defaults.js";

export function createChrome(runtime, actions) {
  const { state, caps } = runtime;
  function applyPanel() {
    document.body.classList.toggle("nopanel", !state.view.panel);
    const label = state.view.panel ? "Hide the panel" : "Show the panel";
    $("#hidePanel").title = label;
    $("#hidePanel").setAttribute("aria-label", label);
    state.loaded && actions.renderTimeline();
  }

  function renderChrome() {
    $("#demoNotice").innerHTML = state.isDemo
      ? `Demo · a fictional year · <button class="linkish" id="tourBtn">Take the tour</button>`
      : "Imported data";
    $("#tourBtn")?.addEventListener("click", actions.startTour);
    $("#ranges").innerHTML = [
      ["all", "All"],
      ["12", "12 months"],
      ["6", "6 months"],
      ["3", "3 months"],
    ]
      .map(
        ([v, l]) =>
          `<button class="chip" aria-pressed="${state.range === v}" data-range="${v}">${l}</button>`,
      )
      .join("");
    $("#suggestBtn").hidden = !caps.sample || !runtime.derived?.allTxns.length;
    $("#suggestBtn").textContent = "Suggest threads with " + actions.AI();
    $("#mapAsk").textContent = `Ask ${actions.AI()} to fill this in`;
    $("#askNote").textContent = caps.sample
      ? `Answers by ${actions.AI()}`
      : "No AI assistant here yet. Set one up under More.";
    $("#sendBtn").disabled = !caps.sample || !runtime.derived?.allTxns.length;
    $("#askInput").disabled = !caps.sample;
    actions.setStatus();
    actions.renderPrivacy();
  }

  function openTab(which) {
    if (!state.view.panel) {
      state.view.panel = true;
      actions.saveView();
      applyPanel();
    }
    ["month", "lenses", "questions", "threads", "ask", "reports"].forEach(
      (w) => {
        $("#tab-" + w).setAttribute("aria-selected", w === which);
        $("#pane-" + w).classList.toggle("on", w === which);
      },
    );
    if (which === "ask") {
      actions.renderAskCtx();
      actions.renderLog();
    }
    if (which === "reports") actions.renderReports();
    if (which === "questions") actions.renderQuestions();
  }

  function wireChrome() {
    $("#addBtn").onclick = () => $("#file").click();
    $("#file").onchange = (e) => {
      actions.importFiles([...e.target.files]);
      e.target.value = "";
    };
    let depth = 0;
    addEventListener("dragenter", (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        depth++;
        document.body.classList.add("dragging");
      }
    });
    addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) document.body.classList.remove("dragging");
    });
    addEventListener("dragover", (e) => e.preventDefault());
    addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove("dragging");
      const fs = [...(e.dataTransfer?.files || [])];
      if (fs.length) actions.importFiles(fs);
    });
    $("#ranges").onclick = (e) => {
      const b = e.target.closest("[data-range]");
      if (!b) return;
      state.range = b.dataset.range;
      actions.refresh();
    };
    $("#hidePanel").onclick = () => {
      state.view.panel = !state.view.panel;
      actions.saveView();
      applyPanel();
    };
    $("#tab-month").onclick = () => openTab("month");
    $("#tab-lenses").onclick = () => openTab("lenses");
    $("#tab-questions").onclick = () => openTab("questions");
    $("#tab-threads").onclick = () => openTab("threads");
    $("#tab-reports").onclick = () => openTab("reports");
    $("#tab-ask").onclick = () => openTab("ask");
    const ta = $("#rules");
    ta.addEventListener("input", () => {
      if (state.previewRules != null) return;
      state.rules = ta.value;
      actions.saveSoon("rules", () => ({ text: state.rules }));
      actions.derive();
      actions.renderTimeline();
      actions.renderEditor();
      actions.renderInspector();
      actions.renderLensesSoon();
      actions.caretHighlight();
    });
    ta.addEventListener("scroll", actions.syncGutter);
    ["keyup", "click", "select", "focus"].forEach((ev) =>
      ta.addEventListener(ev, actions.caretHighlight),
    );
    ta.addEventListener("blur", () =>
      setTimeout(() => {
        if (document.activeElement !== ta && state.highlight.size) {
          state.highlight.clear();
          actions.renderTimeline();
        }
      }, 150),
    );
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !ta.readOnly) {
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
    });
    $("#suggestBtn").onclick = actions.suggestThreads;
    $("#keepPreview").onclick = () => {
      state.rules = state.previewRules;
      state.previewRules = null;
      actions.saveSoon("rules", () => ({ text: state.rules }), 100);
      actions.refresh();
      toast("Threads updated. Edit them any time.");
    };
    $("#dropPreview").onclick = () => {
      state.previewRules = null;
      actions.refresh();
    };
    const menu = $("#moreMenu");
    $("#moreBtn").onclick = (e) => {
      e.stopPropagation();
      const o = !menu.classList.contains("open");
      menu.classList.toggle("open", o);
      $("#moreBtn").setAttribute("aria-expanded", o);
    };
    addEventListener("click", () => {
      menu.classList.remove("open");
      $("#moreBtn").setAttribute("aria-expanded", false);
    });
    menu.querySelector("div").onclick = async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === "import-backup") {
        $("#backupFile").click();
        return;
      }
      if (act === "tour") {
        actions.startTour();
        return;
      }
      if (act === "restart-demo") {
        actions.restartDemo();
        return;
      }
      if (act === "ai") {
        actions.openAISettings();
        return;
      }
      if (act === "reset-lenses") {
        const have = new Set(state.lenses.map((l) => l.id));
        STARTER_LENSES.forEach((l) => {
          if (!have.has(l.id)) state.lenses.push({ ...l });
        });
        actions.saveLenses();
        actions.renderLenses();
        return;
      }
      if (!caps.downloads) {
        toast("Downloads aren't available in this view.");
        return;
      }
      const data =
        act === "dl-rules"
          ? { filename: "transactions-threads.txt", data: state.rules }
          : {
              filename: `transactions-${TODAY}.json`,
              data: JSON.stringify(createBackup(state), null, 1),
            };
      try {
        await caps.downloads.save(data);
      } catch (err) {
        if (err?.code === "unavailable")
          toast("Downloads aren't available in this view.");
      }
    };
    addEventListener("keydown", (e) => {
      // Delete or Backspace removes the selected period, unless typing.
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        state.periodSel &&
        !e.target.closest?.("input, textarea, select, [contenteditable]") &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        actions.removePeriod(state.periodSel);
        return;
      }
      if (e.key === "Escape" && !$("#mapDlg").open) {
        state.selection.clear();
        state.highlight.clear();
        state.statement = null;
        state.periodSel = null;
        state.threadSel = null;
        actions.refresh();
      }
    });
    new ResizeObserver(
      debounce(() => state.loaded && actions.renderTimeline(), 60),
    ).observe($("#tl"));
  }

  return { applyPanel, openTab, renderChrome, wireChrome };
}
