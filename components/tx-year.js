import { esc } from "../helpers.js";
import { coveredMonths, typicalMonth } from "../story/moment-kit.js";
import { dayShort, monthLong } from "../story/copy.js";
import { yearMonthStory, yearStory } from "../story/year.js";
import { sameIds, wireHoverHighlight } from "../ui/highlight.js";
import { emitHighlight, subscribeWhileConnected } from "./base.js";
import { bandHTML } from "./tx-year-band.js";
import { answeredHTML, askHTML } from "./tx-year-ask.js";
import { wireYearStrip } from "./tx-year-strip.js";
import { savedHTML } from "./tx-year-saved.js";
import { whatGoes } from "../assistant/prompts.js";
import { answerStory } from "../story/saved-question.js";

const PRIVATE = "Only you see this. Your answer stays on this device.";

// <tx-year>: artboard 3 without its side panel (the bench is M4, and has an
// empty slot here). The Year scale tells the covered months as sections,
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
    story: null,
  };
  // The saved question picked from the story list, if it still exists.
  const picked = () =>
    ui.story && state.reports.find((r) => `r:${r.id}` === ui.story);

  const parts = (ps) =>
    ps
      .map((p) =>
        p.chip
          ? `<span class="yr-chipinline" title="A period you named">${esc(p.chip)}</span>`
          : p.txnIds?.length
            ? `<span class="sp" tabindex="0" data-ids="${esc(p.txnIds.join(","))}">${esc(p.text)}</span>`
            : esc(p.text),
      )
      .join("");
  const para = (ps, cls = "") =>
    `<p${cls ? ` class="${cls}"` : ""} dir="auto">${parts(ps)}</p>`;

  function months() {
    return runtime.derived ? coveredMonths(runtime.derived) : [];
  }
  function currentMonth(ms) {
    if (!ms.includes(state.monthView)) state.monthView = ms.at(-1) ?? null;
    return state.monthView;
  }

  function pickerHTML(ms, year, month) {
    const opt = (v, label, sel) =>
      `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
    const periods = (state.periods || []).filter(
      (p) => p.start <= `${ms.at(-1)}-31` && p.end >= `${ms[0]}-01`,
    );
    return `<div class="yr-pick">
      <label for="story-pick" class="yr-side">Story</label>
      <div class="yr-pickrow">
        <select id="story-pick">
          <optgroup label="Told from your statements">${opt("year", "Your year so far", year && !picked())}${[
            ...ms,
          ]
            .reverse()
            .map((m) => opt(`m:${m}`, monthLong(m), !year && m === month))
            .join("")}</optgroup>
          ${periods.length ? `<optgroup label="Your periods">${periods.map((p) => opt(`p:${p.id}`, p.name, false)).join("")}</optgroup>` : ""}
          ${state.reports.length ? `<optgroup label="Your saved questions">${state.reports.map((r) => opt(`r:${r.id}`, r.q, ui.story === `r:${r.id}`)).join("")}</optgroup>` : ""}
        </select>
        <button class="yr-small" data-open="reports">Make your own story</button>
      </div>
    </div>`;
  }

  function stretchAsk(s) {
    const st = s.stretch;
    if (ui.naming === st.id)
      return `<div class="yr-card">
        <label for="stretch-name" class="yr-namelabel">Name this stretch</label>
        <div class="yr-namerow">
          <input id="stretch-name" value="${esc(ui.name)}" placeholder="In your own words">
          <button class="yr-dark" data-save-stretch="${esc(st.id)}" data-from="${esc(s.from)}" data-to="${esc(s.to)}">Save as a period</button>
          <button class="yr-chipbtn quiet" data-cancel>Cancel</button>
        </div>
        <p class="yr-fine">It covers ${esc(st.when)}. You can change the dates on the timeline.</p>
      </div>`;
    if (st.skipped)
      return `<p class="yr-result">Left unnamed. You can name it from the timeline any time.</p>`;
    return `<div class="yr-card">
      <div class="yr-when">Optional · ${esc(st.when)}</div>
      <p class="yr-qtext">Want to say what this was for? A name turns it into a period, and the story will use it.</p>
      <div class="yr-chips">
        <button class="yr-chipbtn" data-name-stretch="${esc(st.id)}">Name this stretch</button>
        <button class="yr-chipbtn" data-name-stretch="${esc(st.id)}">Write a note</button>
        <button class="yr-chipbtn quiet" data-skip-stretch="${esc(st.id)}">Skip</button>
      </div>
      <p class="yr-fine">${PRIVATE}</p>
    </div>`;
  }

  function sectionHTML(s, i) {
    const body = s.paragraphs.map((p) => para(p)).join("");
    const head = s.chip
      ? `<div class="yr-headchip"><span class="yr-chipheading" title="A period you named">${esc(s.chip)}</span></div>`
      : s.stretch
        ? `<div class="yr-headchip"><span class="yr-unnamed">A busy stretch, not named yet</span></div>`
        : "";
    const note =
      (s.note
        ? `<div class="yr-note"><div class="yr-notelabel">${esc(s.note.label)}</div><div class="yr-notetext" dir="auto">${esc(s.note.text)}</div></div>`
        : "") + notesHTML(s.notes ?? []);
    return `<section class="yr-sec${i ? "" : " first"}" data-sec="${esc(s.id)}" data-from="${esc(s.from)}" data-to="${esc(s.to)}">
      <div class="yr-side"><div class="yr-seclabel">${esc(s.label)}</div></div>
      <div class="yr-col-story${head ? "" : " prose"}">
        ${head}${head ? `<div class="yr-prose">${body}</div>` : body}${note}
        ${s.after ? `<div class="yr-prose">${para(s.after)}</div>` : ""}
        ${s.stretch ? stretchAsk(s) : ""}
        ${s.month && (s.chip || s.stretch) ? `<button class="yr-quiet" data-month="${esc(s.month)}">See ${esc(monthLong(s.month).split(" ")[0])} day by day</button>` : ""}
      </div>
    </section>`;
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
      ${y.sections.map(sectionHTML).join("")}
      <div class="yr-foot"><div class="yr-side"></div><div class="yr-col-story yr-footbox">
        <div class="yr-chips"><button class="yr-chipbtn" data-mark-period>Mark a period</button><button class="yr-chipbtn" data-open="month">Write a note</button><button class="yr-chipbtn" data-open="reports">Tell the story of something else</button></div>
        <p class="yr-fine">This story is written from your statements and your notes, and it changes when you add either.</p>
      </div></div>
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

  // The story column, and an empty slot for the bench (M4).
  function pageHTML(band, ms, year, month, story) {
    return `${band}<main class="yr-main"><div class="yr-story">${pickerHTML(ms, year, month)}${!year ? monthHTML(story) : picked() ? savedHTML(picked(), answerStory(picked().answer, runtime.derived.byId), { canRun: caps.sample }) : yearHTML(story)}</div><aside class="yr-bench" aria-label="Details and tools"></aside></main>`;
  }

  // The notes written on a period's payments, each with its day.
  const notesHTML = (notes) =>
    notes.length
      ? `<div class="yr-note"><div class="yr-notelabel">Your notes</div><div class="yr-notegrid">${notes.map((n) => `<span class="yr-notedate">${esc(dayShort(n.date))}</span><span dir="auto">${esc(n.text)}</span>`).join("")}</div></div>`
      : "";

  function monthHTML(m) {
    const periods = m.periods
      .map(
        (
          p,
        ) => `<div class="yr-headchip"><span class="yr-chipheading" title="A period you named">${esc(p.name)}</span> <span class="yr-dates">${esc(p.dates)}</span></div>
        <div class="yr-prose">${para(p.parts)}</div>
        ${p.description ? `<div class="yr-note"><div class="yr-notelabel">Your description</div><div class="yr-notetext" dir="auto">${esc(p.description)}</div></div>` : ""}
        ${notesHTML(p.notes)}`,
      )
      .join("");
    return `<div class="yr-intro">
      <div class="yr-side top"><button class="yr-quiet" data-to-year>‹ Your year</button></div>
      <div class="yr-col-story">
        <h1>${esc(m.label)}</h1>
        ${m.lead.length ? para(m.lead, "yr-lead month") : ""}
        ${periods}
        <div class="yr-prose after">${m.paragraphs.map((p) => para(p)).join("")}</div>
        ${m.numbersHint ? `<p class="yr-hint yr-numhint">Turn on Numbers to see each thread against its budget.</p>` : ""}
      </div>
    </div>`;
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
            ? yearStory(d, state)
            : yearMonthStory(d, state, month, { numbers: state.numbers });
          if (year && !this.story?.sections.some((s) => s.id === ui.sec))
            ui.sec = this.story?.sections[0]?.id ?? null;
          const sec = year && this.story?.sections.find((s) => s.id === ui.sec);
          const band = bandHTML(d, state, {
            year,
            months: ms,
            month,
            today: runtime.today,
            compact: !!state.compactTimeline,
            numbers: state.numbers,
            typical: typicalMonth(d),
            label: year ? this.story.title : monthLong(month),
            focus: sec ? { from: sec.from, to: sec.to } : null,
          });
          const focus = this.querySelector("textarea:focus") ? "ask" : null;
          this.innerHTML = pageHTML(band, ms, year, month, this.story);
          if (focus) this.querySelector("#ask")?.focus();
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
          this.querySelectorAll(".yr-bead").forEach((b) => {
            const on = hl.has(b.dataset.id);
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
            if (e.target.id === "ask") ui.text = e.target.value;
            if (e.target.id === "stretch-name") ui.name = e.target.value;
          });
          this.addEventListener("click", (e) => {
            const t = e.target.closest("button");
            if (!t) return;
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
            } else if ("connectAi" in d) actions.openAISettings();
            else if ("askPreview" in d) {
              if (ui.text.trim()) ((ui.ask = "preview"), this.render());
            } else if ("askBack" in d) ((ui.ask = "idle"), this.render());
            else if ("askSend" in d) {
              ui.asked = ui.text.trim();
              ui.ask = "idle";
              ui.text = "";
              this.dispatchEvent(
                new CustomEvent("tx-ask", {
                  bubbles: true,
                  detail: { question: ui.asked },
                }),
              );
            } else if (d.addBudget)
              this.dispatchEvent(
                new CustomEvent("tx-add-budget", {
                  bubbles: true,
                  detail: { thread: d.addBudget },
                }),
              );
            else if (d.runQuestion)
              this.dispatchEvent(
                new CustomEvent("tx-run-question", {
                  bubbles: true,
                  detail: { id: d.runQuestion },
                }),
              );
            else if (d.removeQuestion) {
              state.reports = state.reports.filter(
                (r) => r.id !== d.removeQuestion,
              );
              actions.save("reports");
              this.go("year");
            } else if (d.changeQuestion) {
              ui.text = picked()?.q ?? "";
              ui.story = null;
              ui.ask = "idle";
              this.go("year");
              this.querySelector("#ask")?.focus();
            } else if ("saveQuestion" in d)
              this.dispatchEvent(
                new CustomEvent("tx-save-question", {
                  bubbles: true,
                  detail: { question: ui.asked },
                }),
              );
            else if ("askAgain" in d) {
              ui.ask = "idle";
              this.render();
              this.querySelector("#ask")?.focus();
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
  requires: ["AI", "highlight", "openAISettings", "refresh", "save"],
  renders: [],
  wires: ["defineYear"],
};
