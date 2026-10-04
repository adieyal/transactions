# 0010. Embedded fonts

Status: accepted, 2026-10-04 (the canvas UI brief, M1). Supersedes the fonts decision in [ADR 0007](0007-single-file-no-backend-network-boundary.md).

## Context

The canvas design puts "Private to this device" in the header of every screen. ADR 0007 kept Google Fonts external, which meant one request to Google on every load. The canvas UI brief asks for no request at all except from `assistant.js`, with the fonts embedded.

## Decision

- **Two families, embedded.** Frank Ruhl Libre (weights 400 to 700) and Instrument Sans (400 to 600), each one variable woff2 file with the Latin subset, in `fonts/` with its SIL Open Font License beside it.
- **Inlined by the build.** `styles.css` names `url(fonts/<file>.woff2)`; `scripts/build.mjs` swaps each for a `data:font/woff2;base64,…` URL.
- **No `<link>` to a font service.** `tests/build.test.js` fails if `fonts.googleapis`, `fonts.gstatic` or any `<link>` appears in the build, or if either family is missing its embedded `@font-face`.

## Consequences

- The page makes no request on load.
- The build grows by about 100 KB (74 KB of woff2 as base64).
- Noto Sans Hebrew and the Hebrew subset of Frank Ruhl Libre are no longer loaded. Hebrew text and the ₪ sign fall back to the system's fonts. Adding the Hebrew subset of Frank Ruhl Libre (19 KB) is a later choice.
