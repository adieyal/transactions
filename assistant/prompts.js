import { fmt, monthName } from "../helpers.js";

// What the assistant is told, built from the derived data. Pure: the UI
// sends the text only when the person asks something.

// "Card: Jan 2026, Feb 2026; Bank: …": the statement months per account.
export function coverageText(derived) {
  return derived.accounts
    .map(
      (a) =>
        `${a}: ${[...(derived.coverage[a] || [])].sort().map(monthName).join(", ")}`,
    )
    .join("; ");
}

// The opening message of a conversation. tools: whether the assistant can
// call tools; write: whether it may change things (Ask) or only read
// (reports); compact: how one transaction is described when there are no
// tools and every transaction goes in the message.
export function systemPrompt({ derived, state, today, tools, write, compact }) {
  const pers = state.periods
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const budgets = derived.R.threads
    .filter((t) => t.budget != null)
    .map((t) => {
      // A budget is in its thread's currency; with several, it applies to each.
      const cs = [
        ...new Set(
          derived.allTxns
            .filter((x) => x.thread === t.name)
            .map((x) => x.currency),
        ),
      ];
      return cs.length === 1
        ? `${t.name} ${fmt(t.budget, 0, cs[0])}/month`
        : `${t.name} ${t.budget}/month in each currency`;
    });
  let intro = `You're the question-answering part of Transactions, a personal tool one person uses to explore their own card and bank statements. Today is ${today}.
Each amount is in its own currency, given as an ISO code (currency): ${[...new Set(derived.allTxns.map((t) => t.currency))].sort().join(", ") || "none yet"}. Never add up, compare or convert amounts in different currencies; give each currency's figures separately. A positive amount is money out; negative is a refund or money in. "Threads" are the person's own groupings, from rules they edit: ${derived.names.join(", ")}. Accounts and the statement months present: ${coverageText(derived)}. Any other months are missing, so say so when an answer depends on them.
Transfers between their own accounts (such as the bank paying the card bill) are not spending: the tools leave them out unless you pass include_transfers.
Transaction fields: date is when it was bought and charge_date when it was billed, if different; amount is in the transaction's currency and orig is the amount in the currency it was charged in, when that differs; type and details are copied from the statement; rule is the line of their thread rules that put it in its thread; source is the account, statement month and file it came from; kind is set for things worked out rather than read from a statement, with why explaining it.
${budgets.length ? `Monthly budgets they've set: ${budgets.join(", ")}.\n` : ""}${pers.length ? `Periods they've marked as context for what was going on (they can overlap, and not every charge in the dates belongs):\n${pers.map((p) => `- "${p.name}" ${p.start} to ${p.end}${p.story ? `: ${p.story.replace(/\s+/g, " ").slice(0, 300)}` : ""}`).join("\n")}\n` : ""}Answer briefly (a few sentences or a short list) in the language the person writes in. Don't guess figures. When you refer to specific transactions, cite them inline as [[id]] using ids from the data (at most 8 citations; no other link syntax). If a #tag on some payments would help, don't add it yourself unless asked: suggest it on its own last line, exactly "Suggested change: add #tag to [[id]] [[id]]". Nothing changes until the person applies it.`;
  if (tools) {
    intro += `\nUse the tools to look things up.`;
    if (write)
      intro += ` When the person asks to translate or rename descriptions, use list_merchants then rename_merchants (short, natural names like "Israel Electric Corp", "Shufersal Deal, Yakhin"; keep brand names; the original is kept automatically). When they ask to annotate or tag transactions, write it into their notes with update_notes (prefer the merchant form for anything that applies to every visit to a merchant). When they ask to change threads, read them with get_thread_rules and show a new version with propose_threads. When they describe a stretch of time (a trip, a move, a busy season), create or update it with save_period, and you can write its story. Only change things they asked for, then say briefly what you changed.`;
    else intro += ` In this mode you only read; don't try to change anything.`;
  } else
    intro +=
      `\nAll transactions, one JSON object per line:\n` +
      derived.allTxns
        .slice(0, 1800)
        .map((t) => JSON.stringify(compact(t)))
        .join("\n") +
      `\nExpected future charges:\n` +
      derived.expected.map((t) => JSON.stringify(compact(t))).join("\n") +
      `\nYou can't change anything in this setup, only read. If they ask for changes, say so and suggest picking an assistant that supports tools.`;
  return intro;
}

// What goes with a question, for the year's Ask preview, in the order the
// person reads it. Kept beside systemPrompt so the two change together:
// the opening message above, the conversation so far (ui/chat.js sends the
// last 16 messages), the ids of selected payments, and either the
// transactions the assistant looks up (tools) or all of them (no tools).
// tests/prompts.test.js checks the "not sent" line against systemPrompt.
export function whatGoes({ question, ai, tools, earlier, selected }) {
  const goes = [
    `Your question: “${question}”`,
    "Your account names and the months each statement covers, your thread names and budgets, and your periods with their descriptions",
    tools
      ? `The transactions ${ai} looks up to answer, with their notes and statement details, and your thread rules if it reads them`
      : "All your transactions and the charges expected ahead, with their notes and statement details",
  ];
  if (earlier)
    goes.push(
      `Your earlier questions and answers in this conversation (up to ${Math.min(16, earlier)} messages)`,
    );
  if (selected)
    goes.push(
      `Which ${selected === 1 ? "payment" : `${selected} payments`} you’ve selected on the timeline`,
    );
  return {
    goes,
    notSent: tools
      ? `Not sent: your lenses, and transactions ${ai} doesn’t look up.`
      : "Not sent: your lenses.",
  };
}
