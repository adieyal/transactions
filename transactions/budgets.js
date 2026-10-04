// What a thread usually costs a month: its spending over the months the
// statements cover. Where a new budget line starts.
export function monthlyAverage(derived, thread) {
  const ts = derived.allTxns.filter((t) => t.thread === thread && t.amount > 0);
  const months = new Set(
    Object.values(derived.coverage).flatMap((set) => [...set]),
  );
  return ts.reduce((a, t) => a + t.amount, 0) / Math.max(1, months.size);
}
