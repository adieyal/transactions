# 0001. Layers and dependency direction

Status: accepted, 2026-10-04

## Context

The static import graph has no cycles, but layer boundaries have started to leak:

- `persistence.js:2` and `suggestions.js:2` import `ui/dom.js`;
- `transactions/import.js` uses `DOMParser` and `window.XLSX`;
- `helpers.js` mixes the DOM query `$` and a load-time clock (`TODAY`) with pure helpers.

Charter decision 3 requires `transactions/` and `story/` to stay pure. Story-first is adding `story/*` in parallel, and it imports `helpers.js`.

## Decision

The app has five layers, with dependencies pointing inwards only: `ui → app → persistence/platform → domain → core`. `scripts/` is build-only and never bundled. `docs/architecture.md` section 1 defines what each layer may import and use.

A file's layer comes from a table in `tests/architecture.test.js`, not from its folder. Root files keep their paths until moving them is cheap, and a moved file leaves a re-export at its old path.

`tests/architecture.test.js` reads the import graph and fails on:

- an import that points the wrong way;
- a cycle;
- browser globals in `core` or `domain`.

Today's violations are allowlisted entries, each with a comment naming the backlog item that removes it.

## Consequences

- The rules apply immediately, without moving files under the story-first branch.
- `helpers.js` stays importable by `story/*`. Its DOM and clock parts move out under backlog R5.
- Adding a file means adding a row to the layer table. An unlisted file fails the test, so every new file gets a deliberate layer.
- Folder names (`core/`, `persistence/`, `platform/`, `assistant/`) are targets, not prerequisites.
