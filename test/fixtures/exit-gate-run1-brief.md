---
title: The copy fallback names the address
expectedDecisions: 1
baseRevision: 9f1cd8d
items: [
  {"id":"A","title":"Export isIsoYearMonth from src/lib/dates.ts","dependsOn":[],"size":"small","acceptance":["AC1","AC2"]},
  {"id":"B","title":"Add copyFallback(address) to src/lib/copy.ts","dependsOn":[],"size":"medium","acceptance":["AC3"]},
  {"id":"C","title":"Use copyFallback in src/components/ui/useCopyEmail.ts","dependsOn":["B"],"size":"small","acceptance":["AC4"]}
  ]
---
## Behavior
Item A: `src/lib/dates.ts` checks content dates with a private regular expression inside `monthYear`. Export `isIsoYearMonth(value: string): boolean`, true exactly for `YYYY-MM` with a month from 01 to 12, use it inside `monthYear`, and add a `describe('isIsoYearMonth')` block to `tests/unit/dates.test.ts`.

Item B: when copying the email fails, the toast must name the address so a visitor can copy it by hand. Add `copyFallback(address: string): string` to `src/lib/copy.ts` and a test named `copyFallback names the address` to `tests/unit/copy.test.ts`. The wording is the owner's choice between two options; stop and ask which one before writing it:
1. `Couldn’t copy. Email me at <address>.`
2. `Couldn’t copy the address. Opening your mail app to <address>.`
Keep `COPY_FALLBACK` exported and unchanged in this item.

Item C: `useCopyEmail` shows `copyFallback(address)` instead of `COPY_FALLBACK` when copying fails, and `COPY_FALLBACK` is removed from `src/lib/copy.ts` with every import of it.

## Acceptance criteria
- AC1: isIsoYearMonth accepts 2026-12 and 2022-05 and rejects 2026-1, 2026-13, 2026-00, "December 2026" and the empty string | verifiedBy: check:test, test:isIsoYearMonth
- AC2: the existing monthYear tests pass and the change typechecks | verifiedBy: check:test, check:typecheck
- AC3: copyFallback returns the wording the owner chose, with the address | verifiedBy: decision:fallback-wording, check:test, test:copyFallback names the address
- AC4: useCopyEmail uses copyFallback, COPY_FALLBACK no longer exists, and the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint, check:test

## Exclusions
- No change to COPY_SUCCESS or the toast component
- No change to how dates are rendered on the site

## Write
- src/lib/dates.ts
- tests/unit/dates.test.ts
- src/lib/copy.ts
- tests/unit/copy.test.ts
- src/components/ui/useCopyEmail.ts

## Target checks
- test
