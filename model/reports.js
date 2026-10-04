// Commands on saved questions (reports): save, remove and restore.
import { need, record } from "./change.js";

const replace = (state, reports, command, extra) =>
  record(
    command,
    [{ field: "reports", value: [state.reports, reports] }],
    extra,
  );

// report: the fields to save, with an id chosen by the caller.
export function addReport(state, { report }) {
  need(
    report && typeof report.id === "string",
    "A saved question needs an id.",
  );
  need(String(report.q || "").trim(), "A saved question needs its question.");
  need(
    !state.reports.some((r) => r.id === report.id),
    "That question is saved already.",
  );
  return replace(state, [...state.reports, { ...report }], "addReport", {
    id: report.id,
  });
}

export function removeReport(state, { id }) {
  const i = state.reports.findIndex((r) => r.id === id);
  need(i >= 0, "There's no such saved question.");
  return replace(
    state,
    state.reports.filter((_, j) => j !== i),
    "removeReport",
    { id, report: state.reports[i], at: i, summary: "Report removed." },
  );
}

// Puts a removed question back where it was. The record from removeReport
// says what and where; undoing that record does the same.
export function restoreReport(state, { report, at = state.reports.length }) {
  need(report && typeof report.id === "string", "Say which question.");
  if (state.reports.some((r) => r.id === report.id)) return null;
  const reports = state.reports.slice();
  reports.splice(Math.min(at, reports.length), 0, { ...report });
  return replace(state, reports, "restoreReport", { id: report.id });
}
