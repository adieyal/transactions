import { monthOf } from "../helpers.js";
import { TRANSFERS } from "../transactions/constants.js";
import { coveredMonths, detectMoments, spending } from "./moments.js";
import {
  list,
  money,
  monthList,
  monthLong,
  name as bidi,
  ordinal,
  plural,
} from "./copy.js";
import { eachCurrency, sectionsPerCurrency } from "./currency.js";
import { median } from "./moment-kit.js";
import { cap, total, ids, byDate } from "./summary-kit.js";

// A thread told as a summary, a month strip and a blow-by-blow list.
// With several currencies, each is told on its own and has its own strip.
export function summarizeThread(derived, state, name) {
  const inThread = derived.allTxns.filter((t) => t.thread === name);
  const runs = eachCurrency(derived, inThread, (view) =>
    threadStory(view, state, name),
  );
  if (!runs.length) {
    const story = threadStory(derived, state, name);
    return { ...story, strips: [] };
  }
  const strips = runs.map((r) => ({
    currency: r.currency,
    months: r.value.months,
  }));
  return {
    sections: sectionsPerCurrency(
      derived,
      inThread,
      (view) => threadStory(view, state, name).sections,
    ),
    months: runs.length === 1 ? runs[0].value.months : [],
    strips,
    items: runs.flatMap((r) => r.value.items).sort(byDate),
  };
}

function threadStory(derived, state, name) {
  const inThread = derived.allTxns
    .filter((t) => t.thread === name)
    .sort(byDate);
  // Money that came in is told on its own, never netted against charges.
  const cameIn = inThread.filter((t) => t.inflow);
  const ts = inThread.filter((t) => !t.inflow);
  const months = coveredMonths(derived).map((m) => {
    const inMonth = ts.filter((t) => monthOf(t.date) === m);
    return {
      month: m,
      total: total(inMonth),
      count: inMonth.length,
      txnIds: ids(inMonth),
    };
  });
  const items = inThread.map((t) => ({
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amount: t.amount,
    currency: t.currency,
    inflow: !!t.inflow,
    periods: t.periods || [],
    note: t.note || "",
  }));
  if (!inThread.length)
    return {
      sections: [
        {
          kind: "empty",
          parts: [{ text: `Nothing is in ${bidi(name)} yet.` }],
        },
      ],
      months,
      items,
    };
  const inPart = cameIn.length && {
    text: `${money(-total(cameIn))} came in from ${list([...new Set(cameIn.map((t) => t.merchant))].map(bidi))}.`,
    txnIds: ids(cameIn),
  };
  if (!ts.length)
    return { sections: [{ kind: "overview", parts: [inPart] }], months, items };
  const charges = ts.filter((t) => t.amount > 0);
  const merchants = [...new Set(ts.map((t) => t.merchant))];
  const first = monthOf(ts[0].date),
    last = monthOf(ts.at(-1).date);
  const sections = [];
  const when =
    first === last
      ? `in ${monthLong(first)}`
      : `between ${monthLong(first)} and ${monthLong(last)}`;
  const typical = median(charges.map((t) => t.amount));
  // Transfers move money between your own accounts; a total would mix both
  // directions, so only the count is told.
  if (name === TRANSFERS)
    return {
      sections: [
        {
          kind: "overview",
          parts: [
            {
              text: `${cap(plural(ts.length, "transfer"))} ${when}, between your own accounts or paying card statements. None of it counts as spending.`,
              txnIds: ids(ts),
            },
          ],
        },
      ],
      months,
      items,
    };
  sections.push({
    kind: "overview",
    parts: [
      {
        text: `${bidi(name)} had ${plural(ts.length, "charge")} ${when}, ${money(total(ts))} in all`,
        txnIds: ids(ts),
      },
      {
        text:
          merchants.length === 1
            ? `, all at ${bidi(merchants[0])}. `
            : `, at ${plural(merchants.length, "place")}. `,
      },
      ...(typical != null && charges.length >= 3
        ? [
            {
              text: `A typical one was about ${money(Math.round(typical))}.`,
              txnIds: ids(charges),
            },
          ]
        : []),
      ...(!inPart
        ? []
        : typical != null && charges.length >= 3
          ? [{ text: " " }, inPart]
          : [inPart]),
    ],
  });
  const keys = new Set(ts.map((t) => t.key));
  const tsIds = new Set(ids(ts));
  for (const m of detectMoments(derived, state).filter(
    (m) =>
      m.kind === "rhythm" &&
      m.facts.keys.every((k) => keys.has(k)) &&
      m.txnIds.every((id) => tsIds.has(id)),
  ))
    sections.push({
      kind: "rhythm",
      parts: [
        {
          text: `${m.txnIds.length} of them were on the ${ordinal(m.facts.day)} of the month at ${bidi(m.facts.merchant)}, usually about ${money(m.facts.usual)}.`,
          txnIds: m.txnIds,
        },
      ],
    });
  const busiest = [...months].sort(
    (a, b) => b.total - a.total || (a.month < b.month ? -1 : 1),
  )[0];
  if (busiest.count && months.filter((m) => m.count).length > 1) {
    const inBusiest = ts.filter((t) => monthOf(t.date) === busiest.month);
    const shared = inBusiest[0].periods.filter((n) =>
      inBusiest.every((t) => t.periods.includes(n)),
    );
    sections.push({
      kind: "busiest",
      parts: [
        {
          text: `The busiest month was ${monthLong(busiest.month)}: ${plural(busiest.count, "charge")}, ${money(busiest.total)}${shared.length ? `, ${busiest.count > 1 ? "all " : ""}during “${bidi(shared[0])}”` : ""}.`,
          txnIds: busiest.txnIds,
        },
      ],
    });
  }
  const th = derived.R.threads.find((x) => x.name === name);
  if (th?.budget != null) {
    const over = months.filter((m) => m.count && m.total > th.budget);
    sections.push({
      kind: "budget",
      parts: over.length
        ? [
            {
              text: `It came to more than the ${money(th.budget)} monthly budget in ${monthList(over.map((m) => m.month))}`,
              txnIds: over.flatMap((m) => m.txnIds),
            },
            { text: "." },
          ]
        : [
            {
              text: `It stayed within the ${money(th.budget)} monthly budget every month.`,
              txnIds: ids(ts),
            },
          ],
    });
  }
  return { sections, months, items };
}
