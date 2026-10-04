# 0005. Escaped template strings and delegated events

Status: accepted, 2026-10-04

## Context

Views are template strings assigned with `innerHTML`. Free text is escaped with `esc()` (93 calls). Ids and colours, however, are interpolated raw, and are safe only because `parseBackup` validates them in another file. The assistant label `actions.AI()` is inserted unescaped at 14 sites. Events are wired in three styles: delegated on a host, per-render listeners, and `window` listeners in four modules.

## Decision

- **Keep template strings.** No framework, no virtual DOM, no new runtime dependency.
- **Escape by default in new code.** New and edited templates use an `html` tagged template from `ui/dom.js` that escapes every value unless it is wrapped in `raw()`.
- **Wire events once.** Each module adds one delegated listener per stable host in `wireX()`, dispatching on `data-*` attributes, and adds no listeners inside renders.
- **Global listeners live in `ui/chrome.js`** (the keyboard map) and in `ui/tour.js` while it is open.
- **Mark generated sentences with their transactions.** Each carries `data-ids`, so hovering it can highlight its transactions.

## Consequences

- Escaping no longer depends on validation done elsewhere, and a reviewer can check a template on its own.
- Existing templates move to `html` as they are touched (backlog R10), with no big-bang rewrite.
- Re-rendering by `innerHTML` still loses focus and scroll position inside a pane. Inputs being typed into must not be re-rendered; today's `qTagForm` check (`ui/filter.js:17`) shows the pattern.
