// Change records (ADR 0013). Every command returns one, or null when there is
// nothing to change. A record says, for each saved field it touches, what was
// there before and what is there after, so the same record applies the change
// and undoes it, touching only what it changed:
//
//   { command: "tag", summary: "Added #trip on 3 transactions.",
//     patches: [{ field: "notes", entries: { t1: [before, after] } },
//               { field: "periods", items: { p1: [before, after, at, at] } },
//               { field: "rules", lines: { at: 4, before: [..], after: [..] } }] }
//
// `entries` patches a map entry by entry (undefined deletes the entry).
// `items` patches a list of { id } objects item by item, with each item's
// place before and after, so undoing an earlier change leaves later edits to
// other items alone, as 8d87cd2's Undo did. `lines` patches a text by the
// run of lines that changed; undoing it after those lines were edited again
// is refused with a sentence rather than throwing the later edit away.
// Commands give `value: [before, after]` for a list or a text, and record()
// turns it into `items` or `lines`. Records hold copies, never live objects,
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A list of { id } items as item patches: each changed id with its item and
// place before and after (undefined where it didn't exist).
function itemsOf(before, after) {
  const at = (list) => new Map(list.map((x, i) => [x.id, i]));
  const b = at(before);
  const a = at(after);
  const items = {};
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    const x = before[b.get(id)];
    const y = after[a.get(id)];
    // Only what was added, removed or changed: others shifting along
    // isn't a change to them.
    if (!same(x, y)) items[id] = [copy(x), copy(y), b.get(id), a.get(id)];
  }
  return items;
}

// A text as the one run of lines that changed, after the common start and
// end.
function linesOf(before, after) {
  const x = before.split("\n");
  const y = after.split("\n");
  let at = 0;
  while (at < x.length && at < y.length && x[at] === y[at]) at++;
  let end = 0;
  while (
    end < x.length - at &&
    end < y.length - at &&
    x[x.length - 1 - end] === y[y.length - 1 - end]
  )
    end++;
  return {
    at,
    before: x.slice(at, x.length - end),
    after: y.slice(at, y.length - end),
  };
}

function normal(p) {
  if (p.entries)
    return {
      field: p.field,
      entries: Object.fromEntries(
        Object.entries(p.entries).map(([k, [a, b]]) => [k, [copy(a), copy(b)]]),
      ),
    };
  const [a, b] = p.value;
  if (Array.isArray(a) && Array.isArray(b))
    return { field: p.field, items: itemsOf(a, b) };
  if (typeof a === "string" && typeof b === "string")
    return a === b ? null : { field: p.field, lines: linesOf(a, b) };
  throw new Error(`A ${p.field} change needs a list or a text.`);
}

const empty = (p) =>
  !p ||
  (p.entries && !Object.keys(p.entries).length) ||
  (p.items && !Object.keys(p.items).length);

// A record from patches, or null when no patch changes anything.
export function record(command, patches, extra = {}) {
  const real = patches.map(normal).filter((p) => !empty(p));
  if (!real.length) return null;
  return { command, patches: real, ...extra };
}

// The saved documents a record touches, for the caller to save.
export const keysOf = (change) => [
  ...new Set(change.patches.map((p) => KEY_OF[p.field])),
];

// An entry or item must still be as the record left it: undoing a change
// to something edited again since would throw that later edit away.
const unchanged = (now, was) =>
  need(
    same(now, was),
    "That was changed again since, so undoing it here would lose the later change. Undo the later one first.",
  );

function applyItems(list, items, side) {
  const next = list.slice();
  const puts = [];
  for (const [id, pair] of Object.entries(items)) {
    const i = next.findIndex((x) => x.id === id);
    unchanged(next[i], pair[1 - side]);
    // An item still there is changed where it stands.
    if (i >= 0 && pair[side] !== undefined) next[i] = copy(pair[side]);
    else if (i >= 0) next.splice(i, 1);
    else if (pair[side] !== undefined)
      puts.push([pair[side + 2] ?? next.length, copy(pair[side])]);
  }
  for (const [at, item] of puts.sort((a, b) => a[0] - b[0]))
    next.splice(Math.min(at, next.length), 0, item);
  return next;
}

function applyLines(text, { at, before, after }, side) {
  const [from, to] = side ? [before, after] : [after, before];
  const lines = text.split("\n");
  const fits = (i) => from.every((l, k) => lines[i + k] === l);
  let i = at <= lines.length && fits(at) ? at : -1;
  if (i < 0 && from.length) {
    const found = lines.map((_, k) => k).filter(fits);
    if (found.length === 1) i = found[0];
  }
  need(
    i >= 0,
    "Your threads have changed since then, so this can't be undone here. Edit them in Threads instead.",
  );
  lines.splice(i, from.length, ...to);
  return lines.join("\n");
}

// Puts a record's after side (or, undoing, its before side) into state.
// Every field is worked out before any is set, so a change that can't apply
// (CommandError) leaves state as it was. Fields are replaced, not mutated in
// place, so anything holding the old value keeps it.
export function applyChange(state, change, { undo = false } = {}) {
  const side = undo ? 0 : 1;
  const next = {};
  for (const p of change.patches) {
    const cur = p.field in next ? next[p.field] : state[p.field];
    if (p.items) next[p.field] = applyItems(cur, p.items, side);
    else if (p.lines) next[p.field] = applyLines(cur, p.lines, side);
    else {
      const map = { ...cur };
      for (const [k, pair] of Object.entries(p.entries)) {
        unchanged(map[k], pair[1 - side]);
        if (pair[side] === undefined) delete map[k];
        else map[k] = copy(pair[side]);
      }
      next[p.field] = map;
    }
  }
  Object.assign(state, next);
  return state;
}

// The record that undoes this one.
export function invert(change) {
  const swap = (pair) => [pair[1], pair[0], pair[3], pair[2]];
  return {
    ...change,
    undoes: change.command,
    patches: change.patches.map((p) =>
      p.items
        ? {
            field: p.field,
            items: Object.fromEntries(
              Object.entries(p.items).map(([k, v]) => [k, swap(v)]),
            ),
          }
        : p.lines
          ? {
              field: p.field,
              lines: {
                ...p.lines,
                before: p.lines.after,
                after: p.lines.before,
              },
            }
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
