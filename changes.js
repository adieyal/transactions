// Where change records from the model (ADR 0013) meet the running app: commit
// applies one to state, saves the documents it touches, logs it for undo and
// asks for a refresh; undo does the reverse. The UI and the assistant's tools
// reach state's saved fields only through these.
import {
  applyChange,
  CommandError,
  createUndoLog,
  keysOf,
} from "./model/index.js";

// io: { save, refresh, refreshSoon, tell } from main.js.
export function createChanges(runtime, io) {
  const { state } = runtime;
  const log = createUndoLog();

  // change: a record from a model command, or null for no change.
  // refresh: "now" (default), "soon" while typing, or "none" when the caller
  // redraws itself.
  function commit(change, { refresh = "now" } = {}) {
    if (!change) return null;
    applyChange(state, change);
    log.push(change);
    settle(change, refresh);
    return change;
  }

  // Undoes a committed record (the latest when none is named). Returns the
  // record that did it, or null when there was nothing to undo.
  // An undo the model refuses (a CommandError, e.g. thread rules edited
  // since) stays in the log, and its sentence goes to io.tell.
  function undo(change, { refresh = "now" } = {}) {
    const back = log.undo(change);
    if (!back) return null;
    try {
      applyChange(state, back);
    } catch (e) {
      log.push(change);
      if (!(e instanceof CommandError)) throw e;
      io.tell?.(e.message);
      return null;
    }
    settle(back, refresh);
    return back;
  }

  function settle(change, refresh) {
    io.save(...keysOf(change));
    if (refresh === "now") io.refresh();
    else if (refresh === "soon") io.refreshSoon();
  }

  return { commit, undo };
}
