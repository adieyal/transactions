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
  "defaults.js": "domain",
  "demo.js": "domain",
  "lens-api.js": "domain",
  "documents.js": "persistence",
  "backup.js": "persistence",
  "persistence.js": "persistence",
  "storage.js": "persistence",
  "assistant.js": "platform",
  "downloads.js": "platform",
  "state.js": "app",
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

const LAYER_ALLOW = [
  // R7: persistence.js shows its own toasts; main.js will pass in onError.
  { v: "persistence.js (persistence) imports ui/dom.js (ui)", fix: "R7" },
];

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
const PURE_ALLOW = [
  // R5: `$` moves to ui/dom.js and TODAY is passed in from main.js.
  { v: "helpers.js uses document", fix: "R5" },
  { v: "helpers.js uses new Date()", fix: "R5" },
  // R6: the browser file readers move out to a platform module.
  { v: "transactions/import.js uses window", fix: "R6" },
  { v: "transactions/import.js uses DOMParser", fix: "R6" },
  { v: "transactions/import.js uses XLSX", fix: "R6" },
];

// Only the named adapters may talk to the network or name storage keys (ADR 0007).
const NETWORK =
  /(?<![.\w$])(fetch|XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\b/;
const NETWORK_FILES = ["assistant.js"];
const STORAGE =
  /(?<![.\w$])(localStorage|sessionStorage)\s*(\.\s*(getItem|setItem|removeItem|clear|key)\b|\[)/;
const STORAGE_FILES = ["storage.js"];
const BOUNDARY_ALLOW = [
  // R11: the AI settings and the tour's seen flag move into storage.js.
  { v: "ui/assistant-settings.js uses storage", fix: "R11" },
  { v: "ui/tour.js uses storage", fix: "R11" },
];

// Saved documents (documents.js) that the code does not fully handle yet.
const DOCUMENT_ALLOW = [
  // story-first milestone 1 adds both on its branch; delete these entries
  // when it merges, since the code then covers them.
  {
    v: "answers is missing from: state, boot, save, backup, restore",
    fix: "story-first",
  },
  {
    v: "merchantAnswers is missing from: state, boot, save, backup, restore",
    fix: "story-first",
  },
  // R2: only a backup restore writes `workspace`, and the seed writes `demo`.
  { v: "workspace is missing from: save", fix: "R2" },
  { v: "main.js writes undeclared document demo", fix: "R2" },
];

// Lines per module: warn above SIZE_WARN, fail above SIZE_FAIL.
const SIZE_WARN = 400;
const SIZE_FAIL = 700;
const SIZE_ALLOW = [
  // A ceiling, not a target: these may not grow past it while being split.
  { v: "ui/timeline.js", max: 1000, fix: "R8" },
  { v: "ui/chat.js", max: 800, fix: "R9" },
];

// ---- Reading the source ---------------------------------------------------

function sourceFiles() {
  const files = readdirSync(root).filter((f) => f.endsWith(".js"));
  for (const dir of ["transactions", "story", "ui", "scripts"])
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
    if (!STORAGE_FILES.includes(file) && STORAGE.test(CODE[file]))
      found.push(`${file} uses storage`);
  }
  expectAllowlist("Boundaries", found, BOUNDARY_ALLOW);
});

test("every actions.X call has exactly one provider", async () => {
  // main.js registers the factories; each must build without a DOM and
  // without touching actions, so it can be built here.
  const main = SOURCE["main.js"];
  const registered = [
    ...main.matchAll(
      /Object\.assign\(actions, (create\w+)\(runtime, actions\)\)/g,
    ),
  ].map((m) => m[1]);
  const factoryFile = {};
  for (const [, names, spec] of main.matchAll(
    /import \{([^}]*)\} from "\.\/([^"]+)"/g,
  ))
    for (const n of names.split(",").map((s) => s.trim()))
      if (n.startsWith("create")) factoryFile[n] = spec;

  const declared = FILES.flatMap((f) =>
    [
      ...SOURCE[f].matchAll(/export function (create\w+)\(runtime, actions\)/g),
    ].map((m) => `${m[1]} (${f})`),
  );
  const unregistered = declared.filter(
    (d) => !registered.includes(d.split(" ")[0]),
  );
  assert.deepEqual(unregistered, [], "Register these factories in main.js");

  const { createRuntime } = await import(
    pathToFileURL(path.join(root, "state.js"))
  );
  const saved = globalThis.localStorage;
  globalThis.localStorage = { length: 0, key() {}, getItem() {}, setItem() {} };
  const untouchable = new Proxy(
    {},
    {
      get(_, key) {
        throw new Error(`actions.${String(key)} used while being constructed`);
      },
    },
  );
  const providers = {};
  try {
    for (const name of registered) {
      const mod = await import(
        pathToFileURL(path.join(root, factoryFile[name]))
      );
      const made = mod[name](createRuntime(), untouchable);
      for (const key of Object.keys(made))
        (providers[key] ||= []).push(factoryFile[name]);
    }
  } finally {
    globalThis.localStorage = saved;
  }
  // main.js provides derive() up front and refresh/renderAll/refreshSoon last.
  const own = [
    ...(main.match(/const actions = \{([\s\S]*?)\n\};/)?.[1] || "").matchAll(
      /^ {2}(\w+)\(/gm,
    ),
    ...(
      main.match(/Object\.assign\(actions, \{([^}]*)\}\)/)?.[1] || ""
    ).matchAll(/(\w+)(?=\s*[:,]|\s*$)/g),
  ].map((m) => m[1]);
  for (const key of new Set(own)) (providers[key] ||= []).push("main.js");

  const duplicates = Object.entries(providers)
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => `${key}: ${files.join(", ")}`);
  assert.deepEqual(
    duplicates,
    [],
    "Each actions function needs a single provider",
  );

  const missing = [];
  for (const file of FILES)
    for (const m of CODE[file].matchAll(
      /(?<![\w$.])actions\.([A-Za-z_$][\w$]*)/g,
    ))
      if (!providers[m[1]])
        missing.push(`${file}:${lineOf(CODE[file], m.index)} actions.${m[1]}`);
  assert.deepEqual(missing, [], "No module provides these actions functions");
});

test("saved documents match documents.js in boot, saving and backups", async () => {
  const { DOCUMENTS, BATCH_PREFIX } = await import(
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

  // Keys written (saveSoon / backend.put) and read at boot, with the wrapper
  // property they use, e.g. saveSoon("notes", () => ({ map: … })).
  const writes = [];
  for (const file of FILES.filter((f) => f !== "backup.js"))
    for (const m of SOURCE[file].matchAll(
      /(?:saveSoon|backend\.put)\(\s*"(\w+)",\s*(?:\(\)\s*=>\s*\(?)?\{\s*(\w+)/g,
    ))
      writes.push({ file, key: m[1], wrap: m[2] });
  const reads = [
    ...SOURCE["main.js"].matchAll(/\bdocs\.(\w+)(?:\?\.|\.)(\w+)/g),
  ].map((m) => ({ key: m[1], wrap: m[2] }));
  for (const w of writes)
    if (!keys.has(w.key))
      found.push(`${w.file} writes undeclared document ${w.key}`);
  for (const r of reads)
    if (!keys.has(r.key))
      found.push(`main.js reads undeclared document ${r.key}`);

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

  const fresh = createRuntime().state;
  for (const d of DOCUMENTS) {
    const gaps = [];
    if (!(d.field in fresh)) gaps.push("state");
    const read = reads.filter((r) => r.key === d.key);
    if (!read.length) gaps.push("boot");
    if (!writes.some((w) => w.key === d.key)) gaps.push("save");
    if (d.backup && (!(d.backup in backup) || !(d.field in parsed)))
      gaps.push("backup");
    if (!(d.key in stored)) gaps.push("restore");
    if (gaps.length) found.push(`${d.key} is missing from: ${gaps.join(", ")}`);

    // Every writer and reader uses the declared wrapper.
    if (d.wrap !== "self") {
      for (const w of writes.filter(
        (w) => w.key === d.key && w.wrap !== d.wrap,
      ))
        found.push(`${w.file} saves ${d.key} as {${w.wrap}}, not {${d.wrap}}`);
      for (const r of read.filter((r) => r.wrap !== d.wrap))
        found.push(`main.js reads ${d.key}.${r.wrap}, not ${d.key}.${d.wrap}`);
      if (d.key in stored && !(d.wrap in stored[d.key]))
        found.push(`backup.js restores ${d.key} without {${d.wrap}}`);
    }
  }
  expectAllowlist("Saved documents", found, DOCUMENT_ALLOW);
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
  ]
    .filter((a) => a.fix !== "story-first" && !steps.has(a.fix))
    .map((a) => `${a.v} -> ${a.fix}`);
  assert.deepEqual(unknown, []);
});
