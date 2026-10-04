import { contract as backupImport } from "./ui/backup.js";
import { saveBrowserDownload } from "./downloads.js";
import { createDemoData } from "./demo.js";
import { debounce } from "./helpers.js";
import { dbBackend, localBackend } from "./storage.js";
import { toast } from "./ui/dom.js";
import { createRuntime } from "./state.js";
import { deriveTransactions } from "./transactions/derive.js";
import { contract as persistence } from "./persistence.js";
import { documentFor, loadDocuments, toDocument } from "./documents.js";
import { createRegistry } from "./registry.js";
import { contract as filter } from "./ui/filter.js";
import { contract as timeline } from "./ui/timeline.js";
import { contract as tags } from "./ui/tags.js";
import { contract as inspector } from "./ui/inspector.js";
import { contract as periods } from "./ui/periods.js";
import { contract as questions } from "./ui/questions.js";
import { contract as month } from "./ui/month.js";
import { contract as threadSummary } from "./ui/thread-summary.js";
import { contract as reports } from "./ui/reports.js";
import { contract as threads } from "./ui/threads.js";
import { contract as lenses } from "./ui/lenses.js";
import { contract as chrome } from "./ui/chrome.js";
import { contract as assistantSettings } from "./ui/assistant-settings.js";
import { contract as suggestions } from "./suggestions.js";
import { contract as chat } from "./ui/chat.js";
import { contract as importer } from "./ui/import.js";
import { contract as tour } from "./ui/tour.js";
import { contract as lensEditor } from "./ui/lens-editor.js";

const runtime = createRuntime();
// Modules in registration order: the order of renders on every refresh and
// of wiring at boot. registry.js checks each one's contract.
const MODULES = [
  persistence,
  chrome,
  filter,
  timeline,
  tags,
  questions,
  month,
  reports,
  threads,
  inspector,
  periods,
  threadSummary,
  lenses,
  assistantSettings,
  suggestions,
  chat,
  importer,
  backupImport,
  tour,
  lensEditor,
];
const registry = createRegistry(runtime, MODULES, {
  derive() {
    runtime.derived = deriveTransactions(runtime.state);
  },
  redraw,
  refresh,
  refreshSoon: debounce(() => refresh(), 250),
  // Storage reports failed writes here, so persistence needs no UI.
  onSaveError: (message) => toast(message),
});
const actions = registry.actions;

// The one way the screen catches up with state: re-derive, then every
// registered render. redraw() skips deriving, for a change of tab or layout.
function redraw() {
  if (!runtime.state.loaded) {
    actions.renderTimeline();
    return;
  }
  for (const render of registry.renders) render();
}
function refresh() {
  if (runtime.state.loaded) actions.derive();
  redraw();
}

async function useCap(name) {
  try {
    return window.claude?.use ? await window.claude.use(name) : null;
  } catch {
    return null;
  }
}

async function boot() {
  for (const wire of registry.wires) wire();
  actions.renderTimeline();
  const [db, user, sample, downloads] = await Promise.all(
    ["db", "user", "sample", "downloads"].map(useCap),
  );
  runtime.caps.claude = sample;
  runtime.caps.downloads =
    downloads || (!window.claude?.use ? { save: saveBrowserDownload } : null);
  runtime.caps.claudeTools = false;
  if (sample) {
    try {
      const lim = await sample.limits();
      runtime.caps.claudeTools = !!lim?.tools;
    } catch {}
  }
  actions.applyProvider();
  let uid = null;
  if (db && user) {
    try {
      uid = await user.id();
    } catch {}
  }
  let docs = {};
  if (db && uid) {
    try {
      const b = dbBackend(db, uid, toast);
      docs = await b.all();
      actions.Store.backend = b;
    } catch {
      actions.Store.backend = localBackend(localStorage, toast);
      docs = await actions.Store.backend.all();
      toast(
        "Couldn't reach your saved data, so this session saves in the browser.",
      );
    }
  } else docs = await actions.Store.backend.all();
  // Seed only a new demo workspace. Removed demo statements stay removed on reload.
  if (!Object.keys(docs).length) {
    Object.assign(runtime.state, createDemoData());
    for (const key of ["workspace", "rules", "notes", "periods"])
      await actions.Store.backend.put(
        key,
        toDocument(documentFor(key), runtime.state),
      );
    for (const batch of Object.values(runtime.state.batches))
      actions.saveBatch(batch);
  }
  const { invalid, legacyDemo } = loadDocuments(docs, runtime.state);
  // A workspace seeded before `workspace` existed: record it the current way.
  if (legacyDemo) actions.save("workspace");
  if (invalid.length) {
    actions.blockSaves(invalid);
    console.warn("Saved documents that failed their check:", invalid);
    toast(
      `Some saved data couldn't be read (${invalid.join(", ")}), so it was left as it is and not loaded.`,
    );
  }
  actions.applyPanel();
  runtime.state.loaded = true;
  refresh();
  actions.maybeStartTour();
}

boot();
