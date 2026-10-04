import { esc } from "../helpers.js";
import { dayShort, monthLong } from "../story/copy.js";

// The story column's pieces for <tx-year> (tx-year.js): sentences whose
// figures light up their payments, the year's sections with their unnamed
// stretches, the lenses added to the story, and one month told on its own.

const PRIVATE = "Only you see this. Your answer stays on this device.";

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
export const para = (ps, cls = "") =>
  `<p${cls ? ` class="${cls}"` : ""} dir="auto">${parts(ps)}</p>`;

function stretchAsk(s, ui) {
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

export function sectionHTML(s, i, ui) {
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
      ${s.stretch ? stretchAsk(s, ui) : ""}
      ${s.month && (s.chip || s.stretch) ? `<button class="yr-quiet" data-month="${esc(s.month)}">See ${esc(monthLong(s.month).split(" ")[0])} day by day</button>` : ""}
    </div>
  </section>`;
}

// Lenses the person added to the story, each run in its <tx-lens>.
export function storyLensesHTML(state) {
  const ls = state.lenses.filter((l) => l.inStory);
  if (!ls.length) return "";
  return `<section class="yr-sec yr-lensesec" aria-label="Your lenses"><div class="yr-side"><div class="yr-seclabel strong">Your lenses</div></div><div class="yr-col-story yr-lensfigs">${ls
    .map(
      (l) =>
        `<figure class="yr-lensfig"><figcaption><span class="yr-lenstitle" dir="auto">${esc(l.title)}</span><span class="yr-lensnote">Your lens · updates with each statement</span></figcaption><tx-lens lens="${esc(l.id)}"></tx-lens></figure>`,
    )
    .join("")}</div></section>`;
}

// The notes written on a period's payments, each with its day.
const notesHTML = (notes) =>
  notes.length
    ? `<div class="yr-note"><div class="yr-notelabel">Your notes</div><div class="yr-notegrid">${notes.map((n) => `<span class="yr-notedate">${esc(dayShort(n.date))}</span><span dir="auto">${esc(n.text)}</span>`).join("")}</div></div>`
    : "";

export function monthHTML(m) {
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

// The Story picker: the year, its months, periods and saved questions.
export function pickerHTML(ms, year, month, { state, ui, picked }) {
  const opt = (v, label, sel) =>
    `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(label)}</option>`;
  const periods = (state.periods || []).filter(
    (p) => p.start <= `${ms.at(-1)}-31` && p.end >= `${ms[0]}-01`,
  );
  return `<div class="yr-pick">
    <label for="story-pick" class="yr-side">Story</label>
    <div class="yr-pickrow">
      <select id="story-pick">
        <optgroup label="Told from your statements">${opt("year", "Your year so far", year && !picked)}${[
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
