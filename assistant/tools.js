import { monthOf, normText, sumsByCurrency } from "../helpers.js";

// What the assistant's tools do, as pure functions of the derived data. The
// UI describes the tools to the assistant, calls these, and applies any
// changes they return; nothing here touches state.

// Transactions matching a find_transactions or totals filter.
export function filterTxns(derived, q = {}) {
  let ts = q.include_expected
    ? [...derived.allTxns, ...derived.expected]
    : [...derived.allTxns];
  if (!q.include_transfers) ts = ts.filter((t) => !t.transfer);
  if (q.period) {
    const pn = String(q.period).toLowerCase();
    ts = ts.filter((t) =>
      (t.periods || []).some((n) => n.toLowerCase().includes(pn)),
    );
  }
  if (q.ids?.length) {
    const s = new Set(q.ids.map(String));
    ts = ts.filter((t) => s.has(t.id));
  }
  if (q.text) {
    const n = normText(q.text),
      l = String(q.text).toLowerCase();
    ts = ts.filter(
      (t) => t.norm.includes(n) || t.raw.toLowerCase().includes(l),
    );
  }
  if (q.thread)
    ts = ts.filter(
      (t) => t.thread.toLowerCase() === String(q.thread).toLowerCase(),
    );
  if (q.account)
    ts = ts.filter((t) =>
      t.account.toLowerCase().includes(String(q.account).toLowerCase()),
    );
  if (q.from) ts = ts.filter((t) => t.date >= q.from);
  if (q.to) ts = ts.filter((t) => t.date <= q.to);
  if (q.min != null) ts = ts.filter((t) => t.amount >= +q.min);
  if (q.max != null) ts = ts.filter((t) => t.amount <= +q.max);
  return ts;
}

// Everything the inspector shows about a transaction, without empty fields.
// rules: the threads text in use; transferText: how a transfer is described.
export function compactTxn(t, { rules, transferText }) {
  return {
    periods: t.periods?.length ? t.periods : undefined,
    transfer: t.transfer ? transferText(t) : undefined,
    transfer_other: t.transfer?.kind === "pair" ? t.transfer.other : undefined,
    id: t.id,
    kind: t.kind === "actual" ? undefined : t.kind,
    date: t.date,
    charge_date:
      t.chargeDate && t.chargeDate !== t.date ? t.chargeDate : undefined,
    merchant: t.merchant,
    original: t.original && t.original !== t.merchant ? t.original : undefined,
    amount: t.amount,
    currency: t.currency,
    orig: t.orig ? `${t.orig.currency} ${t.orig.amount}` : undefined,
    type: t.type || undefined,
    details: t.details || undefined,
    thread: t.thread,
    rule:
      t.matchLine != null
        ? `line ${t.matchLine + 1}: ${rules.split("\n")[t.matchLine].trim()}`
        : undefined,
    account: t.account,
    source: t.derivedFrom
      ? `worked out from the ${t.account} ${t.derivedFrom.period || ""} statement`
      : [t.account, t.period && `${t.period} statement`, t.file]
          .filter(Boolean)
          .join(", "),
    note: t.note || undefined,
    inst: t.inst ? `${t.inst.n}/${t.inst.of}` : undefined,
    expected: t.kind === "ghost" || undefined,
    why: t.why || undefined,
  };
}

// find_transactions: newest first, at most `limit` rows (60 unless given).
export function findTransactions(derived, q, compact) {
  const ts = filterTxns(derived, q).sort((a, b) => (a.date < b.date ? 1 : -1));
  const lim = Math.min(200, Math.max(1, +q.limit || 60));
  return {
    count: ts.length,
    // One total per currency, never added together: { EUR: 120.5, GBP: 40 }.
    totals: Object.fromEntries(
      sumsByCurrency(ts).map(([c, v]) => [c, +v.toFixed(2)]),
    ),
    rows: ts.slice(0, lim).map(compact),
  };
}

// totals: count and sum per group and currency, by key for months and
// statement periods, otherwise largest first.
export function totals(derived, q) {
  const f =
    {
      month: (t) => monthOf(t.date),
      thread: (t) => t.thread,
      merchant: (t) => t.merchant,
      account: (t) => t.account,
      period: (t) => t.period,
    }[q.group_by] || ((t) => t.thread);
  const g = {};
  for (const t of filterTxns(derived, q)) {
    const k = f(t) + "\n" + t.currency;
    g[k] ||= { key: f(t), currency: t.currency, count: 0, total: 0 };
    g[k].count++;
    g[k].total += t.amount;
  }
  const out = Object.values(g).map((x) => ({
    ...x,
    total: +x.total.toFixed(2),
  }));
  return /month|period/.test(q.group_by)
    ? out.sort((a, b) =>
        a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : a.currency < b.currency
              ? -1
              : 1,
      )
    : out.sort(
        (a, b) =>
          (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0) ||
          b.total - a.total,
      );
}

// list_merchants: each distinct statement description, largest total first.
export function listMerchants(derived) {
  const g = {};
  for (const t of derived.allTxns) {
    const k = t.nameKey + "\n" + t.currency;
    g[k] ||= {
      original: t.original,
      name: t.merchant,
      currency: t.currency,
      count: 0,
      total: 0,
    };
    g[k].count++;
    g[k].total += t.amount;
  }
  return Object.values(g)
    .sort((a, b) => b.total - a.total)
    .slice(0, 400)
    .map((x) => ({ ...x, total: +x.total.toFixed(2) }));
}
