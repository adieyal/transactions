// <tx-chat>'s reply path (components/tx-chat.js): every tool is one of the
// model's commands, committed through the one undo log, and replies lose
// their reasoning blocks. Run against a stub assistant that calls the tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { parseRules } from "../transactions/rules.js";
import { createChanges } from "../changes.js";
import { addReport } from "../model/index.js";
import { createChatComponent, contract } from "../components/tx-chat.js";
import { stripThinking } from "../assistant/reply.js";

const today = "2026-09-30";
const SAVED = [
  "notes",
  "names",
  "transferOv",
  "rules",
  "periods",
  "lenses",
  "reports",
];
const snapshot = (state) =>
  JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, state[k]])));

// calls: [[tool, input]] the stub assistant makes, in order, before
// answering with `text`.
function setup(calls = [], text = "Done.") {
  const runtime = createRuntime({ today });
  Object.assign(runtime.state, createDemoData(today), { loaded: true });
  const derive = () =>
    (runtime.derived = deriveTransactions(runtime.state, { today }));
  derive();
  const saved = [];
  const changes = createChanges(runtime, {
    save: (...keys) => saved.push(...keys),
    refresh: derive,
    refreshSoon: derive,
  });
  const committed = [];
  const lit = [];
  const actions = {
    commit: (r, o) => (r && committed.push(r), changes.commit(r, o)),
    undo: changes.undo,
    highlight: (ids) => lit.push(...ids),
    transferText: () => "a transfer between your accounts",
    writeLens: async (brief) => ({
      title: "Pets by month",
      code: `// ${brief}\nreturn lib.table([]);`,
    }),
    // As ui/reports.js: commits the record and returns it.
    addReport: (q, answer) =>
      actions.commit(
        addReport(runtime.state, { report: { id: "r-chat", q, answer } }),
      ),
  };
  const outputs = [];
  runtime.caps = {
    tools: true,
    sample: async (messages, opts) => {
      for (const [name, input] of calls) {
        const tool = opts.tools.find((t) => t.name === name);
        assert.ok(tool, `the assistant has a ${name} tool`);
        try {
          outputs.push(await tool.execute(input));
        } catch (e) {
          outputs.push("Error: " + e.message);
        }
      }
      opts.onText?.({ text });
      return { text };
    },
  };
  const chat = createChatComponent(runtime, actions);
  return { runtime, chat, changes, committed, outputs, saved, lit };
}

async function run(calls, opts) {
  const s = setup(calls);
  const before = snapshot(s.runtime.state);
  const reply = { content: "" };
  await s.chat.callAssistant([{ role: "user", content: "q" }], reply, opts);
  return { ...s, before, reply };
}

const ids = (state, merchant, n = 99) =>
  deriveTransactions(state, { today })
    .allTxns.filter((t) => t.merchant === merchant)
    .slice(0, n)
    .map((t) => t.id);

test("the contract provides no ask: the chat is the only place a question starts", () => {
  assert.ok(!contract.provides.includes("ask"));
  assert.deepEqual(contract.renders, []);
});

test("each write tool calls its model command, and undo puts everything back", async () => {
  const s0 = setup();
  const st = s0.runtime.state;
  const kite = ids(st, "Paper Kite Cafe", 4);
  const thread = parseRules(st.rules).threads[0].name;
  const calls = [
    ["tag", { ids: kite, add: ["#food"] }],
    ["untag", { ids: kite.slice(0, 1), remove: ["#food"] }],
    ["update_notes", { changes: [{ id: kite[1], text: "with Dana" }] }],
    [
      "rename_merchants",
      { changes: [{ merchant: "Paper Kite Cafe", name: "The kite" }] },
    ],
    ["set_transfer", { id: kite[2], on: true }],
    [
      "save_period",
      { name: "Cape Town trip", start: "2026-09-03", end: "2026-09-09" },
    ],
    [
      "save_period",
      { name: "Cape Town trip", story: "We went for the wedding." },
    ],
    [
      "save_period",
      { name: "Gone soon", start: "2026-01-01", end: "2026-01-02" },
    ],
    ["delete_period", { name: "Gone soon" }],
    ["add_to_thread", { name: "Coffee", ids: kite.slice(0, 2) }],
    ["set_budget", { thread, monthly: 450 }],
    ["create_lens", { title: "Pets", brief: "pets by month" }],
    [
      "set_thread_rules",
      { rules: "Everything\n  /./\n", summary: "Made one thread" },
    ],
    ["save_question", { question: "What did pets cost?", answer: "₪500." }],
  ];
  const s = await run(calls);
  const state = s.runtime.state;
  assert.deepEqual(
    s.outputs.filter((o) => typeof o === "string" && o.startsWith("Error")),
    [],
  );
  const commands = s.committed.map((r) => r.command);
  assert.deepEqual(commands, [
    "tag",
    "tag",
    "writeNotes",
    "renameMerchants",
    "setTransfer",
    "addPeriod",
    "editPeriod",
    "addPeriod",
    "removePeriod",
    "addToThread",
    "setBudget",
    "addLens",
    "setRules",
    "addReport",
  ]);
  assert.match(state.notes[kite[3]], /#food/);
  assert.doesNotMatch(state.notes[kite[0]] || "", /#food/);
  assert.match(state.notes[kite[1]], /with Dana/);
  assert.equal(state.transferOv[kite[2]], true);
  const trip = state.periods.find((p) => p.name === "Cape Town trip");
  assert.equal(trip.story, "We went for the wedding.");
  assert.ok(!state.periods.some((p) => p.name === "Gone soon"));
  assert.ok(state.lenses.some((l) => l.title === "Pets"));
  assert.equal(state.rules, "Everything\n  /./\n");
  assert.ok(state.reports.some((r) => r.q === "What did pets cost?"));
  // The tags and notes it wrote are lit on the timeline.
  assert.ok(kite.every((id) => s.lit.includes(id)));
  // Every change went through the one log: undo them all, latest first.
  while (s.changes.undo());
  assert.equal(snapshot(state), s.before);
});

test("the read tools look things up and change nothing", async () => {
  const s0 = setup();
  s0.runtime.state.lenses = [
    { id: "l-t", title: "Count", code: "return lib.table([]);" },
  ];
  const calls = [
    ["find_transactions", { text: "kite", limit: 2 }],
    ["totals", { group_by: "thread" }],
    ["list_merchants", {}],
    ["list_periods", {}],
    ["get_thread_rules", {}],
    ["list_lenses", {}],
    ["list_saved_questions", {}],
  ];
  const s = await run(calls);
  assert.equal(s.committed.length, 0);
  assert.equal(s.outputs[0].rows.length, 2);
  assert.ok(Array.isArray(s.outputs[1]));
  assert.equal(snapshot(s.runtime.state), s.before);
});

test("run_lens runs a lens through the model", async () => {
  const s = setup();
  const id = s.runtime.state.lenses[0]?.id;
  assert.ok(id, "the demo has a lens");
  const r = await run([["run_lens", { id }]]);
  assert.ok(!String(r.outputs[0]).startsWith("Error"), String(r.outputs[0]));
});

test("edit_lens and delete_lens change a lens, with Undo", async () => {
  const s0 = setup();
  const l = s0.runtime.state.lenses[0];
  const s = await run([
    ["edit_lens", { id: l.id, title: "Renamed" }],
    ["delete_lens", { id: l.id }],
  ]);
  assert.deepEqual(
    s.committed.map((r) => r.command),
    ["editLens", "removeLens"],
  );
  assert.ok(!s.runtime.state.lenses.some((x) => x.id === l.id));
  s.changes.undo();
  assert.equal(
    s.runtime.state.lenses.find((x) => x.id === l.id).title,
    "Renamed",
  );
  s.changes.undo();
  assert.equal(snapshot(s.runtime.state), s.before);
});

test("a saved question run again gets only the read tools", async () => {
  const s = setup([["tag", { ids: ["x"], add: ["#a"] }]]);
  const reply = { content: "" };
  await assert.rejects(
    s.chat.callAssistant([{ role: "user", content: "q" }], reply, {
      write: false,
    }),
    /tag tool/,
  );
});

test("a bad tool input is an error the assistant reads, and nothing changes", async () => {
  const s = await run([
    ["save_period", { name: "No dates" }],
    ["set_budget", { thread: "Nowhere", monthly: 10 }],
    ["update_notes", { changes: [{ merchant: "Nobody", text: "x" }] }],
  ]);
  assert.equal(s.committed.length, 0);
  assert.match(s.outputs[0], /^Error: A period needs dates/);
  assert.match(s.outputs[1], /^Error: There's no thread called Nowhere/);
  assert.match(s.outputs[2], /^Error: Not found: Nobody/);
  assert.equal(snapshot(s.runtime.state), s.before);
});

test("each tool call is a live step in the reply, marked done", async () => {
  const s0 = setup();
  const kite = ids(s0.runtime.state, "Paper Kite Cafe", 4);
  const s = await run([
    ["find_transactions", { text: "kite" }],
    ["tag", { ids: kite, add: ["#food"] }],
  ]);
  assert.deepEqual(
    s.reply.steps.map((x) => [x.text, x.done]),
    [
      ["Searching your statements for “kite”…", true],
      ["Tagging 4 payments…", true],
    ],
  );
});

test("reasoning blocks are stripped from replies, in one place", async () => {
  assert.equal(
    stripThinking("<think>add it up</think>It came to ₪40."),
    "It came to ₪40.",
  );
  assert.equal(
    stripThinking(
      "<reasoning>a\nb</reasoning>\n\nAnswer <think>x</think>here.",
    ),
    "Answer here.",
  );
  // Still thinking: an unclosed leading block shows nothing yet.
  assert.equal(stripThinking("<think>Let me look at the"), "");
  // The opening tag left out by the model's template.
  assert.equal(
    stripThinking("first I'll sum</think>\nIt came to ₪40."),
    "It came to ₪40.",
  );
  assert.equal(stripThinking("No tags at all."), "No tags at all.");
  assert.equal(stripThinking(undefined), "");
  const s = setup([], "<think>hmm</think>Done.");
  const reply = { content: "" };
  const text = await s.chat.callAssistant(
    [{ role: "user", content: "q" }],
    reply,
  );
  assert.equal(text, "Done.");
  assert.equal(reply.content, "Done.");
});
