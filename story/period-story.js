import { monthsSeen, spending } from "./moments.js";
import { money, name as bidi, plural } from "./copy.js";
import { sectionsPerCurrency } from "./currency.js";
import { groupBy } from "./moment-kit.js";
import {
  cap,
  total,
  ids,
  byDate,
  listParts,
  merchantParts,
} from "./summary-kit.js";

// A period told on its own: what went out in its dates, leaving regular
// spending aside unless asked for, and how it compares with other periods.
export function summarizePeriod(derived, state, period, options = {}) {
  const inDates = derived.allTxns.filter(
    (t) => t.date >= period.start && t.date <= period.end,
  );
  return sectionsPerCurrency(derived, inDates, (view) =>
    periodStory(view, state, period, options),
  );
}

function periodStory(derived, state, period, { regular = false } = {}) {
  const spend = derived.allTxns.filter(spending);
  const seen = monthsSeen(spend);
  const routine = (t) => seen.get(t.key)?.size >= 3;
  const inDates = (p) => (t) => t.date >= p.start && t.date <= p.end;
  const within = spend.filter(inDates(period)).sort(byDate);
  const own = within.filter((t) => !routine(t));
  const usual = within.filter(routine);
  const sections = [];
  sections.push({
    kind: "period",
    parts: own.length
      ? [
          {
            text: `${money(total(own))} went out in these dates`,
            txnIds: ids(own),
          },
          ...merchantParts(own),
          { text: "." },
        ]
      : [{ text: "Only regular spending happened in these dates." }],
  });
  if (usual.length && !regular)
    sections.push({
      kind: "regular",
      parts: [
        {
          text: own.length
            ? `${cap(plural(usual.length, "regular charge"))} (${money(total(usual))}) also fell in these dates, making ${money(total(within))} in all.`
            : `${cap(plural(usual.length, "regular charge"))} came to ${money(total(usual))}.`,
          txnIds: ids(usual),
        },
      ],
    });
  if (usual.length && regular) {
    const threads = [...groupBy(usual, (t) => t.thread)]
      .map(([name, ts]) => ({ name, ts, sum: total(ts) }))
      .sort((a, b) => b.sum - a.sum);
    sections.push({
      kind: "regular",
      parts: [
        { text: "Regular spending in these dates came to " },
        { text: money(total(usual)), txnIds: ids(usual) },
        { text: ": " },
        ...listParts(
          threads.map((th) => ({
            text: `${money(th.sum)} on ${bidi(th.name)}`,
            txnIds: ids(th.ts),
          })),
        ),
        { text: "." },
      ],
    });
  }
  const others = state.periods
    .filter((p) => p.id !== period.id)
    .map((p) => ({
      p,
      ts: spend.filter((t) => inDates(p)(t) && !routine(t)),
    }))
    .filter((o) => o.ts.length)
    .sort((a, b) => (a.p.start < b.p.start ? -1 : 1));
  if (own.length && others.length) {
    const most = others.every((o) => total(o.ts) < total(own));
    sections.push({
      kind: "compare",
      parts: [
        {
          text: most
            ? "That's more than in any of your other periods: "
            : "For comparison: ",
        },
        ...listParts(
          others.map((o) => ({
            text: `“${bidi(o.p.name)}” came to ${money(total(o.ts))}`,
            txnIds: ids(o.ts),
          })),
        ),
        { text: "." },
      ],
    });
  }
  return sections;
}

// The notes written on a period's transactions, in date order. Regular
// spending's notes only when that spending is listed too.
export function periodNotes(derived, period, { regular = false } = {}) {
  const seen = monthsSeen(derived.allTxns.filter(spending));
  return derived.allTxns
    .filter(
      (t) =>
        t.note &&
        t.date >= period.start &&
        t.date <= period.end &&
        (regular || !(seen.get(t.key)?.size >= 3)),
    )
    .sort(byDate)
    .map((t) => ({
      id: t.id,
      date: t.date,
      merchant: t.merchant,
      amount: t.amount,
      currency: t.currency,
      note: t.note,
    }));
}
