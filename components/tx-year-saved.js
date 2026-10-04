import { MONTHS, esc } from "../helpers.js";

// Questions to an assistant told as stories (artboard 3): a saved question
// picked from the story list, and the struck sentences and "Save as a
// story" under an answer. The sentences come from story/saved-question.js.

export const STRUCK_NOTE =
  "The struck sentence couldn’t be checked against your transactions, so it’s shown as unchecked.";

// "30 Sep 2026", as drawn.
const runDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export function answerHTML(story) {
  const sentence = (s) =>
    s.unchecked
      ? `<span class="yr-struck">${esc(s.text)}</span>`
      : `<span class="sp" tabindex="0" data-ids="${esc(s.txnIds.join(","))}">${esc(s.text)}</span>`;
  return `<div class="yr-prose yr-answer">${story.paragraphs
    .map((p) => `<p dir="auto">${p.map(sentence).join(" ")}</p>`)
    .join(
      "",
    )}</div>${story.unchecked ? `<p class="yr-struck-note">${STRUCK_NOTE}</p>` : ""}`;
}

export function savedHTML(r, story, { canRun }) {
  const ran = r.running
    ? "Running…"
    : r.ranAt
      ? `Last run ${runDate(r.ranAt)}${r.by ? ` · answered by ${r.by}` : ""}`
      : "Not run yet";
  const receipts = story.chips.length
    ? `<div class="yr-receipts">${story.chips.map((c) => `<span class="sp yr-receipt" data-ids="${esc(c.txnIds.join(","))}">${esc(c.text)}</span>`).join("")}</div>`
    : "";
  return `<div class="yr-intro yr-saved">
    <div class="yr-side top">A saved question</div>
    <div class="yr-col-story">
      <h1 class="yr-qh1" dir="auto">${esc(r.q)}</h1>
      <div class="yr-runrow"><span>${esc(ran)}</span>${canRun && !r.running ? `<button class="yr-small" data-run-question="${esc(r.id)}">Run again</button>` : ""}</div>
      ${r.error ? `<p class="yr-fine">${esc(r.error)}</p>` : ""}
      ${r.answer ? answerHTML(story) : ""}
      ${receipts}
      ${r.answer && r.by ? `<p class="yr-answered">Answered by ${esc(r.by)}</p>` : ""}
      <div class="yr-chips"><button class="yr-small" data-change-question="${esc(r.id)}">Change the question</button><button class="yr-small" data-remove-question="${esc(r.id)}">Remove</button></div>
    </div>
  </div>`;
}
