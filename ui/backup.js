import { $ } from "../helpers.js";
import { toast } from "./dom.js";
import { parseBackup } from "../backup.js";
import { createRuntime } from "../state.js";
import { createDemoData } from "../demo.js";

export function createBackupImport(runtime, actions) {
  let pending = null;
  let busy = false;
  let doneMessage = "";

  // Asks before replacing the whole workspace with `workspace`.
  function confirmReplace(workspace, { title, summary, button, done }) {
    pending = workspace;
    doneMessage = done;
    $("#backupTitle").textContent = title;
    $("#backupSummary").textContent = summary;
    $("#backupRestore").textContent = button;
    $("#backupError").textContent = "";
    $("#backupDlg").showModal();
  }

  function restartDemo() {
    if (busy) return;
    confirmReplace(
      { ...createRuntime().state, ...createDemoData(), isDemo: true },
      {
        title: "Restart the demo",
        summary: "This loads a fresh copy of the fictional demo year.",
        button: "Replace and restart",
        done: "The demo is back to its starting point.",
      },
    );
  }

  function wireBackupImport() {
    const fileInput = $("#backupFile"),
      dialog = $("#backupDlg");
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file || busy) return;
      try {
        const backup = parseBackup(await file.text());
        const batches = Object.values(backup.batches);
        const count = new Set(batches.flatMap((b) => b.rows.map((r) => r.id)))
          .size;
        confirmReplace(backup, {
          title: "Import backup",
          summary: `${file.name}: ${count} transactions in ${batches.length} statements, ${backup.periods.length} periods and ${backup.lenses.length} lenses.`,
          button: "Replace and import",
          done: "Backup imported. Your statements, threads and notes are restored.",
        });
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
          "Wait for the current assistant request to finish first.";
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
        toast(doneMessage);
      } catch (error) {
        $("#backupError").textContent = error.message;
      } finally {
        busy = false;
        $("#backupRestore").disabled = false;
        $("#backupCancel").disabled = false;
      }
    };
  }
  return { restartDemo, wireBackupImport };
}
