const STARTER_RULES = `// A thread: a name on its own line,
// then indented patterns. A pattern is
// part of a merchant name, a #tag
// from your notes, or a /regex/.
// First matching thread wins.

Bills [budget 300/month]
  brightwell energy
  willow water
  cloudfern internet

Groceries [budget 300/month]
  harbor pantry

Dining out [budget 100/month]
  paper kite cafe

Getting around [budget 100/month]
  loopway transit

Subscriptions [budget 50/month]
  lantern stream

Pets [budget 120/month]
  meadow paws
  #pets

Car
  cobble lane garage
  #car

Home
  bluebell removals
  oak & loom
  kettle & coil
  northgate hardware
  linen lane
  #home
  #move

Trips
  lantern bay
  #trip
`;

const STARTER_LENSES = [
  {
    id: "l-where",
    title: "Where it went, by thread",
    code: `// Money out per thread, largest first. Click a bar to light up its beads.
// Each currency is added up on its own.
const out = txns.filter(t => t.amount > 0);
const several = lib.currencies.length > 1;
const g = lib.groupBy(out, t => t.thread + "|" + t.currency);
return {
  kind: "bars",
  items: Object.values(g)
    .map(ts => ({
      label: several ? ts[0].thread + " (" + ts[0].currency + ")" : ts[0].thread,
      value: lib.sum(ts, t => t.amount),
      currency: ts[0].currency,
      ids: ts.map(t => t.id)
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.value - a.value)
};`,
  },
  {
    id: "l-spoken",
    title: "Already spoken for",
    code: `// What's expected in the coming months: recurring charges
// that showed up in your latest statement, plus instalments still to run.
// Each currency is added up on its own.
const several = lib.currencies.length > 1;
const g = lib.groupBy(lib.expected, t => lib.month(t.date) + "|" + t.currency);
return {
  kind: "bars",
  items: Object.keys(g).sort().map(k => ({
    label: several ? k.replace("|", " ") : k.split("|")[0],
    value: lib.sum(g[k], t => t.amount),
    currency: g[k][0].currency,
    ids: g[k].map(t => t.id)
  }))
};`,
  },
  {
    id: "l-recurring",
    title: "Things that keep coming back",
    code: `// Merchants seen in more than one statement, with their latest charge.
const rec = txns.filter(t => t.recurring);
const g = lib.groupBy(rec, t => t.key);
const rows = Object.values(g)
  .map(ts => ts.sort((a, b) => a.date < b.date ? -1 : 1))
  .sort((a, b) => b.at(-1).amount - a.at(-1).amount);
return {
  kind: "table",
  columns: ["Merchant", "Seen", "Latest"],
  rows: rows.map(ts => [ts.at(-1).merchant, ts.length + "×", lib.fmt(ts.at(-1).amount, ts.at(-1).currency)]),
  rowIds: rows.map(ts => ts.map(t => t.id))
};`,
  },
];
// The threads text for someone's own workspace: how to write threads, and no
// threads yet (the demo's threads name its fictional merchants).
const BLANK_RULES =
  STARTER_RULES.split("\n\n")[0] +
  "\n\n// For example:\n// Groceries [budget 1500/month]\n//   supermarket\n";

export { BLANK_RULES, STARTER_LENSES, STARTER_RULES };
