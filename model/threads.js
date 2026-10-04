// Commands on threads, their rules and budgets. The rules are one text
// (documents.js "rules"); transactions/rules-edit.js holds the text edits.
import { parseRules } from "../transactions/rules.js";
import {
  addToThread as addLines,
  setBudget as budgetLine,
} from "../transactions/rules-edit.js";
import { need, record } from "./change.js";

const rulesChange = (state, rules, command, extra) =>
  record(command, [{ field: "rules", value: [state.rules, rules] }], extra);

// While suggested threads are shown as a preview, the saved rules wait.
const notPreviewing = (state) =>
  need(
    state.previewRules == null,
    "Keep or discard the suggested threads first.",
  );

// Replaces the whole rules text: creating, renaming or editing threads.
export function setRules(state, { rules }) {
  need(typeof rules === "string", "Thread rules are text.");
  return rulesChange(state, rules.replace(/\r/g, ""), "setRules");
}

// Puts the merchants of some transactions into a thread, creating it if
// needed. Returns the lines added as `at` and `count`.
export function addToThread(state, { name, txns }) {
  const n = String(name || "").trim();
  need(n, "A thread needs a name.");
  need(Array.isArray(txns) && txns.length, "Say which transactions.");
  const { rules, at, count } = addLines(state.rules, n, txns);
  return rulesChange(state, rules, "addToThread", { at, count, name: n });
}

// Sets a thread's monthly budget; 0 clears it.
export function setBudget(state, { thread, value }) {
  notPreviewing(state);
  need(Number.isFinite(value) && value >= 0, "A budget is a number.");
  need(
    parseRules(state.rules).threads.some((t) => t.name === thread),
    `There's no thread called ${thread}.`,
  );
  return rulesChange(
    state,
    budgetLine(state.rules, thread, value),
    "setBudget",
    {
      thread,
      value,
    },
  );
}

export const clearBudget = (state, { thread }) =>
  setBudget(state, { thread, value: 0 });
