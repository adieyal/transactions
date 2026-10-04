import { MONTHS, monthOf, withCurrency } from "../helpers.js";
import {
  byDate,
  coveredMonths,
  daysBetween,
  typicalMonth,
} from "./moment-kit.js";
import { detectMoments } from "./moments.js";
import { periodNotes, summarizeMonth, summarizePeriod } from "./summary.js";
import { count, dateRange, list, money, monthLong, name } from "./copy.js";

// Artboard 3, two months or more: the year told as sections, each about a
// stretch of months or one that stood out (Copy rules, sections 2–4). A
// phrase is { text, txnIds }, so it lights up exactly the payments it
// describes; { chip } is a period's name, the person's own words. Typical
// is only said with three or more months.

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six"];
const MORE_WORDS = ["seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = (n) => (n <= 6 ? NUMBER_WORDS[n] : (MORE_WORDS[n - 7] ?? `${n}`));
const pay = (t) => t.amount > 0 && !t.transfer;
const sum = (ts) => ts.reduce((a, t) => a + t.amount, 0);
const ids = (ts) => ts.map((t) => t.id);
const monthName = (ym) => monthLong(ym).split(" ")[0];
const short = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, mon: MONTHS[m - 1], d };
};

// "10 – 13 Dec 2025", "28 Mar – 2 Apr 2026": a section's dates, as drawn.
export function shortRange(from, to) {
  const a = short(from),
    b = short(to);
  if (from === to) return `${a.d} ${a.mon} ${a.y}`;
  if (a.y === b.y && a.mon === b.mon) return `${a.d} – ${b.d} ${b.mon} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.mon} – ${b.d} ${b.mon} ${b.y}`;
  return `${a.d} ${a.mon} ${a.y} – ${b.d} ${b.mon} ${b.y}`;
}

// "Oct – Nov 2025", "Sep 2026": a run of months.
export function monthRange(first, last) {
  const [y1, m1] = first.split("-").map(Number),
    [y2, m2] = last.split("-").map(Number);
  if (first === last) return `${MONTHS[m1 - 1]} ${y1}`;
  return y1 === y2
    ? `${MONTHS[m1 - 1]} – ${MONTHS[m2 - 1]} ${y2}`
    : `${MONTHS[m1 - 1]} ${y1} – ${MONTHS[m2 - 1]} ${y2}`;
}

// "about three times a typical month", "close to a typical month".
function againstTypical(total, typical) {
  if (!typical) return "";
  const r = total / typical;
  if (Math.abs(r - 1) < 0.15) return "close to a typical month";
  if (r >= 1.8)
    return Math.round(r) === 2
      ? "about twice a typical month"
      : `about ${word(Math.round(r))} times a typical month`;
  return r > 1
    ? `about ${money(total - typical)} more than a typical month`
    : `about ${money(typical - total)} less than a typical month`;
}

function mainCurrency(ts) {
  const n = new Map();
  for (const t of ts) n.set(t.currency, (n.get(t.currency) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// "two payments to Fernhill Garden Centre, one to Stoneyard Supplies".
function merchantCounts(ts) {
  const by = new Map();
  for (const t of ts) by.set(t.merchant, (by.get(t.merchant) || 0) + 1);
  return list(
    [...by].map(([m, n], i) =>
      i === 0
        ? `${count(n)} ${n === 1 ? "payment" : "payments"} to ${name(m)}`
        : `${count(n)} to ${name(m)}`,
    ),
  );
}

// The periods and busy stretches inside the covered months, in date order.
function standouts(derived, state, first, last) {
  const end = `${last}-31`,
    start = `${first}-01`;
  const periods = (state.periods || [])
    .filter((p) => p.start <= end && p.end >= start)
    .map((p) => ({ kind: "period", id: p.id, from: p.start, to: p.end, p }));
  const stretches = detectMoments(derived, state)
    .filter((m) => m.kind === "cluster")
    .map((m) => ({ kind: "stretch", id: m.id, from: m.from, to: m.to, m }));
  return [...periods, ...stretches].sort((a, b) =>
    a.from.localeCompare(b.from),
  );
}

export function yearStory(derived, state) {
  const months = coveredMonths(derived);
  if (months.length < 2) return null;
  const inRange = derived.allTxns.filter((t) =>
    months.includes(monthOf(t.date)),
  );
  return withCurrency(mainCurrency(inRange.filter(pay)), () =>
    tell(derived, state, months, inRange),
  );
}

function tell(derived, state, months, inRange) {
  const currency = mainCurrency(inRange.filter(pay));
  const pays = inRange.filter((t) => pay(t) && t.currency === currency);
  const byMonth = new Map(months.map((m) => [m, []]));
  for (const t of pays) byMonth.get(monthOf(t.date)).push(t);
  const typical = typicalMonth(derived);
  const [first, last] = [months[0], months.at(-1)];
  const outs = standouts(derived, state, first, last);
  const title = `${monthLong(first)} to ${monthLong(last)}`;

  // "December came to ₪2,542, about three times a typical month."
  const monthSentence = (m) => {
    const ts = byMonth.get(m) ?? [];
    const vs = againstTypical(sum(ts), typical);
    return [
      { text: `${monthName(m)} came to ${money(sum(ts))}`, txnIds: ids(ts) },
      { text: vs ? `, ${vs}.` : "." },
    ];
  };

  const lead = [
    {
      text: `${money(sum(pays))} went out over these ${word(months.length)} months.`,
      txnIds: ids(pays),
    },
  ];
  if (typical == null) {
    lead.push(
      { text: " " },
      ...months.flatMap((m, i) => [
        ...(i ? [{ text: i === months.length - 1 ? " and " : ", " }] : []),
        {
          text: `${money(sum(byMonth.get(m)))} in ${monthName(m)}`,
          txnIds: ids(byMonth.get(m)),
        },
      ]),
      { text: "." },
    );
  } else {
    lead.push({ text: ` Most months came to about ${money(typical)}` });
    if (outs.length) {
      lead.push({
        text: `, and ${word(outs.length)} ${outs.length === 1 ? "stretch stood out" : "stretches stood out"}: `,
      });
      outs.forEach((o, i) => {
        if (i) lead.push({ text: i === outs.length - 1 ? ", and " : ", " });
        const when = ` in ${monthName(o.from.slice(0, 7))}`;
        if (o.kind === "period") lead.push({ chip: o.p.name }, { text: when });
        else
          lead.push({
            text: `${word(daysBetween(o.from, o.to) + 1)} days${when} you haven’t named yet`,
          });
      });
    }
    lead.push({ text: "." });
  }

  // Months with nothing standing out are told together; each period and
  // busy stretch has its own section.
  const busy = new Set(
    outs.flatMap((o) =>
      months.filter((m) => o.from <= `${m}-31` && o.to >= `${m}-01`),
    ),
  );
  const sections = [];
  let run = [];
  const flush = () => {
    if (run.length) sections.push(quietSection(run, byMonth, typical));
    run = [];
  };
  for (const m of months) {
    if (!busy.has(m)) {
      run.push(m);
      continue;
    }
    flush();
    for (const o of outs.filter((o) => o.from.slice(0, 7) === m))
      sections.push(
        o.kind === "period"
          ? periodSection(derived, state, o, monthSentence)
          : stretchSection(derived, state, o, monthSentence),
      );
  }
  flush();
  return {
    months: months.length,
    first,
    last,
    title,
    allIds: ids(pays),
    lead,
    sections,
  };
}

function quietSection(run, byMonth, typical) {
  const ts = run.flatMap((m) => byMonth.get(m));
  const totals = run.map((m) => sum(byMonth.get(m)));
  let parts;
  if (run.length === 1) {
    const vs = againstTypical(totals[0], typical);
    parts = [
      {
        text: `${monthName(run[0])} came to ${money(totals[0])}`,
        txnIds: ids(ts),
      },
      { text: vs ? `, ${vs}.` : "." },
    ];
  } else if (run.length === 2) {
    parts = [
      {
        text: `${monthName(run[0])} came to ${money(totals[0])}`,
        txnIds: ids(byMonth.get(run[0])),
      },
      { text: " and " },
      {
        text: `${monthName(run[1])} to ${money(totals[1])}`,
        txnIds: ids(byMonth.get(run[1])),
      },
      { text: "." },
    ];
  } else {
    const [lo, hi] = [Math.min(...totals), Math.max(...totals)];
    parts = [
      { text: `From ${monthName(run[0])} to ${monthName(run.at(-1))}, ` },
      {
        text: `each month came to between ${money(lo)} and ${money(hi)}`,
        txnIds: ids(ts),
      },
      { text: "." },
    ];
  }
  const big = [...ts].sort((a, b) => b.amount - a.amount)[0];
  const paragraphs = [parts];
  if (big)
    paragraphs.push([
      { text: "The largest single payment was " },
      {
        text: `${money(big.amount)} to ${name(big.merchant)} on ${dateRange(big.date, big.date)}`,
        txnIds: [big.id],
      },
      { text: "." },
    ]);
  return {
    id: `months-${run[0]}`,
    label: monthRange(run[0], run.at(-1)),
    from: `${run[0]}-01`,
    to: `${run.at(-1)}-28`,
    paragraphs,
  };
}

function periodSection(derived, state, o, monthSentence) {
  const told = summarizePeriod(derived, state, o.p).filter(
    (s) => s.kind === "period",
  );
  const month = o.from.slice(0, 7);
  return {
    id: `period-${o.id}`,
    label: shortRange(o.from, o.to),
    from: o.from,
    to: o.to,
    chip: o.p.name,
    periodId: o.id,
    paragraphs: told.map((s) => s.parts),
    note: o.p.story?.trim()
      ? { label: "Your description", text: o.p.story.trim() }
      : null,
    notes: periodNotes(derived, o.p).map((n) => ({
      date: n.date,
      text: n.note,
    })),
    after: monthSentence(month),
    month,
  };
}

function stretchSection(derived, state, o, monthSentence) {
  const ts = o.m.txnIds
    .map((id) => derived.byId.get(id))
    .filter(Boolean)
    .sort(byDate);
  const days = daysBetween(o.from, o.to) + 1;
  const answer = state.answers?.[o.id] ?? null;
  const [a, b] = [short(o.from), short(o.to)];
  const when =
    a.mon === b.mon
      ? `${a.d}–${b.d} ${monthLong(o.from.slice(0, 7)).split(" ")[0]}`
      : dateRange(o.from, o.to);
  return {
    id: `stretch-${o.id}`,
    label: shortRange(o.from, o.to),
    from: o.from,
    to: o.to,
    stretch: {
      id: o.id,
      when,
      txnIds: ids(ts),
      skipped: answer?.status === "skipped",
    },
    paragraphs: [
      [
        {
          text: `${money(sum(ts))} went out in ${word(days)} ${days === 1 ? "day" : "days"}`,
          txnIds: ids(ts),
        },
        { text: `: ${merchantCounts(ts)}.` },
      ],
    ],
    after: monthSentence(o.from.slice(0, 7)),
    month: o.from.slice(0, 7),
  };
}

// The month inside the year ("April 2026"): its summary from the app's own
// month story, with each period headed by its name and the notes written on
// its payments. Budgets only when Numbers is on.
export function yearMonthStory(
  derived,
  state,
  month,
  { numbers = false } = {},
) {
  const sections = summarizeMonth(derived, state, month);
  const periods = [];
  const paragraphs = [];
  let lead = [];
  let budgets = false;
  for (const s of sections) {
    if (s.kind === "overview") lead = s.parts;
    else if (s.kind === "period") {
      const p = state.periods.find((x) => x.id === s.periodId);
      const head = s.parts[0]?.text?.startsWith("“")
        ? s.parts.slice(1)
        : s.parts;
      periods.push({
        id: s.periodId,
        name: s.name,
        dates: p ? dateRange(p.start, p.end).replace(/ \d{4}$/, "") : "",
        parts: head,
        notes: p
          ? periodNotes(derived, p).map((n) => ({ date: n.date, text: n.note }))
          : [],
      });
    } else if (s.kind === "yours") {
      const p = periods.find((x) => x.id === s.periodId);
      if (p) p.description = s.parts[0].text;
    } else if (s.kind === "budget") {
      budgets = true;
      if (numbers) paragraphs.push(s.parts);
    } else if (s.kind !== "question" && s.parts) paragraphs.push(s.parts);
  }
  return {
    month,
    label: monthLong(month),
    lead,
    periods,
    paragraphs,
    numbersHint: budgets && !numbers,
  };
}
