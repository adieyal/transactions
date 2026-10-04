import { MONTHS, monthOf } from "../helpers.js";
import { accountMonths, byDate, groupBy } from "./moment-kit.js";
import { count, list, money, monthLong, name, ordinal } from "./copy.js";

// The facts with a shape that the year's sections add (Copy rules, section
// 4): a rhythm ("Paper Kite Cafe on the 9th"), a regular transfer, a gap in
// it, price changes, and what is expected ahead. Each comes from the moment
// rules or the expected charges, so every phrase lights its own payments.
// All of them need three months or more (Copy rules, section 2); the caller
// passes no moments with fewer.

const ids = (ts) => ts.map((t) => t.id);
const sum = (ts) => ts.reduce((a, t) => a + t.amount, 0);
const monthName = (ym) => monthLong(ym).split(" ")[0];
const day = (t) => Number(t.date.slice(8, 10));
export const nextMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

// "You were at Paper Kite Cafe on the 9th of both months, and of every month
// since." A rhythm is told once, in the first run of months it covers fully.
export function rhythmSentence(rhythms, run, last, told) {
  for (const r of rhythms) {
    if (told.has(r.id)) continue;
    const ts = r.txns.filter((t) => run.includes(monthOf(t.date)));
    if (new Set(ts.map((t) => monthOf(t.date))).size !== run.length) continue;
    told.add(r.id);
    const which =
      run.length === 2
        ? "both months"
        : `each of these ${count(run.length)} months`;
    const since = monthOf(r.txns.at(-1).date) === last && run.at(-1) !== last;
    return [
      { text: "You were at " },
      {
        text: `${name(r.facts.merchant)} on the ${ordinal(r.facts.day)}`,
        txnIds: ids(ts),
      },
      { text: ` of ${run.length === 1 ? "that month" : which}` },
      { text: since ? ", and of every month since." : "." },
    ];
  }
  return null;
}

// Money moved to another of your accounts on the same day for the same
// amount in every month of a run: "₪150 went into Demo Savings on the 24th".
// A clause, without its full stop; the quiet section joins it to others.
export function transferSentence(derived, run, told) {
  const moved = derived.allTxns.filter(
    (t) =>
      t.transfer?.kind === "pair" &&
      t.transfer.dir === "out" &&
      run.includes(monthOf(t.date)),
  );
  const to = (t) => derived.byId.get(t.transfer.other)?.account;
  for (const ts of groupBy(moved, (t) => `${t.account}\n${to(t)}`).values()) {
    if (ts.length !== run.length) continue;
    if (new Set(ts.map((t) => monthOf(t.date))).size !== run.length) continue;
    if (new Set(ts.map(day)).size !== 1) continue;
    if (new Set(ts.map((t) => t.amount)).size !== 1) continue;
    if (!to(ts[0]) || told.has(`move:${to(ts[0])}`)) continue;
    told.add(`move:${to(ts[0])}`);
    return [
      {
        text: `${money(ts[0].amount)} went into ${name(to(ts[0]))} on the ${ordinal(day(ts[0]))}`,
        txnIds: ids(ts.sort(byDate)),
      },
      ...(run.length > 1 ? [{ text: " of each month" }] : []),
    ];
  }
  return null;
}

// "Nothing went into Demo Savings in December or January; it did in every
// other month." A gap moment, told in the section holding its first month.
export function gapSentence(derived, gap) {
  const ts = gap.txns;
  const t0 = ts[0];
  const other =
    t0.transfer?.kind === "pair" && derived.byId.get(t0.transfer.other);
  const where = other
    ? `into ${name(other.account)}`
    : `to ${name(gap.facts.merchant)}`;
  const covered = accountMonths(derived, t0.account);
  const present = new Set(ts.map((t) => monthOf(t.date)));
  const others = covered.filter((m) => !gap.facts.months.includes(m));
  const all = others.every((m) => present.has(m));
  return [
    {
      text: `Nothing went ${where} in ${list(gap.facts.months.map(monthName), "or")}`,
      txnIds: ids(ts),
    },
    {
      text: all
        ? "; it did in every other month."
        : `; it did in ${count(others.filter((m) => present.has(m)).length)} of the other ${count(others.length)} months.`,
    },
  ];
}

// "One price changed in August: Lantern Stream went from ₪29 to ₪35."
export function priceSentence(prices) {
  if (!prices.length) return null;
  const months = [...new Set(prices.map((p) => p.month))].sort();
  const n = prices.length;
  const parts = [
    {
      text: `${n === 1 ? "One price" : `${count(n)[0].toUpperCase()}${count(n).slice(1)} prices`} changed in ${list(months.map(monthName))}: `,
    },
  ];
  prices.forEach((p, i) => {
    if (i) parts.push({ text: i === n - 1 ? ", and " : ", " });
    parts.push({
      text: `${name(p.facts.merchant)} went from ${money(p.facts.before)} to ${money(p.facts.after)}`,
      txnIds: p.txnIds,
    });
  });
  parts.push({ text: "." });
  return parts;
}

// "Coming up, going by what repeats: about ₪267 in Bills in the first week of
// October, ₪35 to Lantern Stream on the 15th and ₪95 to Meadow Paws on the
// 18th. Your October statement isn’t added yet, so these are expected, not
// paid." A thread with two or more expected charges is told as one amount;
// merchants whose price changed come first, then the largest. At most three.
// threads: the names of the person's threads; other rows (Loose ends) are
// never told as one amount.
export function aheadSentence(expected, month, currency, changed, threads) {
  const due = expected.filter(
    (e) =>
      e.amount > 0 &&
      !e.transfer &&
      e.currency === currency &&
      monthOf(e.date) === month,
  );
  if (!due.length) return null;
  const items = [];
  const single = [];
  for (const [thread, ts] of groupBy(due, (e) => e.thread ?? "")) {
    if (threads.has(thread) && ts.length > 1) {
      const week = ts.every((e) => day(e) <= 7);
      items.push({
        ts,
        first: ts.map((e) => e.date).sort()[0],
        rank: Infinity,
        text: `about ${money(sum(ts))} in ${name(thread)} ${week ? "in the first week of" : "in"} ${monthName(month)}`,
      });
    } else single.push(...ts);
  }
  for (const e of single)
    items.push({
      ts: [e],
      first: e.date,
      rank: changed.has(e.key) ? Infinity : e.amount,
      text: `${money(e.amount)} to ${name(e.merchant)} on the ${ordinal(day(e))}`,
    });
  const shown = items
    .sort((a, b) => b.rank - a.rank || sum(b.ts) - sum(a.ts))
    .slice(0, 3)
    .sort((a, b) => a.first.localeCompare(b.first));
  return [
    { text: "Coming up, going by what repeats: " },
    {
      text: list(shown.map((i) => i.text)),
      txnIds: shown.flatMap((i) => ids(i.ts)),
    },
    {
      text: `. Your ${monthName(month)} statement isn’t added yet, so these are expected, not paid.`,
    },
  ];
}

// A fact told after the month's own sentence, or as its own paragraph.
export function addFact(section, parts) {
  if (section.after)
    section.after = [...section.after, { text: " " }, ...parts];
  else section.paragraphs.push(parts);
}

// "Sep 2026 and ahead": recent price changes and the charges expected in
// the first month after the statements. When the latest month had nothing
// standing out, this section is that month's; otherwise it starts after it.
export function aheadSection(derived, last, withLast, currency, recent) {
  const changed = new Set(recent.flatMap((p) => p.facts.keys));
  const next = derived.expected
    .filter((e) => e.amount > 0 && e.currency === currency)
    .map((e) => monthOf(e.date))
    .filter((m) => m > last)
    .sort()[0];
  const paragraphs = [
    priceSentence(recent),
    next
      ? aheadSentence(
          derived.expected,
          next,
          currency,
          changed,
          new Set(derived.R.threads.map((t) => t.name)),
        )
      : null,
  ].filter(Boolean);
  if (!paragraphs.length) return null;
  const start = withLast ? last : nextMonth(last);
  const [y, m] = start.split("-").map(Number);
  return {
    id: `ahead-${start}`,
    label: `${MONTHS[m - 1]} ${y} and ahead`,
    from: `${start}-01`,
    to: `${start}-28`,
    months: withLast ? [last] : [],
    paragraphs,
  };
}
