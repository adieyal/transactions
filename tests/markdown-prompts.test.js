import test from "node:test";
import assert from "node:assert/strict";
import { createDemoData } from "../demo.js";
import { createRuntime } from "../state.js";
import { deriveTransactions } from "../transactions/derive.js";
import { markdown } from "../ui/markdown.js";
import { coverageText, systemPrompt, whatGoes } from "../assistant/prompts.js";

const TODAY = "2026-09-30";
function demo() {
  const { state } = createRuntime();
  Object.assign(state, createDemoData(TODAY));
  return { state, derived: deriveTransactions(state, { today: TODAY }) };
}

test("markdown escapes everything and adds only its own markup", () => {
  const { derived } = demo();
  const t = derived.allTxns.find((x) => x.merchant === "Kettle & Coil");
  const html = markdown(
    `**Big** week <img src=x onerror=alert(1)>\n\n- one [[${t.id}]]\n- two [[nope]]`,
    derived.byId,
  );
  assert.match(
    html,
    /^<p><b>Big<\/b> week &lt;img src=x onerror=alert\(1\)&gt;<\/p>/,
  );
  assert.match(
    html,
    /<ul><li>one <button class="cite" data-cite="[^"]+" title="Kettle &amp; Coil">/,
  );
  assert.match(html, /<li>two <\/li><\/ul>$/, "an unknown citation is dropped");
  assert.doesNotMatch(html, /<img/);
  assert.equal(markdown("a\nb", derived.byId), "<p>a<br>b</p>");
});

test("the system prompt states the facts the assistant needs", () => {
  const { state, derived } = demo();
  const compact = (t) => ({ id: t.id, amount: t.amount });
  assert.match(
    coverageText(derived),
    /^Demo Card: Sep 2025, Oct 2025, .*Aug 2026; Demo Everyday: /,
  );
  const ask = systemPrompt({
    derived,
    state,
    today: TODAY,
    tools: true,
    write: true,
    compact,
  });
  assert.match(ask, /Today is 2026-09-30\./);
  assert.match(ask, /Monthly budgets they've set: Bills ₪300\/month/);
  assert.match(ask, /- "The car broke down" 2025-12-10 to 2025-12-13: /);
  assert.match(ask, /use list_merchants then rename_merchants/);
  const report = systemPrompt({
    derived,
    state,
    today: TODAY,
    tools: true,
    write: false,
    compact,
  });
  assert.match(report, /In this mode you only read/);
  const noTools = systemPrompt({
    derived,
    state,
    today: TODAY,
    tools: false,
    write: true,
    compact,
  });
  assert.equal(
    noTools.split("\n").filter((l) => l.startsWith('{"id":')).length,
    derived.allTxns.length + derived.expected.length,
  );
});

test("the Ask preview's list matches what the opening message holds", () => {
  const { state, derived } = demo();
  state.lenses = [
    { id: "l-x", title: "Lens SECRET-TITLE", code: "// SECRET-CODE" },
  ];
  const period = state.periods[0];
  for (const tools of [true, false]) {
    const intro = systemPrompt({
      derived,
      state,
      today: TODAY,
      tools,
      write: true,
      compact: (t) => ({ id: t.id, note: t.note }),
    });
    // Said to go: accounts, periods and their descriptions, budgets.
    for (const a of derived.accounts) assert.ok(intro.includes(a));
    assert.ok(intro.includes(period.name));
    // Said not to go: lenses.
    assert.ok(
      !intro.includes("SECRET-TITLE") && !intro.includes("SECRET-CODE"),
    );
    // Without tools every transaction goes, so nothing else may be claimed.
    if (!tools) assert.ok(intro.includes(derived.allTxns[0].id));
    else assert.ok(!intro.includes(`"${derived.allTxns[0].id}"`));
  }
  const w = whatGoes({
    question: "Why December?",
    ai: "LM Studio",
    tools: true,
    earlier: 20,
    selected: 2,
  });
  assert.equal(w.goes[0], "Your question: “Why December?”");
  assert.match(w.goes.at(-2), /up to 16 messages/);
  assert.equal(
    w.notSent,
    "Not sent: your lenses, and transactions LM Studio doesn’t look up.",
  );
  assert.equal(
    whatGoes({ question: "q", ai: "X", tools: false }).notSent,
    "Not sent: your lenses.",
  );
});
