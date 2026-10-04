import { ms } from "../helpers.js";

// What happened in a period's dates: every transaction in them apart from
// transfers, the charges among them, their total, the total per thread
// (largest first), the six biggest charges and the number of days.
export function periodStats(txns, period) {
  const inside = txns.filter(
    (t) => !t.transfer && t.date >= period.start && t.date <= period.end,
  );
  const out = inside.filter((t) => t.amount > 0);
  const sum = out.reduce((a, t) => a + t.amount, 0);
  const byThread = {};
  out.forEach(
    (t) => (byThread[t.thread] = (byThread[t.thread] || 0) + t.amount),
  );
  return {
    inside,
    out,
    sum,
    byThread: Object.entries(byThread).sort((a, b) => b[1] - a[1]),
    biggest: [...out].sort((a, b) => b.amount - a.amount).slice(0, 6),
    days: Math.round((ms(period.end) - ms(period.start)) / 864e5) + 1,
  };
}
