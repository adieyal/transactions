import { createBackupImport } from "./ui/backup.js";
import { saveBrowserDownload } from "./downloads.js";
import { createDemoData } from "./demo.js";
import { $, debounce } from "./helpers.js";
import { dbBackend, localBackend } from "./storage.js";
import { toast } from "./ui/dom.js";
import { createRuntime } from "./state.js";
import { deriveTransactions } from "./transactions/derive.js";
import { createPersistence } from "./persistence.js";
import { createFilter } from "./ui/filter.js";
import { createTimeline } from "./ui/timeline.js";
import { createTags } from "./ui/tags.js";
import { createInspector } from "./ui/inspector.js";
import { createPeriods } from "./ui/periods.js";
import { createQuestions } from "./ui/questions.js";
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
    await actions.Store.backend.put("demo", { version: 1 });
    await actions.Store.backend.put("rules", { text: runtime.state.rules });
    await actions.Store.backend.put("notes", { map: runtime.state.notes });
    await actions.Store.backend.put("periods", {
      items: runtime.state.periods,
    });
    for (const batch of Object.values(runtime.state.batches))
      actions.saveBatch(batch);
  }
  if (docs.workspace?.demo !== undefined)
    runtime.state.isDemo = docs.workspace.demo;
  if (docs.rules?.text != null) runtime.state.rules = docs.rules.text;
  if (docs.notes?.map) runtime.state.notes = docs.notes.map;
  if (Array.isArray(docs.lenses?.items))
    runtime.state.lenses = docs.lenses.items;
  if (docs.adapters?.items) runtime.state.adapters = docs.adapters.items;
  if (docs.names?.map) runtime.state.names = docs.names.map;
  if (docs.transfers?.map) runtime.state.transferOv = docs.transfers.map;
  if (docs.dismissed?.map) runtime.state.dismissed = docs.dismissed.map;
  if (Array.isArray(docs.periods?.items))
    runtime.state.periods = docs.periods.items;
  if (Array.isArray(docs.reports?.items))
    runtime.state.reports = docs.reports.items;
  if (docs.answers?.map) runtime.state.answers = docs.answers.map;
  if (docs.merchantAnswers?.map)
    runtime.state.merchantAnswers = docs.merchantAnswers.map;
  if (docs.view) {
    runtime.state.view.parked = Array.isArray(docs.view.parked)
      ? docs.view.parked
      : [];
    runtime.state.view.panel = docs.view.panel !== false;
  }
  if (Array.isArray(docs.chat?.turns)) runtime.state.turns = docs.chat.turns;
  actions.applyPanel();
  const parts = Object.entries(docs)
    .filter(([k]) => k.startsWith("batch_"))
    .map(([, v]) => v)
    .sort((a, b) => a.batchId.localeCompare(b.batchId) || a.part - b.part);
  for (const p of parts) {
    const b = (runtime.state.batches[p.batchId] ||= {
      id: p.batchId,
      kind: p.kind,
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
  runtime.state.loaded = true;
  renderAll();
  actions.maybeStartTour();
}

const refreshSoon = debounce(() => {
  actions.derive();
  actions.renderQuestions();
  actions.renderFilterBar();
  actions.renderTimeline();
  actions.renderEditor();
  actions.renderLenses();
}, 250);
Object.assign(actions, { refresh: renderAll, renderAll, refreshSoon });

boot();
