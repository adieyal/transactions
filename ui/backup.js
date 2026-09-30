import { $ } from "../helpers.js";
import { toast } from "./dom.js";
import { parseBackup } from "../backup.js";
import { createRuntime } from "../state.js";

export function createBackupImport(runtime, actions) {
  let pending = null;
  let busy = false;
  function wireBackupImport() {
    const fileInput = $("#backupFile"),
      dialog = $("#backupDlg");
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file || busy) return;
      try {
        pending = parseBackup(await file.text());
        const batches = Object.values(pending.batches);
        const count = new Set(batches.flatMap((b) => b.rows.map((r) => r.id)))
          .size;
        $("#backupSummary").textContent =
          `${file.name}: ${count} transactions in ${batches.length} statements, ${pending.periods.length} periods and ${pending.lenses.length} lenses.`;
        $("#backupError").textContent = "";
        dialog.showModal();
      } catch (error) {
        pending = null;
        toast(error.message, 8000);
      }
    };
    $("#backupCancel").onclick = () => {
      pending = null;
      dialog.close();
    };
    dialog.oncancel = (event) => {
      if (busy) event.preventDefault();
      else pending = null;
    };
    $("#backupRestore").onclick = async () => {
      if (!pending || busy) return;
      if (
        runtime.state.turns.some((t) => t.pending) ||
        runtime.state.reports.some((r) => r.running)
      ) {
        $("#backupError").textContent =
          "Wait for the current assistant request to finish before importing.";
        return;
      }
      busy = true;
      $("#backupRestore").disabled = true;
      $("#backupCancel").disabled = true;
      try {
        await actions.restoreBackup(pending);
        Object.assign(runtime.state, createRuntime().state, pending, {
          loaded: true,
        });
        $("#q").value = "";
        actions.applyPanel();
        actions.refresh();
        pending = null;
        dialog.close();
        toast(
          "Backup imported. Your statements, threads and notes are restored.",
        );
      } catch (error) {
        $("#backupError").textContent = error.message;
      } finally {
        busy = false;
        $("#backupRestore").disabled = false;
        $("#backupCancel").disabled = false;
      }
    };
  }
  return { wireBackupImport };
}
