import test from "node:test";
import assert from "node:assert/strict";
import { makeOpenAI } from "../assistant.js";

test("OpenAI adapter normalizes the host, runs tools and retains message history", async () => {
  const saved = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return Response.json({
      choices: [
        {
          message:
            calls.length === 1
              ? {
                  tool_calls: [
                    {
                      id: "one",
                      function: { name: "total", arguments: '{"amount":42}' },
                    },
                  ],
                }
              : { content: "Total is 42" },
          finish_reason: "stop",
        },
      ],
    });
  };
  try {
    const provider = makeOpenAI({
      base: "api.openai.com",
      model: "test",
      key: "local-key",
    });
    const result = await provider("Total?", {
      tools: [
        {
          name: "total",
          description: "Total",
          execute: ({ amount }) => ({ amount }),
        },
      ],
    });
    assert.equal(result.text, "Total is 42");
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].headers.Authorization, "Bearer local-key");
    assert.equal(calls[1].body.messages.at(-1).role, "tool");
    assert.equal(calls[1].body.messages.at(-1).content, '{"amount":42}');
  } finally {
    globalThis.fetch = saved;
  }
});

test("OpenAI adapter parses fenced JSON and maps authentication failures", async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
      });
    const provider = makeOpenAI({
      base: "http://localhost:11434/v1",
      model: "test",
    });
    assert.deepEqual(await provider.json("JSON?"), { ok: true });
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(provider("hello"), (e) => e.code === "auth");
    globalThis.fetch = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    await assert.rejects(provider("hello"), (e) => e.code === "cancelled");
  } finally {
    globalThis.fetch = saved;
  }
});
