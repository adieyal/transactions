# Refactor backlog

Ranked refactors that move Transactions from today's code to [the target architecture](architecture.md). Each id matches section 8 of that document and the allowlist entries in `tests/architecture.test.js`. Every item keeps behaviour the same, and is done when `npm run check` passes with its allowlist entries deleted. 4 October 2026.

## Ranking

Items are ranked by how much they lower the risk of future change, against what they cost. **Wait** means the item touches files that the story-first branch is changing (`ui/`, `main.js`, `state.js`, `persistence.js`, `backup.js`), so it should start after story-first has merged into `main`. As of `48b4f52`, story-first touches:

- `main.js`, `state.js`, `persistence.js`, `backup.js`;
- `ui/chrome.js`, `ui/periods.js`, `ui/month.js`, `ui/questions.js`;
- it deletes `ui/changes.js`;
- its remaining milestones plan changes to the period and thread inspectors, the tour, the demo, and the assistant.

| Rank | Item                                                                                                            |    Size     |    Risk    | Removes allowlist entries                                                    |      Wait for story-first?       |
| ---: | --------------------------------------------------------------------------------------------------------------- | :---------: | :--------: | ---------------------------------------------------------------------------- | :------------------------------: |
|    0 | [M0](#m0-merge-tasks-for-story-first) Merge tasks                                                               |      S      |    Low     | `answers`, `merchantAnswers` (done; adds `dismissed` under R2)               |           is the merge           |
|    1 | [R2](#r2-derive-boot-saves-and-backups-from-documentsjs) Derive boot, saves and backups from `documents.js`     |      M      |   Medium   | `workspace is missing from: save`, `main.js writes undeclared document demo` |        **Done** (`next`)         |
|    2 | [R3](#r3-one-refresh-path) One refresh path                                                                     |      M      |   Medium   | none (removes the duplicate `renderReports` call)                            |        **Done** (`next`)         |
|    3 | [R1](#r1-declared-module-contracts-and-registry) Declared module contracts and registry                         |      M      |    Low     | none (turns the provider test into a contract test)                          |        **Done** (`next`)         |
|    4 | [R4](#r4-pure-logic-out-of-the-ui) Pure logic out of the UI                                                     | L (4 × S/M) | Low–medium | none directly; shrinks `ui/chat.js` and `ui/timeline.js`                     |  R4a, c, d done; R4b part done   |
|    5 | [R6](#r6-browser-file-readers-out-of-transactionsimportjs) Browser file readers out of `transactions/import.js` |      S      |    Low     | 3: `transactions/import.js uses window`, `… DOMParser`, `… XLSX`             |              **No**              |
|    6 | [R7](#r7-persistence-stops-importing-the-ui) Persistence stops importing the UI                                 |      S      |    Low     | `persistence.js (persistence) imports ui/dom.js (ui)`                        |               Yes                |
|    7 | [R5](#r5-split-helpersjs) Split `helpers.js`                                                                    |      S      |    Low     | `helpers.js uses document`, `helpers.js uses new Date()`                     | Yes (touches every `$` importer) |
|    8 | [R11](#r11-storage-keys-into-storagejs) Storage keys into `storage.js`                                          |      S      |    Low     | `ui/assistant-settings.js uses storage`, `ui/tour.js uses storage`           |   Settings: **no**; tour: yes    |
|    9 | [R9](#r9-split-uichatjs) Split `ui/chat.js`                                                                     |      M      | Low–medium | `ui/chat.js` size ceiling                                                    |        Yes (milestone 6)         |
|   10 | [R8](#r8-timeline-layout-into-a-pure-helper) Timeline layout into a pure helper                                 |      L      |   Medium   | `ui/timeline.js` size ceiling                                                |        Yes (milestone 4)         |
|   11 | [R10](#r10-escaped-html-tag-and-delegated-events) Escaped `html` tag and delegated events                       |   S each    |    Low     | none (adds a guardrail)                                                      |            Per module            |
|   12 | [R12](#r12-fonts-and-sheetjs) Fonts and SheetJS                                                                 |     S–M     |   Medium   | none                                                                         |    Needs the user's decision     |

Items that can start now: R6, R11 for the settings, and R4d.

## Items

### M0. Merge tasks for story-first

- **Problem:** A rehearsal merge of `story-first` (`48b4f52`) into `architecture`, run in a throwaway worktree, merges cleanly. 51 of 52 tests pass. One guardrail fails:

  ```text
  ✖ saved documents match documents.js in boot, saving and backups
  actual: { unexpected: [ 'dismissed is missing from: save' ],
            stale: [ 'answers is missing from: state, boot, save, backup, restore',
                     'merchantAnswers is missing from: state, boot, save, backup, restore' ] }
  ℹ story/moments.js has 588 lines (warning above 400)
  ```

- **Change:**
  1. Delete the two `story-first` entries from `DOCUMENT_ALLOW`.
  2. Decide what happens to `dismissed`. Retiring `ui/changes.js` left it loaded and backed up but never saved. Either keep it as legacy data, with an allowlist entry naming R2, or remove it from `documents.js`, `state.js`, `main.js` and `backup.js`. Keep `parseBackup` accepting it, so older backups still load.
- **Size:** S. **Risk:** low. **Wait:** this is the merge itself.
- **Done** on branch `integration`, 4 October 2026. The two entries are deleted. `dismissed` is kept as legacy data with an R2 allowlist entry (`dismissed is missing from: save`), because it still hides dismissed flags, and `story/moments.js` turns flags into questions. Removing it would ask again about things people had already dismissed.

### R2. Derive boot, saves and backups from `documents.js`

- **Problem:** Saved keys are defined in six places. The seed writes `demo` (`main.js:132`), but boot reads `workspace.demo` (`main.js:141`), and only a backup restore ever writes `workspace`. So a workspace that started as the demo appears to stay `isDemo: true` after real imports (review finding 2). `view` has two shapes (`persistence.js:73-78` against `backup.js:263`). Boot loads without the validation that `parseBackup` applies.
- **Change:**
  - Add `check` functions and `delay` to each `DOCUMENTS` entry, taking the checks over from `parseBackup`.
  - Add `loadDocuments(docs)` and `toDocument(entry, state)`.
  - Make `createBackup`, `parseBackup` and `workspaceDocuments` loop over `DOCUMENTS`.
  - Add `actions.save(key)` and replace the 16 literal `saveSoon("key", () => ({ … }))` calls.
  - Make the seed write `workspace`, and read the old `demo` marker as legacy.
  - Report invalid documents at boot instead of skipping them silently.
  - Whether importing real statements should end demo mode is a product question for the user, not part of this item.
- **Size:** M. **Risk:** medium. Boot touches saved user data, so add a test that loads today's demo workspace documents unchanged.
- **Removes:** `workspace is missing from: save`, `main.js writes undeclared document demo`, and `dismissed is missing from: save` (kept by M0).
- **Wait:** yes.
- **Done** on branch `next`, 4 October 2026:
  - Each `DOCUMENTS` entry now has `check`, `delay` and `label`, and optionally `in`, `out` and `older`. The checks moved there from `parseBackup`.
  - `loadDocuments(docs, state)` loads every document and reassembles the statements. `toDocument(entry, state)` builds a stored document. `createBackup`, `parseBackup` and `workspaceDocuments` loop over `DOCUMENTS`.
  - `actions.save(...keys)` replaced the 16 literal `saveSoon` calls and the 33 calls to `savePeriods`, `saveReports`, `saveAnswers`, `saveLenses`, `saveView` and `saveChat`.
  - The seed writes `workspace`. A workspace with only the old `demo` marker loads as a demo and gets a `workspace` document; the marker itself is left in place.
  - A document that fails its check at boot is named in a toast and the console. It is not loaded, and nothing in that session saves over it.
  - `dismissed` needs no entry: nothing changes it in a session, and it is loaded, backed up and restored like every other document.
  - The guardrail now checks the derived design: only `persistence.js` debounces saves, no module writes a literal key, boot uses `loadDocuments`, and every entry round-trips through boot, backup and restore. `tests/documents.test.js` covers the old-key migration, both round trips and invalid documents. All three allowlist entries are deleted.
  - The `view` document now has one shape (`parked`, `panel`) in saves and restores.

### R3. One refresh path

- **Problem:** Four hand-kept lists decide what to redraw: `renderAll` (`main.js:53-71`, which calls `renderReports` twice at `:63` and `:70`), `refreshSoon` (`main.js:186-193`), the rules input (`ui/chrome.js:101-111`) and the filter (`ui/filter.js:68-77`). On top of these there are 34 direct `actions.renderX()` calls, and the "clear the focus" sequence is repeated at 11 sites (review findings 3 and 5).
- **Change:**
  - **Registered renders:** each factory lists its renders. `refresh()` and `refreshSoon()` re-derive, then call every registered render, and each render returns early when its pane is hidden.
  - **New commands:** add `highlight(ids)` and `select(ids)` (in `ui/timeline.js`), plus `clearFocus()` and `openPeriod(id)`.
  - **Call sites:** replace cross-module `renderX()` calls with those commands.
- **Size:** M. **Risk:** medium. Render order and cost change, so profile typing in the rules editor on the demo year before and after.
- **Removes:** no allowlist entries. Consider adding a guardrail afterwards: no `actions.render…` calls outside the owning module.
- **Wait:** yes. `ui/month.js` and `ui/questions.js` are new render targets.
- **Done** on branch `next`, 4 October 2026:
  - **Registered renders.** Factories return `renders: [...]`, and `main.js` collects them with `register()` in registration order: chrome, filter bar, parkbar, timeline, questions, month, reports, editor, inspector, lenses, Ask. `refresh()` re-derives and calls them all. `refreshSoon()` is `refresh` debounced at 250 ms, and `redraw()` renders without deriving.
  - **One list instead of four.** `renderAll`, the old `refreshSoon` list, the rules input and the filter now all go through `refresh`, and the duplicate `renderReports` call is gone.
  - **Hidden panes.** Month, questions (apart from the badge and the open list), reports, lenses, the threads editor and Ask return early while their pane is hidden, and `openTab` calls `redraw()`. The inspector skips a refresh while someone types in one of its text fields.
  - **New commands.** `highlight(ids, { clearSelection })`, `select(ids)` and `clearFocus()` in `ui/timeline.js`, and `openPeriod(id)` in `ui/periods.js`. They replace 19 hand-written sequences. Of the 34 cross-module `renderX()` calls, 7 deliberate ones remain (listed in docs/architecture.md section 4).
  - **Cost.** Typing in the rules editor on the demo year takes a median of 14.7 ms a keystroke, against 15.1 ms before (headless Chrome, 30 keystrokes).

### R1. Declared module contracts and registry

- **Problem:** The `actions` object is an undeclared service locator. It has 76 keys and 264 call sites, and all 18 UI modules form one strongly connected cycle (review finding 1). The guardrail only proves each call has a provider; it doesn't show who depends on whom.
- **Change:**
  - **Contracts:** each factory exports `contract = { name, create, provides, requires, renders, wires }`.
  - **Registry:** `registry.js` builds a frozen table and gives each module a scoped `Proxy`. `main.js` replaces its `Object.assign` chain with `createRegistry`.
  - **Test:** the guardrail checks each module's `actions.X` against its own `requires`, and reports the size of the cycle so it can be capped and lowered.
- **Size:** M (mostly mechanical, one `contract` per file). **Risk:** low. Startup throws on a mismatch, and the test catches that first.
- **Removes:** none. It tightens the actions rule from "some provider" to "a declared provider".
- **Wait:** yes. It touches every `ui/` file and `main.js`.
- **Done** on branch `next`, 4 October 2026:
  - **Contracts.** All 20 factories export `contract = { name, create, provides, requires, renders, wires }`. The lists were generated from the code, then checked by the guardrail.
  - **Registry.** `registry.js` builds the table, gives each module a scoped `actions` that throws on undeclared names, and throws at startup on a missing or doubled provider, or on provides that differ from the contract. `main.js` lists the modules once (`MODULES`); refresh renders and boot wiring follow that order.
  - **Guardrail.** It checks used names against `requires`, both ways, and caps the largest cycle of modules reaching each other at `CYCLE_MAX = 13` (of 20; the review counted 18).
  - **Size.** The label placement helpers moved from `ui/timeline.js` into `ui/timeline-labels.js`, to keep the file under its ceiling with its contract added.
  - **Next.** Lower the cycle by moving shared commands (`openTab`, `refresh`, `save`) out of the cycle's hubs, mainly `ui/chrome.js` and `ui/chat.js`.

### R4. Pure logic out of the UI

- **Problem:** 4,633 of 6,925 lines are never loaded by a test, and they include real logic (review finding 4).
- **Change:** four separable parts, each with demo-year tests:
  - **R4a:** rules-text edits into `transactions/rules-edit.js`: `setBudget` (`ui/timeline.js:501-517`), `addToThread` (`ui/inspector.js:243-296`), and accepting a preview (`ui/chrome.js:132-138`). Size S.
  - **R4b:** assistant tools and prompts into `assistant/tools.js` and `assistant/prompts.js`. That covers `filterTxns`, `totals`, `applyNoteChanges`, `applyNameChanges` and `save_period` (`ui/chat.js:6-434`), `buildIntro` (`ui/chat.js:530-561`), and the prompts in `suggestions.js` and `ui/periods.js:133-159`. The tools return changes and undo records, and the UI applies them. Size M.
  - **R4c:** `periodStats` (`ui/periods.js:7-24`) and tag parsing and bulk tagging (`ui/tags.js`) into `transactions/`. Size S.
  - **R4d:** `lensLib`, `publicTxn` and `runLens` from `ui/lenses.js` into a domain module next to `lens-api.js`. Size S.
- **Risk:** low to medium. The undo records in R4b are what matter to the person.
- **Removes:** no allowlist entries directly. R4b shrinks `ui/chat.js` towards removing its size ceiling.
- **Wait:** R4a, R4b and R4c yes. R4d no, because story-first doesn't touch `ui/lenses.js`.
- **Progress** on branch `next`, 4 October 2026:
  - **R4a done.** `setBudget` and `addToThread` live in `transactions/rules-edit.js` and are tested in `tests/rules-edit.test.js`. Accepting a preview is a two-line assignment, so it stays in `ui/chrome.js`.
    - Found while testing, and kept as it was: `addToThread` doesn't match a thread whose name line carries a budget (`Dining out [budget 100/month]`), so it starts a second thread with the same name. It needs a fix of its own: match the name the way `parseRules` reads it.
  - **R4b first slice done.** `filterTxns`, `compactTxn`, `findTransactions`, `totals`, `listMerchants`, `noteChanges` and `nameChanges` live in `assistant/tools.js` (domain), tested in `tests/assistant-tools.test.js`. They return new notes and names plus undo records, and `ui/chat.js` applies them. `ui/chat.js` is down from 790 to 616 lines, so its size ceiling is deleted.
  - **R4b remaining:**
    - `save_period` and `propose_threads`, which still change state inside the tool;
    - `buildIntro`, the system prompt, into `assistant/prompts.js`;
    - the prompts in `suggestions.js` and in `ui/periods.js` (`draftStory`).
  - **R4c done.** `periodStats` is in `transactions/period-stats.js`. Tag parsing and bulk tagging are in `transactions/tags.js` (`parseTags`, `tagsOf`, `retag`, `restoreNotes`). Both are tested in `tests/tags-periods.test.js`.
  - **R4d done.** `publicTxn`, `lensLib` and `runLens` are in `lens-api.js`. `lensLib` takes `today` as an argument, and `tests/lens-api.test.js` calls them directly.

### R6. Browser file readers out of `transactions/import.js`

- **Problem:** The domain module uses `DOMParser` (`:5`, `:113`), `window.XLSX` (`:183`) and `File.arrayBuffer` (`:171`), which is why it has only 40% coverage.
- **Change:** move `readMatrix`, `htmlMatrix`, `decodeText` and the DOM parts of `parseLeumiHTML` into a platform module (`files.js`, layer `platform`). Keep `csvMatrix`, `applyMapping`, `guessHeaderRow` and `sigOf` pure. Then test the CSV and mapping path fully in Node.
- **Size:** S. **Risk:** low.
- **Removes:** `transactions/import.js uses window`, `… uses DOMParser`, `… uses XLSX`.
- **Wait:** no. Only `transactions/import.js` and `ui/import.js` change, and story-first touches neither.

### R7. Persistence stops importing the UI

- **Problem:** `persistence.js:2` imports `toast` from `ui/dom.js`, and `persistence.js:34-39` writes `#saveStatus` itself.
- **Change:** `createPersistence` takes `{ onError, onSaved }` from `main.js`, and the status text moves into `ui/chrome.js`. Also move `suggestions.js` into `ui/` or split it, as part of R4b.
- **Size:** S. **Risk:** low.
- **Removes:** `persistence.js (persistence) imports ui/dom.js (ui)`.
- **Wait:** yes (`persistence.js`, `main.js`).

### R5. Split `helpers.js`

- **Problem:** The core module holds the DOM query `$` (`helpers.js:1`) and a clock read at load time, `TODAY` (`helpers.js:28`). `derive.js:7`, `demo.js:10` and `backup.js:10,124` fall back to that clock.
- **Change:**
  - Move `$` to `ui/dom.js` and update its 18 importers mechanically.
  - Replace `TODAY` with a `today` that `main.js` computes once and passes in.
  - Keep `helpers.js` exporting the pure functions, because `story/*` imports it.
- **Size:** S. **Risk:** low.
- **Removes:** `helpers.js uses document`, `helpers.js uses new Date()`.
- **Wait:** yes, because of the import churn across `ui/`.

### R11. Storage keys into `storage.js`

- **Problem:** `ui/assistant-settings.js:9,17` and `ui/tour.js:192,242` call `localStorage` directly, under their own keys.
- **Change:** add `settings` and `flags` accessors to `storage.js` and use them from both modules. Keep the same keys, so saved settings survive.
- **Size:** S. **Risk:** low.
- **Removes:** `ui/assistant-settings.js uses storage` and `ui/tour.js uses storage`.
- **Wait:** the settings part can be done now; the tour part waits for story-first milestone 5 (the tour).

### R9. Split `ui/chat.js`

- **Problem:** 756 lines that mix tool schemas, tools, the system prompt, a markdown renderer used by three modules, and a 100-line click handler (`:655-752`).
- **Change:** after R4b, `ui/chat.js` keeps the conversation log and its events. `md()` moves to a pure view helper (`ui/markdown.js`, whose output must stay escaped).
- **Size:** M. **Risk:** low to medium.
- **Removes:** the `ui/chat.js` size ceiling, once the file is under 700 lines. (Done early: R4b's first slice brought it to 616 lines and the entry is deleted.)
- **Wait:** yes. Story-first milestone 6 adds assistant features.

### R8. Timeline layout into a pure helper

- **Problem:** `renderTimeline` (`ui/timeline.js:52-430`) is 378 lines. It mixes layout maths (extent, period lanes, rows, budget bars, bead lanes) with SVG strings. The whole SVG is rebuilt on every pointer move during a drag (`:585`, `:604`).
- **Change:**
  - **Pure layout:** `ui/timeline-layout.js` turns `(derived, state, width)` into positioned rows, beads, bands and arcs, tested in Node against the demo year.
  - **Rendering only:** `renderTimeline` keeps only the SVG output.
  - **Pointer handling:** the five drag modes move to a small `ui/timeline-drag.js` view helper.
- **Size:** L. **Risk:** medium, because the output is visual. Compare headless Chrome screenshots of the demo year before and after.
- **Removes:** the `ui/timeline.js` size ceiling.
- **Wait:** yes. Story-first milestone 4 adds the thread inspector, which is reached from timeline row labels.

### R10. Escaped `html` tag and delegated events

- **Problem:** Ids and colours are interpolated raw, which is safe only because validation happens elsewhere (`backup.js:33,176`). `actions.AI()` is inserted unescaped at 14 sites. Some listeners are attached inside renders (`ui/inspector.js:171-198`, `ui/periods.js:69-111`, `ui/filter.js:29-48`).
- **Change:**
  - **The tag:** add `html` and `raw` to `ui/dom.js`, and convert each module's templates when the module is next touched.
  - **New guardrail:** a new `ui/` file must not assign `innerHTML` from a plain template literal.
- **Size:** S per module. **Risk:** low.
- **Removes:** no allowlist entries; it adds a guardrail with its own allowlist of not-yet-converted modules.
- **Wait:** per module.

### R12. Fonts and SheetJS

- **Problem:** `index.html:7-10` loads Google Fonts and the SheetJS script from CDNs, and `tests/build.test.js:29-35` pins them. Offline, `.xlsx` import fails and the fonts fall back. The script has no `integrity` attribute.
- **Options:**
  - **Load SheetJS on demand** when an `.xlsx` file is chosen, with an `integrity` hash.
  - **Bundle SheetJS,** which adds several hundred KB, more than the constitution's 100 KB budget.
  - **Ship system fonts.**
- **Size:** S to M. **Risk:** medium (network behaviour and appearance).
- **Wait:** this needs the user's decision. It is raised as a fleet attention item.
