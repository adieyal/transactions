import { BLANK_RULES, STARTER_LENSES } from "./defaults.js";
import { FORMAT_CURRENCY } from "./transactions/import.js";

// The single definition of every saved document: its storage key, the state
// field it holds, the wrapper it is stored in, its field in a backup (null:
// not backed up), the check its stored value must pass, and how long a save
// waits for more changes. Boot (loadDocuments), saving (toDocument through
// actions.save) and backups (backup.js) are all derived from this list; see
// docs/architecture.md section 3 and ADR 0003.
//
// Optional per entry:
// - in(value, state): turns a checked stored value into the state field.
// - out(value): the stored value for a state field, leaving transient fields.
// - older(): the value for a backup made before the field existed.
// - label: what a backup that fails the check is told is wrong.
// Statements are saved separately as batch_<id>_<n> chunks (see backup.js).

const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string";
const optionalText = (v) => v == null || text(v);
const identifier = (v) => text(v) && v.length > 0;
export const isId = (v) => text(v) && /^[A-Za-z0-9_-]+$/.test(v);
export function isDate(v) {
  if (!text(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}
const mapOf = (ok) => (v) => record(v) && Object.values(v).every(ok);
const listOf = (ok) => (v) => Array.isArray(v) && v.every(ok);
const isBool = (v) => typeof v === "boolean";

const isName = (n) => record(n) && text(n.name);
// fromBackup: true for a lens that came from an imported backup (shown with
// a label; it runs in the sandbox like any lens). off: the earlier
// switched-off flag, still accepted and read as fromBackup. inStory: true
// for a lens the person added to the year's story ("Your lenses").
const flag = (v) => v == null || typeof v === "boolean";
const isLens = (l) =>
  record(l) &&
  isId(l.id) &&
  text(l.title) &&
  text(l.code) &&
  flag(l.off) &&
  flag(l.fromBackup) &&
  flag(l.inStory);
// A lens saved while imported lenses were switched off: now labelled instead.
const fromOff = ({ off, ...l }) => (off ? { ...l, fromBackup: true } : l);
const isPeriod = (p) =>
  record(p) &&
  isId(p.id) &&
  identifier(p.name) &&
  isDate(p.start) &&
  isDate(p.end) &&
  p.start <= p.end &&
  (p.story == null || text(p.story)) &&
  (p.color == null || (text(p.color) && /^#[0-9a-f]{3,8}$/i.test(p.color)));
const REPORT_TEXT = ["answer", "ranAt", "dataKey", "coverage"];
const isReport = (r) =>
  record(r) &&
  isId(r.id) &&
  text(r.q) &&
  REPORT_TEXT.every((k) => optionalText(r[k]));
const isAnswer = (a) =>
  record(a) &&
  ["answered", "skipped"].includes(a.status) &&
  optionalText(a.choice) &&
  optionalText(a.note) &&
  optionalText(a.at) &&
  (a.created == null ||
    (record(a.created) &&
      optionalText(a.created.periodId) &&
      (a.created.noteIds == null || listOf(text)(a.created.noteIds))));
const isMerchantAnswer = (a) =>
  record(a) && text(a.choice) && optionalText(a.action) && optionalText(a.at);
const isView = (v) =>
  record(v) && listOf(text)(v.parked) && typeof v.panel === "boolean";

// A period saved before colours were required gets the first palette colour.
const withColor = (periods) =>
  periods.map((p) => (p?.color == null ? { ...p, color: "#2F6B8F" } : p));
const reportFields = (r) => ({
  id: r.id,
  q: r.q,
  answer: r.answer || "",
  ranAt: r.ranAt || "",
  dataKey: r.dataKey || "",
  coverage: r.coverage || "",
  by: r.by || "",
  // The latest payment date at this run and at the one before, for
  // "Since the last run: …".
  through: r.through || "",
  prevThrough: r.prevThrough || "",
});
const turnFields = (t) => ({
  role: t.role,
  content: t.content,
  shown: t.shown || "",
  q: t.q || "",
  error: t.error || "",
  undo: t.undo || null,
  changedCount: t.changedCount || 0,
  undone: !!t.undone,
  proposed: !!t.proposed,
  undoNames: t.undoNames || null,
  renamedCount: t.renamedCount || 0,
  namesUndone: !!t.namesUndone,
  periods: t.periods || null,
});

export const DOCUMENTS = [
  {
    key: "workspace",
    label: "demo flag",
    field: "isDemo",
    wrap: "demo",
    backup: "demo",
    check: isBool,
    delay: 0,
    older: () => false,
  },
  {
    key: "rules",
    label: "threads must be text",
    field: "rules",
    wrap: "text",
    backup: "rules",
    check: text,
    delay: 300,
  },
  {
    key: "notes",
    label: "transaction notes",
    field: "notes",
    wrap: "map",
    backup: "notes",
    check: mapOf(text),
    delay: 200,
    older: () => ({}),
  },
  {
    key: "names",
    label: "merchant names",
    field: "names",
    wrap: "map",
    backup: "names",
    check: mapOf(isName),
    delay: 300,
    older: () => ({}),
  },
  {
    key: "transfers",
    label: "transfer overrides",
    field: "transferOv",
    wrap: "map",
    backup: "transfers",
    check: mapOf(isBool),
    delay: 200,
    older: () => ({}),
  },
  {
    key: "dismissed",
    label: "dismissed changes",
    field: "dismissed",
    wrap: "map",
    backup: "dismissed",
    check: mapOf(isBool),
    delay: 300,
    older: () => ({}),
  },
  {
    key: "adapters",
    label: "statement mappings",
    field: "adapters",
    wrap: "items",
    backup: "adapters",
    check: mapOf(record),
    delay: 100,
    older: () => ({}),
  },
  {
    key: "lenses",
    label: "saved lenses",
    field: "lenses",
    wrap: "items",
    backup: "lenses",
    check: listOf(isLens),
    delay: 700,
    in: (lenses) => lenses.map(fromOff),
    older: () => STARTER_LENSES.map((l) => ({ ...l })),
  },
  {
    key: "periods",
    label: "saved periods",
    field: "periods",
    wrap: "items",
    backup: "periods",
    check: listOf(isPeriod),
    delay: 400,
    in: withColor,
    older: () => [],
  },
  {
    key: "reports",
    label: "saved reports",
    field: "reports",
    wrap: "items",
    backup: "reports",
    check: listOf(isReport),
    delay: 400,
    in: (reports) => reports.map(reportFields),
    out: (reports) => reports.map(reportFields),
    older: () => [],
  },
  {
    key: "answers",
    label: "saved answers",
    field: "answers",
    wrap: "map",
    backup: "answers",
    check: mapOf(isAnswer),
    delay: 300,
    older: () => ({}),
  },
  {
    key: "merchantAnswers",
    label: "saved merchant answers",
    field: "merchantAnswers",
    wrap: "map",
    backup: "merchantAnswers",
    check: mapOf(isMerchantAnswer),
    delay: 300,
    older: () => ({}),
  },
  {
    key: "view",
    label: "view settings",
    field: "view",
    wrap: "self",
    backup: "view",
    check: isView,
    delay: 300,
    in: (v, state) => ({ ...state.view, parked: v.parked, panel: v.panel }),
    out: (v) => ({ parked: v.parked, panel: v.panel }),
    older: () => ({ parked: [], panel: true, showParked: false }),
  },
  {
    key: "chat",
    label: "chat",
    field: "turns",
    wrap: "turns",
    backup: null,
    check: listOf(record),
    delay: 500,
    out: (turns) =>
      turns
        .filter((t) => !t.pending)
        .slice(-40)
        .map(turnFields),
  },
];

export const BATCH_PREFIX = "batch_";
// The marker the demo seed wrote before `workspace` existed. A workspace that
// has it and no `workspace` document started as the demo.
export const LEGACY_DEMO_KEY = "demo";

export const documentFor = (key) => {
  const entry = DOCUMENTS.find((d) => d.key === key);
  if (!entry) throw new Error(`No saved document called ${key}.`);
  return entry;
};

// The stored form of one document, from state.
export function toDocument(entry, state) {
  const field = state[entry.field] ?? [];
  const value = entry.out ? entry.out(field) : field;
  return entry.wrap === "self" ? value : { [entry.wrap]: value };
}

// Saved documents into state. A document that fails its check is reported by
// key and left alone: state keeps its starting value, and the caller should
// not save over it. Statements are put back together from their chunks.
// Returns the keys that failed, and whether the legacy demo marker was used.
export function loadDocuments(docs, state) {
  const invalid = [];
  let legacyDemo = false;
  for (const entry of DOCUMENTS) {
    let doc = docs[entry.key];
    if (doc == null && entry.key === "workspace" && docs[LEGACY_DEMO_KEY]) {
      doc = { demo: true };
      legacyDemo = true;
    }
    if (doc == null) continue;
    const value = entry.wrap === "self" ? doc : doc?.[entry.wrap];
    if (!entry.check(value)) {
      invalid.push(entry.key);
      continue;
    }
    state[entry.field] = entry.in ? entry.in(value, state) : value;
  }
  const parts = Object.entries(docs)
    .filter(([k]) => k.startsWith(BATCH_PREFIX))
    .map(([, v]) => v)
    .sort((a, b) => a.batchId.localeCompare(b.batchId) || a.part - b.part);
  for (const p of parts) {
    const b = (state.batches[p.batchId] ||= {
      id: p.batchId,
      kind: p.kind,
      currency: p.currency,
      card: !!p.card,
      account: p.account,
      periods: p.periods,
      file: p.file,
      added: p.added,
      parts: p.parts,
      rows: [],
    });
    b.rows.push(...(p.rows || []));
  }
  for (const b of Object.values(state.batches)) withCurrencies(b);
  return { invalid, legacyDemo };
}

// Statements saved before batches recorded a currency take the currency of
// their recognised format; any other is left without one, for the app to ask
// once (see needsCurrency). Rows take their statement's currency.
export function withCurrencies(batch) {
  // Before then, an original amount in a file that named no currency was
  // saved as ILS, so outside a format known to be in ILS that says nothing.
  if (FORMAT_CURRENCY[batch.kind] !== "ILS")
    for (const r of batch.rows)
      if (!r.currency && r.orig?.currency === "ILS") r.orig = null;
  batch.currency ??= FORMAT_CURRENCY[batch.kind] ?? null;
  if (batch.currency) for (const r of batch.rows) r.currency ??= batch.currency;
  return batch;
}
// Statements with rows in no known currency.
export const needsCurrency = (state) =>
  Object.values(state.batches).filter((b) => b.rows.some((r) => !r.currency));
// The person's answer for statements that had no currency.
export function setCurrency(batch, currency) {
  batch.currency = currency;
  for (const r of batch.rows) r.currency ??= currency;
  return batch;
}

// The person's answers, { batchId: currency }; a statement left unanswered
// keeps waiting. Returns the statements that changed, to be saved.
export function answerCurrencies(state, answers) {
  return Object.entries(answers)
    .filter(([id, c]) => c && state.batches[id])
    .map(([id, c]) => setCurrency(state.batches[id], c));
}

// The workspace that replaces the demo when someone adds their own first
// statements: every saved document back to how a new workspace starts
// (fresh, from createRuntime), no statements, no demo threads, and no longer
// a demo. Their view settings stay.
export function withoutDemo(state, fresh) {
  const out = { batches: {} };
  for (const d of DOCUMENTS) out[d.field] = fresh[d.field];
  return { ...out, rules: BLANK_RULES, isDemo: false, view: state.view };
}
