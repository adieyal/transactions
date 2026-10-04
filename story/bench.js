import { tagsOf } from "../transactions/tags.js";
import { dayLong, list, money, name } from "./copy.js";

// The bench's built-in sentences (artboard 3's side panel, Copy rules s9):
// one bead's one-line story, and several beads told as a story, with no
// assistant. Each takes the derived transactions; nothing here is guessed.

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const dayMonth = (iso) =>
  `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}`;
const paid = (t) => t.kind === "actual" && !t.transfer && t.amount > 0;

// "₪890 at Kettle & Coil on 11 April, during “Moving to Elm Street”. You paid
// Kettle & Coil 3 times in these twelve months."
export function oneStory(t, txns, months) {
  const cur = t.currency;
  if (t.kind === "ghost")
    return `Expected around ${dayMonth(t.date)}: about ${money(Math.abs(t.amount), cur)}${t.amount < 0 ? " back" : ""}, going by what repeats.`;
  if (t.transfer)
    return `${money(Math.abs(t.amount), cur)} on ${dayMonth(t.date)}, a transfer between your accounts, so it isn’t counted as spending.`;
  if (t.amount < 0)
    return `${money(-t.amount, cur)} came back from ${name(t.merchant)} on ${dayMonth(t.date)}.`;
  const during = t.periods?.length
    ? `, during ${list(t.periods.map((p) => `“${name(p)}”`))}`
    : "";
  const n = txns.filter((u) => paid(u) && u.merchant === t.merchant).length;
  const span =
    months === 1 ? "this month" : `these ${countWord(months)} months`;
  const tail =
    n > 1
      ? `You paid ${name(t.merchant)} ${n} times in ${span}.`
      : `It’s the only payment to ${name(t.merchant)} in ${span}.`;
  return `${money(t.amount, cur)} at ${name(t.merchant)} on ${dayMonth(t.date)}${during}. ${tail}`;
}

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];
const countWord = (n) => WORDS[n] ?? String(n);

// Several beads: the heading facts, and the built-in story.
export function manyStory(ts, periods = []) {
  const real = ts.filter(paid);
  const sorted = ts.map((t) => t.date).sort();
  const first = sorted[0],
    last = sorted.at(-1);
  const cur = real[0]?.currency;
  const sum = real.reduce((a, t) => a + t.amount, 0);
  const by = new Map();
  for (const t of real) {
    const m = by.get(t.merchant) ?? { sum: 0, n: 0 };
    m.sum += t.amount;
    m.n++;
    by.set(t.merchant, m);
  }
  const merchants = [...by.keys()].sort(
    (a, b) => by.get(b).sum - by.get(a).sum,
  );
  const top = merchants[0];
  const allIn = periods.find((p) =>
    ts.every((t) => t.date >= p.start && t.date <= p.end),
  );
  let told = real.length
    ? `${money(sum, cur)} went out in ${real.length} payment${real.length > 1 ? "s" : ""} between ${dayMonth(real.map((t) => t.date).sort()[0])} and ${dayMonth(
        real
          .map((t) => t.date)
          .sort()
          .at(-1),
      )}.`
    : "Nothing among these was paid on a statement.";
  if (top)
    told += ` ${name(top)} came to ${money(by.get(top).sum, cur)} of it${by.get(top).n > 1 ? `, in ${by.get(top).n} payments` : ""}.`;
  if (allIn) told += ` All of it was during “${name(allIn.name)}”.`;
  const tags = new Map();
  for (const t of ts)
    for (const g of tagsOf(t.note)) tags.set(g, (tags.get(g) ?? 0) + 1);
  return {
    title: `${ts.length} beads`,
    sub: `${real.length ? money(sum, cur) : "Nothing"} on statements, ${dayLong(first)} to ${dayLong(last)}`,
    merchants:
      merchants.slice(0, 6).map(name).join(" · ") +
      (merchants.length > 6 ? ` and ${merchants.length - 6} more` : ""),
    tags: [...tags].map(([g, n]) => `${g} ${n}`),
    told,
    first,
    last,
    realIds: real.map((t) => t.id),
  };
}
