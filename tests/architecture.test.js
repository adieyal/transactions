// Architecture guardrails: docs/architecture.md and docs/adr/ describe the rules.
// A rule the current code breaks gets an allowlist entry naming the step in
// docs/architecture.md ("Getting there") that removes it. Allowlists are
// exact: an entry that no longer matches fails too, so it gets deleted with
// the violation. Never widen a rule to make a test pass.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// ---- Layers ---------------------------------------------------------------

// Every application file has a layer. Imports may only point to the same or a
// lower rank. `entry` (main.js) is the composition root and may import
// anything; nothing imports it. Prefixes ending in "/" cover a folder.
const LAYERS = {
  "helpers.js": "core",
  "transactions/": "domain",
  "story/": "domain",
  "assistant/": "domain",
  "defaults.js": "domain",
  "demo.js": "domain",
  "lens-api.js": "domain",
  "documents.js": "persistence",
  "backup.js": "persistence",
  "persistence.js": "persistence",
  "storage.js": "persistence",
  "assistant.js": "platform",
  "downloads.js": "platform",
  "files.js": "platform",
  "state.js": "app",
  "registry.js": "app",
  // A UI factory at the root until R4 splits its prompts from its handlers.
  "suggestions.js": "ui",
  "ui/": "ui",
  "main.js": "entry",
  "scripts/": "build",
};
const RANK = {
  core: 0,
  domain: 1,
  persistence: 2,
  platform: 2,
  app: 3,
  ui: 4,
  entry: 5,
};
const PURE = new Set(["core", "domain"]);

// The largest group of modules that all reach each other through actions
// (review finding 1). It may only shrink: lower this when it does.
const CYCLE_MAX = 12;

const LAYER_ALLOW = [];

// No document, window, storage, network, DOM parsing or ambient clock in the
// pure layers. Matched outside strings, comments and regular expressions.
const IMPURE = [
  ["document", /(?<![.\w$])document\b/],
  ["window", /(?<![.\w$])window\b/],
  ["localStorage", /(?<![.\w$])(localStorage|sessionStorage|indexedDB)\b/],
  ["fetch", /(?<![.\w$])(fetch|XMLHttpRequest|WebSocket|EventSource)\b/],
  ["DOMParser", /(?<![.\w$])DOMParser\b/],
  ["navigator", /(?<![.\w$])navigator\b/],
  ["XLSX", /(?<![.\w$])XLSX\b/],
  ["$(", /(?<![\w$])\$\(/],
  ["innerHTML", /\binnerHTML\b/],
  ["new Date()", /\bnew Date\(\s*\)/],
  ["Date.now()", /\bDate\.now\(/],
];
const PURE_ALLOW = [];

// Only the named adapters may talk to the network or name storage keys (ADR 0007).
const NETWORK =
  /(?<![.\w$])(fetch|XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\b/;
const NETWORK_FILES = ["assistant.js"];
// Adding a <script> fetches code: only files.js may, to load SheetJS when a
// spreadsheet is chosen (ADR 0007).
const SCRIPT_LOAD = /createElement\(\s*["']script["']\s*\)/;
const SCRIPT_FILES = ["files.js"];
const STORAGE =
  /(?<![.\w$])(localStorage|sessionStorage)\s*(\.\s*(getItem|setItem|removeItem|clear|key)\b|\[)/;
const STORAGE_FILES = ["storage.js"];
const BOUNDARY_ALLOW = [];

// Saved documents (documents.js) that the code does not fully handle yet.
const DOCUMENT_ALLOW = [];

// UI modules that still set innerHTML from a plain template literal. New
// markup uses the escaping html tag from ui/dom.js (ADR 0005).
const HTML_ALLOW = [
  // R10: converted module by module as each is next touched.
  { v: "ui/chat.js sets innerHTML from a plain template", fix: "R10" },
  { v: "ui/import.js sets innerHTML from a plain template", fix: "R10" },
  { v: "ui/inspector.js sets innerHTML from a plain template", fix: "R10" },
  { v: "ui/lens-editor.js sets innerHTML from a plain template", fix: "R10" },
  { v: "ui/periods.js sets innerHTML from a plain template", fix: "R10" },
  { v: "ui/questions.js sets innerHTML from a plain template", fix: "R10" },
  {
    v: "ui/thread-summary.js sets innerHTML from a plain template",
    fix: "R10",
  },
  { v: "ui/tour.js sets innerHTML from a plain template", fix: "R10" },
];

// Lines per module: warn above SIZE_WARN, fail above SIZE_FAIL.
const SIZE_WARN = 400;
const SIZE_FAIL = 700;
const SIZE_ALLOW = [
  // A ceiling, not a target: these may not grow past it while being split.
];

// ---- Reading the source ---------------------------------------------------

function sourceFiles() {
  const files = readdirSync(root).filter((f) => f.endsWith(".js"));
  for (const dir of ["transactions", "story", "assistant", "ui", "scripts"])
    if (existsSync(path.join(root, dir)))
      for (const f of readdirSync(path.join(root, dir)))
        if (/\.m?js$/.test(f)) files.push(`${dir}/${f}`);
  return files.sort();
}
const FILES = sourceFiles();
const read = (f) => readFileSync(path.join(root, f), "utf8");
const SOURCE = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const CODE = Object.fromEntries(
  FILES.map((f) => [f, stripLiterals(SOURCE[f])]),
);

function layerOf(file) {
  const key = Object.keys(LAYERS)
    .filter((k) => (k.endsWith("/") ? file.startsWith(k) : file === k))
    .sort((a, b) => b.length - a.length)[0];
  return key && LAYERS[key];
}

// Blanks out comments, string and template text and regex literals, keeping
// line breaks and `${…}` expressions, so rules match only real code.
function stripLiterals(src) {
  let out = "";
  let i = 0;
  const templates = []; // brace depth at each open `${`
  let depth = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const regexCanStart = () => {
    const before = out.replace(/\s+$/, "");
    if (!before) return true;
    if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(before)) return true;
    return /\b(return|typeof|case|in|of|void|delete|new|else|do|yield|await)$/.test(
      before,
    );
  };
  const template = () => {
    // at the character after ` or after the } closing a ${…}
    let start = i;
    while (i < src.length) {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "`") {
        out += blank(src.slice(start, i)) + "`";
        i++;
        return;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        out += blank(src.slice(start, i)) + "${";
        i += 2;
        templates.push(depth);
        depth++;
        return;
      } else i++;
    }
    out += blank(src.slice(start));
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i);
      const j = end < 0 ? src.length : end;
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const j = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, j));
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n")
        j += src[j] === "\\" ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + c;
      i = j + 1;
    } else if (c === "`") {
      out += "`";
      i++;
      template();
    } else if (c === "/" && regexCanStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      if (src[j] !== "/") {
        out += c; // a division after all
        i++;
        continue;
      }
      j++;
      while (/[a-z]/i.test(src[j] || "")) j++;
      out += "/" + blank(src.slice(i + 1, j - 1)) + "/";
      i = j;
    } else if (c === "{") {
      depth++;
      out += c;
      i++;
    } else if (c === "}") {
      depth--;
      out += c;
      i++;
      if (templates.length && depth === templates.at(-1)) {
        templates.pop();
        template();
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function importsOf(file) {
  const src = SOURCE[file];
  const specs = [
    ...src.matchAll(
      /^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm,
    ),
    ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1] || m[2]);
  return specs.map((s) =>
    s.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), s))
      : `package:${s}`,
  );
}
const GRAPH = Object.fromEntries(FILES.map((f) => [f, importsOf(f)]));

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function expectAllowlist(name, found, allow) {
  const listed = allow.map((a) => a.v);
  const unexpected = [...new Set(found)].filter((v) => !listed.includes(v));
  const stale = listed.filter((v) => !found.includes(v));
  assert.deepEqual(
    { unexpected, stale },
    { unexpected: [], stale: [] },
    `${name}: fix each "unexpected" violation (see docs/architecture.md), ` +
      `and delete each "stale" allowlist entry, since that violation is gone.`,
  );
}

// ---- Rules ----------------------------------------------------------------

test("every application file has a layer", () => {
  const missing = FILES.filter((f) => !layerOf(f));
  assert.deepEqual(
    missing,
    [],
    "Add these files to LAYERS in tests/architecture.test.js (docs/architecture.md section 1)",
  );
});

test("imports point only to the same or a lower layer", () => {
  const found = [];
  for (const [file, deps] of Object.entries(GRAPH)) {
    const from = layerOf(file);
    for (const dep of deps) {
      if (dep.startsWith("package:")) {
        if (from !== "ui" && from !== "build")
          found.push(`${file} (${from}) imports ${dep}`);
        continue;
      }
      const to = layerOf(dep);
      if (from === "build" || to === "build" || to === "entry") {
        if (from !== to) found.push(`${file} (${from}) imports ${dep} (${to})`);
        continue;
      }
      if (RANK[from] < RANK[to])
        found.push(`${file} (${from}) imports ${dep} (${to})`);
    }
  }
  expectAllowlist("Layering", found, LAYER_ALLOW);
});

test("UI factories reach each other only through actions, never by import", () => {
  const isFactory = (f) =>
    layerOf(f) === "ui" && /export function create\w+\(/.test(SOURCE[f] || "");
  const found = [];
  for (const [file, deps] of Object.entries(GRAPH))
    for (const dep of deps)
      if (file !== "main.js" && isFactory(dep))
        found.push(`${file} imports the UI factory ${dep}`);
  assert.deepEqual(found, []);
});

test("there are no import cycles", () => {
  const cycles = [];
  const state = {};
  const stack = [];
  const visit = (f) => {
    state[f] = "open";
    stack.push(f);
    for (const d of GRAPH[f] || []) {
      if (state[d] === "open")
        cycles.push([...stack.slice(stack.indexOf(d)), d].join(" -> "));
      else if (!state[d] && GRAPH[d]) visit(d);
    }
    stack.pop();
    state[f] = "done";
  };
  for (const f of FILES) if (!state[f]) visit(f);
  assert.deepEqual(cycles, []);
});

test("the pure layers use no DOM, storage, network or ambient clock", () => {
  const found = [];
  for (const file of FILES.filter((f) => PURE.has(layerOf(f))))
    for (const [name, re] of IMPURE)
      if (re.test(CODE[file])) found.push(`${file} uses ${name}`);
  expectAllowlist("Purity", found, PURE_ALLOW);
});

test("only the named adapters use the network or browser storage", () => {
  const found = [];
  for (const file of FILES) {
    if (!NETWORK_FILES.includes(file) && NETWORK.test(CODE[file]))
      found.push(`${file} uses the network`);
    if (!SCRIPT_FILES.includes(file) && SCRIPT_LOAD.test(SOURCE[file]))
      found.push(`${file} loads a script`);
    if (!STORAGE_FILES.includes(file) && STORAGE.test(CODE[file]))
      found.push(`${file} uses storage`);
  }
  expectAllowlist("Boundaries", found, BOUNDARY_ALLOW);
});

test("modules declare what they provide and require, and each requirement has one provider", async (t) => {
  // Every module with a contract is registered in main.js.
  const main = SOURCE["main.js"];
  const registered = Object.fromEntries(
    [
      ...main.matchAll(/import \{ contract as (\w+) \} from "\.\/([^"]+)"/g),
    ].map((m) => [m[2], m[1]]),
  );
  const withContract = FILES.filter((f) =>
    /^export const contract = \{/m.test(SOURCE[f]),
  );
  assert.deepEqual(
    withContract.filter((f) => !registered[f]),
    [],
    "Register these modules in main.js",
  );
  const order = [
    ...(main.match(/const MODULES = \[([^\]]*)\]/)?.[1] || "").matchAll(/\w+/g),
  ].map((m) => m[0]);
  const fileOf = Object.fromEntries(
    Object.entries(registered).map(([f, n]) => [n, f]),
  );
  assert.deepEqual(
    [...order].sort(),
    Object.values(registered).sort(),
    "MODULES lists every imported contract once",
  );

  const { createRuntime } = await import(
    pathToFileURL(path.join(root, "state.js"))
  );
  const { createRegistry } = await import(
    pathToFileURL(path.join(root, "registry.js"))
  );
  const saved = globalThis.localStorage;
  globalThis.localStorage = { length: 0, key() {}, getItem() {}, setItem() {} };
  const contracts = [];
  try {
    for (const name of order)
      contracts.push(
        (await import(pathToFileURL(path.join(root, fileOf[name])))).contract,
      );
    // Factories do nothing with actions while being built.
    const untouchable = new Proxy(
      {},
      {
        get(_, key) {
          throw new Error(
            `actions.${String(key)} used while being constructed`,
          );
        },
      },
    );
    for (const c of contracts) c.create(createRuntime(), untouchable);
    // The registry itself: one provider for every name, provides as declared.
    const own = Object.fromEntries(
      [
        ...(
          main.match(
            /createRegistry\(runtime, MODULES, \{([\s\S]*?)\n\}\);/,
          )?.[1] || ""
        ).matchAll(/^ {2}(\w+)/gm),
      ].map((m) => [m[1], () => {}]),
    );
    createRegistry(createRuntime(), contracts, own);
  } finally {
    globalThis.localStorage = saved;
  }

  // Each module uses exactly the actions it requires: its own code, plus the
  // view helpers it hands its actions to.
  const helpers = FILES.filter(
    (f) =>
      f.startsWith("ui/") &&
      !withContract.includes(f) &&
      /\bactions\./.test(CODE[f]),
  );
  const used = (file) => {
    let code = CODE[file];
    for (const h of helpers) {
      const fn = [
        ...CODE[h].matchAll(/export function (\w+)\([^)]*\bactions\b/g),
      ].map((m) => m[1]);
      if (fn.some((n) => new RegExp(`\\b${n}\\(`).test(code))) code += CODE[h];
    }
    return new Set(
      [...code.matchAll(/(?<![\w$.])actions\.([A-Za-z_$][\w$]*)/g)].map(
        (m) => m[1],
      ),
    );
  };
  const wrong = [];
  const providerOf = {};
  for (const c of contracts) for (const k of c.provides) providerOf[k] = c.name;
  for (const c of contracts) {
    const file = fileOf[order[contracts.indexOf(c)]];
    const uses = used(file);
    for (const k of uses)
      if (!c.requires.includes(k))
        wrong.push(`${file} uses actions.${k} without requiring it`);
    for (const k of c.requires)
      if (!uses.has(k)) wrong.push(`${file} requires ${k} but doesn't use it`);
  }
  assert.deepEqual(
    wrong,
    [],
    "Keep each contract's requires in step with its code",
  );

  // The largest cycle of modules reaching each other through actions.
  const edges = Object.fromEntries(
    contracts.map((c) => [
      c.name,
      [...new Set(c.requires.map((k) => providerOf[k]).filter(Boolean))],
    ]),
  );
  const reach = (from) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length)
      for (const n of edges[stack.pop()] || [])
        if (!seen.has(n)) seen.add(n) && stack.push(n);
    return seen;
  };
  const reaches = Object.fromEntries(
    contracts.map((c) => [c.name, reach(c.name)]),
  );
  const largest = Math.max(
    ...contracts.map(
      (c) =>
        contracts.filter(
          (o) => reaches[c.name].has(o.name) && reaches[o.name].has(c.name),
        ).length,
    ),
  );
  t.diagnostic(`largest cycle of modules: ${largest} of ${contracts.length}`);
  assert.ok(
    largest <= CYCLE_MAX,
    `The largest cycle grew to ${largest} modules (cap ${CYCLE_MAX}); call through fewer modules`,
  );
});

test("saved documents match documents.js in boot, saving and backups", async () => {
  const { DOCUMENTS, BATCH_PREFIX, loadDocuments, toDocument } = await import(
    pathToFileURL(path.join(root, "documents.js"))
  );
  const { createRuntime } = await import(
    pathToFileURL(path.join(root, "state.js"))
  );
  const { createDemoData } = await import(
    pathToFileURL(path.join(root, "demo.js"))
  );
  const backupModule = await import(
    pathToFileURL(path.join(root, "backup.js"))
  );
  const keys = new Set(DOCUMENTS.map((d) => d.key));
  const found = [];

  // Saving goes through actions.save(key), which builds the document from
  // DOCUMENTS. Only persistence.js debounces writes, and nothing writes a
  // literal key to a backend, so no module can save a shape of its own.
  for (const file of FILES) {
    const code = CODE[file];
    if (file !== "persistence.js" && /\bsaveSoon\(/.test(code))
      found.push(`${file} calls saveSoon instead of actions.save(key)`);
    for (const m of SOURCE[file].matchAll(/backend\.put\(\s*"(\w+)"/g))
      found.push(`${file} writes the document ${m[1]} by hand`);
    for (const m of SOURCE[file].matchAll(/\bsave\(((?:\s*"\w+",?)+)\s*\)/g))
      for (const [, key] of m[1].matchAll(/"(\w+)"/g))
        if (!keys.has(key))
          found.push(`${file} saves undeclared document ${key}`);
  }
  // Boot reads every document through loadDocuments, never field by field.
  if (!/\bloadDocuments\(/.test(CODE["main.js"]))
    found.push("main.js doesn't load saved documents with loadDocuments");
  if (/\bdocs\.\w+/.test(CODE["main.js"]))
    found.push("main.js reads a saved document by hand");

  // A demo workspace taken through createBackup, parseBackup and a restore.
  const state = Object.assign(
    createRuntime().state,
    createDemoData("2026-09-30"),
  );
  const backup = backupModule.createBackup(state);
  const parsed = backupModule.parseBackup(JSON.stringify(backup));
  const stored = {};
  await backupModule.restoreBackupDocuments(
    {
      all: async () => JSON.parse(JSON.stringify(stored)),
      put: async (k, v) => void (stored[k] = JSON.parse(JSON.stringify(v))),
      del: async (k) => void delete stored[k],
    },
    parsed,
  );
  for (const k of Object.keys(stored))
    if (!keys.has(k) && !k.startsWith(BATCH_PREFIX))
      found.push(`backup.js writes undeclared document ${k}`);

  // Every entry has a state field, survives saving and loading at boot, and
  // goes through backups and restores in its declared wrapper.
  const fresh = createRuntime().state;
  const reloaded = createRuntime().state;
  const { invalid } = loadDocuments(
    JSON.parse(
      JSON.stringify(
        Object.fromEntries(DOCUMENTS.map((d) => [d.key, toDocument(d, state)])),
      ),
    ),
    reloaded,
  );
  for (const d of DOCUMENTS) {
    const gaps = [];
    if (!(d.field in fresh)) gaps.push("state");
    if (invalid.includes(d.key)) gaps.push("boot");
    if (d.backup && (!(d.backup in backup) || !(d.field in parsed)))
      gaps.push("backup");
    if (!(d.key in stored)) gaps.push("restore");
    if (gaps.length) found.push(`${d.key} is missing from: ${gaps.join(", ")}`);
    if (d.wrap !== "self" && d.key in stored && !(d.wrap in stored[d.key]))
      found.push(`backup.js restores ${d.key} without {${d.wrap}}`);
  }
  expectAllowlist("Saved documents", found, DOCUMENT_ALLOW);
});

test("UI markup goes through the escaping html tag", () => {
  // Each statement that sets innerHTML: an html-tagged template leaves one
  // backtick once its opening "html`" is taken out, a plain template two.
  const found = [];
  for (const file of FILES.filter((f) => layerOf(f) === "ui")) {
    const src = SOURCE[file];
    for (const m of src.matchAll(/\.innerHTML\s*\+?=/g)) {
      const end = src.indexOf(";\n", m.index);
      const stmt = src.slice(m.index, end < 0 ? undefined : end);
      const tagged = (stmt.match(/\bhtml`/g) || []).length;
      const ticks = (stmt.replace(/\bhtml`/g, "").match(/`/g) || []).length;
      if (ticks - tagged > 0) {
        found.push(`${file} sets innerHTML from a plain template`);
        break;
      }
    }
  }
  expectAllowlist("Markup", found, HTML_ALLOW);
});

test("modules stay within their size budget", (t) => {
  const found = [];
  for (const file of FILES) {
    const lines = SOURCE[file].split("\n").length;
    const allowed = SIZE_ALLOW.find((a) => a.v === file);
    if (lines > SIZE_FAIL) {
      found.push(file);
      if (allowed)
        assert.ok(
          lines <= allowed.max,
          `${file} has ${lines} lines, over its ceiling of ${allowed.max}; split it (${allowed.fix})`,
        );
    } else if (lines > SIZE_WARN)
      t.diagnostic(`${file} has ${lines} lines (warning above ${SIZE_WARN})`);
  }
  expectAllowlist("Size", found, SIZE_ALLOW);
});

test("every allowlist entry names a step that exists", () => {
  const plan = readFileSync(path.join(root, "docs/architecture.md"), "utf8");
  const steps = new Set(
    [...plan.matchAll(/^\| (R\d+) +\|/gm)].map((m) => m[1]),
  );
  const unknown = [
    ...LAYER_ALLOW,
    ...PURE_ALLOW,
    ...BOUNDARY_ALLOW,
    ...DOCUMENT_ALLOW,
    ...SIZE_ALLOW,
    ...HTML_ALLOW,
  ]
    .filter((a) => a.fix !== "story-first" && !steps.has(a.fix))
    .map((a) => `${a.v} -> ${a.fix}`);
  assert.deepEqual(unknown, []);
});

test("every ADR is linked from docs/architecture.md", () => {
  const plan = read("docs/architecture.md");
  const missing = readdirSync(path.join(root, "docs/adr"))
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .filter((f) => !plan.includes(`adr/${f}`));
  assert.deepEqual(missing, []);
  assert.ok(plan.includes("`story/currency.js`"));
});
