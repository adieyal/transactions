# 0007. One file, no backend, and a named network boundary

Status: accepted, 2026-10-04

## Context

The constitution requires:

- one HTML file that works offline, with no backend;
- no data sent anywhere unless the person asks for it at that moment;
- no change to what the privacy messages promise without escalation.

Today:

- `fetch` appears only in `assistant.js`;
- `localStorage` is used directly by `storage.js`, `ui/assistant-settings.js` and `ui/tour.js`;
- the page loads Google Fonts and the SheetJS script from CDNs (`index.html:7-10`);
- lens code from an imported backup runs with page access (`ui/lenses.js:60`).

## Decision

- **The build stays single-file.** `scripts/build.mjs` produces one self-contained HTML file. A new bundled runtime dependency, or more than 100 KB of growth, is escalated.
- **Only named modules may talk to the network.** Code that sends data is `assistant.js` (`fetch`) and `caps.sample` calls, and both run only from a handler the person triggered. A guardrail test fails on `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` anywhere else.
- **Storage access goes through `storage.js`.** It is the only module that names `localStorage` keys or the `db` collection. Today's two UI exceptions are allowlisted under backlog R11.
- **What leaves the browser is testable.** Prompt and tool payloads are built by pure functions.
- **The CDN fonts and SheetJS, and the trust given to lens code in imported backups, are recorded as open questions for the user.** This ADR doesn't decide them.

## Consequences

- The privacy promise can be checked by a test, at least for where requests can come from.
- Bundling SheetJS would grow the file by several hundred KB, and dropping the fonts changes the look. Both need the user's decision before anyone acts.
