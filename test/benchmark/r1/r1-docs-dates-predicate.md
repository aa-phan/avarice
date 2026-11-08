---
title: Export the ISO year-month predicate and document the content date rule
size: medium
expectedDecisions: 0
baseRevision: 9f1cd8d
---
## Behavior
`src/lib/dates.ts` checks content dates with a private regular expression inside `monthYear`. Export `isIsoYearMonth(value: string): boolean`, true exactly for `YYYY-MM` with a month from 01 to 12, and use it inside `monthYear`, which keeps its RangeError and message for anything else. Add a `describe('isIsoYearMonth')` block to `tests/unit/dates.test.ts`. In `docs/architecture.md`, section "Content model", add one rule line: content dates are ISO year-months checked by `isIsoYearMonth` in `src/lib/dates.ts` and shown as "Month YYYY" by `monthYear`.

## Acceptance criteria
- AC1: isIsoYearMonth accepts 2026-12 and 2022-05 and rejects 2026-1, 2026-13, 2026-00, "December 2026" and the empty string | verifiedBy: check:test, test:isIsoYearMonth
- AC2: the existing monthYear tests pass | verifiedBy: check:test
- AC3: the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint

## Exclusions
- No change to how dates are rendered on the site
- No other section of docs/architecture.md changes

## Write
- src/lib/dates.ts
- tests/unit/dates.test.ts
- docs/architecture.md

## Target checks
- test
