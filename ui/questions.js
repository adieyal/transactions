import { $, TODAY, esc } from "../helpers.js";
import { toast } from "./dom.js";
import { detectMoments, findMoments } from "../story/moments.js";
import { answerMoment } from "../story/answers.js";
import {
  PRIVACY_NOTE,
  answerOptions,
  kindLabel,
  momentWhen,
  plural,
  privacyText,
  questionText,
} from "../story/copy.js";

export function createQuestions(runtime, actions) {
  const { state } = runtime;
  let open = [];
  // The card with a text field open: { id, action, where }, where is the
  // list it was opened in (the Questions tab or Your month).
  let writing = null;

  function openMoments() {
    if (!state.loaded || !runtime.derived) return [];
    const derived = runtime.derived;
    return findMoments(derived, state, detectMoments(derived, state));
  }

  function cardHTML(m, where = "questions") {
    const options = answerOptions(m, state.merchantAnswers).filter(
      (o) => o.action !== "skip",
    );
    const form =
      writing?.id === m.id && writing.where === where
        ? `<form class="qwrite" data-qform>
            <label class="sub">${writing.action === "period" ? "Name this period" : "Your note"}
            ${
              writing.action === "period"
                ? `<input data-qtext dir="auto" autocomplete="off" required>`
                : `<textarea data-qtext class="note" dir="auto" required></textarea>`
            }</label>
            <div class="row-actions"><button class="btn small" type="submit">Save</button><button class="btn small quiet" type="button" data-qcancel>Cancel</button></div>
          </form>`
        : `<div class="qanswers">${options
            .map(
              (o, i) =>
                `<button class="qchip" data-qopt="${i}" dir="auto">${esc(o.label)}</button>`,
            )
            .join("")}<button class="qskip" data-qskip>Skip</button></div>`;
    return `<li class="qcard" data-qid="${esc(m.id)}" data-ids="${esc(m.txnIds.join(","))}">
      <div class="qmeta"><span class="qkind">${esc(kindLabel(m))}</span><span>${esc(momentWhen(m))}</span></div>
      <p class="qtext" dir="auto">${esc(questionText(m))}</p>
      ${form}
      <p class="qfoot">${esc(PRIVACY_NOTE)}</p>
    </li>`;
  }

  function renderQuestions() {
    const pane = $("#questions");
    open = openMoments();
    $("#qCount").textContent = open.length || "";
    if (!pane) return;
    const answers = Object.values(state.answers || {});
    const answered = answers.filter((a) => a.status === "answered").length;
    const skipped = answers.length - answered;
    const tally = answers.length
      ? `<p class="sub">You've answered ${plural(answered, "question")} and skipped ${skipped}. Skipped questions don't come back.</p>`
      : "";
    const privacy = privacyText(actions.Store.backend.kind);
    let body;
    if (!runtime.derived?.allTxns.length)
      body = `<p class="sub">No statements yet. Questions appear here once you add some.</p>`;
    else if (!open.length)
      body = `<p class="sub">No more questions for now. New ones may appear when you add statements.</p>`;
    else
      body = `<ul class="qlist">${open.map((m) => cardHTML(m, "questions")).join("")}</ul>`;
    pane.innerHTML = `<p class="lead">Your statements show where money went. Here are a few things a short note would explain. Answer any you like, or none at all.</p>
      <div class="qprivacy" id="qPrivacy">${esc(privacy.banner)}</div>
      ${body}${tally}`;
    markCards();
    if (writing?.where === "questions")
      pane.querySelector("[data-qtext]")?.focus();
  }

  function rerender() {
    renderQuestions();
    actions.renderMonth?.();
  }

  // Cards whose transactions are lit up on the timeline.
  function markCards() {
    document
      .querySelectorAll(".qcard")
      .forEach((c) =>
        c.classList.toggle("on", sameIds(c.dataset.ids.split(","))),
      );
  }

  const sameIds = (ids) =>
    ids.length > 0 &&
    ids.length === state.highlight.size &&
    ids.every((i) => state.highlight.has(i));

  function answer(m, choice) {
    const before = {
      answers: state.answers,
      merchantAnswers: state.merchantAnswers,
      notes: state.notes,
    };
    let period = null;
    if (choice.action === "period")
      period = actions.addPeriod(m.from, m.to, {
        name: choice.text || choice.label,
      });
    const result = answerMoment(state, runtime.derived, m, {
      ...choice,
      at: TODAY,
      periodId: period?.id ?? null,
    });
    writing = null;
    state.answers = result.answers;
    state.merchantAnswers = result.merchantAnswers;
    if (result.notes !== state.notes) {
      state.notes = result.notes;
      actions.saveSoon("notes", () => ({ map: state.notes }), 200);
    }
    actions.saveAnswers();
    if (sameIds(m.txnIds)) state.highlight = new Set();
    actions.refresh();
    toast(result.message, 9000, {
      label: "Undo",
      fn: () => {
        Object.assign(state, before);
        actions.saveAnswers();
        if (result.notes !== before.notes)
          actions.saveSoon("notes", () => ({ map: state.notes }), 200);
        if (period) {
          state.periods = state.periods.filter((p) => p.id !== period.id);
          if (state.periodSel === period.id) state.periodSel = null;
          actions.savePeriods();
        }
        actions.refresh();
      },
    });
  }

  function wireQuestions() {
    wireCards($("#questions"), "questions");
  }

  // Cards work the same in any list: the Questions tab or inline in Your month.
  function wireCards(pane, where) {
    pane.addEventListener("click", (e) => {
      const card = e.target.closest(".qcard");
      if (!card) return;
      const m = open.find((x) => x.id === card.dataset.qid);
      if (!m) return;
      if (e.target.closest("[data-qcancel]")) {
        writing = null;
        rerender();
        return;
      }
      if (e.target.closest("[data-qskip]")) {
        answer(m, { action: "skip" });
        return;
      }
      const opt = e.target.closest("[data-qopt]");
      if (opt) {
        const options = answerOptions(m, state.merchantAnswers).filter(
          (o) => o.action !== "skip",
        );
        const o = options[+opt.dataset.qopt];
        if (o.source === "generic") {
          writing = { id: m.id, action: o.action, where };
          rerender();
          pane.querySelector("[data-qtext]")?.focus();
        } else answer(m, { action: o.action, label: o.label });
        return;
      }
      if (e.target.closest("form, button, input, textarea")) return;
      // Clicking the card lights up its transactions, like a lens bar.
      const ids = m.txnIds;
      state.highlight = sameIds(ids) ? new Set() : new Set(ids);
      state.selection.clear();
      actions.renderTimeline();
      markCards();
    });
    pane.addEventListener("submit", (e) => {
      e.preventDefault();
      const card = e.target.closest(".qcard");
      const m = open.find((x) => x.id === card?.dataset.qid);
      const text = e.target.querySelector("[data-qtext]")?.value.trim();
      if (!m || !writing || !text) return;
      answer(m, { action: writing.action, text });
    });
    pane.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && writing) {
        e.stopPropagation();
        writing = null;
        rerender();
      }
    });
  }

  function renderPrivacy() {
    const privacy = privacyText(actions.Store.backend.kind);
    $("#privacyChip").textContent = privacy.label;
    $("#privacyTitle").textContent = privacy.label;
    $("#privacyBody").innerHTML = privacy.details
      .map((d) => `<p>${esc(d)}</p>`)
      .join("");
  }

  function wirePrivacy() {
    $("#privacyChip").onclick = () => {
      renderPrivacy();
      $("#privacyDlg").showModal();
    };
    $("#privacyClose").onclick = () => $("#privacyDlg").close();
  }

  return {
    answerQuestion: answer,
    openQuestions: () => open,
    questionCard: cardHTML,
    renderPrivacy,
    renderQuestions,
    wireCards,
    wirePrivacy,
    wireQuestions,
  };
}
