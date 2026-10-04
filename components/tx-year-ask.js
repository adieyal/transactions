import { esc } from "../helpers.js";
import { answerStory } from "../story/saved-question.js";
import { CHECKED, answerHTML } from "./tx-year-saved.js";

// The year's Ask section (artboard 3): connect, write, check what goes,
// and the answer. Nothing is sent from here; tx-year asks the chat, and only
// when Send is pressed.

const SEND_NOTE = "Before anything is sent, you’ll see exactly what goes.";

// goes: assistant/prompts.js whatGoes, the audited list of what is sent.
export function askHTML(ui, caps, ai, goes) {
  if (!caps.sample)
    return `<div class="yr-card"><p class="yr-asktext"><b>Asking needs an assistant.</b> Connect ChatGPT, a local model through Ollama or LM Studio, or any OpenAI-compatible service. Your statements stay in this browser until you ask something. Then the question and the transactions it needs go to the service you pick.</p>
      <p class="yr-fine top">The story, threads, periods, notes and lenses all work without one.</p>
      <button class="yr-dark" data-connect-ai>Connect an assistant</button></div>`;
  if (ui.ask === "preview")
    return `<div class="yr-card"><h3 class="yr-h3">Ready to send to ${esc(ai)}</h3>
      <ul class="yr-sendlist">${goes.goes.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
      <p class="yr-notsent">${esc(goes.notSent)}</p>
      <div class="yr-chips"><button class="yr-dark" data-ask-send>Send</button><button class="yr-small" data-ask-back>Change the question</button></div></div>`;
  return `<div class="yr-card">
    <div class="yr-askhead"><label for="ask" class="yr-asklabel">Ask about your spending</label><span class="yr-fine">Assistant: ${esc(ai)} · <button class="yr-link" data-connect-ai>Change</button></span></div>
    <textarea id="ask">${esc(ui.text)}</textarea>
    <div class="yr-askfoot"><button class="yr-dark" data-ask-preview>Ask</button><span class="yr-fine">${SEND_NOTE}</span></div>
  </div>`;
}

// The latest answer to the question asked here, from the chat's turns.
export function answeredHTML(ui, state, ai, byId) {
  if (!ui.asked) return "";
  const reply = [...state.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.q === ui.asked);
  if (!reply) return "";
  const story =
    reply.pending || reply.error ? null : answerStory(reply.content, byId);
  const text = reply.pending
    ? `<p class="yr-fine">${esc(reply.status || "Looking through your statements…")}</p>`
    : reply.error
      ? `<p class="yr-fine">${esc(reply.error)}</p>`
      : answerHTML(story);
  const saved = state.reports.some(
    (r) => r.q === ui.asked && r.answer === reply.content,
  );
  const save =
    reply.pending || reply.error
      ? ""
      : `<button class="yr-small" data-save-question${saved ? " disabled" : ""}>${saved ? "Saved to your stories" : "Save as a story"}</button>`;
  return `<section class="yr-sec"><div class="yr-side"><div class="yr-seclabel">You asked</div></div>
    <div class="yr-col-story"><div class="yr-note gap"><div class="yr-notelabel">Your question</div><div class="yr-notetext" dir="auto">${esc(ui.asked)}</div></div>
    <div class="yr-answered by">Answered by ${esc(ai)}${story?.checked ? ` · ${CHECKED}` : ""}</div>${text}
    <div class="yr-chips">${save}<button class="yr-small" data-ask-again>Ask a follow-up</button></div></div></section>`;
}
