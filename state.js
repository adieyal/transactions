import { STARTER_RULES, STARTER_LENSES } from "./defaults.js";
import { createStore } from "./store.js";

// today: the date, read once when the app starts (main.js), and passed to
// everything that needs it.
export function createRuntime({ today = null } = {}) {
  const state = {
    loaded: false,
    isDemo: true,
    batches: {},
    rules: STARTER_RULES,
    previewRules: null,
    previewSummary: "",
    notes: {},
    lenses: STARTER_LENSES.map((l) => ({ ...l })),
    adapters: {},
    names: {},
    transferOv: {},
    dismissed: {},
    periods: [],
    periodSel: null,
    monthView: null,
    periodRegular: false,
    threadSel: null,
    storyEdit: null,
    reports: [],
    answers: {},
    merchantAnswers: {},
    budgetDrag: null,
    hiddenAccounts: new Set(),
    query: "",
    view: { parked: [], panel: true, showParked: false },
    range: "all",
    // The header's Year/Month switch and Numbers toggle (canvas M1).
    scale: null,
    numbers: false,
    selection: new Set(),
    highlight: new Set(),
    statement: null,
    turns: [],
  };
  const caps = {
    sample: null,
    claude: null,
    tools: false,
    claudeTools: false,
    downloads: null,
  };
  const runtime = { state, caps, derived: null, today };
  runtime.store = createStore(runtime);
  return runtime;
}
