import { addMonths, fnv, monthOf, ms, pad2 } from "../helpers.js";

// The small pieces every moment rule shares: arithmetic, months covered by
// statements, a typical month, and the moment record itself.

export const WEIGHT = {
  cluster: 1,
  large: 1,
  gap: 1,
  new: 0.8,
  spike: 0.8,
  budget: 1,
  price: 0.6,
  loose: 0.5,
  rhythm: 0.3,
};

const DAY = 86400000;
export const daysBetween = (a, b) => (ms(b) - ms(a)) / DAY;
export const byDate = (a, b) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
export const sum = (ts) => ts.reduce((s, t) => s + t.amount, 0);
export const round = (n) => Math.round(n * 100) / 100;
export const spending = (t) => t.amount > 0 && !t.transfer;

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// The median of a sorted list with one occurrence of `value` left out.
export function medianWithout(sorted, value) {
  const k = sorted.indexOf(value);
  const n = sorted.length - 1;
  if (k < 0 || n < 1) return null;
  const at = (i) => (i < k ? sorted[i] : sorted[i + 1]);
  return n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}
export function monthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
export const nextMonth = (ym) => addMonths(ym + "-01", 1).slice(0, 7);
export function monthsApart(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}
export function groupBy(items, key) {
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}
// Consecutive months as runs: ["2026-01", "2026-02", "2026-04"] gives two.
export function runsOf(months) {
  const runs = [];
  for (const m of months) {
    const run = runs.at(-1);
    if (run && nextMonth(run.at(-1)) === m) run.push(m);
    else runs.push([m]);
  }
  return runs;
}

// Stable across re-import and re-derivation: built from what the moment is
// about (merchant keys and dates), never from transaction ids.
export function momentId(kind, month, keys, dates) {
  const signature =
    [...new Set(keys)].sort().join("|") + "#" + [...dates].sort().join("|");
  return `${kind}-${month}-${fnv(signature)}`;
}

// The calendar months of purchases that statements cover, oldest first. A
// month with no statement yet is never among them.
export function coveredMonths(derived) {
  const months = new Set();
  for (const set of Object.values(derived.purchaseCoverage))
    set.forEach((m) => months.add(m));
  return [...months].sort();
}
export const accountMonths = (derived, account) =>
  [...(derived.purchaseCoverage[account] || [])].sort();

// The median spending of covered calendar months, leaving out transactions
// inside periods. With fewer than three covered months there is no typical.
export function typicalMonth(derived) {
  const months = coveredMonths(derived);
  if (months.length < 3) return null;
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  for (const t of derived.allTxns) {
    const m = monthOf(t.date);
    if (spending(t) && !t.periods?.length && m in totals) totals[m] += t.amount;
  }
  return median(Object.values(totals));
}

// The calendar months each merchant appears in. Three or more makes it routine.
export function monthsSeen(spend) {
  const out = new Map();
  for (const t of spend) {
    if (!out.has(t.key)) out.set(t.key, new Set());
    out.get(t.key).add(monthOf(t.date));
  }
  return out;
}

export function moment(kind, txns, facts, magnitude, extra = {}) {
  const sorted = [...txns].sort(byDate);
  const from = extra.from ?? sorted[0].date;
  const month = extra.month ?? monthOf(from);
  const keys = [...new Set(txns.map((t) => t.key))].sort();
  return {
    id: momentId(
      kind,
      month,
      extra.idKeys ?? keys,
      extra.idDates ?? sorted.map((t) => t.date),
    ),
    kind,
    month,
    from,
    to: extra.to ?? sorted.at(-1).date,
    txnIds: sorted.map((t) => t.id),
    facts: { keys, ...facts },
    rank: round(Math.abs(magnitude) * (extra.weight ?? WEIGHT[kind])),
  };
}
export const merchantsOf = (txns) => [
  ...new Set([...txns].sort(byDate).map((t) => t.merchant)),
];
