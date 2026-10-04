# 0002. Declared module contracts instead of an open `actions` object

Status: accepted, 2026-10-04

## Context

Every UI factory receives one shared `actions` object, adds its functions to it with `Object.assign` (`main.js:27-50`), and calls the others through it. Measured, that is 76 functions, 264 call sites, and one 18-module cycle that the import graph doesn't show:

- nothing checks providers, so a typo fails only when its code path runs;
- a later module silently replaces an earlier one's function of the same name.

All factories are constructible in Node with no DOM: each one returns its functions without touching the DOM or `actions`.

## Decision

Keep the `createX(runtime, actions)` factory shape, and make the wiring declared and checked:

- **Every module declares a contract.** It exports `contract = { name, create, provides, requires, renders, wires }`.
- **The registry builds `actions` from the contracts.** `registry.js` builds the shared table, throws on a duplicate or missing provider, and freezes it.
- **Each module gets a scoped view.** It receives a `Proxy` that throws on any name it didn't declare in `requires`.
- **A Node test checks the contracts.** It builds the registry with fake runtimes, and checks that each module's `actions.X` references, found in its source, are all in its `requires`.
- **Construction stays DOM-free.** Factories must not touch the DOM or `actions` while being constructed.
- **Modules call commands, not renders.** Cross-module calls go to commands such as `highlight`, `clearFocus` and `save`, never to another module's `renderX`.

## Consequences

- Each module's dependencies can be read in its first lines, and the test keeps them true.
- The cycle doesn't disappear at once, but it becomes visible and countable, and the test can cap it.
- A small amount of boilerplate per module. Adding a call means also adding a `requires` entry.
- Rejected: an event bus, because it hides dependencies even more; dependency injection by explicit argument lists, because it is a larger rewrite than the story-first branch can absorb; and a framework, because it would be a new runtime dependency.
