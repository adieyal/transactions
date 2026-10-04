import { batchDocuments, restoreBackupDocuments } from "./backup.js";
import { documentFor, toDocument } from "./documents.js";
import { toast } from "./ui/dom.js";
import { localBackend } from "./storage.js";
import { $ } from "./helpers.js";

export function createPersistence(runtime, actions) {
  const { state } = runtime;
  const Store = { backend: localBackend(localStorage, toast) };

  const saveTimers = new Map();
  function saveSoon(key, get, wait = 700) {
    clearTimeout(saveTimers.get(key)?.timer);
    const timer = setTimeout(() => {
      saveTimers.delete(key);
      Store.backend.put(key, get());
      setStatus();
    }, wait);
    saveTimers.set(key, { timer, get });
  }
  async function restoreBackup(backup) {
    const pending = [...saveTimers].map(([key, { timer, get }]) => {
      clearTimeout(timer);
      return [key, get()];
    });
    saveTimers.clear();
    await Promise.all(
      pending.map(([key, value]) =>
        Store.backend.put(key, value, { retry: false }),
      ),
    );
    await restoreBackupDocuments(Store.backend, backup);
    blocked.clear();
  }

  function setStatus() {
    $("#saveStatus").textContent =
      Store.backend.kind === "account"
        ? "Saved privately to your Claude account"
        : "Saved in this browser only";
  }

  function saveBatch(batch) {
    for (const [key, document] of Object.entries(batchDocuments(batch)))
      Store.backend.put(key, document);
  }

  function removeBatch(b) {
    for (let i = 0; i < (b.parts || 1); i++)
      Store.backend.del(`batch_${b.id}_${i}`);
    delete state.batches[b.id];
  }

  // Documents that failed their check at boot. They stay as they are in
  // storage, so nothing in this session saves over them.
  const blocked = new Set();
  const blockSaves = (keys) => keys.forEach((k) => blocked.add(k));

  // Saves documents by key, each after its own short wait for more changes.
  function save(...keys) {
    for (const key of keys) {
      const entry = documentFor(key);
      if (blocked.has(key)) continue;
      saveSoon(key, () => toDocument(entry, state), entry.delay);
    }
  }

  return {
    Store,
    blockSaves,
    restoreBackup,
    removeBatch,
    save,
    saveBatch,
    setStatus,
  };
}

export const contract = {
  name: "persistence",
  create: createPersistence,
  provides: [
    "Store",
    "blockSaves",
    "removeBatch",
    "restoreBackup",
    "save",
    "saveBatch",
    "setStatus",
  ],
  requires: [],
  renders: [],
  wires: [],
};
