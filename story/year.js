import { MONTHS, monthOf, withCurrency } from "../helpers.js";
import {
  byDate,
  coveredMonths,
  daysBetween,
  typicalMonth,
} from "./moment-kit.js";
import { detectMoments } from "./moments.js";
import { summarizeMonth } from "./summary.js";
import { periodNotes, summarizePeriod } from "./period-story.js";
import { count, dateRange, list, money, monthLong, name } from "./copy.js";
import {
  addFact,
  aheadSection,
  expectedIn,
  gapSentence,
  nextMonth,
  priceSentence,
  rhythmSentence,
  transferSentence,
} from "./year-facts.js";
import { periodComparison, quietSection, trendSentence } from "./year-quiet.js";
import { monthRange, short, shortRange } from "./year-dates.js";

export { monthRange, shortRange };

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
function standouts(derived, state, first, last, moments) {
  const end = `${last}-31`,
    start = `${first}-01`;
  const periods = (state.periods || [])
    .filter((p) => p.start <= end && p.end >= start)
    .map((p) => ({ kind: "period", id: p.id, from: p.start, to: p.end, p }));
  const stretches = moments
    .filter((m) => m.kind === "cluster")
    .map((m) => ({ kind: "stretch", id: m.id, from: m.from, to: m.to, m }));
  return [...periods, ...stretches].sort((a, b) =>
    a.from.localeCompare(b.from),
  );
}

export function yearStory(derived, state, today) {
  const months = coveredMonths(derived);
  if (months.length < 2) return null;
  const inRange = derived.allTxns.filter((t) =>
    months.includes(monthOf(t.date)),
  );
  return withCurrency(mainCurrency(inRange.filter(pay)), () =>
    tell(derived, state, months, inRange, today),
  );
}

function tell(derived, state, months, inRange, today) {
  const currency = mainCurrency(inRange.filter(pay));
  const pays = inRange.filter((t) => pay(t) && t.currency === currency);
  const byMonth = new Map(months.map((m) => [m, []]));
  for (const t of pays) byMonth.get(monthOf(t.date)).push(t);
  const typical = typicalMonth(derived);
  const [first, last] = [months[0], months.at(-1)];
  const moments = detectMoments(derived, state);
  const outs = standouts(derived, state, first, last, moments);
  // Rhythms, gaps and price changes need three months (Copy rules, s2).
  const found = (typical == null ? [] : moments)
    .filter((m) => m.currency === currency)
    .map((m) => ({
      ...m,
      txns: m.txnIds
        .map((id) => derived.byId.get(id))
        .filter(Boolean)
        .sort(byDate),
    }));
  const of = (kind) => found.filter((m) => m.kind === kind);
  const rhythms = of("rhythm"),
    gaps = of("gap").filter((m) => !m.facts.stopped),
    prices = of("price").filter((m) => months.includes(m.month));
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
  // What's ahead: recent price changes and the charges that repeat. The
  // latest month, when nothing stood out in it, is told with them.
  const recent = prices.filter((p) => p.month >= months.at(-3));
  // The month after the statements is told, and drawn, from the latest
  // month until it is over; later, it would be told as still to come.
  const expected =
    typical != null && [last, nextMonth(last)].includes(monthOf(today))
      ? expectedIn(derived, last, currency)
      : [];
  const ahead =
    typical == null
      ? null
      : aheadSection(
          derived,
          last,
          !busy.has(last),
          currency,
          recent,
          expected,
        );
  const ctx = {
    byMonth,
    months,
    typical,
    threads: new Set(derived.R.threads.map((t) => t.name)),
  };
  const vsTypical = (total) => againstTypical(total, typical);
  const told = new Set();
  const sections = [];
  let run = [];
  const flush = () => {
    if (run.length)
      sections.push(
        quietSection(run, ctx, vsTypical, derived.allTxns, {
          rhythm: rhythmSentence(rhythms, run, last, told),
          transfer:
            typical == null ? null : transferSentence(derived, run, told),
        }),
      );
    run = [];
  };
  for (const m of months) {
    if (ahead?.months.includes(m)) continue;
    if (!busy.has(m)) {
      run.push(m);
      continue;
    }
    flush();
    for (const o of outs.filter((o) => o.from.slice(0, 7) === m))
      sections.push(
        o.kind === "period"
          ? periodSection(derived, state, o, monthSentence, ctx)
          : stretchSection(derived, state, o, monthSentence),
      );
  }
  flush();
  if (ahead) sections.push(ahead);
  // A gap, and a price change not told ahead, sit in the section holding
  // their month.
  const holding = (m) => sections.find((s) => s.months.includes(m)) ?? null;
  for (const g of gaps) {
    const s = holding(g.facts.months[0]);
    if (s) addFact(s, gapSentence(derived, g));
  }
  for (const p of prices.filter((p) => !ahead || !recent.includes(p))) {
    const s = holding(p.month);
    if (s) addFact(s, priceSentence([p]));
  }
  // A thread lower or higher since a month runs to the latest one: told
  // ahead, before what's coming up, as drawn.
  const trend = typical == null ? null : trendSentence(ctx);
  if (trend && ahead) {
    const at = ahead.paragraphs.findIndex((p) =>
      p[0]?.text?.startsWith("Coming up"),
    );
    ahead.paragraphs.splice(at < 0 ? ahead.paragraphs.length : at, 0, trend);
  } else if (trend && holding(last)) addFact(holding(last), trend);
  return {
    months: months.length,
    first,
    last,
    title,
    allIds: ids(pays),
    lead,
    sections,
    expected,
  };
}

function periodSection(derived, state, o, monthSentence, ctx) {
  const told = summarizePeriod(derived, state, o.p).filter(
    (s) => s.kind === "period",
  );
  const month = o.from.slice(0, 7);
  // "Harbor Pantry came to ₪201 that month, against about ₪430 in other
  // months": a merchant the period moved, beside it (Copy rules, s4).
  const compared = ctx.typical == null ? null : periodComparison(month, ctx);
  return {
    id: `period-${o.id}`,
    label: shortRange(o.from, o.to),
    from: o.from,
    to: o.to,
    chip: o.p.name,
    periodId: o.id,
    paragraphs: told.map((s) => s.parts),
    months: [month],
    note: o.p.story?.trim()
      ? { label: "Your description", text: o.p.story.trim() }
      : null,
    notes: periodNotes(derived, o.p).map((n) => ({
      date: n.date,
      text: n.note,
    })),
    after: [
      ...monthSentence(month),
      ...(compared ? [{ text: " " }, ...compared] : []),
    ],
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
    months: [o.from.slice(0, 7)],
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
    // Only when a thread with a budget caught a payment this month: a
    // budget nothing is in has nothing to show.
    numbersHint:
      budgets &&
      !numbers &&
      derived.allTxns.some(
        (t) =>
          monthOf(t.date) === month &&
          derived.R.threads.some(
            (th) => th.name === t.thread && th.budget != null,
          ),
      ),
  };
}
