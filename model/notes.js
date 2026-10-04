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

// The assistant's batch edits, moved from assistant/tools.js: changes name
// transactions by id or by exact merchant name.
const changeList = (changes) => {
  const list = Array.isArray(changes) ? changes.slice(0, 600) : [];
  need(list.length, "changes must be a non-empty list");
  return list;
};

// Merchant names match the statement text or the shown name, then loosely.
function byMerchant(derived, m) {
  const ids = derived.allTxns
    .filter((t) => t.merchant === m || t.original === m)
    .map((t) => t.id);
  if (ids.length) return ids;
  const n = normText(m);
  return derived.allTxns
    .filter((t) => normText(t.merchant) === n)
    .map((t) => t.id);
}

// Appends to (the default) or replaces notes. changes: [{id | merchant,
// text, mode}]. The record's result says what changed and what wasn't found.
export function writeNotes(state, derived, { changes }) {
  const entries = {};
  const missing = [];
  const now = (id) => (id in entries ? entries[id][1] : state.notes[id]);
  for (const c of changeList(changes)) {
    const text = String(c?.text ?? "").trim();
    const ids = c?.id
      ? derived.byId.has(String(c.id))
        ? [String(c.id)]
        : []
      : c?.merchant
        ? byMerchant(derived, String(c.merchant).trim())
        : [];
    if (!ids.length) {
      missing.push(c?.id || c?.merchant || "?");
      continue;
    }
    for (const id of ids) {
      const before = now(id) || "";
      const after =
        c?.mode === "replace"
          ? text
          : !text || before.includes(text)
            ? before
            : before
              ? before + "\n" + text
              : text;
      if (after === before) continue;
      entries[id] = [state.notes[id], after || undefined];
    }
  }
  for (const [id, [a, b]] of Object.entries(entries))
    if (a === b) delete entries[id];
  const n = Object.keys(entries).length;
  const result = { changed: n, not_found: missing.slice(0, 20) };
  need(n || !missing.length, `Not found: ${result.not_found.join(", ")}.`);
  return record("writeNotes", [{ field: "notes", entries }], {
    summary: `Changed the notes on ${n} transaction${n > 1 ? "s" : ""}.`,
    count: n,
    result,
  });
}

// Display names by original or current name; an empty name or the original
// restores it. changes: [{merchant, name}].
export function renameMerchants(state, derived, { changes, by = "ai" }) {
  const entries = {};
  const missing = [];
  for (const c of changeList(changes)) {
    const m = String(c?.merchant ?? "").trim();
    const name = String(c?.name ?? "").trim();
    if (!m) continue;
    const n = normText(m);
    const keys = [
      ...new Set(
        derived.allTxns
          .filter(
            (t) =>
              t.original === m ||
              t.merchant === m ||
              t.nameKey === n ||
              normText(t.merchant) === n,
          )
          .map((t) => t.nameKey),
      ),
    ];
    if (!keys.length) {
      missing.push(m);
      continue;
    }
    for (const k of keys) {
      const orig = derived.allTxns.find((t) => t.nameKey === k)?.original;
      const after = name && name !== orig ? { name, by } : undefined;
      if (JSON.stringify(state.names[k]) === JSON.stringify(after)) continue;
      entries[k] = [state.names[k], after];
    }
  }
  const n = Object.keys(entries).length;
  const result = { changed: n, not_found: missing.slice(0, 20) };
  need(n || !missing.length, `Not found: ${result.not_found.join(", ")}.`);
  return record("renameMerchants", [{ field: "names", entries }], {
    summary: `Renamed ${n} merchant${n > 1 ? "s" : ""}. The originals are kept.`,
    count: n,
    result,
  });
}
