import { $, TODAY, monthName } from "./helpers.js";
import { toast } from "./ui/dom.js";
import { LOOSE } from "./transactions/constants.js";

export function createSuggestions(runtime, actions) {
  const { state, caps } = runtime;
  function coverageText() {
    return runtime.derived.accounts
      .map(
        (a) =>
          `${a}: ${[...(runtime.derived.coverage[a] || [])].sort().map(monthName).join(", ")}`,
      )
      .join("; ");
  }

  function merchantSummary(limit = 300) {
    const g = {};
    for (const t of runtime.derived.allTxns) {
      const k = t.nameKey;
      g[k] ||= {
        name: t.renamed ? `${t.merchant} (${t.original})` : t.merchant,
        n: 0,
        sum: 0,
        thread: t.thread,
      };
      g[k].n++;
      g[k].sum += t.amount;
    }
    return Object.values(g)
      .sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum))
      .slice(0, limit)
      .map((m) => `${m.name} | ${m.n}× | ${m.sum.toFixed(2)} | ${m.thread}`)
      .join("\n");
  }

  const DSL_DOC = `The rules language: a thread is a name on its own line (not indented). Under it, indented lines are patterns, one per line. A plain pattern matches if it appears inside the merchant name (case-insensitive; digits and punctuation such as quotes, dashes and dots are ignored, so write "חברת החשמל" not "חברת החשמל לישראל בע\\"מ 123"). A pattern starting with # matches that tag in the person's notes. A /pattern/ is a JavaScript regular expression tested against the merchant name. Lines starting with // are comments. The first thread (top to bottom) that matches wins.`;

  async function suggestThreads() {
    const btn = $("#suggestBtn");
    btn.disabled = true;
    btn.textContent = actions.AI() + " is reading your merchants…";
    const input = `You're helping one person organise their own card and bank transactions into "threads" (their own categories) in a personal tool called Transactions. ${DSL_DOC}

Their current rules:
<rules>
${state.rules}
</rules>

Merchants they have (name | times seen | total ILS, positive = spent | thread it currently lands in):
${merchantSummary()}

Rewrite the rules so almost nothing is left in "${LOOSE}". Keep their existing threads, names, comments and patterns unless something is clearly wrong; add threads that reflect how this particular person actually lives (for example, if several merchants are vets, pet shops and pet insurance, a thread for the pet makes more sense than scattering them across "Insurance" and "Shopping"). Prefer 6 to 12 threads with short English names. Patterns should be short distinctive fragments of the merchant name, often in Hebrew. Order threads so specific ones come before general ones.

Reply with only JSON: {"rules": "the full new rules text, with \\n line breaks and two-space indents", "summary": "one or two plain sentences on what you changed and why"}`;
    try {
      const r = await caps.sample.json(input, { modelTier: "default" });
      if (typeof r?.rules !== "string" || !r.rules.trim())
        throw { code: "invalid_json" };
      state.previewRules = r.rules.replace(/\r/g, "");
      state.previewSummary = String(r.summary || "");
      actions.refresh();
      $("#rules").scrollTop = 0;
      actions.syncGutter();
    } catch (e) {
      toast(actions.sampleErr(e));
    }
    btn.disabled = false;
    btn.textContent = "Suggest threads with " + actions.AI();
  }

  const LENS_CONTRACT = `A lens in Transactions is the BODY of a JavaScript function (txns, lib) => view. It must return a view object. It runs in the page: no imports, no network, no DOM, no async.
txns: array of { id, date: "YYYY-MM-DD" (purchase date), chargeDate, merchant (display name, possibly translated), original (description exactly as on the statement, often Hebrew), amount (number, ILS; positive = money out, negative = refund or money in), orig: {amount, currency} | null (original or foreign-currency amount), type, details, inst: {n, of} | null (instalment n of of), thread (the person's own category), account, note (their free text, may contain #tags), period: "YYYY-MM" (statement month), recurring (boolean: merchant seen in 2+ statements), key (merchant identity) }.
lib: sum(array, fn), groupBy(array, fn) -> {key: array}, month("YYYY-MM-DD") -> "YYYY-MM", fmt(number) -> "₪1,234.00", today ("YYYY-MM-DD"), threads (names), accounts (names), periods ([{name, start, end, story}] stretches of time they marked; txns also carry periods: [names]), budgets ({thread: monthly ₪}), transfers (money moved between their own accounts; already left out of txns), expected (array shaped like txns: projected future charges from recurring merchants and remaining instalments).
Views:
{ kind: "bars", items: [{ label, value (number, ILS), ids: [txn ids] }] }   // labels "YYYY-MM" are shown as month names; ids make a bar clickable to highlight beads
{ kind: "table", columns: [..], rows: [[cells]], rowIds: [[ids]] }
{ kind: "number", value, label, ids }
{ kind: "text", text }
Write plain, readable code a person will want to edit: under 35 lines, a one-line // comment at the top saying what it shows, clear names, no clever tricks. Remember statement months may be missing; only use what's there.`;

  async function writeLens(brief, prev) {
    const sampleRows = runtime.derived.txns.slice(0, 4).map(actions.publicTxn);
    let input = `${LENS_CONTRACT}

Threads: ${runtime.derived.names.join(", ")}. Accounts and statement months: ${coverageText()}. Today is ${TODAY}.
Example transactions: ${JSON.stringify(sampleRows)}

`;
    if (prev?.error)
      input += `This lens throws an error. Fix it and keep its intent.\nError: ${prev.error}\nCode:\n${prev.code}\n`;
    else if (prev?.change)
      input += `Change this lens as asked: ${prev.change}\nCurrent code:\n${prev.code}\n`;
    else
      input +=
        `Write a lens for: ${brief}\n` +
        (prev?.context
          ? `It comes from this exchange in the Ask panel; use it to understand what they want to see (ids in [[ ]] are transaction ids):\n${prev.context.slice(0, 6000)}\n`
          : "");
    input += `\nReply with only JSON: {"title": "short title in sentence case", "code": "the function body"}`;
    const r = await caps.sample.json(input, { modelTier: "default" });
    if (typeof r?.code !== "string") throw { code: "invalid_json" };
    return { title: String(r.title || ""), code: r.code };
  }

  return { coverageText, suggestThreads, writeLens };
}
