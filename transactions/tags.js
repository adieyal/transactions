// #tags in notes: reading them, and adding or removing them in bulk. Pure:
// notes go in and new notes come out.

const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tagRe = (tag) =>
  new RegExp(
    "(^|[^\\p{L}\\p{N}_-])" + escRe(tag) + "(?![\\p{L}\\p{N}_-])",
    "giu",
  );

// "trip, #Car  home" → ["#trip", "#car", "#home"].
export function parseTags(str) {
  return [
    ...new Set(
      String(str || "")
        .split(/[\s,]+/)
        .map((x) => x.replace(/^#+/, "").replace(/[^\p{L}\p{N}_-]/gu, ""))
        .filter(Boolean)
        .map((x) => "#" + x.toLowerCase()),
    ),
  ];
}

// The tags in one note, lower-cased, each once.
export function tagsOf(note) {
  return [
    ...new Set(
      String(note || "")
        .toLowerCase()
        .match(/#[\p{L}\p{N}_-]+/gu) || [],
    ),
  ];
}

// Adds and removes tags on the notes of some transactions. Returns the new
// notes, and the previous note of every transaction that changed ("" for
// none), so the change can be undone with restoreNotes.
export function retag(notes, ids, add = [], remove = []) {
  const next = { ...notes };
  const previous = {};
  for (const id of ids) {
    const before = notes[id] || "";
    let after = before;
    for (const t of remove) after = after.replace(tagRe(t), "$1");
    after = after
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
    const missing = add.filter((t) => !tagRe(t).test(after));
    if (missing.length)
      after = after ? after + " " + missing.join(" ") : missing.join(" ");
    if (after === before) continue;
    previous[id] = before;
    if (after) next[id] = after;
    else delete next[id];
  }
  return { notes: next, previous };
}

// Puts back the notes retag changed.
export function restoreNotes(notes, previous) {
  const next = { ...notes };
  for (const [id, before] of Object.entries(previous)) {
    if (before) next[id] = before;
    else delete next[id];
  }
  return next;
}

// The transactions whose note carries a tag, matched without regard to
// case, across all notes: what a tag chip stands for.
export function taggedIds(notes, tag) {
  const t = String(tag).toLowerCase();
  return Object.keys(notes || {}).filter((id) => tagsOf(notes[id]).includes(t));
}
