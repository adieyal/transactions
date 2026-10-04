import { esc } from "../helpers.js";
import { wireTip } from "./tip.js";
import { coveredMonths, typicalMonth } from "../story/moment-kit.js";
import { monthLong } from "../story/copy.js";
import { yearMonthStory, yearStory } from "../story/year.js";
import { sameIds } from "../ui/highlight.js";
import { wireLinkedRefs } from "./linked-ref.js";
import { beadStops, wireBeadKeys } from "./bead-keys.js";
import { subscribeWhileConnected } from "./base.js";
import { bandHTML } from "./tx-year-band.js";
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

// <tx-year>: artboard 3, the timeline band, the story column and the bench
// beside it (tx-year-bench.js). The Year scale tells the covered months as sections,
// each lighting its stretch of the timeline while pointed at; the Month
// scale is one month inside the year. Its Ask section holds the app's one
// chat, <tx-chat> (components/tx-chat.js), kept across re-renders.
export function createYearComponent(runtime, actions) {
  const { state, caps } = runtime;
  const ui = {
    sec: null,
    naming: null,
    name: "",
    // "Ask about these": the question the chat starts with.
    askAbout: "",
    bench: "details",
    manyName: "",
    manyMsg: "",
    told: false,
    toldSaved: false,
    tagging: false,
    tag: "",
    activeLine: null,
  };
  // What the bench (tx-year-bench.js) may do, through this contract.
  const benchActions = {
    addBlankLens: () => actions.addBlankLens(),
    addPeriod: (...a) => actions.addPeriod(...a),
    addReport: (...a) => actions.addReport(...a),
    bulkTag: (...a) => actions.bulkTag(...a),
    highlight: (ids) => actions.highlight(ids),
    openLensEditor: (id) => actions.openLensEditor(id),
    refresh: () => actions.refresh(),
    refreshSoon: () => actions.refreshSoon(),
    restoreStarterLenses: () => actions.restoreStarterLenses(),
    save: (k) => actions.save(k),
  };
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
      <section class="yr-sec" aria-label="Ask"><div class="yr-side"><div class="yr-seclabel">Ask</div></div><div class="yr-col-story" data-chat-slot></div></section>`;
  }

  // The story column, and the bench beside it.
  function pageHTML(band, ms, year, month, story) {
    return `${band}<main class="yr-main"><div class="yr-story">${pickerHTML(ms, year, month, { state, ui, picked: null })}${!year ? monthHTML(story) : yearHTML(story)}</div><aside class="yr-bench${state.compactTimeline ? " sticky" : ""}" aria-label="Details and tools">${benchHTML(ui, runtime)}</aside></main>`;
  }

  // The chat element, once <tx-chat> is defined (components/tx-chat.js).
  const newChat = () => {
    const Chat = customElements.get("tx-chat");
    return Chat ? new Chat() : null;
  };

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
          // The chat moves into the new page as it is, mid-question or
          // mid-sentence, keeping its focus.
          const typing = this.chat?.contains(f) && f;
          this.innerHTML = pageHTML(band, ms, year, month, this.story);
          const slot = this.querySelector("[data-chat-slot]");
          this.chat ||= newChat();
          if (slot && this.chat) slot.append(this.chat);
          if (typing) {
            typing.focus();
            typing.setSelectionRange(at[0], at[1]);
          }
          if (left) this.querySelector(".yr-scroll").scrollLeft = left;
          beadStops(this, ".yr-bead[data-id]");
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
          if (ui.focusAsk && this.chat?.isConnected) {
            ui.focusAsk = false;
            this.chat.prefill(ui.askAbout);
            this.chat.scrollIntoView({ block: "center" });
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
          // The header's filter: matches stay lit and the rest dim.
          const matched = runtime.derived?.matched;
          this.querySelectorAll(".yr-bead").forEach((b) => {
            const on = hl.has(b.dataset.id);
            const out = !!matched && !matched.has(b.dataset.id);
            b.classList.toggle("sel", sel.has(b.dataset.id));
            b.classList.toggle("dim", (lit && !on) || out);
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
          wireTip(this, () => runtime.derived?.byId);
          wireLinkedRefs(this, runtime);
          wireBeadKeys(this, ".yr-bead[data-id]");
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
            // A saved question opens in Reports (ui/reports.js), where it
            // runs again and is removed with Undo.
            if (v.startsWith("r:"))
              this.dispatchEvent(
                new CustomEvent("tx-open-bench", {
                  bubbles: true,
                  detail: { tab: "reports", ids: [] },
                }),
              );
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
          // A question sent from the Ask section folds the timeline to its
          // compact strip, as a selection does (Copy rules s9), so the
          // question and its progress stay in view below it.
          const sent = (e) => {
            if (!this.chat?.contains(e.target) || state.compactTimeline) return;
            state.compactTimeline = true;
            this.render();
            const q = this.chat.querySelectorAll(".q");
            q[q.length - 1]?.scrollIntoView({ block: "nearest" });
          };
          this.addEventListener("click", (e) => {
            if (e.target.closest(".ch-send, [data-sug]")) sent(e);
          });
          this.addEventListener("keydown", (e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              e.target.closest(".ch-input")
            )
              sent(e);
          });
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
            }
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
    "Store",
    "addBlankLens",
    "addPeriod",
    "addReport",
    "bulkTag",
    "highlight",
    "openLensEditor",
    "refresh",
    "refreshSoon",
    "restoreStarterLenses",
    "save",
  ],
  renders: [],
  wires: ["defineYear"],
};
