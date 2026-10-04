import { createBackupImport } from "./ui/backup.js";
import { saveBrowserDownload } from "./downloads.js";
import { createDemoData } from "./demo.js";
import { debounce } from "./helpers.js";
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

// Each factory's functions join actions; the renders it lists are called,
// in registration order, by every refresh. A render returns early when its
// pane is hidden, so this order is also the order on screen updates.
const renders = [];
function register({ renders: own = [], ...provided }) {
  Object.assign(actions, provided);
  renders.push(...own);
}

register(createPersistence(runtime, actions));
register(createChrome(runtime, actions));
register(createFilter(runtime, actions));
register(createTimeline(runtime, actions));
register(createTags(runtime, actions));
register(createQuestions(runtime, actions));
register(createMonth(runtime, actions));
register(createReports(runtime, actions));
register(createThreads(runtime, actions));
register(createInspector(runtime, actions));
register(createPeriods(runtime, actions));
register(createThreadSummary(runtime, actions));
register(createLenses(runtime, actions));
register(createAssistantSettings(runtime, actions));
register(createSuggestions(runtime, actions));
register(createChat(runtime, actions));
register(createImport(runtime, actions));
register(createBackupImport(runtime, actions));
register(createTour(runtime, actions));
register(createLensEditor(runtime, actions));

// The one way the screen catches up with state: re-derive, then every
// registered render. redraw() skips deriving, for a change of tab or layout.
function redraw() {
  if (!runtime.state.loaded) {
    actions.renderTimeline();
    return;
  }
  for (const render of renders) render();
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
  refresh();
  actions.maybeStartTour();
}

const refreshSoon = debounce(refresh, 250);
Object.assign(actions, { redraw, refresh, refreshSoon });

boot();
