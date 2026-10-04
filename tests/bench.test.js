import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { manyStory, oneStory } from "../story/bench.js";
import { plain } from "../story/copy.js";

const today = "2026-09-30";
const demo = { ...createRuntime().state, ...createDemoData(today) };
const derived = deriveTransactions(demo, { today });
const car = derived.txns.filter(
  (t) => t.kind === "actual" && t.periods?.includes("The car broke down"),
);
const garage = car.filter((t) => t.merchant === "Cobble Lane Garage");

test("one bead: a one-line story, then how often", () => {
  const said = plain(oneStory(garage.at(-1), derived.txns, 12));
  assert.equal(
    said,
    "₪1,480 at Cobble Lane Garage on 13 December, during “The car broke down”. You paid Cobble Lane Garage 2 times in these twelve months.",
  );
  const ghost = derived.expected.find((t) => t.amount > 0);
  assert.match(
    plain(oneStory(ghost, derived.txns, 12)),
    /^Expected around \d+ \w+: about ₪[\d,]+, going by what repeats\.$/,
  );
});

test("several beads told as a story, without an assistant", () => {
  const m = manyStory(car, demo.periods);
  assert.equal(m.title, `${car.length} beads`);
  const sum = car.reduce((a, t) => a + t.amount, 0);
  assert.match(
    plain(m.sub),
    /on statements, 10 December 2025 to 13 December 2025$/,
  );
  assert.equal(
    plain(m.told),
    `₪${sum.toLocaleString("en-US")} went out in ${car.length} payments between 10 December and 13 December. Cobble Lane Garage came to ₪1,600 of it, in 2 payments. All of it was during “The car broke down”.`,
  );
  assert.deepEqual(m.tags, ["#car 2"]);
});

test("a touch on the timeline scrolls when it moves at once, and gathers after a hold", async () => {
  const { touchIntent, HOLD_MS, SLOP_PX } =
    await import("../components/tx-year-gather.js");
  assert.equal(touchIntent(100, 2), "wait");
  assert.equal(touchIntent(100, SLOP_PX + 1), "scroll");
  assert.equal(touchIntent(HOLD_MS, 0), "gather");
  assert.equal(touchIntent(HOLD_MS + 200, SLOP_PX + 40), "gather");
});

test("the lens view shows the lens's title, its code and the six drawn reference rows", async () => {
  const { lensViewHTML, lensViewClick } =
    await import("../components/tx-year-lens.js");
  const runtime = {
    state: {
      lenses: [{ id: "l1", title: "Cats & <dogs>", code: "return {a:1<2};" }],
    },
  };
  assert.equal(lensViewHTML({}, runtime), "");
  const h = lensViewHTML({ lensView: "l1" }, runtime);
  assert.match(h, /<h2 dir="auto">Cats &amp; &lt;dogs&gt;<\/h2>/);
  assert.match(h, /<pre class="bn-lv-code">return \{a:1&lt;2\};<\/pre>/);
  assert.deepEqual(
    [...h.matchAll(/<dt>(.*?)<\/dt>/g)].map((m) => m[1]),
    [
      "id",
      "date",
      "merchant · original",
      "amount",
      "thread · tags · note · period",
      "lib.expected",
    ],
  );
  const ui = {};
  const opened = [];
  const actions = { openLensEditor: (id) => opened.push(id) };
  assert.ok(lensViewClick({ lensEdit: "l1" }, ui, actions));
  assert.equal(ui.lensView, "l1");
  assert.ok(lensViewClick({ lensOpenEditor: "l1" }, ui, actions));
  assert.equal(ui.lensView, null);
  assert.deepEqual(opened, ["l1"]);
  assert.equal(lensViewClick({}, ui, actions), false);
});

test("new workspaces start with the two drawn lenses; the third stays the app's own", async () => {
  const { STARTER_LENSES, OTHER_LENSES } = await import("../defaults.js");
  assert.deepEqual(
    STARTER_LENSES.map((l) => l.title),
    ["Already spoken for", "Things that keep coming back"],
  );
  assert.deepEqual(
    OTHER_LENSES.map((l) => l.id),
    ["l-where"],
  );
});
