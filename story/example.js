import { addMonths, ms } from "../helpers.js";
import { LOOSE, TRANSFERS } from "../transactions/constants.js";
import { coveredMonths } from "./moment-kit.js";

// The first-run card's mini timeline: the threads that took the most money,
// one row each, with a dot per payment along the covered months, and the
// named moments placed on the same line. Positions are percentages of the
// span; a dot's size grows with the square root of its amount, from 6 to 16
// pixels, as drawn on artboard 1.
export function exampleStrip(derived, moments = [], { rows = 5 } = {}) {
  const months = coveredMonths(derived);
  if (!months.length) return { rows: [], moments: [] };
  const start = ms(months[0] + "-01");
  const end = ms(addMonths(months.at(-1) + "-01", 1));
  const at = (iso) =>
    Math.round(((ms(iso) - start) / (end - start)) * 1000) / 10;
  const spend = derived.txns.filter(
    (t) =>
      t.amount > 0 &&
      !t.transfer &&
      !t.inflow &&
      t.thread &&
      t.thread !== LOOSE &&
      t.thread !== TRANSFERS &&
      ms(t.date) >= start &&
      ms(t.date) < end,
  );
  const totals = new Map();
  for (const t of spend)
    totals.set(t.thread, (totals.get(t.thread) || 0) + t.amount);
  const top = [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rows)
    .map(([name]) => name);
  const largest = Math.max(...spend.map((t) => t.amount));
  return {
    rows: top.map((name) => ({
      thread: name,
      color: derived.colorOf[name],
      dots: spend
        .filter((t) => t.thread === name)
        .map((t) => ({
          id: t.id,
          left: at(t.date),
          size: Math.round(6 + 10 * Math.sqrt(t.amount / largest)),
        })),
    })),
    moments: moments
      .filter((m) => ms(m.date) >= start && ms(m.date) < end)
      .map((m) => ({ label: m.label, left: at(m.date) })),
  };
}
