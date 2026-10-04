// Commands on lenses: create, edit, delete and put back the starters; and
// running one, which reads and changes nothing.
import { STARTER_LENSES } from "../defaults.js";
import { runLens as run } from "../lens-api.js";
import { need, record } from "./change.js";

const replace = (state, lenses, command, extra) =>
  record(command, [{ field: "lenses", value: [state.lenses, lenses] }], extra);

// id: chosen by the caller, since the model reads no clock.
export function addLens(state, { id, title = "", code }) {
  need(typeof id === "string" && id, "A new lens needs an id.");
  need(!state.lenses.some((l) => l.id === id), "That lens already exists.");
  need(typeof code === "string" && code.trim(), "A lens needs its code.");
  const l = { id, title: String(title).trim() || "Untitled lens", code };
  return replace(state, [...state.lenses, l], "addLens", { id });
}

// Changes a lens's title or code.
export function editLens(state, { id, title, code }) {
  const i = state.lenses.findIndex((l) => l.id === id);
  need(i >= 0, "There's no such lens.");
  const l = { ...state.lenses[i] };
  if (title !== undefined) l.title = String(title).trim() || "Untitled lens";
  if (code !== undefined) {
    need(typeof code === "string", "A lens's code is text.");
    l.code = code;
  }
  const lenses = state.lenses.slice();
  lenses[i] = l;
  return replace(state, lenses, "editLens", { id });
}

export function removeLens(state, { id }) {
  const l = state.lenses.find((x) => x.id === id);
  need(l, "There's no such lens.");
  return replace(
    state,
    state.lenses.filter((x) => x !== l),
    "removeLens",
    { id, summary: `Removed “${l.title}”.` },
  );
}

// Puts back any starter lens that was removed (or any of `lenses`); the
// person's own stay.
export function restoreStarterLenses(state, { lenses = STARTER_LENSES } = {}) {
  const have = new Set(state.lenses.map((l) => l.id));
  const missing = lenses.filter((l) => !have.has(l.id));
  return replace(
    state,
    [...state.lenses, ...missing.map((l) => ({ ...l }))],
    "restoreStarterLenses",
  );
}

// Runs a saved lens over the data: a query, not a change, so no record.
export function runLens(state, derived, { id }, today) {
  const l = state.lenses.find((x) => x.id === id);
  need(l, "There's no such lens.");
  return run(l.code, derived, state, today);
}
