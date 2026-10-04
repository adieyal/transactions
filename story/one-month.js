import { addMonths, monthOf, ms, withCurrency } from "../helpers.js";
import { STARTER_RULES } from "../defaults.js";
import { LOOSE, TRANSFERS } from "../transactions/constants.js";
import { parseRules } from "../transactions/rules.js";
import { coveredMonths } from "./moment-kit.js";
import { detectMoments } from "./moments.js";
import {
  count,
  dayShort,
  list,
  money,
  monthLong,
  name,
  ordinal,
} from "./copy.js";

// Artboard 2, one month: the timeline band's rows and axis, and a story told
// with only what one month can say (Copy rules, section 2): totals and
// counts, the busiest week, the largest payment and what happened more than
// once within the month. No comparison words: typical, usual, regular,
// every month, again, new.

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKS = [
  "The first week",
  "The second week",
  "The third week",
  "The fourth week",
  "The last days",
];
const TIMES = ["", "once", "twice"];
const pay = (t) => t.amount > 0 && !t.transfer;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const day = (t) => Number(t.date.slice(8, 10));
const sum = (ts) => ts.reduce((a, t) => a + t.amount, 0);

// The month's main currency: the one most payments are in. A total never
// adds two currencies.
function mainCurrency(ts) {
  const n = new Map();
  for (const t of ts) n.set(t.currency, (n.get(t.currency) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Threads whose rules are still the starter rules, unedited.
function starterThreads(rules) {
  const sig = (t) =>
    `${t.patterns.map((p) => p.src).join("\n")}|${t.budget ?? ""}`;
  const starter = new Map(
    parseRules(STARTER_RULES).threads.map((t) => [t.name, sig(t)]),
  );
  return new Set(
    parseRules(rules)
      .threads.filter((t) => starter.get(t.name) === sig(t))
      .map((t) => t.name),
  );
}

export function daysIn(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The day axis: each day with its weekday's initial.
export function monthAxis(month) {
  return Array.from({ length: daysIn(month) }, (_, i) => {
    const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { day: i + 1, weekday: WEEKDAY[new Date(ms(iso)).getUTCDay()] };
  });
}

// The days of the month the statements cover (Copy rules s2: a month counts
// as complete only when a statement covers all of it). A statement file
// doesn't say its dates, so its first and last rows mark them. Payments
// rarely fall on the very first and last days, so a span that reaches into
// the first and the last week of the month counts as all of it; a gap of a
// week or more at either end means the statement doesn't reach it.
const EDGE = 7;
export function monthSpan(state, month) {
  const last = daysIn(month);
  const [start, end] = [`${month}-01`, `${month}-31`];
  let from = null,
    to = null;
  for (const b of Object.values(state.batches || {})) {
    const ds = (b.rows || [])
      .map((r) => r.date)
      .filter(Boolean)
      .sort();
    if (!ds.length || ds[0] > end || ds.at(-1) < start) continue;
    const f = ds[0] < start ? 1 : day({ date: ds[0] });
    const t = ds.at(-1) > end ? last : day({ date: ds.at(-1) });
    from = Math.min(from ?? f, f);
    to = Math.max(to ?? t, t);
  }
  if (from == null) return null;
  const complete = from <= EDGE && to > last - EDGE;
  return complete ? { from: 1, to: last, complete } : { from, to, complete };
}

// "13–17 September so far" for the latest month, "13–30 September" for an
// earlier one, and "September 2026" when the month is complete.
export function monthLabel(state, month, latest) {
  const span = monthSpan(state, month);
  if (!span || span.complete) return monthLong(month);
  const name = monthLong(month).split(" ")[0];
  const days =
    span.from === span.to ? `${span.from}` : `${span.from}–${span.to}`;
  return `${days} ${name}${latest && span.to < daysIn(month) ? " so far" : ""}`;
}

// One row per thread with payments this month, in the threads' own order,
// each bead sized by its amount as drawn: 9px plus 0.85 × √amount, at most
// 30px.
export function monthRows(derived, state, month) {
  const inMonth = derived.allTxns.filter(
    (t) => monthOf(t.date) === month && t.amount > 0 && t.thread,
  );
  const starter = starterThreads(state.rules);
  return Object.keys(derived.colorOf)
    .map((thread) => ({
      thread,
      color: derived.colorOf[thread],
      starter: thread !== LOOSE && starter.has(thread),
      beads: inMonth
        .filter((t) => t.thread === thread)
        .map((t) => ({
          id: t.id,
          day: day(t),
          date: t.date,
          merchant: t.merchant,
          amount: money(t.amount, t.currency),
          size: Math.round(Math.min(30, 9 + Math.sqrt(t.amount) * 0.85)),
        })),
    }))
    .filter((r) => r.beads.length);
}

// "₪995 went out in September, in 12 payments." and, when money moved to
// another of the person's accounts, "Another ₪150 went to Savings on the
// 24th."
function lead(pays, moves, derived, label, span) {
  const when =
    span && !span.complete
      ? span.from === span.to
        ? `on ${span.from} ${label}`
        : `between ${span.from} and ${span.to} ${label}`
      : `in ${label}`;
  const parts = [
    {
      text: `${money(sum(pays))} went out ${when}, in ${pays.length === 1 ? "one payment" : `${pays.length} payments`}.`,
      txnIds: pays.map((t) => t.id),
    },
  ];
  const to = new Map();
  for (const t of moves) {
    const acct = derived.byId.get(t.transfer.other)?.account;
    if (acct && acct !== t.account) to.set(acct, [...(to.get(acct) || []), t]);
  }
  const [acct, ts] = [...to].sort((a, b) => sum(b[1]) - sum(a[1]))[0] ?? [];
  if (acct) {
    const when =
      ts.length === 1
        ? `on the ${ordinal(day(ts[0]))}`
        : `in ${count(ts.length)} transfers`;
    parts.push(
      { text: " Another " },
      {
        text: `${money(sum(ts))} went to ${name(acct)} ${when}`,
        txnIds: ts.map((t) => t.id),
      },
      { text: "." },
    );
  }
  return parts;
}

// The busiest week, and a thread whose payments all fell inside it. Only
// weeks the statements cover in full are compared.
function busiestWeek(pays, month, monthName, span) {
  const covered = (w) => {
    const from = w * 7 + 1,
      to = w === 4 ? daysIn(month) : from + 6;
    return !span || (from >= span.from && to <= span.to);
  };
  const weeks = [0, 1, 2, 3, 4]
    .filter(covered)
    .map((w) => ({
      w,
      ts: pays.filter((t) => Math.min(4, Math.floor((day(t) - 1) / 7)) === w),
    }))
    .filter((x) => x.ts.length);
  if (weeks.length < 2) return null;
  const top = weeks.sort((a, b) => sum(b.ts) - sum(a.ts))[0];
  const from = top.w * 7 + 1,
    to = top.w === 4 ? daysIn(month) : from + 6;
  const parts = [
    { text: `${WEEKS[top.w]} ${top.w === 4 ? "were" : "was"} the busiest: ` },
    {
      text: `${money(sum(top.ts))} between ${from} and ${to} ${monthName}`,
      txnIds: top.ts.map((t) => t.id),
      days: [from, to],
    },
  ];
  const threads = [...new Set(top.ts.map((t) => t.thread))].filter(
    (th) => th !== LOOSE && th !== TRANSFERS,
  );
  const whole = threads
    .map((th) => pays.filter((t) => t.thread === th))
    .filter(
      (ts) =>
        ts.length >= 2 && ts.length <= 4 && ts.every((t) => top.ts.includes(t)),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (!whole) return [...parts, { text: "." }];
  return [
    ...parts,
    { text: ", including " },
    {
      text: `all ${count(whole.length)} ${name(whole[0].thread)} payments`,
      txnIds: whole.map((t) => t.id),
    },
    {
      text: `: ${list(whole.map((t) => `${name(t.merchant)} on the ${ordinal(day(t))}`))}.`,
    },
  ];
}

// The merchant paid most often, and the largest single payment.
function repeatsAndLargest(pays) {
  const by = new Map();
  for (const t of pays) by.set(t.merchant, [...(by.get(t.merchant) || []), t]);
  const [merchant, ts] =
    [...by]
      .filter(([, ts]) => ts.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || sum(b[1]) - sum(a[1]))[0] ??
    [];
  const parts = [];
  if (merchant) {
    const gaps = ts.slice(1).map((t, i) => day(t) - day(ts[i]));
    const weekly = ts.length >= 3 && gaps.every((g) => g >= 5 && g <= 9);
    parts.push(
      { text: "You went to " },
      {
        text: `${name(merchant)} ${TIMES[ts.length] ?? `${count(ts.length)} times`}${weekly ? ", about once a week" : ""}`,
        txnIds: ts.map((t) => t.id),
      },
      { text: `, ${money(sum(ts))} in all. ` },
    );
  }
  const big = [...pays].sort((a, b) => b.amount - a.amount)[0];
  parts.push(
    { text: "The largest single payment was " },
    { text: `${money(big.amount)} to ${name(big.merchant)}`, txnIds: [big.id] },
    { text: "." },
  );
  return parts;
}

// "Is it something you pay every month?" about the largest payment to a
// merchant seen once this month, while there are only one or two months
// (Copy rules s6, Maybe regular). Any payment can be asked about, in a
// thread or not: a first statement often has no threads yet. The answer is
// kept under the merchant, so it is asked once.
function maybeRegular(pays, months, answers) {
  if (months > 2) return null;
  const once = pays.filter(
    (t) => pays.filter((x) => x.merchant === t.merchant).length === 1,
  );
  const t = once.sort((a, b) => b.amount - a.amount)[0];
  if (!t) return null;
  const id = `regular-${t.key}`;
  return {
    id,
    date: t.date,
    merchant: t.merchant,
    txnIds: [t.id],
    text: `${money(t.amount)} went to ${name(t.merchant)}. Is it something you pay every month?`,
    answer: answers?.[id] ?? null,
  };
}

// The result line under an answered question, as drawn.
export function regularResult(q) {
  const a = q.answer;
  if (!a) return "";
  if (a.status === "skipped")
    return "Skipped. Your next statement will show whether it repeats.";
  return a.choice === "monthly"
    ? `Noted: ${name(q.merchant)} is a monthly payment. Next month’s statement will be compared with this one.`
    : `Noted: ${name(q.merchant)} isn’t a regular payment.`;
}

// "Two payments aren’t in a thread yet: Meadow Paws (₪95) and Bright Spark
// Electrical (₪96)."
function looseEnds(pays) {
  const ts = pays.filter((t) => t.thread === LOOSE);
  if (!ts.length) return null;
  const shown = ts.slice(0, ts.length > 4 ? 3 : 4);
  const items = shown.map((t) => `${name(t.merchant)} (${money(t.amount)})`);
  if (ts.length > shown.length) items.push(`${ts.length - shown.length} more`);
  return {
    txnIds: ts.map((t) => t.id),
    parts: [
      {
        text: `${cap(count(ts.length))} ${ts.length === 1 ? "payment isn’t" : "payments aren’t"} in a thread yet`,
        txnIds: ts.map((t) => t.id),
      },
      { text: `: ${list(items)}.` },
    ],
  };
}

// Everything artboard 2 says about one month. Phrases are { text, txnIds,
// days }, so each lights up exactly the payments it describes.
export function oneMonthStory(derived, state, month) {
  const inMonth = derived.allTxns
    .filter((t) => monthOf(t.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date));
  return withCurrency(mainCurrency(inMonth.filter(pay)), () =>
    tell(derived, state, month, inMonth),
  );
}

function tell(derived, state, month, inMonth) {
  const months = coveredMonths(derived);
  if (!months.includes(month)) return null;
  const currency = mainCurrency(inMonth.filter(pay));
  const pays = inMonth.filter((t) => pay(t) && t.currency === currency);
  const moves = inMonth.filter(
    (t) => t.amount > 0 && t.transfer && t.currency === currency,
  );
  const span = monthSpan(state, month);
  const label = monthLabel(state, month, month === months.at(-1));
  const monthName = monthLong(month).split(" ")[0];
  const accounts = [...new Set(inMonth.map((t) => t.account))];
  const batches = Object.keys(state.batches).length;
  return {
    month,
    label,
    source: [
      months.length > 1
        ? "From your statements"
        : batches === 1
          ? "Your first statement"
          : "Your first statements",
      ...accounts,
    ],
    months: months.length,
    previous: addMonths(`${month}-01`, -1).slice(0, 7),
    axis: monthAxis(month),
    rows: monthRows(derived, state, month),
    allIds: pays.map((t) => t.id),
    span,
    lead: pays.length ? lead(pays, moves, derived, monthName, span) : [],
    paragraphs: pays.length
      ? [
          busiestWeek(pays, month, monthName, span),
          repeatsAndLargest(pays),
        ].filter(Boolean)
      : [],
    question: maybeRegular(pays, months.length, state.answers),
    loose: looseEnds(pays),
  };
}

// The Periods strip (Copy rules s3): the person's periods and the busy
// stretches the app finds, each clipped to the month as a first and last
// day. A stretch is told by its amount and dates only: "₪720 · 2–6 Jun".
export function periodStrip(derived, state, month) {
  const first = `${month}-01`,
    last = `${month}-${String(daysIn(month)).padStart(2, "0")}`;
  const span = (from, to) =>
    from > last || to < first
      ? null
      : {
          from: from < first ? 1 : day({ date: from }),
          to: to > last ? daysIn(month) : day({ date: to }),
        };
  const periods = (state.periods || [])
    .map((p) => {
      const s = span(p.start, p.end);
      return s && { id: p.id, name: p.name, color: p.color, ...s };
    })
    .filter(Boolean);
  const stretches = detectMoments(derived, state)
    .filter((m) => m.kind === "cluster")
    .map((m) => {
      const s = span(m.from, m.to);
      if (!s) return null;
      const days = s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`;
      const [mon, long] = [dayShort(first).split(" ")[1], monthLong(month)];
      return {
        id: m.id,
        ...s,
        txnIds: m.txnIds,
        label: `${money(m.facts.total, m.currency)} · ${days} ${mon}`,
        aria: `A busy stretch, ${s.from === s.to ? s.from : `${s.from} to ${s.to}`} ${long.split(" ")[0]}, not named yet`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.from - b.from);
  return { month, days: daysIn(month), periods, stretches };
}
