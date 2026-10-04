import { fnv } from "../helpers.js";
import { count, money, monthLong, name as bidi, plural } from "./copy.js";
import { groupBy } from "./moment-kit.js";

// Small helpers shared by the month, period and thread stories.

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const total = (ts) => ts.reduce((s, t) => s + t.amount, 0);
export const ids = (ts) => ts.map((t) => t.id);
export const byDate = (a, b) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
export const monthWord = (ym) => monthLong(ym).split(" ")[0];

// Varies wording by month without randomness: the same month always reads
// the same way.
export const pick = (month, kind, variants) =>
  variants[parseInt(fnv(month + "|" + kind), 16) % variants.length];

// Text parts joined as "a, b and c", each item keeping its own ids.
export function listParts(items) {
  const out = [];
  items.forEach((item, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? " and " : ", " });
    out.push(item);
  });
  return out;
}

export function times(r) {
  if (r < 2.5) return "about twice";
  return `about ${count(Math.round(r))} times`;
}

// ", with ₪1,505 at Kettle & Coil (three purchases), ₪640 at …", or " at X"
// when there is only one merchant.
export function merchantParts(ts) {
  const merchants = [...groupBy(ts, (t) => t.merchant)]
    .map(([name, group]) => ({ name, ts: group, sum: total(group) }))
    .sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
  if (merchants.length === 1)
    return [{ text: ` at ${bidi(merchants[0].name)}` }];
  const items = merchants.slice(0, 4).map((m) => ({
    text: `${money(m.sum)} at ${bidi(m.name)}${m.ts.length > 1 ? ` (${plural(m.ts.length, "purchase")})` : ""}`,
    txnIds: ids(m.ts),
  }));
  const rest = merchants.slice(4).flatMap((m) => m.ts);
  if (rest.length)
    items.push({ text: `${money(total(rest))} elsewhere`, txnIds: ids(rest) });
  return [{ text: ", with " }, ...listParts(items)];
}
