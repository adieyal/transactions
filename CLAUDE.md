# Transactions: instructions for agents

Transactions is a single-file browser app (no backend). esbuild bundles `main.js` and its imports into `transactions.html`. **Read [docs/architecture.md](docs/architecture.md) before adding a module, a saved document or a cross-module call.** It explains the rules below, and the [ADRs](docs/adr/) explain why.

## Commands

- `npm ci`: install. Node 22 or newer.
- `npm test`: all tests, including the architecture guardrails (`tests/architecture.test.js`).
- `npm run check`: formatting, tests and build. Run it before every commit.
- `npx prettier --write <files>`: format.
- `transactions.html` and `dist/transactions.html` are generated. Never edit them by hand.

## Architecture rules (enforced by `npm test`)

- **Layers point inwards:** `ui/` → app (`main.js`, `state.js`) → persistence and platform → domain → core.
  - A file's layer is set in the `LAYERS` table of `tests/architecture.test.js`. A new file needs a row there.
  - **Core:** `helpers.js`.
  - **Domain:** `transactions/`, `story/`, `defaults.js`, `demo.js`, `lens-api.js`.
  - **Persistence:** `documents.js`, `backup.js`, `persistence.js`, `storage.js`.
  - **Platform:** `assistant.js`, `downloads.js`.
- **The pure layers stay pure.** `transactions/`, `story/` and `helpers.js` use no `document`, `window`, `$(`, `innerHTML`, storage, `fetch`, `DOMParser`, `new Date()` or `Date.now()`. Take `today` as an argument.
- **No import cycles.** No `ui/` factory imports another; UI modules reach each other only through `actions`.
- **Every `actions.X` must have exactly one provider** (a key in some factory's returned object, or `main.js`).
  - Factories must not touch the DOM or `actions` while being constructed. The test builds them in Node.
- **Saved documents are declared in `documents.js`.** A new saved key needs an entry there, plus loading in `main.js`, a save call, and support in `backup.js` (`createBackup`, `parseBackup`, `workspaceDocuments`). The test checks all of these, and the wrapper shape (`{ map }`, `{ items }` and so on).
- **The network is only touched from `assistant.js`, and storage only from `storage.js`.** Nothing is sent without the person asking.
- **Size limits:** a module over 400 lines warns, and over 700 fails.
- **Existing violations are allowlisted** in the test, each naming the step (R1–R12 in docs/architecture.md) that removes it.
  - Never add an allowlist entry to get new code through, and never weaken a rule.
  - When you fix a violation, delete its entry; a stale entry fails the test.

## Conventions for new code

- **UI modules:** `export function createX(runtime, actions)` returns `{ renderX, wireX, … }`.
  - Register the module in `main.js`.
  - Wire one delegated listener per stable host in `wireX`.
  - Call `actions.refresh()` / `refreshSoon()` after changing state, rather than another module's `renderX`.
- **HTML:** escape every interpolated value with `esc()`, including ids and colours.
- **Pure logic:** put it in `transactions/` or `story/`. Test it with `node --test` against `createDemoData("2026-09-30")`, passing `today`.
- **Visible changes:** check them in headless Chrome (`playwright-core` installed outside the repo) and save screenshots.
- **The project constitution** (voice, privacy, no fallbacks that hide missing data) applies to all generated text and UI.
