import { esc } from "../helpers.js";
import { wireTip } from "./tip.js";
import { handlesHTML, wirePeriodEdit } from "./period-edit.js";
import { coveredMonths } from "../story/moments.js";
import { answerKept, dayShort, monthLong } from "../story/copy.js";
import {
  oneMonthStory,
  periodStrip,
  regularResult,
} from "../story/one-month.js";
import { phraseHTML, sameIds, wireHoverHighlight } from "../ui/highlight.js";
import { emitHighlight, subscribeWhileConnected } from "./base.js";

const ACCEPT = ".xls,.xlsx,.csv,.txt,.html,.htm";
const STEPS = [
  [
    "One month",
    () =>
      "The shape of your month: its busiest days and weeks, and where it went.",
  ],
  [
    "Two months",
    (s) =>
      `How ${monthLong(s.month).split(" ")[0]} compares with ${monthLong(s.previous).split(" ")[0]}.`,
  ],
  [
    "Three months or more",
    () => "What a typical month looks like, and which payments repeat.",
  ],
  ["A year", () => "Your year on one line, and the stretches that stood out."],
];
const step = (months) => (months >= 12 ? 3 : months >= 3 ? 2 : months - 1);
const pct = (n) => n.toFixed(2);
const HINT =
  "Drag along this strip to mark a stretch that mattered. Busy stretches the app finds will be outlined here too.";

// <tx-one-month>: artboard 2, a single month. The timeline band with a row
// per thread, the month's story, the optional question, the loose ends and
// the "As you add statements" aside. Hovering or focusing a dotted phrase
// asks for its payments to be lit up (tx-highlight); the store's highlight
// then dims the other beads, rings the matched ones and bolds the days.
export function createOneMonthComponent(runtime, actions) {
  const { state } = runtime;
  // A dotted phrase; one about a stretch of days also names them, so the
  // axis can bold them while it is lit.
  const phrase = (p) =>
    p.days && p.txnIds?.length
      ? `<span class="sp" tabindex="0" data-ids="${esc(p.txnIds.join(","))}" data-days="${esc(p.days.join("-"))}">${esc(p.text)}</span>`
      : phraseHTML(p, esc);
  const parts = (ps) => ps.map(phrase).join("");

  // The month shown: the app's month, or the latest with statements.
  function current() {
    const ms = runtime.derived ? coveredMonths(runtime.derived) : [];
    if (!ms.includes(state.monthView)) state.monthView = ms.at(-1) ?? null;
    return state.monthView;
  }

  function bandHTML(s) {
    const days = s.axis.length;
    const x = (d) => pct(((d - 0.5) / days) * 100);
    const axis = s.axis
      .map(
        (a) =>
          `<div class="om-day" data-day="${esc(a.day)}" style="left: ${x(a.day)}%">${esc(a.day)} ${esc(a.weekday)}</div>`,
      )
      .join("");
    const grid = [0, 7, 14, 21, 28]
      .map(
        (d) =>
          `<div class="om-gridline" style="left: ${pct((d / days) * 100)}%"></div>`,
      )
      .join("");
    const rows = s.rows
      .map(
        (r) => `<div class="om-row">
          <div class="om-rowhead"><span class="om-thread" style="color: ${esc(r.color)}">${esc(r.thread)}</span>${r.starter ? `<span class="om-starter">starter</span>` : ""}</div>
          <div class="om-track"><div class="om-line"></div>${r.beads
            .map(
              (b) =>
                `<div class="om-bead" data-id="${esc(b.id)}" data-tip="${esc(`${dayShort(b.date)} · ${b.merchant} · ${b.amount}`)}" aria-label="${esc(`${dayShort(b.date)} · ${b.merchant} · ${b.amount}`)}" style="left: ${x(b.day)}%; width: ${esc(b.size)}px; height: ${esc(b.size)}px; background: ${esc(r.color)}"></div>`,
            )
            .join("")}</div>
        </div>`,
      )
      .join("");
    // Periods are tinted bands and busy stretches dashed outlines, across
    // the rows, each with its chip on the strip (as artboard 3 draws them).
    const { periods, stretches } = s.strip;
    const at = (p) =>
      `left: ${pct(((p.from - 1) / days) * 100)}%; width: ${pct(((p.to - p.from + 1) / days) * 100)}%`;
    const bands = [
      ...periods.map(
        (p) =>
          `<div class="om-pband" data-pid="${esc(p.id)}" style="${at(p)}"></div>`,
      ),
      ...stretches.map((b) => `<div class="om-sband" style="${at(b)}"></div>`),
    ].join("");
    const chips = [
      ...periods.map(
        (p) =>
          `<button class="om-pchip" data-period="${esc(p.id)}" data-tip="A period you named. Drag to move it, or click to rename or delete it." style="left: ${pct(((p.from - 1) / days) * 100)}%">${esc(p.name)}</button>${handlesHTML(p.id, pct(((p.from - 1) / days) * 100), pct((p.to / days) * 100))}`,
      ),
      ...stretches.map(
        (b) =>
          `<button class="sp om-schip" data-ids="${esc(b.txnIds.join(","))}" data-days="${esc(`${b.from}-${b.to}`)}" aria-label="${esc(b.aria)}" style="left: ${pct(((b.from - 1) / days) * 100)}%">${esc(b.label)}<span aria-hidden="true" class="om-q">?</span></button>`,
      ),
    ].join("");
    const empty = !periods.length && !stretches.length;
    return `<section class="om-band" aria-label="Timeline"><div class="om-scroll"><div class="om-inner">
      <div class="om-axisrow"><div class="om-month">${esc(s.label)}</div><div class="om-axis">${axis}</div></div>
      <div class="om-periodsrow"><div class="om-periodslabel">Periods</div><div class="om-periods${empty ? "" : " filled"}" data-tip="Drag along this strip to mark a period">${empty ? esc(HINT) : chips}<div class="om-pnew" hidden></div></div></div>
      <div class="om-rows"><div class="om-grid">${grid}${bands}</div>${rows}</div>
    </div></div></section>`;
  }

  function questionHTML(q) {
    if (!q) return "";
    if (q.answer) return `<p class="om-result">${esc(regularResult(q))}</p>`;
    const [, , d] = q.date.split("-").map(Number);
    return `<div class="om-card">
      <div class="om-qwhen">Optional · ${esc(`${d} ${monthLong(q.date.slice(0, 7)).split(" ")[0]}`)}</div>
      <p class="om-qtext" dir="auto">${esc(q.text)}</p>
      <div class="om-chips">
        <button class="om-chip" data-answer="monthly">Every month</button>
        <button class="om-chip" data-answer="not">Not regular</button>
        <button class="om-chip quiet" data-answer="skip">Skip</button>
      </div>
      <p class="om-qnote">Not sure? Your next statement will show it either way. ${esc(`Only you see this, and ${answerKept(actions.Store.backend.kind)}.`)}</p>
    </div>`;
  }

  function asideHTML(s) {
    const now = step(s.months);
    return `<aside class="om-aside" aria-label="As you add statements">
      <h2>As you add statements</h2>
      <p class="om-asidenote">Each month you add lets the story say more.</p>
      <ol>${STEPS.map(
        ([title, text], i) =>
          `<li><span aria-hidden="true" class="om-tick${i <= now ? " done" : ""}">${i <= now ? "✓" : ""}</span><div><div class="om-steptitle">${esc(title)}</div><div class="om-steptext">${esc(text(s))}</div></div></li>`,
      ).join("")}</ol>
      <label class="om-add">Add more statements<input class="om-files vh" type="file" multiple accept="${ACCEPT}"></label>
      <p class="om-tip">Most banks let you export several months in one file.</p>
    </aside>`;
  }

  function pageHTML(s) {
    return `${bandHTML(s)}
    <main class="om-main">
      <div class="om-source">${s.source.map(esc).join("<br>")}</div>
      <article class="om-story">
        <h1>${esc(s.label)}</h1>
        <p class="om-lead" dir="auto">${parts(s.lead)}</p>
        <div class="om-body">${s.paragraphs.map((p) => `<p dir="auto">${parts(p)}</p>`).join("")}</div>
        ${questionHTML(s.question)}
        ${s.loose ? `<div class="om-card om-loose"><p class="om-qtext" dir="auto">${parts(s.loose.parts)}</p><button class="om-chip" data-thread-loose>Put them in threads</button></div>` : ""}
      </article>
      ${asideHTML(s)}
    </main>`;
  }

  function defineOneMonth() {
    if (customElements.get("tx-one-month")) return;
    customElements.define(
      "tx-one-month",
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
          const m = current();
          this.story = m
            ? {
                ...oneMonthStory(runtime.derived, state, m),
                strip: periodStrip(runtime.derived, state, m),
              }
            : null;
          this.innerHTML = this.story ? pageHTML(this.story) : "";
          this.mark();
        }
        // Lit-up phrases, beads and days, from the store's highlight.
        mark() {
          const hl = state.highlight;
          const lit = hl.size > 0;
          const ring = lit && !sameIds(this.story?.allIds ?? [], hl);
          this.querySelectorAll(".sp[data-ids]").forEach((sp) =>
            sp.classList.toggle("on", sameIds(sp.dataset.ids.split(","), hl)),
          );
          this.querySelectorAll(".om-bead").forEach((b) => {
            const on = hl.has(b.dataset.id);
            b.classList.toggle("dim", lit && !on);
            b.classList.toggle("ring", ring && on);
          });
          const days = this.querySelector(".sp.on[data-days]")?.dataset.days;
          const [from, to] = days ? days.split("-").map(Number) : [0, -1];
          this.querySelectorAll(".om-day").forEach((d) =>
            d.classList.toggle(
              "on",
              +d.dataset.day >= from && +d.dataset.day <= to,
            ),
          );
        }
        answer(choice) {
          const q = this.story?.question;
          if (!q) return;
          state.answers = {
            ...state.answers,
            [q.id]:
              choice === "skip"
                ? {
                    status: "skipped",
                    choice: null,
                    note: null,
                    created: null,
                    at: runtime.today,
                  }
                : {
                    status: "answered",
                    choice,
                    note: null,
                    created: null,
                    at: runtime.today,
                  },
          };
          actions.save("answers");
          this.render();
        }
        // Dragging along the strip marks a period, through the app's own
        // addPeriod (tx-mark-period). A press without a drag marks nothing.
        wireStrip() {
          let drag = null;
          const dayAt = (strip, x) => {
            const r = strip.getBoundingClientRect();
            const days = this.story.strip.days;
            const d = Math.floor(((x - r.left) / r.width) * days) + 1;
            return Math.min(days, Math.max(1, d));
          };
          const show = () => {
            const [a, b] = [drag.a, drag.b].sort((x, y) => x - y);
            const days = this.story.strip.days;
            Object.assign(drag.ghost.style, {
              left: `${pct(((a - 1) / days) * 100)}%`,
              width: `${pct(((b - a + 1) / days) * 100)}%`,
            });
            drag.ghost.hidden = false;
          };
          this.addEventListener("pointerdown", (e) => {
            const strip = e.target.closest(".om-periods");
            if (!strip || e.target.closest("button") || e.button) return;
            const a = dayAt(strip, e.clientX);
            drag = { strip, x: e.clientX, a, b: a, moved: false };
            drag.ghost = strip.querySelector(".om-pnew");
            strip.setPointerCapture(e.pointerId);
            e.preventDefault();
          });
          this.addEventListener("pointermove", (e) => {
            if (!drag) return;
            if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
            drag.b = dayAt(drag.strip, e.clientX);
            if (drag.moved) show();
          });
          const end = (e, keep) => {
            if (!drag) return;
            const d = drag;
            drag = null;
            d.ghost.hidden = true;
            if (!keep || !d.moved) return;
            const [a, b] = [d.a, d.b].sort((x, y) => x - y);
            const iso = (n) =>
              `${this.story.strip.month}-${String(n).padStart(2, "0")}`;
            this.dispatchEvent(
              new CustomEvent("tx-mark-period", {
                bubbles: true,
                detail: { start: iso(a), end: iso(b) },
              }),
            );
          };
          this.addEventListener("pointerup", (e) => end(e, true));
          this.addEventListener("pointercancel", (e) => end(e, false));
        }
        wire() {
          this.wired = true;
          wireTip(this, () => runtime.derived?.byId);
          wirePeriodEdit(this, {
            strip: ".om-periods",
            isoAt: (strip, x) => {
              const r = strip.getBoundingClientRect();
              const { days, month } = this.story.strip;
              const d = Math.floor(((x - r.left) / r.width) * days) + 1;
              return `${month}-${String(Math.min(days, Math.max(1, d))).padStart(2, "0")}`;
            },
            state,
            actions: {
              save: (k) => actions.save(k),
              refresh: () => actions.refresh(),
              removePeriod: (id) => actions.removePeriod(id),
            },
          });
          wireHoverHighlight(this, runtime, (ids) => emitHighlight(this, ids));
          this.addEventListener("click", (e) => {
            const a = e.target.closest("[data-answer]");
            if (a) this.answer(a.dataset.answer);
            const pc = e.target.closest("[data-period]");
            if (pc)
              this.dispatchEvent(
                new CustomEvent("tx-open-period", {
                  bubbles: true,
                  detail: { id: pc.dataset.period },
                }),
              );
            if (e.target.closest("[data-thread-loose]"))
              this.dispatchEvent(
                new CustomEvent("tx-open-bench", {
                  bubbles: true,
                  detail: { tab: "threads", ids: this.story.loose.txnIds },
                }),
              );
          });
          this.wireStrip();
          this.addEventListener("change", (e) => {
            if (!e.target.matches(".om-files")) return;
            const files = [...e.target.files];
            e.target.value = "";
            if (files.length)
              this.dispatchEvent(
                new CustomEvent("tx-import-files", {
                  bubbles: true,
                  detail: { files },
                }),
              );
          });
        }
      },
    );
  }

  return { defineOneMonth };
}

export const contract = {
  name: "tx-one-month",
  create: createOneMonthComponent,
  provides: ["defineOneMonth"],
  requires: ["Store", "refresh", "removePeriod", "save"],
  renders: [],
  wires: ["defineOneMonth"],
};
