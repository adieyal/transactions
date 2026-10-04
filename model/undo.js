// The one undo log. Every committed change record goes in, from the UI, the
// assistant's tools or anywhere else, and undo takes the same records back
// out. Holds records only: applying and saving is the caller's job.
import { invert } from "./change.js";

export function createUndoLog({ limit = 100 } = {}) {
  const done = [];
  return {
    push(change) {
      done.push(change);
      if (done.length > limit) done.shift();
      return change;
    },
    // The record that reverses `change` (the latest if none is named), taken
    // off the log; null if it isn't there, e.g. undone already.
    undo(change = done.at(-1)) {
      const i = done.lastIndexOf(change);
      if (i < 0) return null;
      done.splice(i, 1);
      return invert(change);
    },
    get size() {
      return done.length;
    },
  };
}
