// Change records (ADR 0013). Every command returns one, or null when there is
// nothing to change. A record says, for each saved field it touches, what was
// there before and what is there after, so the same record applies the change
// and undoes it:
//
//   { command: "tag", summary: "Added #trip on 3 transactions.",
//     patches: [{ field: "notes", entries: { t1: [before, after] } },
//               { field: "periods", value: [before, after] }] }
//
// `entries` patches one map entry by entry (undefined deletes the entry);
// `value` replaces the whole field. Records hold copies, never live objects,
// so a later edit can't change what undo puts back.

// The saved document (documents.js) each field is saved in.
export const KEY_OF = {
  notes: "notes",
  names: "names",
  transferOv: "transfers",
  rules: "rules",
  periods: "periods",
  lenses: "lenses",
  reports: "reports",
};

const copy = (v) =>
  v === undefined ? undefined : JSON.parse(JSON.stringify(v));

// A record from patches, or null when no patch changes anything.
export function record(command, patches, extra = {}) {
  const real = patches.filter((p) =>
    p.entries ? Object.keys(p.entries).length : !same(p.value[0], p.value[1]),
  );
  if (!real.length) return null;
  return {
    command,
    patches: real.map((p) =>
      p.entries
        ? {
            field: p.field,
            entries: Object.fromEntries(
              Object.entries(p.entries).map(([k, [a, b]]) => [
                k,
                [copy(a), copy(b)],
              ]),
            ),
          }
        : { field: p.field, value: [copy(p.value[0]), copy(p.value[1])] },
    ),
    ...extra,
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The saved documents a record touches, for the caller to save.
export const keysOf = (change) => [
  ...new Set(change.patches.map((p) => KEY_OF[p.field])),
];

// Puts a record's after side (or, undoing, its before side) into state.
// Fields are replaced, not mutated in place, so anything holding the old
// value keeps it.
export function applyChange(state, change, { undo = false } = {}) {
  const side = undo ? 0 : 1;
  for (const p of change.patches) {
    if (p.value) {
      state[p.field] = copy(p.value[side]);
      continue;
    }
    const next = { ...state[p.field] };
    for (const [k, pair] of Object.entries(p.entries)) {
      if (pair[side] === undefined) delete next[k];
      else next[k] = copy(pair[side]);
    }
    state[p.field] = next;
  }
  return state;
}

// The record that undoes this one.
export function invert(change) {
  return {
    ...change,
    undoes: change.command,
    patches: change.patches.map((p) =>
      p.value
        ? { field: p.field, value: [p.value[1], p.value[0]] }
        : {
            field: p.field,
            entries: Object.fromEntries(
              Object.entries(p.entries).map(([k, [a, b]]) => [k, [b, a]]),
            ),
          },
    ),
  };
}

// Commands report bad input by throwing this, with a sentence the person (or
// the assistant) can act on.
export class CommandError extends Error {}

export function need(ok, message) {
  if (!ok) throw new CommandError(message);
}

export const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
