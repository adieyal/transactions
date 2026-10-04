# 0006. Testing pure logic in Node and the UI in headless Chrome

Status: accepted, 2026-10-04

## Context

The pure core is well covered. But 4,633 of the 6,925 lines of application JavaScript are never loaded by a test, and they include real logic: assistant tools, rules-text editing, period statistics and tagging. The constitution requires demo-year tests for new pure logic and headless Chrome checks for visible changes, and it rules out new project dependencies.

## Decision

- **Pure logic lives in pure modules.** Testable logic goes in `transactions/`, `story/`, assistant tools and prompts, the lens runner, or a pure view helper. It is tested with `node --test` against `createDemoData("2026-09-30")`, with `today` passed in.
- **Structural guardrails are tests.** Layers, contracts, documents and network boundaries are checked by Node tests in `npm test`.
- **UI behaviour is checked in headless Chrome.** It uses `playwright-core` installed in a temporary directory outside the repo, and saves screenshots to the job's outbox. It is not part of `npm test`.
- **Existing violations are allowlisted.** Each has a comment naming the backlog item that removes it. A rule is never weakened.

## Consequences

- Moving logic out of the UI is how coverage grows. Tests of DOM glue are not the goal.
- Browser walk-throughs are evidence for a change, not a regression suite. A failure there is caught by whoever runs the walk-through, not by CI.
- Tests never use the real clock, so the demo year produces the same facts on any date.
