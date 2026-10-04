import { monthOf } from "../helpers.js";
import { groupBy, median } from "./moment-kit.js";
import {
  count,
  dateRange,
  list,
  money,
  monthLong,
  name,
  ordinal,
} from "./copy.js";
import { monthRange } from "./year-dates.js";

// The months with nothing standing out, told together (Copy rules, sections
// 2–5), and the facts with a shape that the drawn year finds in them: a
// merchant's cadence ("about once a week, roughly ₪410 a month"), a
// thread's steady total ("Bills came to around ₪285 a month"), a one-off
// ("the only one this year"), a thread that has been lower or higher since
// a month, and a merchant inside a period against other months. Each needs
// three months or more and appears only when the data meets its threshold.
// ctx: { byMonth, months, typical, threads }, payments in the main currency.

const sum = (ts) => ts.reduce((a, t) => a + t.amount, 0);
const ids = (ts) => ts.map((t) => t.id);
const monthName = (ym) => monthLong(ym).split(" ")[0];
const around = (n) => money(Math.round(n / 5) * 5);
const mean = (ns) => sum(ns.map((amount) => ({ amount }))) / ns.length;

// A steady amount varies by no more than this between the lowest and
// highest month: 25% for a merchant, 20% for a thread's total.
export const STEADY_MERCHANT = 1.25;
export const STEADY_THREAD = 1.2;
// A one-off is told when it is at least this share of a typical month.
export const ONE_OFF_SHARE = 0.05;
// A trend needs this many months on each side, a change of this share, and
// a merchant carrying this share of it to be named as the main cause.
export const TREND_MONTHS = 3;
export const TREND_SHARE = 0.1;
export const CAUSE_SHARE = 0.5;
// A merchant in a period's month differs from its other months by this
// ratio, and by this share of a typical month, to be told.
export const PERIOD_RATIO = 1.4;
export const PERIOD_SHARE = 0.05;

const CADENCE = {
  2: "about twice a month",
  3: "about three times a month",
  4: "about once a week",
  5: "about once a week",
};

const steady = (totals, ratio) =>
  totals.every((n) => n > 0) &&
  Math.max(...totals) <= Math.min(...totals) * ratio;

// "You went to Harbor Pantry about once a week, roughly ₪410 a month": the
// merchant paid most often in every month of the run, two to five times
// each month, with counts within one of each other.
export function cadenceClause(run, { byMonth }) {
  if (run.length < 2) return null;
  const ts = run.flatMap((m) => byMonth.get(m));
  const best = [...groupBy(ts, (t) => t.merchant)]
    .map(([merchant, mts]) => {
      const per = run.map((m) => mts.filter((t) => monthOf(t.date) === m));
      return { merchant, mts, per, n: mts.length };
    })
    .filter(({ per }) => {
      const c = per.map((p) => p.length);
      return Math.min(...c) >= 1 && Math.max(...c) - Math.min(...c) <= 1;
    })
    .map((x) => ({ ...x, words: CADENCE[Math.round(x.n / run.length)] }))
    .filter((x) => x.words)
    .sort((a, b) => b.n - a.n || sum(b.mts) - sum(a.mts))[0];
  if (!best) return null;
  const totals = best.per.map(sum);
  const amount = steady(totals, STEADY_MERCHANT)
    ? `, roughly ${around(mean(totals))} a month`
    : "";
  return {
    thread: best.mts[0].thread,
    parts: [
      { text: "You went to " },
      {
        text: `${name(best.merchant)} ${best.words}${amount}`,
        txnIds: ids(best.mts),
      },
    ],
  };
}

// "Bills came to around ₪285 a month": a thread of two or more merchants,
// paid in every month of the run, whose monthly total stays steady. The
// largest such thread, other than the one the cadence already told.
export function groupClause(run, { byMonth, threads }, skip) {
  if (run.length < 2) return null;
  const ts = run.flatMap((m) => byMonth.get(m));
  const best = [...groupBy(ts, (t) => t.thread ?? "")]
    .filter(([thread]) => threads.has(thread) && thread !== skip)
    .map(([thread, tts]) => ({
      thread,
      tts,
      totals: run.map((m) => sum(tts.filter((t) => monthOf(t.date) === m))),
    }))
    .filter(
      (x) =>
        new Set(x.tts.map((t) => t.merchant)).size >= 2 &&
        steady(x.totals, STEADY_THREAD),
    )
    .sort((a, b) => sum(b.tts) - sum(a.tts))[0];
  if (!best) return null;
  return [
    {
      text: `${name(best.thread)} came to around ${around(mean(best.totals))} a month`,
      txnIds: ids(best.tts),
    },
  ];
}

// "On 14 February there’s one payment to Florentine Flowers, ₪85, the only
// one this year." A merchant paid once in all the statements, in this run,
// worth at least ONE_OFF_SHARE of a typical month. The run's largest
// payment is told on its own, so it is never the one-off.
export function oneOffSentence(
  run,
  { byMonth, months, typical },
  allTxns,
  big,
) {
  const seen = groupBy(
    allTxns.filter((t) => t.amount > 0 && !t.transfer),
    (t) => t.merchant,
  );
  const t = run
    .flatMap((m) => byMonth.get(m))
    .filter(
      (t) =>
        t !== big &&
        seen.get(t.merchant).length === 1 &&
        t.amount >= typical * ONE_OFF_SHARE,
    )
    .sort((a, b) => b.amount - a.amount)[0];
  if (!t) return null;
  const when = dateRange(t.date, t.date).replace(/ \d{4}$/, "");
  const span =
    months.length <= 12
      ? "this year"
      : `in these ${count(months.length)} months`;
  return [
    { text: `On ${when} there’s ` },
    {
      text: `one payment to ${name(t.merchant)}, ${money(t.amount)}`,
      txnIds: [t.id],
    },
    { text: `, the only one ${span}.` },
  ];
}

const range = (totals) => {
  const [lo, hi] = [Math.min(...totals), Math.max(...totals)];
  return Math.round(lo) === Math.round(hi)
    ? money(lo)
    : `${money(lo)} to ${money(hi)}`;
};

// "Bills have been lower since June, ₪236 to ₪253 a month, against ₪295 to
// ₪310 from December to May, mostly because of Brightwell Energy." A thread
// paid every month, whose every month since a change is below (or above)
// every month before it, by TREND_SHARE or more, with TREND_MONTHS on each
// side. The cause is named when one merchant carries CAUSE_SHARE of it.
export function trendSentence({ byMonth, months, threads }) {
  const found = [];
  for (const thread of threads) {
    const per = months.map((m) =>
      byMonth.get(m).filter((t) => t.thread === thread),
    );
    const totals = per.map(sum);
    if (totals.some((n) => n <= 0)) continue;
    for (let k = TREND_MONTHS; k <= months.length - TREND_MONTHS; k++) {
      const [before, after] = [totals.slice(0, k), totals.slice(k)];
      const lower = Math.max(...after) < Math.min(...before);
      const higher = Math.min(...after) > Math.max(...before);
      const change = mean(after) - mean(before);
      if (!(lower || higher) || Math.abs(change) < mean(before) * TREND_SHARE)
        continue;
      found.push({
        thread,
        per,
        k,
        totals,
        change,
        share: change / mean(before),
      });
      break;
    }
  }
  const best = found.sort((a, b) => Math.abs(b.share) - Math.abs(a.share))[0];
  if (!best) return null;
  const { thread, per, k, totals, change } = best;
  const [pb, pa] = [per.slice(0, k).flat(), per.slice(k).flat()];
  const byMerchant = (ts, n) =>
    new Map(
      [...groupBy(ts, (t) => t.merchant)].map(([m, x]) => [m, sum(x) / n]),
    );
  const [mb, ma] = [byMerchant(pb, k), byMerchant(pa, months.length - k)];
  const cause = [...new Set([...mb.keys(), ...ma.keys()])]
    .map((m) => ({ m, d: (ma.get(m) ?? 0) - (mb.get(m) ?? 0) }))
    .filter((x) => x.d / change >= CAUSE_SHARE)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  const since = months[k];
  return [
    {
      text: `${name(thread)} ${change < 0 ? "have been lower" : "have been higher"} since ${monthName(since)}, ${range(totals.slice(k))} a month`,
      txnIds: ids(pa),
    },
    { text: ", against " },
    {
      text: `${range(totals.slice(0, k))} from ${monthName(months[0])} to ${monthName(months[k - 1])}`,
      txnIds: ids(pb),
    },
    ...(cause
      ? [
          { text: ", mostly because of " },
          {
            text: name(cause.m),
            txnIds: ids([...pb, ...pa].filter((t) => t.merchant === cause.m)),
          },
        ]
      : []),
    { text: "." },
  ];
}

// "Harbor Pantry came to ₪201 that month, against about ₪430 in other
// months." A merchant paid in three or more other months, and in three in
// four of them, whose total in the period's month is PERIOD_RATIO above or
// below its median there. The largest difference is told.
export function periodComparison(month, { byMonth, months, typical }) {
  const others = months.filter((m) => m !== month);
  const best = [...groupBy(byMonth.get(month) ?? [], (t) => t.merchant)]
    .map(([merchant, ts]) => {
      const elsewhere = others
        .map((m) => sum(byMonth.get(m).filter((t) => t.merchant === merchant)))
        .filter((n) => n > 0);
      return {
        merchant,
        ts,
        total: sum(ts),
        elsewhere,
        ref: median(elsewhere),
      };
    })
    .filter(
      (x) =>
        x.elsewhere.length >= 3 &&
        x.elsewhere.length >= others.length * 0.75 &&
        Math.max(x.total / x.ref, x.ref / x.total) >= PERIOD_RATIO &&
        Math.abs(x.total - x.ref) >= typical * PERIOD_SHARE,
    )
    .sort((a, b) => Math.abs(b.total - b.ref) - Math.abs(a.total - a.ref))[0];
  if (!best) return null;
  return [
    {
      text: `${name(best.merchant)} came to ${money(best.total)} that month`,
      txnIds: ids(best.ts),
    },
    { text: `, against about ${money(best.ref)} in other months.` },
  ];
}

// The run's opening: one month against a typical one, two months' totals,
// or the range of three or more.
function opening(run, byMonth, vsTypical) {
  const totals = run.map((m) => sum(byMonth.get(m)));
  if (run.length === 1) {
    const vs = vsTypical(totals[0]);
    return [
      {
        text: `${monthName(run[0])} came to ${money(totals[0])}`,
        txnIds: ids(byMonth.get(run[0])),
      },
      { text: vs ? `, ${vs}.` : "." },
    ];
  }
  if (run.length === 2)
    return [
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
  return [
    { text: `From ${monthName(run[0])} to ${monthName(run.at(-1))}, ` },
    {
      text: `each month came to between ${money(Math.min(...totals))} and ${money(Math.max(...totals))}`,
      txnIds: ids(run.flatMap((m) => byMonth.get(m))),
    },
    { text: "." },
  ];
}

// "The largest single payment was …". When several payments share the
// largest amount, all of them are told (M3 verifier finding 7): one merchant
// on the same day of every month is a rhythm ("on the 1st, every month"), one
// merchant otherwise is counted, and several merchants are listed.
export function largestSentence(ts, run, big) {
  const ties = ts.filter((t) => t.amount === big.amount);
  const what = { txnIds: ties.map((t) => t.id) };
  if (ties.length === 1)
    return [
      { text: "The largest single payment was " },
      {
        ...what,
        text: `${money(big.amount)} to ${name(big.merchant)} on ${dateRange(big.date, big.date)}`,
      },
      { text: "." },
    ];
  const merchants = [...new Set(ties.map((t) => t.merchant))];
  if (merchants.length > 1)
    return [
      { text: "The largest single payments were " },
      {
        ...what,
        text: `${money(big.amount)} each, to ${list(merchants.map(name))}`,
      },
      { text: "." },
    ];
  const days = new Set(ties.map((t) => t.date.slice(8)));
  const monthly =
    days.size === 1 &&
    ties.length === run.length &&
    new Set(ties.map((t) => monthOf(t.date))).size === run.length;
  return [
    { text: "The largest single payment was " },
    {
      ...what,
      text: !monthly
        ? `${money(big.amount)} to ${name(big.merchant)}, ${ties.length === 2 ? "twice" : `${count(ties.length)} times`}`
        : run.length === 2
          ? `${money(big.amount)} to ${name(big.merchant)} on the ${ordinal(Number([...days][0]))} of ${monthName(run[1])}, also on the ${ordinal(Number([...days][0]))} of ${monthName(run[0])}`
          : `${money(big.amount)} to ${name(big.merchant)} on the ${ordinal(Number([...days][0]))}, every month`,
    },
    { text: "." },
  ];
}

// facts: { rhythm, transfer } sentences from year-facts.js; transfer is a
// clause, joined to the cadence and thread total as drawn.
export function quietSection(
  run,
  ctx,
  vsTypical,
  allTxns,
  { rhythm, transfer },
) {
  const { byMonth, typical } = ctx;
  const ts = run.flatMap((m) => byMonth.get(m));
  const big = [...ts].sort((a, b) => b.amount - a.amount)[0];
  const first = opening(run, byMonth, vsTypical);
  const shaped = typical != null;
  const cadence = shaped ? cadenceClause(run, ctx) : null;
  const clauses = [
    cadence?.parts,
    shaped ? groupClause(run, ctx, cadence?.thread) : null,
    transfer,
  ].filter(Boolean);
  const oneOff = shaped ? oneOffSentence(run, ctx, allTxns, big) : null;
  if (oneOff) first.push({ text: " " }, ...oneOff);
  const shape = clauses.flatMap((c, i) => [
    ...(i ? [{ text: i === clauses.length - 1 ? ", and " : ", " }] : []),
    ...c,
  ]);
  if (shape.length) shape.push({ text: "." });
  if (rhythm) shape.push(...(shape.length ? [{ text: " " }] : []), ...rhythm);
  const paragraphs = [first];
  if (shape.length) paragraphs.push(shape);
  if (big) paragraphs.push(largestSentence(ts, run, big));
  return {
    id: `months-${run[0]}`,
    label: monthRange(run[0], run.at(-1)),
    months: run,
    from: `${run[0]}-01`,
    to: `${run.at(-1)}-28`,
    paragraphs,
  };
}
