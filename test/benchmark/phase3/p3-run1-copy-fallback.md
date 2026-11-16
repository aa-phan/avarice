---
title: The copy fallback names the address
expectedDecisions: 1
baseRevision: 9f1cd8d
items: [
  {"id":"A","title":"Export isIsoYearMonth from src/lib/dates.ts","dependsOn":[],"size":"small","acceptance":["AC1","AC2"]},
  {"id":"B","title":"Add copyFallback(address) to src/lib/copy.ts","dependsOn":[],"size":"medium","acceptance":["AC3"]},
  {"id":"C","title":"Show copyFallback in src/sections/Contact/Contact.tsx","dependsOn":["B"],"size":"small","acceptance":["AC4"]}
  ]
---
## Behavior
Item A: `src/lib/dates.ts` checks content dates with a private regular expression inside `monthYear`. Export `isIsoYearMonth(value: string): boolean`, true exactly for `YYYY-MM` with a month from 01 to 12, use it inside `monthYear`, and add a `describe('isIsoYearMonth')` block to `tests/unit/dates.test.ts`.

Item B: when copying the email fails, the wording a visitor reads must name the address so they can copy it by hand. B only adds the wording function; item C shows it, and the toast keeps its text. Add `copyFallback(address: string): string` to `src/lib/copy.ts` and a test named `copyFallback names the address` to `tests/unit/copy.test.ts`. The wording is the owner's choice between two options; stop and ask which one before writing it:
1. `Couldn’t copy. Email me at <address>.`
2. `Couldn’t copy the address. Opening your mail app to <address>.`
Keep `COPY_FALLBACK` exported and unchanged in this item.

Item C: the Contact section shows the wording item B chose, so a visitor sees it on the page. In `src/sections/Contact/Contact.tsx`, import `copyFallback` from `@/lib/copy` and add one paragraph, in the muted small text style the hero facts use, as the last child of the section's grid element, after the links list, so the copy button and the links keep their row. The paragraph renders `copyFallback(email)` with the section's own email prop. It has no role and no aria-live attribute, so it is not a second status region. Add `tests/unit/contact-fallback.test.tsx` with a test named `contact shows the copy fallback` that renders the section with an address and finds `copyFallback(address)` in it. Nothing else changes: `COPY_FALLBACK` and `COPY_SUCCESS` stay exactly as they are, the toast, the live-region text and `useCopyEmail` are not touched, and the copy button keeps its accessible name and its markup.

## Acceptance criteria
- AC1: isIsoYearMonth accepts 2026-12 and 2022-05 and rejects 2026-1, 2026-13, 2026-00, "December 2026" and the empty string | verifiedBy: check:test, test:isIsoYearMonth
- AC2: the existing monthYear tests pass and the change typechecks | verifiedBy: check:test, check:typecheck
- AC3: copyFallback returns the wording the owner chose, with the address | verifiedBy: decision:fallback-wording, check:test, test:copyFallback names the address
- AC4: the Contact section renders copyFallback(email) in a paragraph with no status role, COPY_FALLBACK and COPY_SUCCESS are unchanged, and the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint, check:test, test:contact shows the copy fallback

## Exclusions
- No change to COPY_SUCCESS, COPY_FALLBACK, the toast component or useCopyEmail
- No change to how dates are rendered on the site
- No change to any end-to-end spec

## Write
- src/lib/dates.ts
- tests/unit/dates.test.ts
- src/lib/copy.ts
- tests/unit/copy.test.ts
- src/sections/Contact/Contact.tsx
- tests/unit/contact-fallback.test.tsx

## Target checks
- test
