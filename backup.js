import { STARTER_LENSES } from "./defaults.js";
import { TODAY } from "./helpers.js";

export const BATCH_CHUNK_SIZE = 350;

export function createBackup(state) {
  return {
    format: "transactions-backup",
    version: 1,
    exported: TODAY,
    demo: state.isDemo,
    rules: state.rules,
    notes: state.notes,
    names: state.names,
    periods: state.periods,
    reports: state.reports,
    transfers: state.transferOv,
    lenses: state.lenses,
    adapters: state.adapters,
    dismissed: state.dismissed,
    view: state.view,
    batches: Object.values(state.batches),
  };
}

function requireValue(ok, field) {
  if (!ok) throw new Error(`Invalid backup: ${field}.`);
}
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string";
const identifier = (value) => text(value) && value.length > 0;
const id = (value) => text(value) && /^[A-Za-z0-9_-]+$/.test(value);
function date(value) {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === value;
}
function safeKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(
      !["__proto__", "constructor", "prototype"].includes(key),
      "unsupported object key",
    );
    safeKeys(child);
  }
}

// Accept both the original Abacus exports and current Transactions backups.
export function parseBackup(source) {
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error(
      "Choose a valid JSON backup exported with “Download everything (JSON)”.",
    );
  }
  requireValue(record(data), "expected a JSON object");
  safeKeys(data);
  if (data.format !== undefined)
    requireValue(
      data.format === "transactions-backup" && data.version === 1,
      "unsupported backup format or version",
    );
  requireValue(text(data.rules), "threads must be text");
  requireValue(Array.isArray(data.batches), "statements must be an array");
  const batches = {};
  for (const batch of data.batches) {
    requireValue(
      record(batch) &&
        id(batch.id) &&
        identifier(batch.account) &&
        text(batch.kind),
      "statement identity",
    );
    requireValue(!Object.hasOwn(batches, batch.id), "duplicate statement ID");
    requireValue(
      Array.isArray(batch.periods) &&
        batch.periods.every(
          (p) => text(p) && /^\d{4}-(0[1-9]|1[0-2])$/.test(p),
        ),
      "statement months",
    );
    requireValue(Array.isArray(batch.rows), "statement rows");
    for (const row of batch.rows) {
      requireValue(
        record(row) &&
          id(row.id) &&
          identifier(row.account) &&
          text(row.merchant),
        "transaction identity",
      );
      requireValue(
        Number.isFinite(row.amount) && date(row.date) && date(row.chargeDate),
        "transaction amount or date",
      );
      requireValue(
        text(row.period) && /^\d{4}-(0[1-9]|1[0-2])$/.test(row.period),
        "transaction statement month",
      );
      if (row.inst != null)
        requireValue(
          record(row.inst) &&
            Number.isInteger(row.inst.n) &&
            Number.isInteger(row.inst.of) &&
            row.inst.n >= 1 &&
            row.inst.of >= row.inst.n,
          "instalment payments",
        );
      if (row.orig != null)
        requireValue(
          record(row.orig) &&
            Number.isFinite(row.orig.amount) &&
            text(row.orig.currency) &&
            /^[A-Z]{3}$/.test(row.orig.currency),
          "original currency amount",
        );
    }
    batches[batch.id] = {
      ...batch,
      file: batch.file ?? "imported-backup.json",
      added: batch.added ?? TODAY,
      parts: Math.max(1, Math.ceil(batch.rows.length / BATCH_CHUNK_SIZE)),
    };
  }
  const maps = {};
  for (const key of ["notes", "names", "transfers", "adapters", "dismissed"]) {
    maps[key] = data[key] ?? {};
    requireValue(record(maps[key]), key);
  }
  requireValue(Object.values(maps.notes).every(text), "transaction notes");
  requireValue(
    Object.values(maps.names).every((n) => record(n) && text(n.name)),
    "merchant names",
  );
  requireValue(
    Object.values(maps.transfers).every((v) => typeof v === "boolean"),
    "transfer overrides",
  );
  requireValue(
    Object.values(maps.dismissed).every((v) => typeof v === "boolean"),
    "dismissed changes",
  );
  requireValue(
    Object.values(maps.adapters).every(record),
    "statement mappings",
  );
  const lenses = data.lenses ?? STARTER_LENSES.map((l) => ({ ...l }));
  requireValue(
    Array.isArray(lenses) &&
      lenses.every(
        (l) => record(l) && id(l.id) && text(l.title) && text(l.code),
      ),
    "saved lenses",
  );
  const periods = data.periods ?? [];
  requireValue(
    Array.isArray(periods) &&
      periods.every(
        (p) =>
          record(p) &&
          id(p.id) &&
          identifier(p.name) &&
          date(p.start) &&
          date(p.end) &&
          p.start <= p.end &&
          (p.story == null || text(p.story)),
      ),
    "saved periods",
  );
  for (const period of periods) {
    if (period.color == null) period.color = "#2F6B8F";
    requireValue(
      text(period.color) && /^#[0-9a-f]{3,8}$/i.test(period.color),
      "period color",
    );
  }
  const reports = data.reports ?? [];
  requireValue(
    Array.isArray(reports) &&
      reports.every(
        (r) =>
          record(r) &&
          id(r.id) &&
          text(r.q) &&
          ["answer", "ranAt", "dataKey", "coverage"].every(
            (k) => r[k] == null || text(r[k]),
          ),
      ),
    "saved reports",
  );
  const view = data.view ?? { parked: [], panel: true, showParked: false };
  requireValue(
    record(view) &&
      Array.isArray(view.parked) &&
      view.parked.every(text) &&
      typeof view.panel === "boolean",
    "view settings",
  );
  if (data.demo !== undefined)
    requireValue(typeof data.demo === "boolean", "demo flag");
  return {
    batches,
    rules: data.rules,
    notes: maps.notes,
    names: maps.names,
    transferOv: maps.transfers,
    adapters: maps.adapters,
    dismissed: maps.dismissed,
    lenses,
    periods,
    reports: reports.map((r) => ({
      id: r.id,
      q: r.q,
      answer: r.answer ?? "",
      ranAt: r.ranAt ?? "",
      dataKey: r.dataKey ?? "",
      coverage: r.coverage ?? "",
    })),
    view,
    isDemo: data.demo === true,
  };
}

export function batchDocuments(batch) {
  const parts = Math.max(1, Math.ceil(batch.rows.length / BATCH_CHUNK_SIZE));
  return Object.fromEntries(
    Array.from({ length: parts }, (_, part) => [
      `batch_${batch.id}_${part}`,
      {
        batchId: batch.id,
        kind: batch.kind,
        card: !!batch.card,
        account: batch.account,
        periods: batch.periods,
        file: batch.file,
        added: batch.added,
        part,
        parts,
        rows: batch.rows.slice(
          part * BATCH_CHUNK_SIZE,
          (part + 1) * BATCH_CHUNK_SIZE,
        ),
      },
    ]),
  );
}

function workspaceDocuments(state) {
  return {
    workspace: { demo: state.isDemo },
    rules: { text: state.rules },
    notes: { map: state.notes },
    names: { map: state.names },
    transfers: { map: state.transferOv },
    dismissed: { map: state.dismissed },
    lenses: { items: state.lenses },
    adapters: { items: state.adapters },
    periods: { items: state.periods },
    reports: { items: state.reports },
    view: state.view,
    chat: { turns: [] },
    ...Object.assign({}, ...Object.values(state.batches).map(batchDocuments)),
  };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

async function completeWrites(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

// Verify writes before deleting old chunks; recover the previous documents on failure.
export async function restoreBackupDocuments(backend, state) {
  const previous = await backend.all();
  const documents = workspaceDocuments(state);
  const owned = (key) =>
    key.startsWith("batch_") || Object.hasOwn(documents, key);
  const expected = {
    ...Object.fromEntries(Object.entries(previous).filter(([k]) => !owned(k))),
    ...documents,
  };
  async function writeAndVerify(target) {
    await completeWrites(
      Object.entries(target).map(([k, v]) =>
        backend.put(k, v, { retry: false }),
      ),
    );
    const written = await backend.all();
    if (!Object.entries(target).every(([k, v]) => same(written[k], v)))
      throw new Error("The backup could not be saved completely.");
    await completeWrites(
      Object.keys(written)
        .filter((k) => !Object.hasOwn(target, k))
        .map((k) => backend.del(k, { retry: false })),
    );
    if (!same(await backend.all(), target))
      throw new Error("Saved backup verification failed.");
  }
  try {
    await writeAndVerify(expected);
  } catch (error) {
    try {
      await writeAndVerify(previous);
    } catch {
      throw new Error(
        "Import failed, and the previous saved data could not be fully restored. Keep your backup file.",
      );
    }
    throw new Error(`${error.message} Previous saved data was restored.`);
  }
}
