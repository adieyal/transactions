import { addMonths, fnv, monthOf, ms, pad2 } from "../helpers.js";

// Moments are things in the data worth an optional question. Each rule below
// works from the derived transactions alone; no assistant is involved.

export const MAX_OPEN_PER_MONTH = 3;
const WEIGHT = {
  cluster: 1,
  large: 1,
  gap: 1,
  new: 0.8,
  spike: 0.8,
  budget: 1,
  price: 0.6,
  rhythm: 0.3,
};
// Moments that describe an event; a smaller moment inside one is the same question.
const CONTAINERS = new Set(["cluster", "large"]);

const DAY = 86400000;
const daysBetween = (a, b) => (ms(b) - ms(a)) / DAY;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const sum = (ts) => ts.reduce((s, t) => s + t.amount, 0);
const round = (n) => Math.round(n * 100) / 100;
const spending = (t) => t.amount > 0 && !t.transfer;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// The median of a sorted list with one occurrence of `value` left out.
function medianWithout(sorted, value) {
  const k = sorted.indexOf(value);
  const n = sorted.length - 1;
  if (k < 0 || n < 1) return null;
  const at = (i) => (i < k ? sorted[i] : sorted[i + 1]);
  return n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}
function monthEnd(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
const nextMonth = (ym) => addMonths(ym + "-01", 1).slice(0, 7);
function groupBy(items, key) {
  const out = new Map();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

// Stable across re-import and re-derivation: built from what the moment is
// about (merchant keys and dates), never from transaction ids.
export function momentId(kind, month, keys, dates) {
  const signature =
    [...new Set(keys)].sort().join("|") + "#" + [...dates].sort().join("|");
  return `${kind}-${month}-${fnv(signature)}`;
}

export function coveredMonths(derived) {
  const months = new Set();
  for (const set of Object.values(derived.coverage))
    set.forEach((m) => months.add(m));
  return [...months].sort();
}

// The median spending of covered calendar months, leaving out transactions
// inside periods. With fewer than three covered months there is no typical.
export function typicalMonth(derived) {
  const months = coveredMonths(derived);
  if (months.length < 3) return null;
  const totals = Object.fromEntries(months.map((m) => [m, 0]));
  for (const t of derived.allTxns) {
    const m = monthOf(t.date);
    if (spending(t) && !t.periods?.length && m in totals) totals[m] += t.amount;
  }
  return median(Object.values(totals));
}

function moment(kind, txns, facts, magnitude, extra = {}) {
  const sorted = [...txns].sort(byDate);
  const from = extra.from ?? sorted[0].date;
  const month = extra.month ?? monthOf(from);
  const keys = [...new Set(txns.map((t) => t.key))].sort();
  return {
    id: momentId(
      kind,
      month,
      extra.idKeys ?? keys,
      extra.idDates ?? sorted.map((t) => t.date),
    ),
    kind,
    month,
    from,
    to: extra.to ?? sorted.at(-1).date,
    txnIds: sorted.map((t) => t.id),
    facts: { keys, ...facts },
    rank: round(Math.abs(magnitude) * (extra.weight ?? WEIGHT[kind])),
  };
}
const merchantsOf = (txns) => [
  ...new Set([...txns].sort(byDate).map((t) => t.merchant)),
];

// 3+ purchases within 7 days, together over twice a typical week, outside
// periods and away from places you go every month.
function clusters(ctx) {
  if (ctx.typical == null) return [];
  const week = (ctx.typical * 12) / 52;
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
      if (
        group.length >= 3 &&
        total > 2 * week &&
        (!best || total > best.total)
      )
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

// A charge over three times the median for its thread (or its merchant), or
// the largest of the year. Same-merchant charges within a week join it.
function large(ctx) {
  const sortedBy = (key) =>
    new Map(
      [...groupBy(ctx.spend, key)].map(([k, ts]) => [
        k,
        ts.map((t) => t.amount).sort((a, b) => a - b),
      ]),
    );
  const byThread = sortedBy((t) => t.thread);
  const byMerchant = sortedBy((t) => t.key);
  const anchors = new Map();
  for (const t of ctx.spend) {
    if (t.amount < 100) continue;
    for (const [list, label] of [
      [byThread.get(t.thread), t.thread],
      [byMerchant.get(t.key), t.merchant],
    ]) {
      if (list.length - 1 < 3) continue;
      const usual = medianWithout(list, t.amount);
      if (usual > 0 && t.amount > 3 * usual) {
        anchors.set(t, { usual: round(usual), usualFor: label });
        break;
      }
    }
  }
  const year = new Set(ctx.months.slice(-12));
  const inYear = ctx.spend.filter((t) => year.has(monthOf(t.date)));
  const top = inYear.reduce(
    (a, t) => (!a || t.amount > a.amount ? t : a),
    null,
  );
  if (top && (ctx.typical == null || top.amount >= ctx.typical / 2))
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

// A merchant seen for the first time, after the account's first statement,
// with a material amount (at least ₪100 and a fifth of a typical month).
function newMerchants(ctx) {
  if (ctx.typical == null) return [];
  const floor = Math.max(100, ctx.typical / 5);
  const out = [];
  for (const ts of groupBy(ctx.spend, (t) => t.key).values()) {
    const first = monthOf([...ts].sort(byDate)[0].date);
    const start = [...(ctx.derived.coverage[ts[0].account] || [])].sort()[0];
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
function spikes(ctx) {
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

// The price flags from findChanges, for charges that were steady before.
function prices(ctx, spiked) {
  const out = [];
  for (const f of ctx.derived.flags) {
    if (f.type !== "price" || spiked.has(f.t.id)) continue;
    const before = f.group
      .map((id) => ctx.derived.byId.get(id))
      .filter((t) => t && t.id !== f.t.id)
      .map((t) =>
        f.cur !== "ILS" && t.orig?.currency === f.cur
          ? t.orig.amount
          : t.amount,
      );
    const usual = median(before);
    if (
      !before.length ||
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

// A regular charge or outgoing transfer missing from covered statement
// months, and charges that stopped (findChanges' "gone" flags).
function gaps(ctx) {
  const out = [];
  const regular = ctx.derived.allTxns.filter(
    (t) =>
      !t.inst &&
      (spending(t) ||
        (t.transfer?.kind === "pair" && t.transfer.dir === "out")),
  );
  for (const ts of groupBy(regular, (t) => t.key).values()) {
    const perMonth = groupBy(ts, (t) => t.period);
    if (perMonth.size < 4) continue;
    const once = [...perMonth.values()].filter((g) => g.length === 1).length;
    if (once < 0.75 * perMonth.size) continue;
    const present = [...perMonth.keys()].sort();
    const covered = [...(ctx.derived.coverage[ts[0].account] || [])]
      .filter((m) => m >= present[0] && m <= present.at(-1))
      .sort();
    if (present.length < 0.75 * covered.length) continue;
    const missing = covered.filter((m) => !perMonth.has(m));
    const runs = [];
    for (const m of missing) {
      const run = runs.at(-1);
      if (run && nextMonth(run.at(-1)) === m) run.push(m);
      else runs.push([m]);
    }
    const usual = median(ts.map((t) => t.amount));
    for (const run of runs)
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
  for (const f of ctx.derived.flags) {
    if (f.type !== "gone") continue;
    const ts = f.group.map((id) => ctx.derived.byId.get(id)).filter(Boolean);
    out.push(
      moment(
        "gap",
        ts,
        {
          merchant: f.t.merchant,
          months: [f.since],
          usual: f.t.amount,
          seen: new Set(ts.map((t) => t.period)).size,
          stopped: true,
          last: f.t.date,
        },
        f.t.amount,
        {
          month: f.since,
          from: f.since + "-01",
          to: monthEnd(f.since),
          idDates: [f.since],
        },
      ),
    );
  }
  return out;
}

// A card purchase at the same place on the same day of the month for 4+
// months running. Fixed amounts (subscriptions) and places visited several
// times most months don't count.
function rhythms(ctx) {
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
      const runs = [];
      for (const m of months) {
        const run = runs.at(-1);
        if (run && nextMonth(run.at(-1)) === m) run.push(m);
        else runs.push([m]);
      }
      for (const run of runs) {
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
function budgets(ctx) {
  const out = [];
  for (const th of ctx.derived.R.threads) {
    if (th.budget == null) continue;
    const ts = ctx.derived.allTxns.filter(
      (t) => t.thread === th.name && !t.transfer,
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

// The calendar months each merchant appears in. Three or more makes it routine.
function monthsSeen(spend) {
  const out = new Map();
  for (const t of spend) {
    if (!out.has(t.key)) out.set(t.key, new Set());
    out.get(t.key).add(monthOf(t.date));
  }
  return out;
}

// Every moment the rules find, highest rank first, before anything is dropped.
export function detectMoments(derived, state) {
  const spend = derived.allTxns.filter(spending);
  const ctx = {
    derived,
    state,
    spend,
    months: coveredMonths(derived),
    typical: typicalMonth(derived),
    monthsSeen: monthsSeen(spend),
  };
  const spike = spikes(ctx);
  const spiked = new Set(spike.flatMap((m) => m.txnIds));
  const all = [
    ...clusters(ctx),
    ...large(ctx),
    ...gaps(ctx),
    ...prices(ctx, spiked),
    ...spike,
    ...rhythms(ctx),
    ...newMerchants(ctx),
    ...budgets(ctx),
  ];
  const seen = new Set();
  return all
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

// A transaction is explained by a note written for it (a note repeated on the
// merchant's other charges doesn't count), or by a period it falls in unless
// it is routine spending that happened during those dates.
export function explainer(derived, state) {
  const seen = monthsSeen(derived.allTxns.filter(spending));
  const uses = new Map();
  const noteKey = (t) => t.key + "\n" + t.note;
  for (const t of derived.allTxns)
    if (t.note) uses.set(noteKey(t), (uses.get(noteKey(t)) || 0) + 1);
  return (m) => {
    if (m.kind === "gap")
      return state.periods.some((p) => p.start <= m.from && p.end >= m.to);
    return m.txnIds.every((id) => {
      const t = derived.byId.get(id);
      return (
        !!t &&
        ((t.periods?.length > 0 && !(seen.get(t.key)?.size >= 3)) ||
          (!!t.note && uses.get(noteKey(t)) === 1))
      );
    });
  };
}

// The questions to offer: not answered or skipped, not explained, not part of
// a bigger moment, and at most three a month, highest rank first.
export function findMoments(derived, state) {
  const all = detectMoments(derived, state);
  const answers = state.answers || {};
  const explained = explainer(derived, state);
  const perMonth = {};
  return all.filter((m, i) => {
    if (answers[m.id] || explained(m)) return false;
    const inside = all
      .slice(0, i)
      .some(
        (h) =>
          CONTAINERS.has(h.kind) &&
          m.txnIds.every((id) => h.txnIds.includes(id)),
      );
    if (inside) return false;
    perMonth[m.month] = (perMonth[m.month] || 0) + 1;
    return perMonth[m.month] <= MAX_OPEN_PER_MONTH;
  });
}

// Record an answer (or a skip) and remember a real answer for the merchant,
// so the same choice can be offered next time. Returns new documents.
export function applyAnswer(
  { answers = {}, merchantAnswers = {} },
  m,
  { status, choice = null, action = null, note = null, created = null, at },
) {
  const next = {
    answers: {
      ...answers,
      [m.id]: { status, choice, note, created, at },
    },
    merchantAnswers: { ...merchantAnswers },
  };
  if (status === "answered" && choice)
    for (const key of m.facts.keys || [])
      next.merchantAnswers[key] = { choice, action, at };
  return next;
}
