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

Home
  oak & loom
  #home

Trips
  lantern bay
  #trip
`;

const STARTER_LENSES = [
  {
    id: "l-where",
    title: "Where it went, by thread",
    code: `// Money out per thread, largest first. Click a bar to light up its beads.
const out = txns.filter(t => t.amount > 0);
const g = lib.groupBy(out, t => t.thread);
return {
  kind: "bars",
  items: Object.entries(g)
    .map(([name, ts]) => ({ label: name, value: lib.sum(ts, t => t.amount), ids: ts.map(t => t.id) }))
    .sort((a, b) => b.value - a.value)
};`,
  },
  {
    id: "l-spoken",
    title: "Already spoken for",
    code: `// What's expected in the coming months: recurring charges
// that showed up in your latest statement, plus instalments still to run.
const g = lib.groupBy(lib.expected, t => lib.month(t.date));
return {
  kind: "bars",
  items: Object.keys(g).sort().map(m => ({
    label: m,
    value: lib.sum(g[m], t => t.amount),
    ids: g[m].map(t => t.id)
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
  rows: rows.map(ts => [ts.at(-1).merchant, ts.length + "×", lib.fmt(ts.at(-1).amount)]),
  rowIds: rows.map(ts => ts.map(t => t.id))
};`,
  },
];
export { STARTER_LENSES, STARTER_RULES };
