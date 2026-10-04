// What a saved question (ui/reports.js) records about the statements when it
// runs, so Run again can say what's new.

// The latest payment on the statements, for a run's `through`.
export const latestPayment = (derived) =>
  derived.txns
    .filter((t) => t.kind === "actual")
    .reduce((a, t) => (t.date > a ? t.date : a), "");
