# 0004. One refresh path

Status: accepted, 2026-10-04

## Context

Four hand-kept lists decide which views to redraw after a change:

- `renderAll` (`main.js:53-71`, which calls `renderReports` twice);
- `refreshSoon` (`main.js:186-193`);
- the rules input (`ui/chrome.js:101-111`);
- the filter (`ui/filter.js:68-77`).

On top of these, 34 direct `actions.renderX()` calls are spread across `ui/` and `suggestions.js`. A new panel has to be added to every list, and if it is left out of one, that path shows stale data with no error.

## Decision

- **Registered renders.** Modules list their renders in `contract.renders`.
- **One full refresh.** `actions.refresh()` re-derives once, then calls every registered render in registration order.
- **One debounced refresh.** `actions.refreshSoon()` does the same, debounced at 250 ms.
- **Each render owns its visibility.** A render returns early if its pane is hidden.
- **Expensive views debounce themselves.** Lenses, for example, debounce inside their own render.
- **Only direct self-renders.** A module calls its own render directly only for hot interactions, such as dragging. Cross-module re-rendering always goes through `refresh`.

## Consequences

- New panels such as `ui/month.js` and `ui/questions.js` are kept up to date by declaring `renders`, and nothing else.
- Some paths render more than they do today; for example, typing a rule also re-renders chrome. The debounce and early-return checks keep that cheap. If a profile shows a real cost, the fix is a narrower render inside the module, not a new list.
- Rejected: topic-based subscriptions, because they reintroduce per-path lists in another form, and that precision isn't needed at this size.
