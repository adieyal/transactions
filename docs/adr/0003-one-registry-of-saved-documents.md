# 0003. One registry of saved documents

Status: accepted, 2026-10-04

## Context

Saved keys and their shapes are defined in six places: `state.js`, `main.js` boot, `persistence.js`, literal `saveSoon("key", …)` calls in five UI modules, and `backup.js` in three functions. Drift is already visible:

- the seed writes a `demo` document, but boot reads `workspace` (`main.js:132,141`);
- `view` has two shapes.

Story-first adds `answers` and `merchantAnswers` by editing four files by hand.

## Decision

`documents.js` (persistence layer, pure) lists every saved document: storage key, state field, wrapper shape, backup field name, validation, and save delay. Batches stay chunked and special-cased. All of the following derive from that list:

- default state;
- loading at boot (with the same checks as `parseBackup`);
- `actions.save(key)`;
- `createBackup`, `parseBackup` and `workspaceDocuments`.

A test round-trips every entry through both backups and storage.

Storage keys and backup field names stay as they are, for compatibility. A document that fails its check at boot is reported and left in storage, not replaced by a default.

## Consequences

- Adding a saved document becomes one entry plus a check function, and the test proves backups include it.
- `answers` and `merchantAnswers` move into the registry under backlog R2. Story-first's hand edits are valid until then.
- Boot gains validation it doesn't have today. Data that fails a check now produces a visible message, where before it was silently ignored.
- The question of when a workspace stops being a demo is a product decision. The registry only makes the key consistent.
