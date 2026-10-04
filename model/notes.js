// Commands on a transaction or merchant: tags, notes, names and the transfer
// label. Each takes state and its input, and returns a change record
// (model/change.js) without touching state.
import { normText } from "../helpers.js";
import { parseTags, retag } from "../transactions/tags.js";
import { need, record } from "./change.js";

const ids = (x) => {
  need(
    Array.isArray(x) && x.length && x.every((id) => typeof id === "string"),
    "Say which transactions, by id.",
  );
  return x;
};

// Adds and removes #tags on the notes of some transactions.
export function tag(state, { ids: which, add = [], remove = [] }) {
  const plus = parseTags([].concat(add).join(" "));
  const minus = parseTags([].concat(remove).join(" "));
  need(plus.length || minus.length, "Say which tag to add or remove.");
  const { notes, previous } = retag(state.notes, ids(which), plus, minus);
  const entries = Object.fromEntries(
    Object.keys(previous).map((id) => [
      id,
      [previous[id] || undefined, notes[id]],
    ]),
  );
  const n = Object.keys(entries).length;
  const what = [
    plus.length ? `added ${plus.join(" ")}` : "",
    minus.length ? `removed ${minus.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return record("tag", [{ field: "notes", entries }], {
    summary: `${what[0].toUpperCase() + what.slice(1)} on ${n} transaction${n > 1 ? "s" : ""}.`,
    count: n,
  });
}

export const untag = (state, { ids: which, remove }) =>
  tag(state, { ids: which, remove });

// Writes one transaction's note. Blank text removes it.
export function setNote(state, { id, text }) {
  need(typeof id === "string" && id, "Say which transaction, by id.");
  need(typeof text === "string", "A note is text.");
  const after = text.trim() ? text : undefined;
  if (after === state.notes[id]) return null;
  return record("setNote", [
    { field: "notes", entries: { [id]: [state.notes[id], after] } },
  ]);
}

// The key a merchant's display name is saved under.
export const nameKeyOf = (t) => t.nameKey || normText(t.original || t.merchant);

// Shows a merchant under another name; the statement's text stays on file.
// A blank name, or the original, goes back to the original.
export function renameMerchant(state, { key, original, name, by = "you" }) {
  need(typeof key === "string" && key, "Say which merchant.");
  need(typeof name === "string", "A name is text.");
  const v = name.trim();
  const after = v && v !== original ? { name: v, by } : undefined;
  if (JSON.stringify(after) === JSON.stringify(state.names[key])) return null;
  return record("renameMerchant", [
    { field: "names", entries: { [key]: [state.names[key], after] } },
  ]);
}

// Labels a transaction as a transfer between the person's accounts, or not.
// auto: whether the app found it a transfer by itself, in which case "yes"
// needs no override.
export function setTransfer(state, { id, on, auto = false }) {
  need(typeof id === "string" && id, "Say which transaction, by id.");
  const after = on && auto ? undefined : !!on;
  if (after === state.transferOv[id]) return null;
  return record("setTransfer", [
    { field: "transferOv", entries: { [id]: [state.transferOv[id], after] } },
  ]);
}
