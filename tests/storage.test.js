import test from "node:test";
import assert from "node:assert/strict";
import { localBackend, dbBackend } from "../storage.js";

function memoryStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}

test("browser storage round-trips documents without reading AI settings", async () => {
  const storage = memoryStorage();
  storage.setItem("abacus-ai-settings", '{"key":"private"}');
  storage.setItem("abacus:notes", '{"map":{"private":"Personal note"}}');
  storage.setItem(
    "abacus:batch_private_0",
    '{"rows":[{"merchant":"Personal merchant"}]}',
  );
  const backend = localBackend(storage, assert.fail);
  await backend.put("notes", { map: { t1: "hello" } });
  assert.deepEqual(await backend.all(), { notes: { map: { t1: "hello" } } });
  await backend.del("notes");
  assert.deepEqual(await backend.all(), {});
});

test("browser storage surfaces write failure through the injected reporter", async () => {
  const errors = [];
  const storage = memoryStorage();
  storage.setItem = () => {
    throw Error("quota");
  };
  await localBackend(storage, (e) => errors.push(e)).put("notes", {});
  assert.equal(errors.length, 1);
});

test("account storage keeps the private user path and serializes writes to a document", async () => {
  const calls = [];
  let unlock;
  const blocked = new Promise((resolve) => (unlock = resolve));
  const db = {
    collection(path) {
      assert.equal(path, "data/users/user-1/transactions-demo/documents");
      return {
        doc(k) {
          return {
            async set(v) {
              calls.push([k, v]);
              if (v.n === 1) await blocked;
            },
            async delete() {
              calls.push([k, "deleted"]);
            },
          };
        },
        limit(n) {
          assert.equal(n, 1000);
          return {
            async get() {
              return {
                docs: [{ id: "notes", data: () => ({ map: { a: "note" } }) }],
              };
            },
          };
        },
      };
    },
  };
  const backend = dbBackend(db, "user-1", assert.fail);
  const first = backend.put("rules", { n: 1 }),
    second = backend.put("rules", { n: 2 }),
    third = backend.del("rules");
  await Promise.resolve();
  assert.deepEqual(calls, [["rules", { n: 1 }]]);
  unlock();
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, [
    ["rules", { n: 1 }],
    ["rules", { n: 2 }],
    ["rules", "deleted"],
  ]);
  assert.deepEqual(await backend.all(), { notes: { map: { a: "note" } } });
});

test("assistant settings and flags keep their keys in browser storage", async () => {
  const { browserFlags, browserSettings } = await import("../storage.js");
  const items = new Map();
  const fake = {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
  };
  const settings = browserSettings(() => fake);
  assert.deepEqual(settings.readAI(), {});
  settings.writeAI({ provider: "openai", model: "m" });
  assert.deepEqual(JSON.parse(items.get("transactions-demo-ai-settings")), {
    provider: "openai",
    model: "m",
  });
  items.set("transactions-demo-ai-settings", "not json");
  assert.deepEqual(settings.readAI(), {});

  const flags = browserFlags(() => fake);
  assert.equal(flags.has("tourSeen"), false);
  flags.set("tourSeen");
  assert.equal(items.get("transactions-tour-seen"), "1");
  assert.equal(flags.has("tourSeen"), true);

  const broken = browserSettings(() => ({
    setItem() {
      throw new Error("quota");
    },
  }));
  assert.throws(() => broken.writeAI({}), /quota/);
});
