import { ms, sumsByCurrency } from "../helpers.js";

// What happened in a period's dates: every transaction in them apart from
// transfers, the charges among them, their total, the total per thread
// (largest first), the six biggest charges and the number of days.
export function periodStats(txns, period) {
  const inside = txns.filter(
    (t) => !t.transfer && t.date >= period.start && t.date <= period.end,
  );
  const out = inside.filter((t) => t.amount > 0);
  // Each currency is added up on its own: sums is [[currency, total]], and
  // byThread is [[thread, total, currency]].
  const byThread = new Map();
  for (const t of out) {
    const k = t.thread + "\n" + t.currency;
    const row = byThread.get(k) || [t.thread, 0, t.currency];
    row[1] += t.amount;
    byThread.set(k, row);
  }
  return {
    inside,
    out,
    sums: sumsByCurrency(out),
    byThread: [...byThread.values()].sort(
      (a, b) => a[2].localeCompare(b[2]) || b[1] - a[1],
    ),
    biggest: [...out].sort((a, b) => b.amount - a.amount).slice(0, 6),
    days: Math.round((ms(period.end) - ms(period.start)) / 864e5) + 1,
  };
}
