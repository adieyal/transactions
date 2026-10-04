# Story-first Transactions: implementation plan

Prototype: <https://claude.ai/artifact/BcUkMQiBifSzdDihvySphA>

## Goal

Make reading a plain-language summary of your spending the centre of the app, and make adding context feel like answering easy, optional questions rather than doing analysis. The timeline stays as the illustration beside it.

The loop: the app notices something in the data, offers an optional question, your answer becomes a period or a note, and the summary improves.

## Principles

- **Works without an assistant.** Moments come from rules and summaries from templates. An assistant only improves phrasing and answer suggestions, and only when you ask.
- **Facts only.** Generated sentences state what the data shows. Personal detail appears only when you wrote it, and your words are shown apart from generated text.
- **Friendly voice.** Second person and conversational: "April was a big month: ₪3,160 went out, about five times a typical month."
- **Plain vocabulary.** Budgets, notes, periods, threads. No "intentions", "memories" or "chapters". Going over a budget is stated neutrally, never in red.
- **Privacy said where it matters.** Questions are optional, skippable and visibly private. The wording reflects where data is actually stored: this browser, or the user's Claude account inside claude.ai.
- **Every sentence is tied to its transactions.** Hovering a sentence highlights its beads, the same way Ask's citations already do.

## Architecture

Three new pure modules, testable in Node like `transactions/*`:

| Module | Input | Output |
|---|---|---|
| `story/moments.js` | derived data and state | `Moment[]`: `{ id, kind, month, from, to, txnIds, facts, rank }` |
| `story/summary.js` | derived data, state, a month | `Section[]`: `{ kind, parts: [{ text, txnIds? }] }` |
| `story/copy.js` | facts | friendly-voice sentences; number, date and plural helpers |

Two new UI modules, following the existing `createX(runtime, actions)` pattern: `ui/questions.js` and `ui/month.js`.

New saved documents: `answers` (`{ [momentId]: { status: "answered" | "skipped", choice, note, created: { periodId?, noteIds? }, at } }`) and `merchantAnswers`, the last answer per merchant key, used to suggest it again. Both go into `persistence.js`, `backup.js` (`workspaceDocuments` and `parseBackup`) and their tests.

Moment ids must stay stable across re-imports and re-derivation. Build them from the kind, the month and a hash of the sorted merchant keys and dates, not from transaction ids.

## Moment kinds (no assistant needed)

| Kind | Rule | Demo case |
|---|---|---|
| `cluster` | 3+ purchases totalling over 2× a typical week within 7 days, not already in a period | the move (9–16 Apr) |
| `large` | a charge over 3× the thread's or merchant's median, or the largest of the year | Cobble Lane Garage |
| `gap` | a recurring item or regular transfer missing from a covered month | savings in Dec and Jan |
| `price` | reuse the `findChanges` price flags | Lantern Stream |
| `spike` | a recurring merchant at 1.5× its usual amount | Meadow Paws |
| `rhythm` | the same merchant on the same day of the month for 4+ months | Paper Kite Cafe on the 9th |
| `new` | a merchant first seen this month with a material amount | Bluebell Removals |
| `budget` | a thread over budget for the first time, or by a lot | Bills in April |

Ranking: amount × novelty. Show at most three open questions a month. Moments already explained by a period or a note are dropped.

## Answers and what they do

- **Generic options always available:** Name this period · Write a note · Skip.
- **Suggestions without an assistant:** the last answer for the same merchant, plus a small keyword table (*removal, garage, vet, hotel, airline, pharmacy*) with English and Hebrew terms.
- **Effects:** an answer can create a period (`addPeriod`, extended to accept a name and story), add a note or tag to the transactions (the notes and tags tools already exist), or link two moments (the savings gap and the car).
- **Undo:** every answer can be undone from its toast, the same way removing a period works.

## UI

- **Side panel tabs:** **Your month** (default) · **Questions** · Lenses · Threads · Ask · Reports. The timeline stays on the left as the illustration.
- **Your month:** month navigation, the summary sections, open questions inline, budgets as "₪305 of ₪300". Hovering a sentence highlights its beads.
- **Questions:** an inbox of all open moments, with a privacy banner, kinds in plain words, quick answers and Skip.
- **Period inspector:** "Your description" (the existing story field, labelled as yours) above a generated "Summary", the notes for the period's transactions, and a checkbox for regular spending in those dates.
- **Thread inspector (themes):** clicking a thread name shows its summary and a blow-by-blow list.
- **Privacy:** a header chip ("Private to this device", or "Saved to your Claude account") opens an accurate explanation, and every question card has a one-line footer.
- **Worth a look:** retired. Its price and stopped-charge flags become moments.

## Milestones

1. **Moments and answers (no UI).** `story/moments.js`, `story/copy.js`, the `answers` and `merchantAnswers` documents, backup support. Tests: the demo year produces each demo case above; ids stay stable after a re-import; answers survive a backup round trip.
2. **Questions.** The Questions tab, inline answers that create periods and notes, undo, the privacy chip and card footer, retiring Worth a look. Tests: answer effects (pure parts) plus a headless walk-through.
3. **Your month.** `story/summary.js` and `ui/month.js` as the default tab, with hover highlighting and month navigation. Tests: fixed expected text for the demo's April, each sentence's `txnIds` correct.
4. **Periods and threads as stories.** The period inspector's Your description and Summary, and the thread summary with a blow-by-blow list.
5. **Demo, tour and docs.** The demo ships with the car and the holiday answered and the move left open. The tour walks through reading April and answering the move question. Update the README and recapture the screenshots and the demo backup.
6. **Assistant, opt-in.** A "Suggest answers" button and a "Polish this summary" button. Each sends facts with transaction ids, and its result is accepted only if every claim cites ids, with the template text as the fallback. Never runs automatically.

Milestones 1–3 deliver the loop. 4 and 5 make it complete. 6 is optional polish.

## Open decisions

- **Calendar months or statement months:** summaries use calendar months of the purchase date. Card statements straddle months, so the coverage bars stay as they are.
- **"Typical month":** the median of covered months, excluding periods. Needs at least 3 months; with fewer, skip comparisons.
- **Question fatigue:** a cap of 3 a month, and "Skip" counts as an answer, so the question doesn't come back.
- **Language:** templates are English only for now, with Hebrew merchant names shown as they are.
- **Lenses and Reports:** stay as they are for analytical users. Reports may later fold into Your month.
