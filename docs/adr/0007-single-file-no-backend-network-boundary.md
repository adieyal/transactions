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
- **The CDN fonts and SheetJS, and the trust given to lens code in imported backups, were recorded as open questions for the user.** The user's answers are under "Decisions taken" below.

## Decisions taken

- **Fonts (user, 2026-10-04): keep the external Google Fonts.** `index.html` keeps loading Frank Ruhl Libre, Instrument Sans and Noto Sans Hebrew from Google Fonts. They are page styling, not data, and nothing about the person's statements is sent with them. Offline, the browser falls back to its own fonts, and the app still works.
- **SheetJS (user, 2026-10-04): load it on demand, not on page load and not bundled.** `files.js` adds the pinned script (`xlsx/0.18.5/xlsx.full.min.js` on cdnjs) with an `integrity` hash and `crossorigin="anonymous"`, and only when someone chooses an `.xlsx` or `.xls` file. That choice is the person asking. If the script can't load (offline, blocked, or a hash that doesn't match), the import shows "The spreadsheet reader couldn't load … Save the file as CSV and add that instead." and nothing else happens. A guardrail allows `<script>` creation only in `files.js`.
- **Lens code (user, 2026-10-04): runs in a sandbox.** Every lens, yours, the starter ones and any from a backup, runs in a hidden `<iframe sandbox="allow-scripts">` (opaque origin, no `allow-same-origin`) built from `srcdoc`. A CSP meta tag (`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'`) blocks every request; `unsafe-eval` is there because lenses are built with `new Function`. Data goes in and plain view data comes back by `postMessage`, and replies are accepted only from the frame. Views are drawn by the escaped `renderView`. A lens that runs longer than 1.5 seconds is stopped by replacing the frame, and lenses queued behind it run in the new one. Lenses from an imported backup are labelled "From your backup" (`fromBackup`). The switched-off state that step 8 saved (`off`) still loads, as that label. This replaces step 8's "imported lenses arrive switched off".

## Consequences

- The privacy promise can be checked by a test, at least for where requests can come from.
- Bundling SheetJS would grow the file by several hundred KB, and dropping the fonts would change the look. The fonts stay external by the user's decision.
