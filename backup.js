import { DOCUMENTS, isDate, isId, toDocument } from "./documents.js";

export const BATCH_CHUNK_SIZE = 350;

// today: the date the backup is made.
export function createBackup(state, today) {
  const backup = {
    format: "transactions-backup",
    version: 1,
    exported: today,
  };
  for (const d of DOCUMENTS) if (d.backup) backup[d.backup] = state[d.field];
  backup.batches = Object.values(state.batches);
  return backup;
}

function requireValue(ok, field) {
  if (!ok) throw new Error(`Invalid backup: ${field}.`);
}
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string";
const identifier = (value) => text(value) && value.length > 0;
const id = isId;
const date = isDate;
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
// today: the date a statement without one counts as added.
export function parseBackup(source, today) {
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
      added: batch.added ?? today,
      parts: Math.max(1, Math.ceil(batch.rows.length / BATCH_CHUNK_SIZE)),
    };
  }
  // Every saved document, through the same checks as loading at boot. A
  // field an older backup lacks gets the value it had before the field existed.
  const out = { batches };
  for (const d of DOCUMENTS) {
    if (!d.backup) continue;
    const value =
      data[d.backup] === undefined && d.older ? d.older() : data[d.backup];
    requireValue(d.check(value), d.label);
    out[d.field] = d.in ? d.in(value, { [d.field]: d.older?.() }) : value;
  }
  return out;
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
    ...Object.fromEntries(DOCUMENTS.map((d) => [d.key, toDocument(d, state)])),
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
