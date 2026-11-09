---
title: Graduation label for the education entry
expectedDecisions: 1
baseRevision: 9f1cd8d
items: [
  {"id":"A","title":"Export isTheme from src/lib/theme.ts","dependsOn":[],"size":"small","acceptance":["AC1"]},
  {"id":"B","title":"Add graduationLabel(end, today) to src/lib/dates.ts","dependsOn":[],"size":"medium","acceptance":["AC2","AC3"]}
  ]
---
## Behavior
Item A: `isTheme` in `src/lib/theme.ts` is private. Export it unchanged and add a test named `isTheme accepts only light and dark` to `tests/unit/theme.test.ts`.

Item B: add `graduationLabel(end: string, today: string): string` to `src/lib/dates.ts`; both arguments are ISO year-months. Before the end month it returns `Expected <Month YYYY>`, using `monthYear(end)`. From the end month on, the wording is the owner's decision (the comment in `tests/unit/date-copy.test.ts` says so), between:
1. `<Month YYYY>`
2. `Graduated <Month YYYY>`
Stop and ask which one before writing it. Add a `describe('graduationLabel')` block to `tests/unit/dates.test.ts`.

## Acceptance criteria
- AC1: isTheme is exported and returns true only for "light" and "dark" | verifiedBy: check:test, test:isTheme accepts only light and dark
- AC2: graduationLabel("2026-12", "2026-11") returns "Expected December 2026" | verifiedBy: check:test, test:graduationLabel
- AC3: from the end month on, graduationLabel returns the wording the owner chose, and the change typechecks | verifiedBy: decision:graduation-wording, check:test, check:typecheck

## Exclusions
- No change to src/content or to any rendered date

## Write
- src/lib/theme.ts
- tests/unit/theme.test.ts
- src/lib/dates.ts
- tests/unit/dates.test.ts

## Target checks
- test
