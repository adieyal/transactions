import { esc } from "../helpers.js";
import { wireTip } from "./tip.js";
import { stackPeriods, wirePeriodEdit } from "./period-edit.js";
import { coveredMonths, typicalMonth } from "../story/moment-kit.js";
import { monthLong } from "../story/copy.js";
import { yearMonthStory, yearStory } from "../story/year.js";
import { sameIds, wireHoverHighlight } from "../ui/highlight.js";
import { emitHighlight, subscribeWhileConnected } from "./base.js";
import { bandHTML } from "./tx-year-band.js";
import { answeredHTML, askClick, askHTML } from "./tx-year-ask.js";
import { stripTime, wireYearStrip } from "./tx-year-strip.js";
import { savedHTML } from "./tx-year-saved.js";
import { rerunGoes, whatGoes } from "../assistant/prompts.js";
import { answerStory, sinceLastRun } from "../story/saved-question.js";
import {
  benchClick,
  benchHTML,
  benchInput,
  resetBench,
  selectedIds,
} from "./tx-year-bench.js";
import { wireGather } from "./tx-year-gather.js";
import {
  monthHTML,
  para,
  pickerHTML,
  sectionHTML,
  storyLensesHTML,
} from "./tx-year-story.js";
import { showLensView, wireLensView } from "./tx-year-lens.js";
import { applySuggestion, suggestKey } from "./tx-year-saved.js";

// <tx-year>: artboard 3, the timeline band, the story column and the bench
// beside it (tx-year-bench.js). The Year scale tells the covered months as sections,
// each lighting its stretch of the timeline while pointed at; the Month
// scale is one month inside the year. Asking goes through the app's chat
// (actions.ask), only when Send is pressed.
export function createYearComponent(runtime, actions) {
  const { state, caps } = runtime;
  const ui = {
    sec: null,
    naming: null,
    name: "",
    ask: "idle",
    text: "",
    asked: null,
    rerun: null,
    story: null,
    bench: "details",
    manyName: "",
    manyMsg: "",
    told: false,
    toldSaved: false,
    tagging: false,
    tag: "",
    activeLine: null,
    // Suggested changes chosen, by suggestKey: { status, previous }.
    suggest: {},
  };
  // What the bench and the Ask area (tx-year-bench.js, tx-year-ask.js) may
  // do, through this contract.
  const benchActions = {
    addBlankLens: () => actions.addBlankLens(),
    addPeriod: (...a) => actions.addPeriod(...a),
    addReport: (...a) => actions.addReport(...a),
    bulkTag: (...a) => actions.bulkTag(...a),
    highlight: (ids) => actions.highlight(ids),
    openAISettings: () => actions.openAISettings(),
    openLensEditor: (id) => actions.openLensEditor(id),
    refresh: () => actions.refresh(),
    refreshSoon: () => actions.refreshSoon(),
    restoreStarterLenses: () => actions.restoreStarterLenses(),
    save: (k) => actions.save(k),
  };
  // The saved question picked from the story list, if it still exists.
  const picked = () =>
    ui.story && state.reports.find((r) => `r:${r.id}` === ui.story);

  function months() {
    return runtime.derived ? coveredMonths(runtime.derived) : [];
  }
  function currentMonth(ms) {
    if (!ms.includes(state.monthView)) state.monthView = ms.at(-1) ?? null;
    return state.monthView;
  }

  function yearHTML(y) {
    return `<div class="yr-intro">
        <div class="yr-side top">Your year so far</div>
        <div class="yr-col-story">
          <h1>${esc(y.title)}</h1>
          ${para(y.lead, "yr-lead")}
          <p class="yr-hint">Point at underlined text to find it on the timeline. Names and notes in boxes are your own words.</p>
        </div>
      </div>
      ${y.sections.map((s, i) => sectionHTML(s, i, ui, actions.Store.backend.kind)).join("")}
      <div class="yr-foot"><div class="yr-side"></div><div class="yr-col-story yr-footbox">
        <div class="yr-chips"><button class="yr-chipbtn" data-mark-period>Mark a period</button><button class="yr-chipbtn" data-open="month">Write a note</button><button class="yr-chipbtn" data-open="reports">Tell the story of something else</button></div>
        <p class="yr-fine">This story is written from your statements and your notes, and it changes when you add either.</p>
      </div></div>
      ${storyLensesHTML(state)}
      ${answeredHTML(ui, state, actions.AI(), runtime.derived.byId)}
      <section class="yr-sec" aria-label="Ask"><div class="yr-side"><div class="yr-seclabel">Ask</div></div><div class="yr-col-story">${askHTML(
        ui,
        caps,
        actions.AI(),
        whatGoes({
          question: ui.text.trim(),
          ai: actions.AI(),
          tools: !!caps.tools,
          earlier: state.turns.filter((t) => !t.pending).length,
          selected: [...state.selection].length,
        }),
      )}</div></section>`;
  }

  function savedQuestionHTML(r) {
    const story = answerStory(r.answer, runtime.derived.byId);
    return savedHTML(r, story, {
      canRun: caps.sample,
      since: sinceLastRun(r, story, runtime.derived),
      byId: runtime.derived.byId,
      suggested: (sg) => ui.suggest[suggestKey(sg)]?.status,
      ai: actions.AI(),
      rerun: ui.rerun === r.id && {
        id: r.id,
        ...rerunGoes({
          question: r.q,
          ai: actions.AI(),
          tools: !!caps.tools,
          ranAt: r.answer && r.ranAt,
        }),
      },
    });
  }

  // The story column, and the bench beside it.
  function pageHTML(band, ms, year, month, story) {
    return `${band}<main class="yr-main"><div class="yr-story">${pickerHTML(ms, year, month, { state, ui, picked: picked() })}${!year ? monthHTML(story) : picked() ? savedQuestionHTML(picked()) : yearHTML(story)}</div><aside class="yr-bench${state.compactTimeline ? " sticky" : ""}" aria-label="Details and tools">${benchHTML(ui, runtime)}</aside></main>`;
  }

  function defineYear() {
    if (customElements.get("tx-year")) return;
    customElements.define(
      "tx-year",
      class extends HTMLElement {
        connectedCallback() {
          if (!this.wired) this.wire();
          subscribeWhileConnected(this, runtime.store, (change) =>
            change === "highlight" ? this.mark() : this.render(),
          );
          this.render();
        }
        render() {
          if (!state.loaded || this.hidden) return;
          const ms = months();
          if (ms.length < 2) return void (this.innerHTML = "");
          const year = state.scale !== "month";
          const month = currentMonth(ms);
          const d = runtime.derived;
          this.story = year
            ? yearStory(d, state, runtime.today)
            : yearMonthStory(d, state, month, { numbers: state.numbers });
          if (year && !this.story?.sections.some((s) => s.id === ui.sec))
            ui.sec = this.story?.sections[0]?.id ?? null;
          const sec = year && this.story?.sections.find((s) => s.id === ui.sec);
          const band = bandHTML(d, state, {
            year,
            months: ms,
            month,
            today: runtime.today,
            expected: year ? (this.story?.expected ?? []) : [],
            compact: !!state.compactTimeline,
            numbers: state.numbers,
            typical: typicalMonth(d),
            label: year ? this.story.title : monthLong(month),
            focus: sec ? { from: sec.from, to: sec.to } : null,
          });
          // A field being typed in keeps its focus and caret.
          const f = this.querySelector("input:focus, textarea:focus");
          const at = f && [f.selectionStart, f.selectionEnd];
          // The timeline's own scroller keeps its place.
          const left = this.querySelector(".yr-scroll")?.scrollLeft;
          this.innerHTML = pageHTML(band, ms, year, month, this.story);
          stackPeriods(this, ".yr-periods");
          if (left) this.querySelector(".yr-scroll").scrollLeft = left;
          const back = f?.id && this.querySelector(`#${CSS.escape(f.id)}`);
          if (back && "value" in back) {
            back.focus();
            if (at[0] != null) back.setSelectionRange(at[0], at[1]);
          }
          showLensView(this, ui);
          if (ui.focusTag) {
            ui.focusTag = false;
            this.querySelector("#bench-tag")?.focus();
          }
          if (ui.focusAsk) {
            ui.focusAsk = false;
            const ask = this.querySelector("#ask");
            ask?.focus();
            ask?.setSelectionRange(ask.value.length, ask.value.length);
            ask?.scrollIntoView({ block: "center" });
          }
          const bandEl = this.querySelector(".yr-band");
          if (bandEl)
            this.style.setProperty("--yr-band-h", `${bandEl.offsetHeight}px`);
          this.markWindow();
          this.mark();
        }
        // The section pointed at: its months bold on the axis, and the
        // window over them on the timeline.
        markWindow() {
          const sec = this.story?.sections?.find((s) => s.id === ui.sec);
          this.querySelectorAll(".yr-col[data-month]").forEach((c) => {
            const m = c.dataset.month;
            c.classList.toggle(
              "on",
              !!sec && m >= sec.from.slice(0, 7) && m <= sec.to.slice(0, 7),
            );
          });
        }
        mark() {
          const hl = state.highlight;
          const lit = hl.size > 0;
          const ring = lit && !sameIds(this.story?.allIds ?? [], hl);
          this.querySelectorAll(".sp[data-ids]").forEach((sp) =>
            sp.classList.toggle("on", sameIds(sp.dataset.ids.split(","), hl)),
          );
          const sel = state.selection;
          this.querySelectorAll(".yr-bead").forEach((b) => {
            const on = hl.has(b.dataset.id);
            b.classList.toggle("sel", sel.has(b.dataset.id));
            b.classList.toggle("dim", lit && !on);
            b.classList.toggle("ring", ring && on);
          });
          const threads = new Set();
          this.querySelectorAll(".yr-bead.ring").forEach((b) =>
            threads.add(b.closest(".yr-row")?.dataset.thread),
          );
          this.querySelectorAll(".yr-row").forEach((r) =>
            r.classList.toggle("focus", threads.has(r.dataset.thread)),
          );
        }
        // A new selection: Details, with the timeline folded to its compact
        // strip so both stay in view (Copy rules s9).
        pick(ids, toggle) {
          const sel = new Set(toggle ? selectedIds(runtime) : []);
          for (const id of ids)
            if (toggle && sel.has(id)) sel.delete(id);
            else sel.add(id);
          state.selection = sel;
          resetBench(ui);
          ui.manyName = "";
          if (sel.size) state.compactTimeline = true;
          state.highlight = new Set();
          actions.refresh();
        }
        go(scale, month) {
          state.scale = scale;
          if (month) state.monthView = month;
          if (scale === "year") state.range = "all";
          actions.highlight([]);
          actions.refresh();
        }
        wire() {
          this.wired = true;
          wireYearStrip(this);
          wireTip(this, () => runtime.derived?.byId);
          wirePeriodEdit(this, {
            strip: ".yr-periods",
            bands: ".yr-pband",
            inv: stripTime,
            redraw: () => this.render(),
            state,
            actions: {
              save: (k) => actions.save(k),
              refresh: () => actions.refresh(),
              removePeriod: (id) => actions.removePeriod(id),
            },
          });
          wireHoverHighlight(this, runtime, (ids) =>
            emitHighlight(this, [...ids]),
          );
          this.addEventListener("mouseover", (e) => {
            const sec = e.target.closest?.(".yr-sec[data-sec]");
            if (sec && sec.dataset.sec !== ui.sec) {
              ui.sec = sec.dataset.sec;
              this.render();
            }
          });
          this.addEventListener("change", (e) => {
            if (e.target.id !== "story-pick") return;
            const v = e.target.value;
            ui.story = v.startsWith("r:") ? v : null;
            if (v.startsWith("r:")) this.go("year");
            else if (v === "year") this.go("year");
            else if (v.startsWith("m:")) this.go("month", v.slice(2));
            else if (v.startsWith("p:")) {
              ui.sec = `period-${v.slice(2)}`;
              this.go("year");
              this.querySelector(
                `[data-sec="${CSS.escape(ui.sec)}"]`,
              )?.scrollIntoView({ block: "start" });
            }
          });
          this.addEventListener("input", (e) => {
            if (benchInput(e, ui, runtime, benchActions)) return;
            if (e.target.id === "ask") ui.text = e.target.value;
            if (e.target.id === "stretch-name") ui.name = e.target.value;
          });
          this.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && e.target.id === "bench-tag") {
              e.preventDefault();
              this.querySelector("[data-bench-tag-add]")?.click();
            }
          });
          // Click a bead for its details; shift-click to add or take it out.
          wireGather(this, (ids, add) => this.pick(ids, add));
          wireLensView(this);
          this.addEventListener("click", (e) => {
            const bead = e.target.closest(".yr-bead[data-id]");
            if (bead) return this.pick([bead.dataset.id], e.shiftKey);
            const t = e.target.closest("button");
            if (!t) return;
            if (t.closest(".yr-bench")) {
              if (benchClick(t, ui, runtime, benchActions, this)) {
                if (ui.focusAsk) this.go("year");
                else this.render();
              }
              return;
            }
            const d = t.dataset;
            if (d.suggestApply || d.suggestDiscard || d.suggestUndo)
              return applySuggestion(d, ui, state, actions);
            if ("toYear" in d) this.go("year");
            else if (d.month) this.go("month", d.month);
            else if (t.classList.contains("yr-compact")) {
              state.compactTimeline = !state.compactTimeline;
              this.render();
            } else if (d.open)
              this.dispatchEvent(
                new CustomEvent("tx-open-bench", {
                  bubbles: true,
                  detail: { tab: d.open, ids: [] },
                }),
              );
            else if (d.period)
              this.dispatchEvent(
                new CustomEvent("tx-open-period", {
                  bubbles: true,
                  detail: { id: d.period },
                }),
              );
            else if (d.stretch || d.nameStretch) {
              ui.naming = d.stretch || d.nameStretch;
              ui.name = "";
              if (state.scale === "month") this.go("year");
              else this.render();
              this.querySelector("#stretch-name")?.focus();
            } else if ("cancel" in d) {
              ui.naming = null;
              this.render();
            } else if (d.skipStretch) {
              state.answers = {
                ...state.answers,
                [d.skipStretch]: {
                  status: "skipped",
                  choice: null,
                  note: null,
                  created: null,
                  at: runtime.today,
                },
              };
              actions.save("answers");
              this.render();
            } else if (d.saveStretch) {
              const name = ui.name.trim();
              if (!name) return this.querySelector("#stretch-name")?.focus();
              ui.naming = null;
              this.dispatchEvent(
                new CustomEvent("tx-mark-period", {
                  bubbles: true,
                  detail: { start: d.from, end: d.to, name },
                }),
              );
            } else
              askClick(this, d, { ui, state, actions: benchActions, picked });
          });
        }
      },
    );
  }

  return { defineYear };
}

export const contract = {
  name: "tx-year",
  create: createYearComponent,
  provides: ["defineYear"],
  requires: [
    "AI",
    "Store",
    "addBlankLens",
    "addPeriod",
    "addReport",
    "bulkTag",
    "highlight",
    "openAISettings",
    "openLensEditor",
    "refresh",
    "refreshSoon",
    "removePeriod",
    "restoreStarterLenses",
    "save",
  ],
  renders: [],
  wires: ["defineYear"],
};
