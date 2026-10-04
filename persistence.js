import { batchDocuments, restoreBackupDocuments } from "./backup.js";
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

  const savePeriods = () =>
    saveSoon("periods", () => ({ items: state.periods }), 400);

  const saveReports = () =>
    saveSoon(
      "reports",
      () => ({
        items: state.reports.map((r) => ({
          id: r.id,
          q: r.q,
          answer: r.answer || "",
          ranAt: r.ranAt || "",
          dataKey: r.dataKey || "",
          coverage: r.coverage || "",
        })),
      }),
      400,
    );

  const saveAnswers = () => {
    saveSoon("answers", () => ({ map: state.answers }), 300);
    saveSoon("merchantAnswers", () => ({ map: state.merchantAnswers }), 300);
  };

  const saveLenses = () => saveSoon("lenses", () => ({ items: state.lenses }));

  const saveView = () =>
    saveSoon(
      "view",
      () => ({ parked: state.view.parked, panel: state.view.panel }),
      300,
    );

  const saveChat = () =>
    saveSoon(
      "chat",
      () => ({
        turns: state.turns
          .filter((t) => !t.pending)
          .slice(-40)
          .map((t) => ({
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
          })),
      }),
      500,
    );

  return {
    Store,
    restoreBackup,
    removeBatch,
    saveAnswers,
    saveBatch,
    saveChat,
    saveLenses,
    savePeriods,
    saveReports,
    saveSoon,
    saveView,
    setStatus,
  };
}
