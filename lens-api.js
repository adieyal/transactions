import { fmt } from "./helpers.js";

// What a lens can use, for the editor's reference panel and autocomplete.
// tests/lens-api.test.js checks this against the objects lenses receive.

export const TXN_FIELDS = [
  {
    name: "id",
    type: "string",
    doc: "Unique id. Pass ids to a view to light up beads.",
  },
  { name: "date", type: '"YYYY-MM-DD"', doc: "Purchase date." },
  {
    name: "chargeDate",
    type: '"YYYY-MM-DD"',
    doc: "Date it was charged, if different.",
  },
  {
    name: "merchant",
    type: "string",
    doc: "Display name, possibly renamed or translated.",
  },
  {
    name: "original",
    type: "string",
    doc: "Description exactly as on the statement.",
  },
  {
    name: "amount",
    type: "number",
    doc: "Positive is money out; negative is a refund or money in.",
  },
  {
    name: "orig",
    type: "{amount, currency} | null",
    doc: "Original or foreign-currency amount.",
  },
  { name: "type", type: "string", doc: "Transaction type from the statement." },
  { name: "details", type: "string", doc: "Extra text from the statement." },
  { name: "inst", type: "{n, of} | null", doc: "Instalment n of `of`." },
  {
    name: "thread",
    type: "string",
    doc: "Your category, from the Threads rules.",
  },
  { name: "account", type: "string", doc: "Account or card name." },
  { name: "note", type: "string", doc: "Your note, which may contain #tags." },
  { name: "period", type: '"YYYY-MM"', doc: "Statement month." },
  {
    name: "periods",
    type: "string[]",
    doc: "Names of the periods you marked that include it.",
  },
  {
    name: "recurring",
    type: "boolean",
    doc: "The merchant appears in two or more statements.",
  },
  {
    name: "key",
    type: "string",
    doc: "Merchant identity used to group repeats.",
  },
  {
    name: "kind",
    type: "string",
    doc: '"actual" for statement rows; expected charges differ.',
  },
];

export const LIB_MEMBERS = [
  {
    name: "sum",
    sig: "sum(array, fn?)",
    doc: "Adds up fn(x) for each item, or the items themselves.",
  },
  {
    name: "groupBy",
    sig: "groupBy(array, fn)",
    doc: "Returns { key: [items] } grouped by fn(x).",
  },
  {
    name: "month",
    sig: "month(date)",
    doc: 'Turns "YYYY-MM-DD" into "YYYY-MM".',
  },
  { name: "fmt", sig: "fmt(number)", doc: 'Formats money, e.g. "₪1,234.00".' },
  { name: "today", sig: "today", doc: 'Today as "YYYY-MM-DD".' },
  { name: "threads", sig: "threads", doc: "Thread names, in order." },
  { name: "accounts", sig: "accounts", doc: "Account names." },
  {
    name: "expected",
    sig: "expected",
    doc: "Projected future charges, shaped like txns.",
  },
  {
    name: "periods",
    sig: "periods",
    doc: "[{ name, start, end, story }] for the periods you marked.",
  },
  { name: "budgets", sig: "budgets", doc: "{ thread: monthly budget }." },
  {
    name: "transfers",
    sig: "transfers",
    doc: "Moves between your own accounts, left out of txns.",
  },
];

export const VIEW_KINDS = [
  {
    kind: "bars",
    shape: '{ kind: "bars", items: [{ label, value, ids? }], unit? }',
    doc: 'Horizontal bars. Labels like "2026-03" show as month names. unit: "" shows raw values.',
  },
  {
    kind: "table",
    shape: '{ kind: "table", columns: [..], rows: [[..]], rowIds? }',
    doc: "A table. rowIds[i] lists the ids behind row i.",
  },
  {
    kind: "number",
    shape: '{ kind: "number", value, label?, ids? }',
    doc: "One big figure with a caption.",
  },
  { kind: "text", shape: '{ kind: "text", text }', doc: "A sentence or two." },
];

// Says, in the app's voice, what is wrong with the shape of a lens's view,
// or returns null when it can be drawn.
export function viewProblem(v) {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return 'This lens didn’t return a view. It should return an object such as { kind: "text", text: "…" }.';
  const list = (x) => x == null || Array.isArray(x);
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (v.kind === "bars") {
    if (!list(v.items))
      return "This lens returned bars in an unexpected shape: items should be a list.";
    if (!v.items?.every(isObj) && v.items?.length)
      return "This lens returned bars in an unexpected shape: each item should look like { label, value }.";
    if (v.items?.some((i) => !list(i.ids)))
      return "This lens returned bars in an unexpected shape: ids should be a list of transaction ids.";
    return null;
  }
  if (v.kind === "table") {
    if (!list(v.columns))
      return "This lens returned a table in an unexpected shape: columns should be a list of headings.";
    if (!list(v.rows))
      return "This lens returned a table in an unexpected shape: rows should be a list.";
    if (v.rows?.some((r) => !Array.isArray(r)))
      return "This lens returned a table in an unexpected shape: rows should be lists of values.";
    if (!list(v.rowIds) || v.rowIds?.some((r) => !list(r)))
      return "This lens returned a table in an unexpected shape: rowIds should be lists of transaction ids.";
    return null;
  }
  if (v.kind === "number")
    return list(v.ids)
      ? null
      : "This lens returned a number in an unexpected shape: ids should be a list of transaction ids.";
  if (v.kind === "text") return null;
  return `This lens returned a view of kind “${v.kind}”, which the app can’t draw. Use bars, table, number or text.`;
}

export const ARRAY_METHODS = [
  ["filter", "filter(t => …)", "Keep the items where the test is true."],
  ["map", "map(t => …)", "Turn each item into something else."],
  ["reduce", "reduce((acc, t) => …, start)", "Fold the items into one value."],
  [
    "sort",
    "sort((a, b) => …)",
    "Sort in place; return negative to put a first.",
  ],
  ["slice", "slice(start, end)", "A part of the array."],
  ["find", "find(t => …)", "The first item where the test is true."],
  ["some", "some(t => …)", "True if any item passes."],
  ["every", "every(t => …)", "True if every item passes."],
  ["forEach", "forEach(t => …)", "Run something for each item."],
  ["length", "length", "How many items."],
].map(([name, sig, doc]) => ({ name, sig, doc }));

// The fields of a transaction a lens sees (TXN_FIELDS documents them).
export function publicTxn(t) {
  return {
    id: t.id,
    date: t.date,
    chargeDate: t.chargeDate,
    merchant: t.merchant,
    original: t.original || t.merchant,
    amount: t.amount,
    orig: t.orig,
    type: t.type,
    details: t.details,
    inst: t.inst,
    thread: t.thread,
    account: t.account,
    note: t.note || "",
    period: t.period,
    periods: t.periods || [],
    recurring: !!t.recurring,
    key: t.key,
    kind: t.kind,
  };
}

// The helpers and data a lens gets as `lib` (LIB_MEMBERS documents them).
export function lensLib(derived, state, today) {
  return {
    sum: (a, f = (x) => x) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0),
    groupBy: (a, f) =>
      a.reduce((o, x) => {
        const k = f(x);
        (o[k] ||= []).push(x);
        return o;
      }, {}),
    month: (d) => String(d).slice(0, 7),
    fmt: (n) => fmt(n),
    today,
    threads: derived.names,
    accounts: derived.accounts,
    expected: derived.expected.map(publicTxn),
    periods: state.periods.map((p) => ({
      name: p.name,
      start: p.start,
      end: p.end,
      story: p.story || "",
    })),
    budgets: Object.fromEntries(
      derived.R.threads
        .filter((t) => t.budget != null)
        .map((t) => [t.name, t.budget]),
    ),
    transfers: derived.allTxns.filter((t) => t.transfer).map(publicTxn),
  };
}

// Runs a lens's code on the shown transactions (without transfers). The code
// is the person's own; it must return a view object.
export function runLens(code, derived, state, today) {
  const txns = derived.txns.filter((t) => !t.transfer).map(publicTxn);
  const fn = new Function("txns", "lib", code);
  const view = fn(txns, lensLib(derived, state, today));
  if (!view || typeof view !== "object")
    throw new Error(
      "The lens needs to return a view, e.g. { kind: 'bars', items: [...] }",
    );
  return view;
}

// What a lens gets, as plain data that can be posted to the sandbox: its
// transactions, and lib's data (lib's functions are rebuilt where it runs).
export function lensInput(derived, state, today) {
  const lib = lensLib(derived, state, today);
  const data = Object.fromEntries(
    Object.entries(lib).filter(([, v]) => typeof v !== "function"),
  );
  return {
    txns: derived.txns.filter((t) => !t.transfer).map(publicTxn),
    data,
  };
}

// Lenses arriving in an imported backup are code from that file. They run
// in the sandbox like every lens, labelled "From your backup". A lens whose
// code is exactly a starter lens's code is the app's own and isn't labelled.
// The earlier switched-off flag (off) is dropped.
export function markFromBackup(lenses, starters) {
  const own = new Set(starters.map((l) => l.code));
  return lenses.map((l) => {
    const { off, fromBackup, ...rest } = l;
    return own.has(l.code) ? rest : { ...rest, fromBackup: true };
  });
}
