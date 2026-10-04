import { createBackupImport } from "./ui/backup.js";
import { saveBrowserDownload } from "./downloads.js";
import { createDemoData } from "./demo.js";
import { $, debounce } from "./helpers.js";
import { dbBackend, localBackend } from "./storage.js";
import { toast } from "./ui/dom.js";
import { createRuntime } from "./state.js";
import { deriveTransactions } from "./transactions/derive.js";
import { createPersistence } from "./persistence.js";
import { documentFor, loadDocuments, toDocument } from "./documents.js";
import { createFilter } from "./ui/filter.js";
import { createTimeline } from "./ui/timeline.js";
import { createTags } from "./ui/tags.js";
import { createInspector } from "./ui/inspector.js";
import { createPeriods } from "./ui/periods.js";
import { createQuestions } from "./ui/questions.js";
import { createMonth } from "./ui/month.js";
import { createThreadSummary } from "./ui/thread-summary.js";
import { createReports } from "./ui/reports.js";
import { createThreads } from "./ui/threads.js";
import { createLenses } from "./ui/lenses.js";
import { createChrome } from "./ui/chrome.js";
import { createAssistantSettings } from "./ui/assistant-settings.js";
import { createSuggestions } from "./suggestions.js";
import { createChat } from "./ui/chat.js";
import { createImport } from "./ui/import.js";
import { createTour } from "./ui/tour.js";
import { createLensEditor } from "./ui/lens-editor.js";

const runtime = createRuntime();
const actions = {
  derive() {
    runtime.derived = deriveTransactions(runtime.state);
  },
};

Object.assign(actions, createPersistence(runtime, actions));
Object.assign(actions, createFilter(runtime, actions));
Object.assign(actions, createTimeline(runtime, actions));
Object.assign(actions, createTags(runtime, actions));
Object.assign(actions, createInspector(runtime, actions));
Object.assign(actions, createPeriods(runtime, actions));
Object.assign(actions, createQuestions(runtime, actions));
Object.assign(actions, createMonth(runtime, actions));
Object.assign(actions, createThreadSummary(runtime, actions));
Object.assign(actions, createReports(runtime, actions));
Object.assign(actions, createThreads(runtime, actions));
Object.assign(actions, createLenses(runtime, actions));
Object.assign(actions, createChrome(runtime, actions));
Object.assign(actions, createAssistantSettings(runtime, actions));
Object.assign(actions, createSuggestions(runtime, actions));
Object.assign(actions, createChat(runtime, actions));
Object.assign(actions, createImport(runtime, actions));
Object.assign(actions, createBackupImport(runtime, actions));
Object.assign(actions, createTour(runtime, actions));
Object.assign(actions, createLensEditor(runtime, actions));

function renderAll() {
  if (!runtime.state.loaded) {
    actions.renderTimeline();
    return;
  }
  actions.derive();
  actions.renderChrome();
  actions.renderFilterBar();
  actions.renderParkbar();
  actions.renderQuestions();
  actions.renderMonth();
  if ($("#pane-reports").classList.contains("on")) actions.renderReports();
  actions.renderTimeline();
  actions.renderEditor();
  actions.renderInspector();
  actions.renderLenses();
  actions.renderAskCtx();
  if ($("#pane-ask").classList.contains("on")) actions.renderLog();
  if ($("#pane-reports").classList.contains("on")) actions.renderReports();
}

async function useCap(name) {
  try {
    return window.claude?.use ? await window.claude.use(name) : null;
  } catch {
    return null;
  }
}

async function boot() {
  actions.wireChrome();
  actions.wireBackupImport();
  actions.wireTimeline();
  actions.wireLenses();
  actions.wireLensEditor();
  actions.wireAsk();
  actions.wireConnect();
  actions.wireFilter();
  actions.wireParkbar();
  actions.wireQuestions();
  actions.wireMonth();
  actions.wirePrivacy();
  actions.wireInspector();
  actions.wireReports();
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
  renderAll();
  actions.maybeStartTour();
}

const refreshSoon = debounce(() => {
  actions.derive();
  actions.renderQuestions();
  actions.renderMonth();
  actions.renderFilterBar();
  actions.renderTimeline();
  actions.renderEditor();
  actions.renderLenses();
}, 250);
Object.assign(actions, { refresh: renderAll, renderAll, refreshSoon });

boot();
