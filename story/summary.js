import { fnv, monthOf } from "../helpers.js";
import { TRANSFERS } from "../transactions/constants.js";
import {
  coveredMonths,
  detectMoments,
  findMoments,
  monthsSeen,
  spending,
  typicalMonth,
} from "./moments.js";
import {
  count,
  dateRange,
  list,
  money,
  monthList,
  monthLong,
  ordinal,
  plural,
  questionText,
} from "./copy.js";

// A month told in plain sentences. Each part that states a figure carries
// the ids of the transactions behind it, so the page can light them up.

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const total = (ts) => ts.reduce((s, t) => s + t.amount, 0);
const ids = (ts) => ts.map((t) => t.id);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const monthWord = (ym) => monthLong(ym).split(" ")[0];

// Varies wording by month without randomness: the same month always reads
// the same way.
const pick = (month, kind, variants) =>
  variants[parseInt(fnv(month + "|" + kind), 16) % variants.length];

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function groupBy(items, key) {
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}
// Text parts joined as "a, b and c", each item keeping its own ids.
function listParts(items) {
  const out = [];
  items.forEach((item, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? " and " : ", " });
    out.push(item);
  });
  return out;
}

function times(r) {
  if (r < 2.5) return "about twice";
  return `about ${count(Math.round(r))} times`;
}

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
  const refunds = ctx.month.filter((t) => t.amount < 0 && !t.transfer);
  if (refunds.length)
    parts.push(
      { text: " " },
      {
        text:
          refunds.length === 1
            ? `${money(-refunds[0].amount)} came back as a refund from ${refunds[0].merchant}.`
            : `${money(-total(refunds))} came back in ${plural(refunds.length, "refund")}.`,
        txnIds: ids(refunds),
      },
    );
  return { kind: "overview", parts };
}

// Merchants seen in three or more months, grouped by thread, against each
// thread's usual monthly amount.
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
  const items = shown.map((th) => ({
    text: `${money(th.sum)} on ${th.name}`,
    txnIds: ids(th.ts),
  }));
  if (rest.length)
    items.push({
      text: `${money(total(rest))} on other regular things`,
      txnIds: ids(rest),
    });
  parts.push(...listParts(items), { text: "." });
  for (const th of off.slice(0, 2))
    parts.push(
      { text: " " },
      {
        text: `${th.name} came to ${money(th.sum)}, against a usual ${money(Math.round(th.usual))}.`,
        txnIds: ids(th.ts),
      },
    );
  return { kind: "regular", parts };
}

// ", with ₪1,505 at Kettle & Coil (three purchases), ₪640 at …", or " at X"
// when there is only one merchant.
function merchantParts(ts) {
  const merchants = [...groupBy(ts, (t) => t.merchant)]
    .map(([name, group]) => ({ name, ts: group, sum: total(group) }))
    .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
  if (merchants.length === 1) return [{ text: ` at ${merchants[0].name}` }];
  const items = merchants.slice(0, 4).map((m) => ({
    text: `${money(m.sum)} at ${m.name}${m.ts.length > 1 ? ` (${plural(m.ts.length, "purchase")})` : ""}`,
    txnIds: ids(m.ts),
  }));
  const rest = merchants.slice(4).flatMap((m) => m.ts);
  if (rest.length)
    items.push({ text: `${money(total(rest))} elsewhere`, txnIds: ids(rest) });
  return [{ text: ", with " }, ...listParts(items)];
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
    const head = { text: `“${p.name}”, ${dateRange(p.start, p.end)}: ` };
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
      `You moved ${sum} from ${from} to ${to}`,
      `${sum} went from ${from} to ${to}`,
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
      text: `${th.name} ${money(total(ts))} of ${money(th.budget)}`,
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
  section.parts.map((p) => p.text).join("");

// A period told on its own: what went out in its dates, leaving regular
// spending aside unless asked for, and how it compares with other periods.
export function summarizePeriod(
  derived,
  state,
  period,
  { regular = false } = {},
) {
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
          text: `${cap(plural(usual.length, "regular charge"))} (${money(total(usual))}) also fell in these dates and ${usual.length === 1 ? "isn't" : "aren't"} counted above.`,
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
            text: `${money(th.sum)} on ${th.name}`,
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
            text: `“${o.p.name}” came to ${money(total(o.ts))}`,
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
      note: t.note,
    }));
}

// A thread told as a summary, a month strip and a blow-by-blow list.
export function summarizeThread(derived, state, name) {
  const ts = derived.allTxns.filter((t) => t.thread === name).sort(byDate);
  const months = coveredMonths(derived).map((m) => {
    const inMonth = ts.filter((t) => monthOf(t.date) === m);
    return {
      month: m,
      total: total(inMonth),
      count: inMonth.length,
      txnIds: ids(inMonth),
    };
  });
  const items = ts.map((t) => ({
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amount: t.amount,
    periods: t.periods || [],
    note: t.note || "",
  }));
  if (!ts.length)
    return {
      sections: [
        { kind: "empty", parts: [{ text: `Nothing is in ${name} yet.` }] },
      ],
      months,
      items,
    };
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
        text: `${name} had ${plural(ts.length, "charge")} ${when}, ${money(total(ts))} in all`,
        txnIds: ids(ts),
      },
      {
        text:
          merchants.length === 1
            ? `, all at ${merchants[0]}. `
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
          text: `${m.txnIds.length} of them were on the ${ordinal(m.facts.day)} of the month at ${m.facts.merchant}, usually about ${money(m.facts.usual)}.`,
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
          text: `The busiest month was ${monthLong(busiest.month)}: ${plural(busiest.count, "charge")}, ${money(busiest.total)}${shared.length ? `, ${busiest.count > 1 ? "all " : ""}during “${shared[0]}”` : ""}.`,
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
