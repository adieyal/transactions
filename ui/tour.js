import { $, esc } from "../helpers.js";

const SEEN_KEY = "transactions-tour-seen";

// A short walk through the demo year. Each step points at the real UI and
// makes one point about reading spending as a record of life.
export function createTour(runtime, actions) {
  const { state } = runtime;
  let at = -1,
    steps = [],
    spot = null,
    card = null;

  const txn = (merchant, amount) =>
    runtime.derived?.allTxns.find(
      (t) => t.merchant === merchant && (amount == null || t.amount === amount),
    );
  const dot = (t) => t && $(`#tl [data-id="${t.id}"]`);
  // A period's dots on one wire.
  const periodOn = (id, thread) => {
    const p = state.periods.find((x) => x.id === id);
    return (runtime.derived?.allTxns || [])
      .filter((t) => t.thread === thread && t.periods.includes(p?.name))
      .map(dot);
  };
  const select = (t) => {
    state.selection = new Set([t.id]);
    state.highlight = new Set([t.id]);
    state.periodSel = null;
    actions.refresh();
  };
  const openPeriod = (id) => {
    state.periodSel = id;
    state.selection.clear();
    state.highlight = new Set();
    actions.refresh();
  };
  const clear = () => {
    state.selection.clear();
    state.highlight = new Set();
    state.periodSel = null;
    actions.refresh();
  };

  function buildSteps() {
    const repair = txn("Cobble Lane Garage", 1480);
    const fridge = txn("Kettle & Coil", 890);
    return [
      {
        title: "This isn't a bank statement",
        body: "It's a year of someone's life. Each wire is part of it: food, bills, the cat, getting around. Each dot is a moment money changed hands, and bigger dots mean bigger amounts.",
        target: () => $("#tlwrap"),
        before: clear,
      },
      repair && {
        title: "Life gets in the way",
        body: "A few months in, the clutch went. The repair came out of the holiday fund, and on the Transfers wire you can see two months without a savings transfer. The note on the charge says why. A statement never would.",
        target: () => dot(repair),
        before: () => select(repair),
      },
      state.periods.some((p) => p.id === "demo-move") && {
        title: "Remember moving house?",
        body: "Mark the stretches of time that mattered: a move, a trip, a renovation. The cluster on the Home wire is the fridge, the washing machine and the kettle from the week of the move. Drag across the dots that belong together and choose Mark as a period.",
        target: () => periodOn("demo-move", "Home"),
        before: () => openPeriod("demo-move"),
      },
      state.periods.some((p) => p.id === "demo-move") && {
        title: "Write down what was going on",
        body: "A period keeps its story next to what it cost. Months later, this is what you'll want to remember.",
        target: () => $("#insp"),
      },
      fridge && {
        title: "Notes and #tags",
        body: "Add a note to any charge. Tags in notes become filters: click #move to see everything the move cost, wherever it was spent.",
        target: () => $("#qTags"),
        before: () => select(fridge),
      },
      {
        title: "Your categories, your words",
        body: "Threads are a short list you can edit. Rename a wire, split one up, or add a budget. Put the cursor on a line to see which charges it catches.",
        target: () => $("#editor"),
        before: () => {
          clear();
          actions.openTab("threads");
        },
      },
      state.periods.some((p) => p.id === "demo-trip") && {
        title: "And the holiday you saved for",
        body: "The car set the fund back two months, but they got there. The money moved out of savings, and the trip is all there on the Trips wire.",
        target: () => periodOn("demo-trip", "Trips"),
        before: () => openPeriod("demo-trip"),
      },
      {
        title: "Now make it yours",
        body: "Add your own statements and shape the view around your own life. Everything stays in this browser. You can replay this tour from More.",
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
      <h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
      <div class="row-actions">${
        step.final
          ? `<button class="linkish" data-tour="end">Keep exploring</button><button class="btn small" data-tour="add">Add your statements</button>`
          : `<button class="linkish" data-tour="end">Skip the tour</button><span>${at ? `<button class="btn small quiet" data-tour="back">Back</button> ` : ""}<button class="btn small" data-tour="next">Next</button></span>`
      }</div>`;
    [step.target?.()]
      .flat()
      .filter(Boolean)
      .at(-1)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
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
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
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
    let seen = false;
    try {
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {}
    if (!seen) startTour();
  }

  return { maybeStartTour, startTour };
}
