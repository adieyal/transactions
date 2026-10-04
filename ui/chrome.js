import { createBackup } from "../backup.js";
import { debounce } from "../helpers.js";
import { $, html, toast } from "./dom.js";
import { STARTER_LENSES } from "../defaults.js";
import { coveredMonths } from "../story/moment-kit.js";

export function createChrome(runtime, actions) {
  const { state, caps } = runtime;
  function applyPanel() {
    document.body.classList.toggle("nopanel", !state.view.panel);
    const label = state.view.panel ? "Hide the panel" : "Show the panel";
    $("#hidePanel").title = label;
    $("#hidePanel").setAttribute("aria-label", label);
    state.loaded && actions.renderTimeline();
  }

  // The header as drawn: the first-run page while there are no statements,
  // and Year/Month only once there is more than one month to show.
  function renderShell() {
    const first = !Object.keys(state.batches).length;
    document.body.classList.toggle("firstrun", first);
    $("#firstRun").hidden = !first;
    const months = runtime.derived ? coveredMonths(runtime.derived).length : 0;
    const year = months > 1 && state.scale !== "month";
    // Artboard 2: one month of statements. Artboard 3: two or more, at
    // either scale.
    const month = !first && months === 1 && !state.bench;
    const several = !first && months > 1 && !state.bench;
    document.body.classList.toggle("onemonth", month || several);
    $("#oneMonth").hidden = !month;
    $("#year").hidden = !several;
    $("#scaleYear").disabled = months < 2;
    $("#scaleYear").title =
      months < 2 ? "Appears when you have more than one month" : "";
    $("#scaleYear").setAttribute("aria-pressed", year);
    $("#scaleMonth").setAttribute("aria-pressed", !year);
    $("#numbersBtn").setAttribute("aria-pressed", state.numbers);
  }

  function renderChrome() {
    renderShell();
    $("#demoNotice").innerHTML = state.isDemo
      ? html`Demo<span class="wide-only"> · a fictional year</span> · <button class="linkish" id="tourBtn">Take the tour</button>`
      : "Imported data";
    $("#ranges").innerHTML = [
      ["all", "All"],
      ["12", "12 months"],
      ["6", "6 months"],
      ["3", "3 months"],
    ]
      .map(
        ([v, l]) =>
          html`<button class="chip" aria-pressed="${state.range === v}" data-range="${v}">${l}</button>`,
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
    showSaveStatus(actions.Store.backend.kind);
    actions.renderPrivacy();
  }

  // The side panel scrolls as one; a new tab, month or workspace starts at
  // its top, so the tabs never hide the start of what was opened.
  function resetPanelScroll() {
    const panel = $(".right");
    if (panel) panel.scrollTop = 0;
  }

  // Where the last save went, from the storage backend's kind.
  function showSaveStatus(kind) {
    $("#saveStatus").textContent =
      kind === "account"
        ? "Saved privately to your Claude account"
        : "Saved in this browser only";
  }

  function openTab(which) {
    if ($("#tab-" + which).getAttribute("aria-selected") !== "true")
      resetPanelScroll();
    if (!state.view.panel) {
      state.view.panel = true;
      actions.save("view");
      applyPanel();
    }
    ["month", "lenses", "questions", "threads", "ask", "reports"].forEach(
      (w) => {
        $("#tab-" + w).setAttribute("aria-selected", w === which);
        $("#pane-" + w).classList.toggle("on", w === which);
      },
    );
    // Hidden panes skip their renders, so the one just opened catches up.
    actions.redraw();
  }

  function wireChrome() {
    $("#demoNotice").addEventListener("click", (e) => {
      if (e.target.closest("#tourBtn")) actions.startTour();
    });
    $("#addBtn").onclick = () => $("#file").click();
    $("#restoreBtn").onclick = () => $("#backupFile").click();
    // Month shows the month view (artboard 2). Until the year view arrives,
    // Year shows the whole timeline.
    document.querySelector(".scale").onclick = (e) => {
      const b = e.target.closest("[data-scale]");
      if (!b || b.disabled) return;
      state.scale = b.dataset.scale;
      if (state.scale === "year") state.range = "all";
      state.bench = false;
      actions.refresh();
    };
    $("#numbersBtn").onclick = () => {
      state.numbers = !state.numbers;
      actions.redraw();
    };
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
      actions.save("view");
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
      actions.save("rules");
      actions.refresh();
      actions.caretHighlight();
    });
    ta.addEventListener("scroll", actions.syncGutter);
    ["keyup", "click", "select", "focus"].forEach((ev) =>
      ta.addEventListener(ev, actions.caretHighlight),
    );
    ta.addEventListener("blur", () =>
      setTimeout(() => {
        if (document.activeElement !== ta && state.highlight.size) {
          actions.highlight([]);
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
      actions.save("rules");
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
      if (act === "bench") {
        state.bench = true;
        actions.refresh();
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
        actions.save("lenses");
        actions.redraw();
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
              filename: `transactions-${runtime.today}.json`,
              data: JSON.stringify(createBackup(state, runtime.today), null, 1),
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
        actions.clearFocus();
      }
    });
    new ResizeObserver(
      debounce(() => state.loaded && actions.renderTimeline(), 60),
    ).observe($("#tl"));
  }

  return {
    applyPanel,
    openTab,
    renderChrome,
    resetPanelScroll,
    showSaveStatus,
    wireChrome,
  };
}

export const contract = {
  name: "chrome",
  create: createChrome,
  provides: [
    "applyPanel",
    "openTab",
    "renderChrome",
    "resetPanelScroll",
    "showSaveStatus",
    "wireChrome",
  ],
  requires: [
    "AI",
    "caretHighlight",
    "clearFocus",
    "highlight",
    "importFiles",
    "openAISettings",
    "redraw",
    "refresh",
    "removePeriod",
    "renderPrivacy",
    "renderTimeline",
    "restartDemo",
    "save",
    "startTour",
    "Store",
    "suggestThreads",
    "syncGutter",
  ],
  renders: ["renderChrome"],
  wires: ["wireChrome"],
};
