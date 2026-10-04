# 0014. One chat, with the person's access, shown as it acts

Date: 2026-10-05. Status: accepted (user decision).

## Context

The canvas artboard drew a different Ask: a "Ready to send" preview, "each sentence checked" with uncited sentences struck through, and "Suggested change / Apply". The builders made new UI for it (`components/tx-year-ask.js`, `tx-year-saved.js` and the checking in `story/saved-question.js`) and kept only `ask()` from `ui/chat.js`. A privacy review then made that Ask read-only. The user, after testing: "It isn't clear what's happening, it's read-only for some reason, and there is no indication that it is processing. What are the lines struck out? I want the agent to have access to everything." The original chat on 8d87cd2 is the behaviour to keep.

## Decision

- **One chat.** `ui/chat.js` moved to `components/tx-chat.js` as `<tx-chat>`: turns, live tool lines, Stop, follow-ups, suggestions, "Turn this into a lens" and "Save as a story". The year's Ask section, the one-month view and the panel's Ask tab all embed the same element; the bench's "Ask about these" fills its input. A test fails on a second chat (architecture: "there is one chat").
- **Full access.** The tools (`components/chat-tools.js`) are the model's commands (ADR 0013): tag, untag, notes, merchant names, transfers, periods (make, change, delete), threads and rules, budgets, lenses (make, change, run, delete) and saved questions. The old tools' own mutation code and per-reply undo maps are gone.
- **Shown as it acts.** Each change is one line in the thread ("Added #coffee on 4 transactions", "Made a period Cape Town trip, 3 Sep 2026 to 9 Sep 2026") with Undo through the one undo log, and its payments light on the timeline. While it works, the question shows at once, with a working line, one line per tool call and Stop.
- **Deleted:** the preview and confirm step, the sentence checking and strike-through, "each sentence checked", Suggested change / Apply, and main.js's `tx-ask`, `tx-save-question` and `tx-run-question` listeners and `write: false` branch for the Ask.

## Consequences

- Nothing is sent until the person presses Ask, and the line under the input names what goes and to whom.
- Undo for a chat change lasts for the session; after a reload the lines stay, without Undo, as the undo log is in memory.
- Saved questions run again from Reports still get only the lookup tools: running a saved question changes nothing.
