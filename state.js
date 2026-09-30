import { STARTER_RULES, STARTER_LENSES } from "./defaults.js";

export function createRuntime() {
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
    storyEdit: null,
    reports: [],
    budgetDrag: null,
    hiddenAccounts: new Set(),
    query: "",
    view: { parked: [], panel: true, showParked: false },
    range: "all",
    selection: new Set(),
    highlight: new Set(),
    statement: null,
    turns: [],
    editing: new Set(),
  };
  const caps = {
    sample: null,
    claude: null,
    tools: false,
    claudeTools: false,
    downloads: null,
  };
  return { state, caps, derived: null };
}
