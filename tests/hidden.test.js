// ADR 0004: a render under the hidden <main> skips its work. With
// body.onemonth set and the bench closed, no registered render other than the
// shell's may touch the DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";

const today = "2026-09-30";
// Renders outside <main>: the header and shell.
const OUTSIDE = new Set(["renderChrome"]);
const MODULES = [
  "filter",
  "timeline",
  "questions",
  "reports",
  "threads",
  "inspector",
  "lenses",
];

function fakeDocument(classes, touched) {
  const element = (what) =>
    new Proxy(function () {}, {
      get(_, key) {
        touched.push(`${what}.${String(key)}`);
        return element(`${what}.${String(key)}`);
      },
      set(_, key) {
        touched.push(`${what}.${String(key)} =`);
        return true;
      },
      apply() {
        touched.push(`${what}()`);
        return element(`${what}()`);
      },
    });
  return {
    body: { classList: { contains: (c) => classes.includes(c) } },
    getElementById: (id) => element(`#${id}`),
    querySelector: (s) => element(s),
    querySelectorAll: (s) => (touched.push(s), []),
    createElement: (s) => element(`<${s}>`),
  };
}

for (const bench of [false, true]) {
  test(`renders under <main> ${bench ? "draw when the bench is open" : "skip while body.onemonth hides it"}`, async () => {
    const runtime = createRuntime({ today });
    Object.assign(runtime.state, createDemoData(today), {
      loaded: true,
      bench,
    });
    runtime.derived = deriveTransactions(runtime.state, { today });
    const actions = new Proxy({}, { get: () => () => "" });
    const touched = [];
    const saved = globalThis.document;
    globalThis.document = fakeDocument(["onemonth"], touched);
    try {
      const renders = [];
      for (const name of MODULES) {
        const { contract } = await import(`../ui/${name}.js`);
        const made = contract.create(runtime, actions);
        for (const r of contract.renders)
          if (!OUTSIDE.has(r)) renders.push([r, made[r]]);
      }
      // Ten before the chat became <tx-chat>, which draws only inside itself.
      assert.ok(renders.length >= 8);
      for (const [name, render] of renders) {
        touched.length = 0;
        try {
          render();
        } catch {
          // A render that runs against the fake document may throw; it has
          // already touched it.
        }
        if (bench) assert.ok(touched.length || name === "renderQuestions");
        else assert.deepEqual(touched, [], `${name} touched the DOM`);
      }
    } finally {
      globalThis.document = saved;
    }
  });
}
