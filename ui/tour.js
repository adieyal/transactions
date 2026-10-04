import { esc } from "../helpers.js";
import { flags } from "../storage.js";
import { $ } from "./dom.js";
import { detectMoments } from "../story/moments.js";
import { money, monthLong, privacyText } from "../story/copy.js";

// A short walk through the demo year: reading a month, checking a figure,
// answering a question, privacy, and threads. Each step points at the real UI.
export function createTour(runtime, actions) {
  const { state } = runtime;
  let at = -1,
    steps = [],
    spot = null,
    card = null;

  const clear = () => {
    actions.clearFocus();
  };
  // The demo's biggest burst of purchases: the move. Once answered with a
  // period it is no longer a burst outside a period, so use that period.
  function theMove() {
    const open = detectMoments(runtime.derived, state).find(
      (m) => m.kind === "cluster",
    );
    if (open) return open;
    for (const [id, a] of Object.entries(state.answers)) {
      const p = state.periods.find((x) => x.id === a.created?.periodId);
      if (id.startsWith("cluster-") && p)
        return {
          id,
          month: p.start.slice(0, 7),
          txnIds: runtime.derived.allTxns
            .filter((t) => t.date >= p.start && t.date <= p.end)
            .map((t) => t.id),
          facts: {},
        };
    }
    return null;
  }
  const showMonth = (month) => {
    clear();
    state.monthView = month;
    actions.openTab("month");
    actions.resetPanelScroll();
  };
  const movePeriod = (move) =>
    state.periods.find(
      (p) => p.id === state.answers[move.id]?.created?.periodId,
    );

  function buildSteps() {
    const move = theMove();
    if (!move) return [];
    const M = monthLong(move.month).split(" ")[0];
    const privacy = privacyText(actions.Store.backend.kind);
    return [
      {
        title: "Your month, in plain words",
        body: `This is ${M}, told in sentences: what went out, what was regular and what stood out. Every figure comes straight from the statements.`,
        target: () => $("#month .msum"),
        before: () => showMonth(move.month),
      },
      {
        title: "Every figure can be checked",
        body: "Hover an underlined phrase and its transactions light up on the timeline. Try it on any sentence.",
        target: () => $("#month .mp-overview .sp"),
        before: () => {
          showMonth(move.month);
          const phrase = $("#month .mp-overview .sp");
          if (!phrase) return;
          phrase.classList.add("on");
          actions.highlight(phrase.dataset.ids.split(","));
        },
      },
      !state.answers[move.id] && {
        title: "The app asks, so you don't have to",
        body: `${money(move.facts.total)} went out in one week in ${M}, so the app asks about it. Answer if you like: pick an option, name it yourself, write a note or skip. Only you see your answer. Press Next and the tour will answer “Moving house” for you.`,
        target: () => $(`#month .qcard[data-qid="${move.id}"]`),
        before: () => showMonth(move.month),
      },
      {
        title: "Your answer becomes a period",
        body: () => {
          const p = movePeriod(move);
          return p
            ? `“${p.name}” is now a period on the timeline, and ${M}'s summary tells it in a sentence of its own. Undo is in the message at the bottom.`
            : "Your answer is saved, and the question won't come back.";
        },
        target: () => {
          const p = movePeriod(move);
          return p ? $(`#tl g.period[data-pid="${p.id}"]`) : null;
        },
        before: () => {
          if (!state.answers[move.id])
            actions.answerQuestion(move, {
              action: "period",
              label: "Moving house",
            });
          showMonth(move.month);
          actions.highlight(move.txnIds);
        },
      },
      {
        title: "Private, and it says so",
        body: `This chip says where everything is kept: ${privacy.label.charAt(0).toLowerCase() + privacy.label.slice(1)}. Click it for the details. Nothing goes to an assistant unless you ask.`,
        target: () => $("#privacyChip"),
        before: clear,
      },
      {
        title: "More questions, all optional",
        body: "Other things the app noticed wait here, like a price change or a savings transfer that paused. Answer any you like. Skip means it won't ask again.",
        target: () => $("#pane-questions"),
        before: () => {
          clear();
          actions.openTab("questions");
        },
      },
      {
        title: "Every thread has a story too",
        body: "Click a thread's name on the timeline to see it summed up: how often, how much, the busiest month, and every charge blow by blow.",
        target: () => $("#insp"),
        before: () => {
          clear();
          state.threadSel = "Dining out";
          state.highlight = new Set(
            runtime.derived.allTxns
              .filter((t) => t.thread === "Dining out")
              .map((t) => t.id),
          );
          actions.openTab("month");
          actions.refresh();
        },
      },
      {
        title: "Now make it yours",
        body: "Add your own statements and your months will be told the same way. Everything stays where the chip says. You can replay this tour from More.",
        final: true,
        before: clear,
      },
    ].filter(Boolean);
  }

  // One rectangle around an element, or around several.
  function bounds(target) {
    const rs = [target]
      .flat()
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect());
    if (!rs.length) return null;
    const left = Math.min(...rs.map((r) => r.left)),
      top = Math.min(...rs.map((r) => r.top)),
      right = Math.max(...rs.map((r) => r.right)),
      bottom = Math.max(...rs.map((r) => r.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function place() {
    const step = steps[at];
    if (!step) return;
    const r = bounds(step.target?.());
    if (r && r.width) {
      Object.assign(spot.style, {
        display: "block",
        left: r.left - 6 + "px",
        top: r.top - 6 + "px",
        width: r.width + 12 + "px",
        height: r.height + 12 + "px",
      });
    } else spot.style.display = "none";
    const cw = card.offsetWidth,
      ch = card.offsetHeight,
      vw = innerWidth,
      vh = innerHeight,
      m = 12;
    let x, y;
    if (!r || !r.width) {
      x = (vw - cw) / 2;
      y = (vh - ch) / 2;
    } else if (r.bottom + m + ch < vh) {
      x = r.left;
      y = r.bottom + m;
    } else if (r.top - m - ch > 0) {
      x = r.left;
      y = r.top - m - ch;
    } else if (r.right + m + cw < vw) {
      x = r.right + m;
      y = r.top;
    } else {
      x = r.left - m - cw;
      y = r.top;
    }
    card.style.left = Math.max(m, Math.min(x, vw - cw - m)) + "px";
    card.style.top = Math.max(m, Math.min(y, vh - ch - m)) + "px";
  }

  function show(i) {
    at = i;
    const step = steps[at];
    step.before?.();
    card.innerHTML = `<button class="tour-close" data-tour="end" aria-label="Close the tour" title="Close (Esc)">×</button>
      <div class="tour-count">${at + 1} of ${steps.length}</div>
      <h3>${esc(step.title)}</h3><p>${esc(typeof step.body === "function" ? step.body() : step.body)}</p>
      <div class="row-actions">${
        step.final
          ? `<button class="linkish" data-tour="end">Keep exploring</button><button class="btn small" data-tour="add">Add your statements</button>`
          : `<button class="linkish" data-tour="end">Skip the tour</button><span>${at ? `<button class="btn small quiet" data-tour="back">Back</button> ` : ""}<button class="btn small" data-tour="next">Next</button></span>`
      }</div>`;
    [step.target?.()]
      .flat()
      .filter(Boolean)
      .at(-1)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    requestAnimationFrame(place);
    card.querySelector('[data-tour="next"], [data-tour="add"]')?.focus();
  }

  function end() {
    if (at < 0) return;
    at = -1;
    spot.remove();
    card.remove();
    removeEventListener("resize", place);
    removeEventListener("scroll", place, true);
    removeEventListener("keydown", onKey, true);
    // Steps scroll their targets into view; the panel starts at its top again.
    actions.resetPanelScroll();
    flags.set("tourSeen");
    clear();
  }

  // Listens in the capture phase so Escape closes the tour before anything
  // else on the page reacts to it.
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      end();
      return;
    }
    if (e.target.closest?.("input, textarea, select, [contenteditable]"))
      return;
    if (e.key === "ArrowRight" && at < steps.length - 1) show(at + 1);
    else if (e.key === "ArrowLeft" && at > 0) show(at - 1);
  }

  function startTour() {
    if (at >= 0 || !runtime.derived?.allTxns.length) return;
    steps = buildSteps();
    if (!steps.length) return;
    spot = document.createElement("div");
    spot.className = "tour-spot";
    card = document.createElement("div");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Tour of the demo");
    card.onclick = (e) => {
      const act = e.target.closest("[data-tour]")?.dataset.tour;
      if (act === "next") show(at + 1);
      else if (act === "back") show(at - 1);
      else if (act === "end") end();
      else if (act === "add") {
        end();
        $("#addBtn").click();
      }
    };
    document.body.append(spot, card);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    addEventListener("keydown", onKey, true);
    show(0);
  }

  // Offer the tour once, the first time someone opens the demo.
  function maybeStartTour() {
    if (!state.isDemo) return;
    if (!flags.has("tourSeen")) startTour();
  }

  return { maybeStartTour, startTour };
}

export const contract = {
  name: "tour",
  create: createTour,
  provides: ["maybeStartTour", "startTour"],
  requires: [
    "Store",
    "answerQuestion",
    "clearFocus",
    "highlight",
    "openTab",
    "refresh",
    "resetPanelScroll",
  ],
  renders: [],
  wires: [],
};
