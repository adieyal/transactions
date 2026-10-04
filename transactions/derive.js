import { addMonths, normText } from "../helpers.js";
import { LOOSE, TRANSFERS } from "./constants.js";
import { parseRules } from "./rules.js";
import { detectTransfers } from "./transfers.js";
import { findChanges } from "./changes.js";

function deriveTransactions(state, { today }) {
  const R = parseRules(state.previewRules ?? state.rules);
  const all = new Map();
  // Rows whose currency isn't known yet wait until the person says it (see
  // needsCurrency in documents.js); an amount is never shown in a guessed one.
  let unpriced = 0;
  for (const b of Object.values(state.batches))
    for (const r of b.rows)
      if (!r.currency) unpriced++;
      else if (!all.has(r.id)) all.set(r.id, r);
  const accounts = [...new Set([...all.values()].map((r) => r.account))].sort();
  const coverage = {};
  for (const b of Object.values(state.batches)) {
    coverage[b.account] ||= new Set();
    b.periods.forEach((p) => coverage[b.account].add(p));
  }
  const purchaseCoverage = purchaseMonths(state.batches);
  const TR = detectTransfers([...all.values()], state);
  const txns = [];
  for (const r of all.values()) {
    if (state.hiddenAccounts.has(r.account)) continue;
    const note = state.notes[r.id] || "";
    const nk = normText(r.merchant);
    const alias = state.names[nk]?.name || "";
    const t = {
      ...r,
      merchant: alias || r.merchant,
      original: r.merchant,
      nameKey: nk,
      renamed: !!alias,
      note,
      key: r.account + "::" + nk,
      noteLower: note.toLowerCase(),
      raw: (alias ? alias + " " : "") + r.merchant + " " + note,
      norm: (alias ? normText(alias) + " " : "") + nk + " " + normText(note),
      kind: "actual",
      transfer: TR.info[r.id] || null,
    };
    txns.push(t);
  }
  // threads
  const lineHits = {};
  for (const t of txns) {
    t.thread = LOOSE;
    t.matchLine = null;
    if (t.transfer) {
      t.thread = TRANSFERS;
      continue;
    }
    outer: for (const th of R.threads)
      for (const p of th.patterns)
        if (p.test(t)) {
          t.thread = th.name;
          t.matchLine = p.line;
          t.threadLine = th.line;
          break outer;
        }
    if (t.matchLine != null) (lineHits[t.matchLine] ||= []).push(t);
  }
  // money in: a credit that isn't a transfer, from a merchant never paid.
  // A credit from a merchant you also paid is a refund.
  const paid = new Set(
    txns.filter((t) => t.amount > 0 && !t.transfer).map((t) => t.key),
  );
  for (const t of txns)
    t.inflow = t.amount < 0 && !t.transfer && !paid.has(t.key);
  // recurring: same merchant in two or more statement months; projected only if it's in the latest one
  const groups = {};
  for (const t of txns)
    if (!t.inst && !t.transfer) (groups[t.key] ||= []).push(t);
  const expected = [];
  const links = [];
  const horizon = addMonths(today, 3);
  for (const g of Object.values(groups)) {
    const periods = new Set(g.map((t) => t.period));
    if (periods.size < 2) continue;
    g.sort((a, b) => (a.date < b.date ? -1 : 1));
    g.forEach((t) => (t.recurring = true));
    const last = g.at(-1);
    const cov = [...(coverage[last.account] || [])].sort();
    const chain = g.map((t) => t.id);
    if (cov.at(-1) === last.period) {
      for (let k = 1; k <= 12; k++) {
        const d = addMonths(last.date, k);
        if (d > horizon) break;
        if (d <= today) continue;
        const e = {
          ...last,
          id: `x${last.id}-${k}`,
          date: d,
          chargeDate: d,
          kind: "ghost",
          note: "",
          recurring: true,
          amount: last.amount,
          details: "",
          derivedFrom: last,
          why: `Expected, because ${last.merchant} appears in ${periods.size} statements`,
        };
        expected.push(e);
        chain.push(e.id);
      }
    }
    links.push(chain);
  }
  // instalments: fill in missing payments and project the rest
  const plans = {};
  for (const t of txns)
    if (t.inst && !t.transfer)
      (plans[t.key + "|" + t.date + "|" + t.inst.of] ||= []).push(t);
  const purchases = [];
  for (const ps of Object.values(plans)) {
    ps.sort((a, b) => a.inst.n - b.inst.n);
    const ref = ps[0];
    const have = new Set(ps.map((p) => p.inst.n));
    const purchase = {
      ...ref,
      id: `p${ref.id}`,
      kind: "purchase",
      chargeDate: ref.date,
      details: "",
      derivedFrom: ref,
      amount: ref.orig?.amount ?? ref.amount * ref.inst.of,
      why: `Bought in ${ref.inst.of} payments`,
    };
    purchases.push(purchase);
    const chain = [purchase.id];
    for (let n = 1; n <= ref.inst.of; n++) {
      const got = ps.find((p) => p.inst.n === n);
      if (got) {
        chain.push(got.id);
        continue;
      }
      const d = addMonths(ref.chargeDate, n - ref.inst.n);
      const e = {
        ...ref,
        id: `i${ref.id}-${n}`,
        chargeDate: d,
        date: d,
        inst: { n, of: ref.inst.of },
        note: "",
        kind: d > today ? "ghost" : "inferred",
        details: "",
        derivedFrom: ref,
        why:
          d > today
            ? `Payment ${n} of ${ref.inst.of}, still to come`
            : `Payment ${n} of ${ref.inst.of}, in a statement you haven't added`,
      };
      if (e.kind === "ghost") expected.push(e);
      else purchases.push(e);
      chain.push(e.id);
    }
    links.push(chain);
  }
  for (const t of txns)
    if (t.transfer?.kind === "pair" && t.transfer.dir === "out")
      links.push([t.id, t.transfer.other]);
  let extras = [...expected, ...purchases];
  for (const t of [...txns, ...extras]) {
    const d = t.date;
    t.periods = state.periods
      .filter((p) => d >= p.start && d <= p.end)
      .map((p) => p.name);
  }
  // Price changes and stopped charges, for the questions (story/moments.js).
  const flags = findChanges(groups, coverage, state.dismissed);
  const byId = new Map();
  [...txns, ...extras].forEach((t) => byId.set(t.id, t));
  // the filter box: every term must match the description, details or note; #tags look only in notes; -term excludes
  const Q = parseQuery(state.query);
  let shown = txns,
    shownExpected = expected;
  if (Q) {
    const ok = (t) => Q.every((q) => q.test(t) !== q.neg);
    shown = txns.filter(ok);
    extras = extras.filter((t) =>
      ok(t.derivedFrom ? { ...t, note: t.derivedFrom.note || "" } : t),
    );
    shownExpected = expected.filter((t) => extras.includes(t));
    for (const k of Object.keys(lineHits)) lineHits[k] = lineHits[k].filter(ok);
  }
  const names = [
    ...R.threads.map((t) => t.name),
    LOOSE,
    ...(txns.some((t) => t.transfer) ? [TRANSFERS] : []),
  ];
  const colorOf = Object.fromEntries(R.threads.map((t) => [t.name, t.color]));
  colorOf[LOOSE] = "#6F787B";
  colorOf[TRANSFERS] = "#6F7F99";
  const tags = {};
  for (const n of Object.values(state.notes))
    for (const m of String(n)
      .toLowerCase()
      .matchAll(/#[\p{L}\p{N}_-]+/gu))
      tags[m[0]] = (tags[m[0]] || 0) + 1;
  return {
    R,
    // The filter's matches by id, for the canvas views that keep every bead
    // and dim the rest; null with no filter.
    matched: Q ? new Set([...shown, ...extras].map((t) => t.id)) : null,
    txns: shown,
    allTxns: txns,
    expected: shownExpected,
    extras,
    byId,
    links,
    accounts,
    coverage,
    purchaseCoverage,
    names,
    colorOf,
    lineHits,
    tags,
    filtered: !!Q,
    flags,
    stmts: TR.stmts,
    unpriced,
    stmtPaid: TR.paid,
  };
}

// The calendar months of purchases each account's statements cover. A card
// statement is often labelled with the month it is charged and holds the
// month before's purchases, so each statement label is shifted back by its
// usual gap between purchase and statement month. Instalments are left out:
// their dates are the original purchase.
const monthIndex = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + m - 1;
};
const fromIndex = (i) =>
  `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
function purchaseMonths(batches) {
  const lagOf = (rows, label) => {
    const lags = rows
      .filter((r) => !r.inst && r.date)
      .map(
        (r) => monthIndex(r.period || label) - monthIndex(r.date.slice(0, 7)),
      )
      .sort((a, b) => a - b);
    return lags.length ? Math.max(0, lags[(lags.length - 1) >> 1]) : null;
  };
  const accountLag = {};
  for (const b of Object.values(batches)) {
    const lag = lagOf(b.rows, b.periods[0]);
    if (lag != null) (accountLag[b.account] ||= []).push(lag);
  }
  const out = {};
  for (const b of Object.values(batches)) {
    const lags = (accountLag[b.account] || [0]).sort((x, y) => x - y);
    const lag = lagOf(b.rows, b.periods[0]) ?? lags[(lags.length - 1) >> 1];
    out[b.account] ||= new Set();
    for (const p of b.periods)
      out[b.account].add(fromIndex(monthIndex(p) - lag));
  }
  return out;
}

function parseQuery(q) {
  const terms = String(q || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return null;
  return terms.map((raw) => {
    const neg = raw.startsWith("-") && raw.length > 1;
    const term = (neg ? raw.slice(1) : raw).toLowerCase();
    if (term.startsWith("@") && term.length > 1)
      return {
        neg,
        test: (t) =>
          (t.periods || []).some((n) =>
            n.toLowerCase().includes(term.slice(1)),
          ),
      };
    if (term.startsWith("#"))
      return {
        neg,
        test: (t) =>
          new RegExp(
            "(^|[^\\p{L}\\p{N}_-])" +
              term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "(?![\\p{L}\\p{N}_-])",
            "u",
          ).test(String(t.note || "").toLowerCase()),
      };
    const n = normText(term);
    return {
      neg,
      test: (t) => {
        const hay = (
          t.merchant +
          " " +
          (t.original && t.original !== t.merchant ? t.original + " " : "") +
          (t.details || "") +
          " " +
          (t.note || "")
        ).toLowerCase();
        return hay.includes(term) || (!!n && normText(hay).includes(n));
      },
    };
  });
}
export { deriveTransactions };
