import { normText } from "../helpers.js";
import { parseRules } from "./rules.js";

// Edits to the threads text, as pure functions from text to text. The UI
// saves the result and refreshes.

// Sets or removes a thread's monthly budget. Returns the text unchanged when
// there is no such thread.
export function setBudget(rules, name, value) {
  const th = parseRules(rules).threads.find((t) => t.name === name);
  if (!th) return rules;
  const lines = rules.split("\n");
  let line = lines[th.line].replace(/\s*\[\s*budget[^\]]*\]/i, "");
  if (value > 0) line += `  [budget ${Math.round(value)}]`;
  lines[th.line] = line;
  return lines.join("\n");
}

// Adds the merchants of some transactions to a thread, as patterns under its
// name, creating the thread at the top (after any opening comments) when it
// doesn't exist yet. Returns the new text and the lines that were added.
export function addToThread(rules, name, txns) {
  const patterns = [
    ...new Set(txns.map((t) => normText(t.merchant)).filter(Boolean)),
  ];
  const lines = rules.split("\n");
  const idx = lines.findIndex(
    (l) =>
      !/^\s/.test(l) &&
      l.trim() &&
      !l.trim().startsWith("//") &&
      l.trim().replace(/:.*$/, "").toLowerCase() === name.toLowerCase(),
  );
  let at, count;
  if (idx >= 0) {
    let j = idx + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
    lines.splice(j, 0, ...patterns.map((p) => "  " + p));
    at = j;
    count = patterns.length;
  } else {
    let j = 0;
    while (
      j < lines.length &&
      (!lines[j].trim() || lines[j].trim().startsWith("//"))
    )
      j++;
    lines.splice(j, 0, name, ...patterns.map((p) => "  " + p), "");
    at = j;
    count = patterns.length + 1;
  }
  return { rules: lines.join("\n"), at, count };
}
