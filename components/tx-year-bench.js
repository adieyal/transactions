import { esc, fmt, normText } from "../helpers.js";
import { coveredMonths } from "../story/moment-kit.js";
import { dayLong, exactMoney, monthLong, plain } from "../story/copy.js";
import { manyStory, oneStory } from "../story/bench.js";
import { addToThread } from "../transactions/rules-edit.js";
import { parseTags } from "../transactions/tags.js";
import { lensViewClick, lensViewHTML } from "./tx-year-lens.js";

// The bench (artboard 3's aside, "Details and tools"; Copy rules s9):
// Details for one bead or several, the thread rules, and the lenses. Its
// state lives in tx-year's `ui`; benchHTML draws it and benchClick and
// benchInput act on it. Editing the rules as text, and everything else the
// old panel did, stays under More → Timeline and panels.

const EMPTY = `<div class="bn-empty">
  <p class="bn-lead">Nothing selected.</p>
  <p>Click a bead to see where it came from and add a note. Shift-click to add more, or drag across the timeline to gather several, then make them a thread or a period, tag them, or have them told as a story.</p>
  <p>Threads holds the rules that sort payments onto wires. Lenses are small programs that turn your payments into a chart or a table.</p>
</div>`;

export const selectedIds = (runtime) =>
  [...runtime.state.selection].filter((id) => runtime.derived.byId.has(id));

function tabs(on) {
  const tab = (k, label) =>
    `<button role="tab" class="bn-tab" data-bench-tab="${k}" aria-selected="${on === k}">${label}</button>`;
  return `<div role="tablist" aria-label="Bench" class="bn-tabs">${tab("details", "Details")}${tab("threads", "Threads")}${tab("lenses", "Lenses")}</div>`;
}

function tagRow(ui, n) {
  if (!ui.tagging) return "";
  return `<div class="bn-tagrow"><input id="bench-tag" placeholder="#tag" aria-label="Tags to add${n > 1 ? ` to ${n} payments` : ""}" value="${esc(ui.tag)}"><button class="bn-small" data-bench-tag-add>Add</button></div>`;
}

function oneHTML(ui, runtime, t) {
  const { state, derived } = runtime;
  const rules = (state.previewRules ?? state.rules).split("\n");
  const thread = derived.R.threads.find((x) => x.name === t.thread);
  const caught =
    t.matchLine != null
      ? `caught by line ${t.matchLine + 1} “${rules[t.matchLine]?.trim() ?? ""}”`
      : "no rule caught it yet";
  const label =
    t.kind === "ghost" ? "Expected" : t.amount < 0 ? "Refunded" : "Charged";
  const source = t.derivedFrom
    ? `Worked out from the ${t.account} ${monthLong(t.derivedFrom.period)} statement`
    : t.kind === "ghost"
      ? "Projected from what repeats on your statements"
      : `${t.account}${t.period ? `, ${monthLong(t.period)} statement` : ""}`;
  const editable = t.kind === "actual";
  const months = coveredMonths(derived).length;
  return `<div class="bn-one">
    <h2 class="bn-h2" dir="auto">${esc(plain(t.merchant))}</h2>
    <p class="bn-story" dir="auto">${esc(plain(oneStory(t, derived.txns, months)))}</p>
    <label for="one-name" class="bn-label">Name</label>
    <input id="one-name" class="bn-input" dir="auto" value="${esc(t.merchant)}" data-name-key="${esc(t.nameKey || normText(t.original || t.merchant))}" data-original="${esc(t.original || t.merchant)}">
    <p class="bn-fine" dir="auto">On the statement: ${esc(t.original || t.merchant)}</p>
    <dl class="bn-dl">
      <dt>${label}</dt><dd>${t.kind === "ghost" ? "about " : ""}${esc(fmt(Math.abs(t.amount), 2, t.currency))}</dd>
      <dt>Date</dt><dd>${esc(dayLong(t.date))}</dd>
      ${
        t.transfer
          ? `<dt>Transfer</dt><dd>Between your accounts, so not counted as spending.</dd>`
          : `<dt>Thread</dt><dd><span class="bn-thread" style="color:${esc(thread?.color ?? "var(--ink-body)")}" dir="auto">${esc(t.thread)}</span>, <button class="bn-caught" data-bench-line="${esc(t.matchLine ?? "")}">${esc(caught)}</button></dd>`
      }
      <dt>Source</dt><dd dir="auto">${esc(source)}</dd>
    </dl>
    ${
      editable
        ? `<label for="one-note" class="bn-notelabel">Your note</label>
    <textarea id="one-note" class="bn-note" dir="auto" data-id="${esc(t.id)}" placeholder="What was it for? Any #tag you write can be caught by a thread.">${esc(state.notes[t.id] ?? "")}</textarea>
    <div class="bn-row"><button class="bn-small" data-bench-tag>Add a tag</button><button class="bn-small" data-bench-transfer="${esc(t.id)}">${t.transfer ? "Not a transfer" : "This is a transfer between my accounts"}</button></div>
    ${tagRow(ui, 1)}`
        : ""
    }
  </div>`;
}

function manyHTML(ui, runtime, ts) {
  const m = manyStory(ts, runtime.state.periods);
  return `<div class="bn-many">
    <h2 class="bn-h2">${esc(m.title)}</h2>
    <p class="bn-sub">${esc(plain(m.sub))}</p>
    <p class="bn-merchants" dir="auto">${esc(plain(m.merchants))}</p>
    <label for="many-name" class="bn-label">Name</label>
    <input id="many-name" class="bn-input" dir="auto" value="${esc(ui.manyName)}" placeholder="For a new thread or a period">
    <div class="bn-row bn-acts"><button class="bn-dark" data-bench-thread>Thread these</button><button class="bn-small" data-bench-period>Mark as a period</button><button class="bn-small" data-bench-clear>Clear</button></div>
    <div class="bn-row bn-tags"><button class="bn-small" data-bench-tag>Add a tag to ${ts.length}</button>${m.tags.map((g) => `<span class="bn-tagchip" dir="auto">${esc(g)}</span>`).join("")}</div>
    ${ui.manyMsg ? `<p role="status" class="bn-msg">${esc(ui.manyMsg)}</p>` : ""}
    ${tagRow(ui, ts.length)}
    <div class="bn-tell">
      <div class="bn-row"><button class="bn-small" data-bench-tell>Tell these as a story</button><button class="bn-small" data-bench-ask>Ask about these</button></div>
      ${ui.told ? `<div class="bn-told"><p dir="auto">${esc(plain(m.told))}</p><button class="bn-small" data-bench-save-told${ui.toldSaved ? " disabled" : ""}>${ui.toldSaved ? "Saved to your stories" : "Save as a story"}</button></div>` : ""}
    </div>
  </div>`;
}

// The rules, a line at a time: a thread's total in its gutter, and how many
// payments each pattern catches.
function threadsHTML(ui, runtime) {
  const { state, derived } = runtime;
  const lines = (state.previewRules ?? state.rules).split("\n");
  const totals = new Map();
  for (const t of derived.txns)
    if (t.kind === "actual" && !t.transfer && t.amount > 0)
      totals.set(t.thread, (totals.get(t.thread) ?? 0) + t.amount);
  const short = (v, c) =>
    v >= 1000
      ? exactMoney(v / 1000, c).replace(/(\.\d)\d$/, "$1") + "k"
      : exactMoney(Math.round(v), c);
  const cur = derived.txns.find((t) => t.kind === "actual")?.currency;
  const rows = lines
    .map((ln, i) => {
      const text = ln.trim();
      if (!text) return `<div class="bn-line blank" aria-hidden="true"></div>`;
      if (text.startsWith("//") || text.startsWith("#!"))
        return `<div class="bn-line comment"><span class="bn-gutter"></span><span>${esc(text)}</span></div>`;
      const head = !/^\s/.test(ln);
      const name = text.replace(/\s*\[.*\]\s*$/, "");
      const thread = head && derived.R.threads.find((x) => x.name === name);
      const gutter = head
        ? totals.get(name)
          ? short(totals.get(name), cur)
          : ""
        : String(derived.lineHits[i]?.length ?? 0);
      const ids = lineIds(ln, i, derived);
      return `<button class="bn-line${head ? " head" : ""}${ui.activeLine === i ? " on" : ""}" data-rule-line="${i}"${ids.length ? ` data-ref="hover" data-ids="${esc(ids.join(","))}"` : ""}><span class="bn-gutter">${esc(gutter)}</span><span dir="auto"${thread ? ` style="color:${esc(thread.color)}"` : ""}>${esc(text)}</span></button>`;
    })
    .join("");
  return `<p class="bn-p">Each thread is a wire on the timeline. Type a name, then indented bits of merchant names, #tags from your notes, or /patterns/. Put the cursor on a line to see what it catches.</p>
    <div class="bn-rules">${rows}</div>
    <p class="bn-fine top">Saved in this browser only. First matching thread wins.</p>`;
}

function lensesHTML(ui, runtime) {
  const cards = runtime.state.lenses
    .map(
      (l) => `<article class="bn-card" data-lens="${esc(l.id)}">
      <h3 class="bn-h3" dir="auto">${esc(l.title)}</h3>
      <tx-lens lens="${esc(l.id)}"></tx-lens>
      <div class="bn-links"><button class="bn-link" data-lens-edit="${esc(l.id)}">Edit code</button><button class="bn-link" data-lens-pin="${esc(l.id)}">${l.inStory ? "Take out of the story" : "Add to the story"}</button><button class="bn-link" data-lens-remove="${esc(l.id)}">Remove</button></div>
    </article>`,
    )
    .join("");
  return `<div class="bn-lenses">${cards}<div class="bn-row"><button class="bn-small" data-lens-blank>Start a blank lens</button><button class="bn-small" data-lens-starters>Restore starter lenses</button></div></div>${lensViewHTML(ui, runtime)}`;
}

export function benchHTML(ui, runtime) {
  const tab = ui.bench ?? "details";
  let body;
  if (tab === "threads") body = threadsHTML(ui, runtime);
  else if (tab === "lenses") body = lensesHTML(ui, runtime);
  else {
    const ids = selectedIds(runtime);
    const ts = ids.map((id) => runtime.derived.byId.get(id));
    body = !ts.length
      ? EMPTY
      : ts.length === 1
        ? oneHTML(ui, runtime, ts[0])
        : manyHTML(ui, runtime, ts);
  }
  return `${tabs(tab)}${body}`;
}

// A new selection starts the Details tab afresh.
export function resetBench(ui) {
  Object.assign(ui, {
    bench: "details",
    manyMsg: "",
    told: false,
    toldSaved: false,
    tagging: false,
    tag: "",
  });
}

export function benchInput(e, ui, runtime, actions) {
  const { state } = runtime;
  const el = e.target;
  if (el.id === "many-name") ui.manyName = el.value;
  else if (el.id === "bench-tag") ui.tag = el.value;
  else if (el.id === "one-note") {
    const v = el.value;
    if (v.trim()) state.notes[el.dataset.id] = v;
    else delete state.notes[el.dataset.id];
    actions.save("notes");
    actions.refreshSoon();
  } else if (el.id === "one-name") {
    const v = el.value.trim();
    const k = el.dataset.nameKey;
    if (v && v !== el.dataset.original) state.names[k] = { name: v, by: "you" };
    else delete state.names[k];
    actions.save("names");
    actions.refreshSoon();
  } else return false;
  return true;
}

// Returns true when it handled the click; render tells tx-year to redraw.
export function benchClick(b, ui, runtime, actions, host) {
  const { state } = runtime;
  const d = b.dataset;
  const ids = selectedIds(runtime);
  const ts = ids.map((id) => runtime.derived.byId.get(id));
  const real = ts.filter((t) => t.kind === "actual");
  if (d.benchTab) ui.bench = d.benchTab;
  else if ("benchLine" in d) {
    ui.bench = "threads";
    ui.activeLine = d.benchLine === "" ? null : +d.benchLine;
    if (ui.activeLine != null) lightLine(ui.activeLine, runtime, actions);
  } else if (d.ruleLine) {
    ui.activeLine = +d.ruleLine;
    lightLine(ui.activeLine, runtime, actions);
  } else if (d.benchTransfer) {
    const t = runtime.derived.byId.get(d.benchTransfer);
    const auto = !!t?.transfer && t.transfer.kind !== "manual";
    state.transferOv[t.id] = !t.transfer;
    if (!t.transfer && auto) delete state.transferOv[t.id];
    actions.save("transfers");
    actions.refresh();
  } else if ("benchTag" in d) {
    ui.tagging = true;
    ui.focusTag = true;
    if (ts.length > 1)
      ui.manyMsg = `Type a tag, like #garden, and it’s added to the notes of all ${real.length} payments.`;
  } else if ("benchTagAdd" in d) {
    const tags = parseTags(ui.tag);
    if (!tags.length) return (host.querySelector("#bench-tag")?.focus(), false);
    ui.tagging = false;
    ui.tag = "";
    ui.manyMsg = "";
    actions.bulkTag(
      real.map((t) => t.id),
      tags,
      [],
    );
  } else if ("benchThread" in d) {
    const name = ui.manyName.trim();
    if (!name) ui.manyMsg = "Give the thread a name first.";
    else {
      const { rules } = addToThread(state.rules, name, real.length ? real : ts);
      state.rules = rules;
      state.previewRules = null;
      actions.save("rules");
      ui.manyMsg = `Made a thread, “${name}”, from these ${ts.length} payments. Its rule is at the end of Threads, where you can change what it catches.`;
      actions.refresh();
    }
  } else if ("benchPeriod" in d) {
    const name = ui.manyName.trim();
    if (!name) ui.manyMsg = "Give the period a name first.";
    else {
      const dates = ts.map((t) => t.date).sort();
      actions.addPeriod(dates[0], dates.at(-1), { name });
      state.selection = new Set(ids);
      ui.manyMsg = `Saved a period, “${name}”, ${dayLong(dates[0])} to ${dayLong(dates.at(-1))}. Drag its edges on the timeline to change the dates.`;
      actions.refresh();
    }
  } else if ("benchClear" in d) {
    state.selection = new Set();
    resetBench(ui);
    actions.highlight([]);
  } else if ("benchTell" in d) ui.told = true;
  else if ("benchSaveTold" in d) {
    const m = manyStory(ts, state.periods);
    actions.addReport(
      `About these ${ts.length} payments`,
      `${plain(m.told)} ${ts.map((t) => `[[${t.id}]]`).join(" ")}`,
      { open: false },
    );
    ui.toldSaved = true;
  } else if ("benchAsk" in d) {
    ui.text = `About these ${ts.length} payments: `;
    ui.ask = "idle";
    ui.story = null;
    state.scale = "year";
    ui.focusAsk = true;
  } else if (lensViewClick(d, ui, actions)) return true;
  else if (d.lensPin) {
    state.lenses = state.lenses.map((l) =>
      l.id === d.lensPin ? { ...l, inStory: !l.inStory } : l,
    );
    actions.save("lenses");
  } else if (d.lensRemove) {
    const l = state.lenses.find((x) => x.id === d.lensRemove);
    if (!l || !confirm(`Remove “${l.title}”?`)) return false;
    state.lenses = state.lenses.filter((x) => x !== l);
    actions.save("lenses");
  } else if ("lensBlank" in d) actions.addBlankLens();
  else if ("lensStarters" in d) actions.restoreStarterLenses();
  else return false;
  return true;
}

// The payments a rule line sorts: a rule's hits, or a thread's payments.
const lineIds = (line, i, derived) =>
  (/^\s/.test(line)
    ? (derived.lineHits[i] ?? [])
    : derived.txns.filter(
        (t) => t.thread === line.trim().replace(/\s*\[.*\]\s*$/, ""),
      )
  ).map((t) => t.id);

function lightLine(i, runtime, actions) {
  const { derived, state } = runtime;
  const line = (state.previewRules ?? state.rules).split("\n")[i] ?? "";
  actions.highlight(lineIds(line, i, derived));
}
