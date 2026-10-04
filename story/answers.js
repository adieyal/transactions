import { applyAnswer } from "./moments.js";
import { dateRange, plural } from "./copy.js";

// What answering a question changes, without touching the page. The caller
// creates any period (through addPeriod) and passes its id in.

// The transactions a note about a moment belongs on.
export function noteTargets(m, derived) {
  if (m.kind === "price") return m.txnIds.slice(-1);
  if (m.kind === "gap") {
    const ts = m.txnIds.map((id) => derived.byId.get(id)).filter(Boolean);
    const before = ts.filter((t) => t.date < m.from).at(-1);
    return [(before || ts.find((t) => t.date > m.to) || ts[0]).id];
  }
  return [...m.txnIds];
}

function addNote(before, text) {
  if (!before) return text;
  return before.includes(text) ? before : `${before} ${text}`;
}

// action: "period" (name), "note" (text) or "skip". Returns the new answers,
// merchantAnswers and notes documents, what was created, and a message.
export function answerMoment(
  state,
  derived,
  m,
  { action, label = null, text = "", at, periodId = null },
) {
  const written = String(text || "").trim();
  if (action === "skip") {
    return {
      ...applyAnswer(state, m, { status: "skipped", at }),
      notes: state.notes,
      created: null,
      message: "Skipped. This question won't come back.",
    };
  }
  if (action === "period") {
    const name = written || label;
    return {
      ...applyAnswer(state, m, {
        status: "answered",
        choice: name,
        action,
        created: { periodId },
        at,
      }),
      notes: state.notes,
      created: { periodId },
      message: `Saved a period, “${name}”, ${dateRange(m.from, m.to)}.`,
    };
  }
  const note = written || label;
  const noteIds = noteTargets(m, derived);
  const notes = { ...state.notes };
  for (const id of noteIds) notes[id] = addNote(notes[id], note);
  return {
    ...applyAnswer(state, m, {
      status: "answered",
      choice: note,
      action: "note",
      note,
      created: { noteIds },
      at,
    }),
    notes,
    created: { noteIds },
    message:
      noteIds.length === 1
        ? `Added a note to ${derived.byId.get(noteIds[0])?.merchant ?? "the transaction"}.`
        : `Added a note to ${plural(noteIds.length, "transaction")}.`,
  };
}
