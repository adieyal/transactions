import { monthOf } from "../helpers.js";
import { LOOSE } from "../transactions/constants.js";
import {
  WEIGHT,
  accountMonths,
  byDate,
  daysBetween,
  groupBy,
  median,
  medianWithout,
  merchantsOf,
  moment,
  monthEnd,
  monthsApart,
  round,
  runsOf,
  spending,
  sum,
} from "./moment-kit.js";

// The rules that find moments. Each works from the derived transactions in
// `ctx` alone; no assistant is involved. Money that came in (`t.inflow`) is
// never spending, so it never reaches the price, spike, large or gap rules.

// 3+ purchases within 7 days, together over twice a typical week, outside
// periods and away from places you go every month. Not one big purchase
// with small ones around it: the largest is under half the total, and the
// others alone come to more than a typical week.
// With fewer than three months there is no typical week, so (Copy rules s3)
// 3+ purchases within 7 days count when together they exceed a third of
// their month.
export function clusters(ctx) {
  const third =
    ctx.typical == null && ctx.months.length < 3
      ? new Map(
          [...groupBy(ctx.spend, (t) => monthOf(t.date))].map(([m, ts]) => [
            m,
            sum(ts) / 3,
          ]),
        )
      : null;
  if (ctx.typical == null && !third) return [];
  const week = (ctx.typical * 12) / 52;
  const busy = (group, total, largest) =>
    third
      ? group.length >= 3 && total > third.get(monthOf(group[0].date))
      : group.length >= 3 &&
        total > 2 * week &&
        largest < total / 2 &&
        total - largest > week;
  let pool = ctx.spend
    .filter((t) => !t.periods?.length && ctx.monthsSeen.get(t.key).size < 3)
    .sort(byDate);
  const out = [];
  for (;;) {
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      const group = [];
      for (
        let j = i;
        j < pool.length && daysBetween(pool[i].date, pool[j].date) <= 7;
        j++
      )
        group.push(pool[j]);
      const total = sum(group);
      const largest = Math.max(...group.map((t) => t.amount));
      if (busy(group, total, largest) && (!best || total > best.total))
        best = { group, total };
    }
    if (!best) break;
    const { group, total } = best;
    out.push(
      moment(
        "cluster",
        group,
        {
          merchants: merchantsOf(group),
          total: round(total),
          count: group.length,
        },
        total,
      ),
    );
    pool = pool.filter((t) => !group.includes(t));
  }
  return out;
}

// A merchant's charges, sorted, and whether it charges a steady amount.
function merchantAmounts(ctx) {
  return new Map(
    [...groupBy(ctx.spend, (t) => t.key)].map(([k, ts]) => [
      k,
      ts.map((t) => t.amount).sort((a, b) => a - b),
    ]),
  );
}

// A charge over three times the same merchant's usual amount, or the largest
// of the year unless that merchant always charges about as much. Same-merchant
// charges within a week join it.
export function large(ctx) {
  const byMerchant = merchantAmounts(ctx);
  const anchors = new Map();
  for (const t of ctx.spend) {
    if (t.amount < 100) continue;
    const list = byMerchant.get(t.key);
    if (list.length - 1 < 3) continue;
    const usual = medianWithout(list, t.amount);
    if (usual > 0 && t.amount > 3 * usual)
      anchors.set(t, { usual: round(usual), usualFor: t.merchant });
  }
  const year = new Set(ctx.months.slice(-12));
  const inYear = ctx.spend.filter((t) => year.has(monthOf(t.date)));
  const top = inYear.reduce(
    (a, t) => (!a || t.amount > a.amount ? t : a),
    null,
  );
  const topList = top && byMerchant.get(top.key);
  const steady =
    topList?.length >= 3 &&
    top.amount <= 1.5 * medianWithout(topList, top.amount);
  if (top && !steady && (ctx.typical == null || top.amount >= ctx.typical / 2))
    anchors.set(top, { ...anchors.get(top), largestOfYear: true });
  const out = [];
  const used = new Set();
  for (const [t, why] of [...anchors].sort(
    (a, b) => b[0].amount - a[0].amount,
  )) {
    if (used.has(t)) continue;
    const group = ctx.spend.filter(
      (o) =>
        o.key === t.key &&
        !used.has(o) &&
        Math.abs(daysBetween(t.date, o.date)) <= 7,
    );
    group.forEach((o) => used.add(o));
    const total = sum(group);
    out.push(
      moment(
        "large",
        group,
        {
          merchant: t.merchant,
          thread: t.thread,
          total: round(total),
          count: group.length,
          largest: t.amount,
          usual: why.usual ?? null,
          usualFor: why.usualFor ?? null,
          largestOfYear: !!why.largestOfYear,
        },
        total,
      ),
    );
  }
  return out;
}

// A merchant seen for the first time, after the account's first covered
// month, with a material amount (at least 100 in its currency and a fifth of a typical month).
export function newMerchants(ctx) {
  if (ctx.typical == null) return [];
  const floor = Math.max(100, ctx.typical / 5);
  const out = [];
  for (const ts of groupBy(ctx.spend, (t) => t.key).values()) {
    const first = monthOf([...ts].sort(byDate)[0].date);
    const start = accountMonths(ctx.derived, ts[0].account)[0];
    if (!start || first <= start) continue;
    const inMonth = ts.filter((t) => monthOf(t.date) === first);
    const total = sum(inMonth);
    if (total < floor) continue;
    out.push(
      moment(
        "new",
        inMonth,
        {
          merchant: inMonth[0].merchant,
          total: round(total),
          count: inMonth.length,
        },
        total,
      ),
    );
  }
  return out;
}

// A charge from a merchant seen in 3+ months at 1.5× its usual amount or more.
export function spikes(ctx) {
  const out = [];
  for (const ts of groupBy(ctx.spend, (t) => t.key).values()) {
    if (ctx.monthsSeen.get(ts[0].key).size < 3 || ts.length < 4) continue;
    const sorted = ts.map((t) => t.amount).sort((a, b) => a - b);
    for (const t of ts) {
      const usual = medianWithout(sorted, t.amount);
      if (!(usual > 0) || t.amount < 1.5 * usual || t.amount - usual < 20)
        continue;
      out.push(
        moment(
          "spike",
          [t],
          { merchant: t.merchant, amount: t.amount, usual: round(usual) },
          t.amount - usual,
        ),
      );
    }
  }
  return out;
}

// The price flags from findChanges, only for steady monthly charges: at least
// three earlier charges, all within 3% of each other. Pay-as-you-go places
// and one-off visits are not prices.
export function prices(ctx, spiked) {
  const out = [];
  for (const f of ctx.derived.flags) {
    if (f.type !== "price" || spiked.has(f.t.id)) continue;
    if (f.t.currency !== ctx.derived.currency) continue;
    if (!(f.a > 0 && f.b > 0) || f.t.inflow) continue;
    const before = f.group
      .map((id) => ctx.derived.byId.get(id))
      .filter((t) => t && t.id !== f.t.id)
      .map((t) =>
        f.cur !== t.currency && t.orig?.currency === f.cur
          ? t.orig.amount
          : t.amount,
      );
    const usual = median(before);
    if (
      before.length < 3 ||
      before.some((a) => Math.abs(a - usual) > 0.03 * Math.abs(usual))
    )
      continue;
    out.push(
      moment(
        "price",
        [f.prev, f.t],
        { merchant: f.t.merchant, before: f.a, after: f.b, currency: f.cur },
        (f.b - f.a) * 12,
        { from: f.t.date, month: monthOf(f.t.date), idDates: [f.t.date] },
      ),
    );
  }
  return out;
}

// A regular charge (about once a month) or outgoing transfer.
function regularItems(ctx) {
  const regular = ctx.derived.allTxns.filter(
    (t) =>
      !t.inst &&
      (spending(t) ||
        (t.transfer?.kind === "pair" && t.transfer.dir === "out")),
  );
  const out = [];
  for (const ts of groupBy(regular, (t) => t.key).values()) {
    const perMonth = groupBy(ts, (t) => monthOf(t.date));
    const once = [...perMonth.values()].filter((g) => g.length === 1).length;
    if (once >= 0.75 * perMonth.size) out.push({ ts, perMonth });
  }
  return out;
}

// Whether charges look like a standing payment rather than a shop someone
// happens to visit most months: at least three in four fall on a steady day
// of the month, or at least three in four are steady in amount. A steady day
// is within five days of the usual one, counted across the turn of the month,
// so the 30th and the 1st are close; that keeps variable bills. A steady
// amount is within 20% of the charge before or after it, so a single price
// rise still counts.
function steady(ts) {
  const sorted = [...ts].sort((a, b) => a.date.localeCompare(b.date));
  const days = sorted.map((t) => +t.date.slice(8, 10));
  const apart = (a, b) => Math.min(Math.abs(a - b), 31 - Math.abs(a - b));
  const nearDays = Math.max(
    ...days.map((d) => days.filter((e) => apart(d, e) <= 5).length),
  );
  const close = (a, b) =>
    b && Math.abs(a.amount - b.amount) <= 0.2 * Math.abs(b.amount);
  const nearAmounts = sorted.filter(
    (t, i) => close(t, sorted[i - 1]) || close(t, sorted[i + 1]),
  ).length;
  return Math.max(nearDays, nearAmounts) >= 0.75 * ts.length;
}

// A steady charge or outgoing transfer missing from covered months, and a
// regular charge that stopped (findChanges' "gone" flags). Months without a
// statement never count as missing.
export function gaps(ctx) {
  const out = [];
  const regular = regularItems(ctx);
  for (const { ts, perMonth } of regular) {
    if (perMonth.size < 4 || !steady(ts)) continue;
    const present = [...perMonth.keys()].sort();
    const covered = accountMonths(ctx.derived, ts[0].account).filter(
      (m) => m >= present[0] && m <= present.at(-1),
    );
    if (present.length < 0.75 * covered.length) continue;
    const missing = covered.filter((m) => !perMonth.has(m));
    const usual = median(ts.map((t) => t.amount));
    for (const run of runsOf(missing))
      out.push(
        moment(
          "gap",
          ts,
          {
            merchant: ts[0].merchant,
            months: run,
            usual: round(usual),
            seen: present.length,
            stopped: false,
          },
          usual * run.length,
          {
            month: run[0],
            from: run[0] + "-01",
            to: monthEnd(run.at(-1)),
            idDates: run,
          },
        ),
      );
  }
  // Stopped: a steady charge seen in 3+ months, missing from the latest
  // covered month and for at least as long as it usually goes between charges.
  const regularKeys = new Map(
    regular
      .filter((r) => r.perMonth.size >= 3 && steady(r.ts))
      .map((r) => [r.ts[0].key, r]),
  );
  for (const f of ctx.derived.flags) {
    if (f.type !== "gone" || !regularKeys.has(f.t.key)) continue;
    const { ts, perMonth } = regularKeys.get(f.t.key);
    const since = accountMonths(ctx.derived, f.t.account).at(-1);
    const seen = [...perMonth.keys()].sort();
    const last = seen.at(-1);
    const cadence = median(
      seen.slice(1).map((m, i) => monthsApart(seen[i], m)),
    );
    if (!since || since <= last || monthsApart(last, since) < cadence) continue;
    const lastTxn = [...ts].sort(byDate).at(-1);
    out.push(
      moment(
        "gap",
        ts,
        {
          merchant: lastTxn.merchant,
          months: [since],
          usual: lastTxn.amount,
          seen: seen.length,
          stopped: true,
          last: lastTxn.date,
        },
        lastTxn.amount,
        {
          month: since,
          from: since + "-01",
          to: monthEnd(since),
          idDates: [since],
        },
      ),
    );
  }
  return out;
}

// A card purchase at the same place on the same day of the month for 4+
// months running. Fixed amounts (subscriptions) and places visited several
// times most months don't count.
export function rhythms(ctx) {
  const cards = new Set(
    Object.values(ctx.state.batches)
      .filter((b) => b.card)
      .map((b) => b.account),
  );
  const out = [];
  const onCard = ctx.spend.filter((t) => cards.has(t.account));
  for (const ts of groupBy(onCard, (t) => t.key).values()) {
    const perMonth = groupBy(ts, (t) => monthOf(t.date));
    for (const sameDay of groupBy(ts, (t) => t.date.slice(8)).values()) {
      const months = [...new Set(sameDay.map((t) => monthOf(t.date)))].sort();
      for (const run of runsOf(months)) {
        if (run.length < 4) continue;
        const inRun = sameDay.filter((t) => run.includes(monthOf(t.date)));
        const counts = groupBy(inRun, (t) => t.amount);
        if (
          Math.max(...[...counts.values()].map((g) => g.length)) >=
          inRun.length / 2
        )
          continue;
        if (
          run.filter((m) => perMonth.get(m).length === 1).length <
          run.length / 2
        )
          continue;
        const first = inRun.sort(byDate)[0];
        out.push(
          moment(
            "rhythm",
            inRun,
            {
              merchant: first.merchant,
              day: Number(first.date.slice(8)),
              months: run.length,
              usual: round(median(inRun.map((t) => t.amount))),
            },
            median(inRun.map((t) => t.amount)) * run.length,
            { month: run[3], idDates: [first.date] },
          ),
        );
      }
    }
  }
  return out;
}

// A thread over its monthly budget for the first time, or by a quarter or more.
export function budgets(ctx) {
  const out = [];
  for (const th of ctx.derived.R.threads) {
    if (th.budget == null) continue;
    const ts = ctx.derived.allTxns.filter(
      (t) => t.thread === th.name && !t.transfer && !t.inflow,
    );
    const perMonth = groupBy(ts, (t) => monthOf(t.date));
    let overBefore = false;
    for (const m of ctx.months) {
      const inMonth = perMonth.get(m) || [];
      const spent = round(sum(inMonth));
      if (spent <= th.budget) continue;
      const first = !overBefore;
      overBefore = true;
      if (!first && spent < 1.25 * th.budget) continue;
      out.push(
        moment(
          "budget",
          inMonth,
          { thread: th.name, spent, budget: th.budget, first },
          spent - th.budget,
          {
            month: m,
            from: m + "-01",
            to: monthEnd(m),
            idKeys: [th.name],
            idDates: [m],
            weight: first ? WEIGHT.budget : WEIGHT.budget / 2,
          },
        ),
      );
    }
  }
  return out;
}

// Charges in no thread, when there are at least five and they come to a
// tenth of all spending or more. One question, in the latest month with any;
// it goes away once they are sorted into threads.
export function loose(ctx) {
  const covered = new Set(ctx.months);
  const inCovered = ctx.spend.filter((t) => covered.has(monthOf(t.date)));
  const ts = inCovered.filter((t) => t.thread === LOOSE);
  const total = sum(ts);
  if (ts.length < 5 || total < 0.1 * sum(inCovered)) return [];
  const month = monthOf([...ts].sort(byDate).at(-1).date);
  return [
    moment(
      "loose",
      ts,
      {
        count: ts.length,
        total: round(total),
        places: new Set(ts.map((t) => t.key)).size,
      },
      total,
      { month, idKeys: [LOOSE], idDates: [month] },
    ),
  ];
}
