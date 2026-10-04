import { monthOf } from "../helpers.js";
import { LOOSE } from "../transactions/constants.js";
import {
  coveredMonths,
  findMoments,
  monthsSeen,
  spending,
  typicalMonth,
} from "./moments.js";
import {
  dateRange,
  list,
  merchantList,
  money,
  monthLong,
  name as bidi,
  plain,
  plural,
  questionText,
} from "./copy.js";
import { sectionsPerCurrency } from "./currency.js";
import { groupBy, median } from "./moment-kit.js";
import {
  total,
  ids,
  byDate,
  monthWord,
  pick,
  listParts,
  times,
  merchantParts,
} from "./summary-kit.js";

// A month told in plain sentences. Each part that states a figure carries
// the ids of the transactions behind it, so the page can light them up.

function overview(month, ctx) {
  const M = monthWord(month);
  const out = ctx.spend;
  const sum = total(out);
  const parts = [];
  if (!out.length) parts.push({ text: `Nothing went out in ${M}.` });
  else if (ctx.typical == null)
    parts.push(
      { text: `${money(sum)} went out in ${M}.`, txnIds: ids(out) },
      {
        text: " There aren't enough months of statements yet to compare it with a typical month.",
      },
    );
  else {
    const r = sum / ctx.typical;
    const typ = money(Math.round(ctx.typical));
    const s = money(sum);
    const text =
      r >= 1.75
        ? `${M} was a big month: ${s} went out, ${times(r)} a typical month.`
        : r >= 1.15
          ? pick(month, "more", [
              `${s} went out in ${M}, a bit more than a typical month (${typ}).`,
              `${M} came to ${s}, a bit above a typical month's ${typ}.`,
            ])
          : r > 0.85
            ? pick(month, "close", [
                `${s} went out in ${M}, close to a typical month (${typ}).`,
                `${M} was close to a typical month: ${s} went out, against a usual ${typ}.`,
              ])
            : r >= 0.5
              ? pick(month, "less", [
                  `${s} went out in ${M}, less than a typical month (${typ}).`,
                  `${M} was lighter than usual: ${s} went out, against a typical ${typ}.`,
                ])
              : `${M} was a quiet month: ${s} went out, less than half a typical month (${typ}).`;
    parts.push({ text, txnIds: ids(out) });
  }
  // Money in and refunds too small to matter beside the month are left out.
  const trivial = Math.max(10, 0.005 * sum);
  const big = (t) => -t.amount >= trivial;
  const cameIn = ctx.month.filter((t) => t.inflow && big(t));
  if (cameIn.length) {
    const from = [...new Set(cameIn.map((t) => t.merchant))];
    parts.push(
      { text: " " },
      {
        text: `${money(-total(cameIn))} came in from ${list(from.map(bidi))}.`,
        txnIds: ids(cameIn),
      },
    );
  }
  const refunds = ctx.month.filter(
    (t) => t.amount < 0 && !t.transfer && !t.inflow && big(t),
  );
  if (refunds.length)
    parts.push(
      { text: " " },
      {
        text:
          refunds.length === 1
            ? `${money(-refunds[0].amount)} came back as a refund from ${bidi(refunds[0].merchant)}.`
            : `${money(-total(refunds))} came back in ${plural(refunds.length, "refund")}.`,
        txnIds: ids(refunds),
      },
    );
  return { kind: "overview", parts };
}

// Merchants seen in three or more months, grouped by thread, against each
// thread's usual monthly amount. A thread with a budget is compared in the
// budget line, and one with a question this month in the question, so
// neither is compared again here.
function regular(month, ctx) {
  const routine = ctx.spend.filter((t) => ctx.seen.get(t.key)?.size >= 3);
  if (!routine.length) return null;
  const threads = [...groupBy(routine, (t) => t.thread)]
    .map(([name, ts]) => {
      const others = ctx.months
        .filter((m) => m !== month)
        .map((m) =>
          total(
            ctx.allSpend.filter(
              (t) =>
                t.thread === name &&
                monthOf(t.date) === m &&
                ctx.seen.get(t.key)?.size >= 3,
            ),
          ),
        );
      return { name, ts, sum: total(ts), usual: median(others) };
    })
    .sort((a, b) => b.sum - a.sum);
  const off = threads.filter(
    (th) => th.usual > 0 && Math.abs(th.sum - th.usual) > 0.15 * th.usual,
  );
  const parts = off.length
    ? [
        { text: "Regular spending came to " },
        { text: money(total(routine)), txnIds: ids(routine) },
        { text: ": " },
      ]
    : [
        {
          text: pick(month, "steady", [
            "The regular things stayed close to usual: ",
            "Your regular spending was much as usual: ",
          ]),
        },
      ];
  const shown = threads.slice(0, 4);
  const rest = threads.slice(4).flatMap((th) => th.ts);
  // Loose ends is no thread to someone with none: its merchants are named.
  const items = shown.map((th) => ({
    text: `${money(th.sum)} ${th.name === LOOSE ? `to ${merchantList(th.ts)}` : `on ${bidi(th.name)}`}`,
    txnIds: ids(th.ts),
  }));
  if (rest.length)
    items.push({
      text: `${money(total(rest))} on other regular things`,
      txnIds: ids(rest),
    });
  parts.push(...listParts(items), { text: "." });
  const told = new Set([
    ...ctx.derived.R.threads
      .filter((th) => th.budget != null)
      .map((th) => th.name),
    ...ctx.asked,
  ]);
  for (const th of off.filter((th) => !told.has(th.name)).slice(0, 2))
    parts.push(
      { text: " " },
      {
        text: `${bidi(th.name)} came to ${money(th.sum)}, against a usual ${money(Math.round(th.usual))}.`,
        txnIds: ids(th.ts),
      },
    );
  return { kind: "regular", parts };
}

// A period overlapping the month: what went out in its dates this month,
// leaving out the regular things that happened anyway.
function periodSections(month, ctx) {
  // Dates compare as text, so "-31" bounds every month.
  const start = month + "-01",
    end = month + "-31";
  const out = [];
  const periods = [...ctx.state.periods]
    .filter((p) => p.start <= end && p.end >= start)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const p of periods) {
    const inside = ctx.spend
      .filter(
        (t) =>
          t.date >= p.start &&
          t.date <= p.end &&
          !(ctx.seen.get(t.key)?.size >= 3),
      )
      .sort(byDate);
    const head = { text: `“${bidi(p.name)}”, ${dateRange(p.start, p.end)}: ` };
    let parts;
    if (!inside.length)
      parts = [head, { text: "only regular spending in those dates." }];
    else
      parts = [
        head,
        { text: `${money(total(inside))} went out`, txnIds: ids(inside) },
        ...merchantParts(inside),
        { text: "." },
      ];
    out.push({ kind: "period", periodId: p.id, name: p.name, parts });
    // The person's own words, kept apart from generated text.
    if (p.story?.trim())
      out.push({
        kind: "yours",
        periodId: p.id,
        label: "Your description",
        parts: [{ text: p.story.trim() }],
      });
  }
  return out;
}

// Money moved between your own accounts, with the running total.
function savings(month, ctx) {
  const moved = ctx.derived.allTxns.filter(
    (t) => t.transfer?.kind === "pair" && t.transfer.dir === "out",
  );
  const route = (t) =>
    `${t.account}\n${ctx.derived.byId.get(t.transfer.other)?.account ?? ""}`;
  const now = groupBy(
    moved.filter((t) => monthOf(t.date) === month),
    route,
  );
  if (!now.size) return null;
  const parts = [];
  for (const [key, ts] of now) {
    const [from, to] = key.split("\n");
    const sum = money(total(ts));
    const lead = pick(month, "save", [
      `You moved ${sum} from ${bidi(from)} to ${bidi(to)}`,
      `${sum} went from ${bidi(from)} to ${bidi(to)}`,
    ]);
    const sofar = moved.filter(
      (t) => route(t) === key && monthOf(t.date) <= month,
    );
    const first = sofar.map((t) => monthOf(t.date)).sort()[0];
    if (parts.length) parts.push({ text: " " });
    parts.push({ text: lead, txnIds: ids(ts) });
    if (first < month)
      parts.push(
        { text: ", " },
        {
          text: `${money(total(sofar))} in all since ${monthLong(first)}`,
          txnIds: ids(sofar.sort(byDate)),
        },
      );
    parts.push({ text: "." });
  }
  return { kind: "savings", parts };
}

// Budgets stated as they are: "Bills ₪305 of ₪300".
function budgets(month, ctx) {
  const threads = ctx.derived.R.threads.filter((th) => th.budget != null);
  if (!threads.length) return null;
  const items = threads.map((th) => {
    const ts = ctx.month.filter((t) => t.thread === th.name && !t.transfer);
    return {
      text: `${bidi(th.name)} ${money(total(ts))} of ${money(th.budget)}`,
      txnIds: ids(ts),
    };
  });
  return {
    kind: "budget",
    parts: [{ text: "Budgets: " }, ...listParts(items), { text: "." }],
  };
}

// The calendar months with statements, oldest first.
export const summaryMonths = (derived) => coveredMonths(derived);

export function summarizeMonth(
  derived,
  state,
  month,
  moments = findMoments(derived, state),
) {
  if (!coveredMonths(derived).includes(month))
    return monthSections(derived, state, month, moments);
  const inMonth = derived.allTxns.filter((t) => monthOf(t.date) === month);
  return sectionsPerCurrency(derived, inMonth, (view) =>
    monthSections(
      view,
      state,
      month,
      moments.filter((m) => m.currency === view.currency),
    ),
  );
}

function monthSections(derived, state, month, moments) {
  const months = coveredMonths(derived);
  if (!months.includes(month))
    return [
      {
        kind: "empty",
        parts: [
          {
            text: `There are no statements covering ${monthLong(month)} yet.`,
          },
        ],
      },
    ];
  const inMonth = derived.allTxns.filter((t) => monthOf(t.date) === month);
  const allSpend = derived.allTxns.filter(spending);
  const ctx = {
    derived,
    state,
    months,
    month: inMonth,
    spend: inMonth.filter(spending),
    allSpend,
    seen: monthsSeen(allSpend),
    typical: typicalMonth(derived),
    // Threads a question this month already compares: a budget, or one
    // merchant's charges against its usual.
    asked: moments
      .filter((m) => m.month === month)
      .flatMap((m) =>
        m.kind === "budget"
          ? [m.facts.thread]
          : ["large", "spike", "price"].includes(m.kind)
            ? m.txnIds.map((id) => derived.byId.get(id)?.thread)
            : [],
      ),
  };
  const questions = moments
    .filter((m) => m.month === month)
    .map((m) => ({
      kind: "question",
      moment: m,
      parts: [{ text: questionText(m), txnIds: m.txnIds }],
    }));
  return [
    overview(month, ctx),
    regular(month, ctx),
    ...periodSections(month, ctx),
    ...questions,
    savings(month, ctx),
    budgets(month, ctx),
  ].filter(Boolean);
}

// A section's plain text, for tests and for an assistant to polish later.
export const sectionText = (section) =>
  plain(section.parts.map((p) => p.text).join(""));
