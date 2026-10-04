import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = fileURLToPath(new URL("../", import.meta.url));

// Builds the lens frame's script the way scripts/build.mjs builds the app
// (bundled, minified, es2022), then runs it as the frame would.
async function minifiedFrameScript() {
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { sandboxScript } from "./ui/lens-sandbox.js"; globalThis.frameScript = sandboxScript;`,
      resolveDir: root,
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
  });
  const holder = {};
  runInContext(result.outputFiles[0].text, createContext(holder));
  return holder.frameScript;
}

function runInFrame(script, message) {
  let handler = null,
    reply = null;
  const frame = createContext({
    addEventListener: (type, f) => {
      if (type === "message") handler = f;
    },
    parent: { postMessage: (m) => (reply = m) },
  });
  runInContext(script, frame);
  handler({ data: message });
  return reply;
}

test("a lens using lib.fmt runs in the minified frame", async () => {
  const script = await minifiedFrameScript();
  const reply = runInFrame(script, {
    id: 1,
    code: `return { kind: "bars", items: [{ label: "Oct", value: 1234.5, text: lib.fmt(1234.5) }, { label: "Nov", value: -12.3, text: lib.fmt(-12.3) }] };`,
    txns: [],
    data: { currencies: ["ILS"] },
  });
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(
    JSON.parse(JSON.stringify(reply.view.items.map((i) => i.text))),
    ["₪1,235", "−₪12.30"],
  );
});

test("lib.fmt in the minified frame asks for a currency when there are two", async () => {
  const script = await minifiedFrameScript();
  const reply = runInFrame(script, {
    id: 2,
    code: `return { kind: "bars", items: [{ text: lib.fmt(5) }] };`,
    txns: [],
    data: { currencies: ["EUR", "ILS"] },
  });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /^Say which currency/);
});
