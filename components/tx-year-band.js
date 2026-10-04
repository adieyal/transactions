import { MONTHS, esc, monthOf } from "../helpers.js";
import { dayShort, money } from "../story/copy.js";
import { daysIn, monthAxis } from "../story/one-month.js";
import { monthsSeen } from "../story/moment-kit.js";
import { detectMoments } from "../story/moments.js";
import { shortRange } from "../story/year.js";

// Artboard 3's timeline band, for the Year scale (a column per month) and
// the Month scale (a column per day). The month's axis comes from the
// one-month story (story/one-month.js), as in artboard 2.

const pct = (n) => n.toFixed(2);
const LEGEND =
  "Solid beads are payments, hollow ones with a line are refunds, and dashed ones are expected: charges that repeat, projected ahead, or sitting in a statement you haven’t added. Arcs join payments that repeat. Hover a bead for its details and click it for where it came from. Drag across the timeline to gather several.";
const day = (iso) => Number(iso.slice(8, 10));

// Where things sit across the band: x(date) as a percentage, for the start
// of a day (at) and its middle (mid).
export function yearScale(months, today) {
  const next = (() => {
    const [y, m] = months.at(-1).split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  })();
  // The month after the statements is drawn ahead from the latest month's
  // end until it is over (story/year.js tells it over the same days).
  const cols = [months.at(-1), next].includes(monthOf(today))
    ? [...months, next]
    : months;
  const N = cols.length;
  const pos = (date, off) => {
    const i = cols.indexOf(monthOf(date));
    if (i < 0) return date < cols[0] ? 0 : 100;
    return ((i + (day(date) - 1 + off) / daysIn(cols[i])) / N) * 100;
  };
  return {
    cols,
    N,
    ahead: cols.length > months.length,
    at: (d) => pos(d, 0),
    end: (d) => pos(d, 1),
    mid: (d) => pos(d, 0.5),
  };
}

export function monthScale(month) {
  const days = daysIn(month);
  const inside = (d) => monthOf(d) === month;
  return {
    days,
    at: (d) => (inside(d) ? ((day(d) - 1) / days) * 100 : d < month ? 0 : 100),
    end: (d) => (inside(d) ? (day(d) / days) * 100 : d < month ? 0 : 100),
    mid: (d) => ((day(d) - 0.5) / days) * 100,
  };
}

// The rows: a thread each, with its beads and the arcs that join a
// merchant's repeating payments (seen in three or more months, at most 70
// days apart).
function rowsHTML(derived, txns, scale, { year, compact, numbers }) {
  const RH = compact ? 26 : 64,
    WY = RH / 2;
  const seen = monthsSeen(txns.filter((t) => t.amount > 0 && !t.transfer));
  return Object.keys(derived.colorOf)
    .map((thread) => {
      const col = derived.colorOf[thread];
      const ts = txns.filter((t) => t.thread === thread && t.amount !== 0);
      if (!ts.length) return "";
      const beads = ts
        .map((t) => {
          const back = t.amount < 0 && !t.expected;
          const a = Math.abs(t.amount);
          const raw = compact
            ? 4 + Math.sqrt(a) * 0.32
            : (year ? 7 : 9) + Math.sqrt(a) * (year ? 0.7 : 0.85);
          const sz = Math.round(Math.min(compact ? 14 : 30, raw));
          const look = t.expected
            ? `--bead: ${esc(col)}`
            : back
              ? `background: var(--band); border-color: ${esc(col)}`
              : `background: ${esc(col)}`;
          const title = t.expected
            ? `${dayShort(t.date)} · ${t.merchant} · expected, about ${money(a, t.currency)}`
            : back
              ? `${dayShort(t.date)} · ${t.merchant} refund · ${money(a, t.currency)} back`
              : `${dayShort(t.date)} · ${t.merchant} · ${money(a, t.currency)}`;
          return `<div class="yr-bead${back ? " back" : ""}${t.expected ? " expected" : ""}" data-id="${esc(t.id)}" tabindex="-1" role="button" data-tip="${esc(title)}" aria-label="${esc(title)}" style="top: ${WY}px; left: ${pct(scale.mid(t.date))}%; width: ${sz}px; height: ${sz}px; ${look}">${back ? `<span class="yr-minus" style="background: ${esc(col)}"></span>` : ""}</div>`;
        })
        .join("");
      // Arcs join the repeats in compact rows too, lower to fit 26px.
      let arcs = "";
      const lift = compact ? 12 : 30;
      if (year) {
        const by = new Map();
        for (const t of ts)
          if (t.amount > 0 && !t.expected && seen.get(t.key)?.size >= 3)
            by.set(t.key, [...(by.get(t.key) || []), t]);
        for (const ser of by.values()) {
          ser.sort((a, b) => a.date.localeCompare(b.date));
          for (let i = 1; i < ser.length; i++) {
            const [a, b] = [ser[i - 1], ser[i]];
            const gap = (Date.parse(b.date) - Date.parse(a.date)) / 864e5;
            if (gap > 70) continue;
            const [x1, x2] = [scale.mid(a.date) * 10, scale.mid(b.date) * 10];
            arcs += `M${x1.toFixed(1)} ${WY} Q${((x1 + x2) / 2).toFixed(1)} ${WY - lift} ${x2.toFixed(1)} ${WY} `;
          }
        }
      }
      const out = ts
        .filter((t) => t.amount > 0 && !t.expected)
        .reduce((s, t) => s + t.amount, 0);
      const back = ts
        .filter((t) => t.amount < 0 && !t.expected)
        .reduce((s, t) => s - t.amount, 0);
      const cur = ts[0].currency;
      const th = derived.R.threads.find((x) => x.name === thread);
      const budget = numbers && year && !compact ? th?.budget : null;
      let meta =
        numbers && !compact && out > 0
          ? year
            ? `${money(out, cur)} in ${scale.cols.length - (scale.ahead ? 1 : 0)} months${back ? ` · ${money(back, cur)} back` : ""}`
            : money(out, cur)
          : "";
      if (budget) meta += ` · budget ${money(budget, cur)} a month`;
      const add =
        numbers && year && !compact && th && !th.budget
          ? `<button class="yr-addbudget" data-add-budget="${esc(thread)}">+ Budget</button>`
          : "";
      return `<div class="yr-row" data-thread="${esc(thread)}" style="height: ${RH}px">
        <div class="yr-rowhead"><span class="yr-thread" tabindex="0" data-ref data-ids="${esc(
          ts
            .filter((t) => !t.expected)
            .map((t) => t.id)
            .join(","),
        )}" style="color: ${esc(col)}; font-size: ${compact ? 13 : 15}px">${esc(thread)}</span>${meta ? `<span class="yr-meta">${esc(meta)}</span>` : ""}${add}</div>
        <div class="yr-track">${budget ? budgetHTML(ts, budget, cur, col, scale) : ""}<div class="yr-wire" style="top: ${WY}px"></div>${arcs ? `<svg class="yr-arcs" viewBox="0 0 1000 ${RH}" preserveAspectRatio="none" aria-hidden="true"><path d="${esc(arcs)}" style="stroke: ${esc(col)}"></path></svg>` : ""}${beads}</div>
      </div>`;
    })
    .join("");
}

// Numbers on, a thread with a budget: each month's payments as a box
// against the budget's dashed line, 40px high ("Apr: ₪305 of ₪300").
const LANE = 40;
function budgetHTML(ts, budget, cur, col, scale) {
  const months = scale.cols.length - (scale.ahead ? 1 : 0);
  const w = (months / scale.N) * 100;
  const boxes = scale.cols
    .slice(0, months)
    .map((m, i) => {
      const v = ts
        .filter((t) => t.amount > 0 && !t.expected && monthOf(t.date) === m)
        .reduce((a, t) => a + t.amount, 0);
      const h = Math.min(56, Math.round((v / budget) * LANE));
      const [, mm] = m.split("-").map(Number);
      return `<div class="yr-budgetbox" data-tip="${esc(`${MONTHS[mm - 1]}: ${money(v, cur)} of ${money(budget, cur)}`)}" aria-label="${esc(`${MONTHS[mm - 1]}: ${money(v, cur)} of ${money(budget, cur)}`)}" style="height: ${h}px; left: calc(${pct((i / scale.N) * 100)}% + 3px); width: calc(${(100 / scale.N).toFixed(3)}% - 6px); border-color: ${esc(col)}; background: ${esc(col)}14"></div>`;
    })
    .join("");
  return `${boxes}<div class="yr-budgetline" style="width: ${pct(w)}%; bottom: ${4 + LANE}px; border-top-color: ${esc(col)}"></div><div class="yr-budgetlabel" style="right: ${pct(100 - w)}%; bottom: ${6 + LANE}px">${esc(`${money(budget, cur)} a month`)}</div>`;
}

// Busy stretches the app found, for <tx-period-strip>, which draws them as
// dashed outlines with "₪720 · 2–6 Jun ?" beside the named periods.
function stretchesOf(derived, state, [from, to]) {
  return detectMoments(derived, state)
    .filter((m) => m.kind === "cluster" && m.from <= to && m.to >= from)
    .map((m) => {
      const r = shortRange(m.from, m.to)
        .replace(/ \d{4}$/, "")
        .replace(" – ", "–");
      return {
        from: m.from,
        to: m.to,
        label: `${money(m.facts.total, m.currency)} · ${r}`,
        aria: `A busy stretch, ${r}, not named yet. Name it`,
        data: {
          "data-stretch": m.id,
          "data-ids": m.txnIds.join(","),
          "data-ref": "hover",
        },
      };
    });
}

export function bandHTML(derived, state, view) {
  const { year, months, month, today, compact, numbers, label, focus } = view;
  const range = year
    ? [`${months[0]}-01`, `${months.at(-1)}-31`]
    : [`${month}-01`, `${month}-31`];
  const scale = year ? yearScale(months, today) : monthScale(month);
  const txns = derived.allTxns.filter(
    (t) =>
      t.date >= range[0] &&
      t.date <= range[1] &&
      t.thread &&
      !(t.amount < 0 && t.transfer),
  );
  // Charges that repeat, projected into the month ahead (the story's, which
  // include those due between the 1st and today): dashed beads.
  if (year && scale.ahead)
    for (const e of view.expected)
      if (e.thread) txns.push({ ...e, expected: true });
  const axis = year
    ? scale.cols
        .map((ym, i) => {
          const [y, m] = ym.split("-").map(Number);
          const yearMark = i === 0 || m === 1 ? ` ${y}` : "";
          return `<div class="yr-col${i >= months.length ? " ahead" : ""}" data-month="${esc(ym)}" style="left: ${pct(((i + 0.5) / scale.N) * 100)}%">${esc(MONTHS[m - 1] + yearMark)}</div>`;
        })
        .join("")
    : monthAxis(month)
        .map(
          (a) =>
            `<div class="yr-col day" data-day="${esc(a.day)}" style="left: ${pct(((a.day - 0.5) / scale.days) * 100)}%">${esc(`${a.day} ${a.weekday}`)}</div>`,
        )
        .join("");
  // Gridlines between months, or at the start of each week (Mondays).
  const lines = year
    ? Array.from({ length: scale.N + 1 }, (_, i) => (i / scale.N) * 100)
    : [
        0,
        ...monthAxis(month)
          .filter(
            (a, i) =>
              i && a.weekday === "M" && monthAxis(month)[i - 1].weekday === "S",
          )
          .map((a) => a.day - 1),
      ].map((d) => (d / scale.days) * 100);
  const grid = lines
    .map((x) => `<div class="yr-gridline" style="left: ${pct(x)}%"></div>`)
    .join("");
  const stretches = stretchesOf(derived, state, range);
  const tx = year && scale.ahead ? scale.at(today) : null;
  const future =
    tx == null
      ? ""
      : `<div class="yr-future" style="left: ${pct(tx)}%"></div><div class="yr-today" style="left: ${pct(tx)}%"></div><div class="yr-todaylabel" style="left: ${pct(tx)}%">today</div>`;
  const win =
    year && focus
      ? `<div class="yr-window" style="left: ${pct(scale.at(focus.from))}%; width: ${pct(Math.max(scale.end(focus.to) - scale.at(focus.from), 1))}%"></div>`
      : "";
  const totals =
    numbers && !compact ? numbersHTML(derived, state, view, scale, txns) : "";
  return `<section class="yr-band" aria-label="Timeline"><div class="yr-scroll"><div class="yr-inner">
    <div class="yr-top"><div class="yr-scalelabel">${esc(label)}${txns.some((t) => t.expected) ? ", and what’s expected ahead" : ""}</div><div class="yr-flex"></div><button class="yr-compact" aria-pressed="${compact}">${compact ? "Full timeline" : "Compact timeline"}</button></div>
    <div class="yr-axisrow"><div class="yr-gutter"></div><div class="yr-axis">${axis}</div></div>
    ${totals}
    <tx-period-strip variant="year" months="${esc((year ? scale.cols : [month]).join(","))}" stretches="${esc(JSON.stringify(stretches))}"><div class="yr-rows"><div class="yr-grid">${grid}${future}${win}</div>${rowsHTML(derived, txns, scale, { year, compact, numbers })}</div></tx-period-strip>
    ${year && !compact ? `<p class="yr-legend">${esc(LEGEND)}</p>` : ""}
  </div></div></section>`;
}

// Numbers on: what went out each month, and which months each account's
// statements cover.
function numbersHTML(derived, state, view, scale, txns) {
  const out = txns.filter((t) => t.amount > 0 && !t.transfer);
  const cur = out[0]?.currency;
  const total = (ts) =>
    ts.filter((t) => t.currency === cur).reduce((s, t) => s + t.amount, 0);
  const outs = view.year
    ? view.months
        .map(
          (m, i) =>
            `<div class="yr-out" style="left: ${pct(((i + 0.5) / scale.N) * 100)}%">${esc(money(total(out.filter((t) => monthOf(t.date) === m)), cur))}</div>`,
        )
        .join("")
    : `<div class="yr-out start">${esc(`${money(total(out), cur)} out${view.typical ? ` · a typical month is about ${money(view.typical, cur)}` : ""}`)}</div>`;
  const cover = Object.entries(derived.purchaseCoverage)
    .map(([account, set]) => {
      const cols = view.year ? scale.cols : [view.month];
      const cells = cols
        .map((ym, i) => {
          const has = set.has(ym);
          return `<div class="yr-cover${has ? "" : " missing"}" data-tip="${esc(`${MONTHS[Number(ym.slice(5)) - 1]}: ${has ? "statement added" : "no statement yet"}`)}" aria-label="${esc(`${MONTHS[Number(ym.slice(5)) - 1]}: ${has ? "statement added" : "no statement yet"}`)}" style="left: calc(${pct((i / cols.length) * 100)}% + 2px); width: calc(${(100 / cols.length).toFixed(3)}% - 4px)"></div>`;
        })
        .join("");
      return `<div class="yr-coverrow"><div class="yr-gutter yr-small">${esc(account)}</div><div class="yr-covertrack">${cells}</div></div>`;
    })
    .join("");
  return `<div class="yr-outrow"><div class="yr-gutter yr-small">Went out</div><div class="yr-outs">${outs}</div></div>${cover}`;
}
