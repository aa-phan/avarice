---
title: swipeDirection ignores non-finite deltas
size: medium
expectedDecisions: 0
baseRevision: 9f1cd8d
---
## Behavior
`swipeDirection(dx, dy)` in `src/hooks/useSwipeStep.ts` returns -1 when `dx` is NaN, because every comparison with NaN is false and the function falls through to the direction branch, and it returns a step for an infinite `dx`. A gesture whose delta is not a finite number must not step: return `null` when `dx` or `dy` is NaN, Infinity or -Infinity. First add a failing unit test named `ignores non-finite deltas` to the `swipeDirection` describe block in `tests/unit/swipe-step.test.ts`, then fix the function. Behaviour for finite deltas is unchanged.

## Acceptance criteria
- AC1: swipeDirection returns null when dx or dy is NaN, Infinity or -Infinity | verifiedBy: check:test, test:ignores non-finite deltas
- AC2: every existing swipeDirection and useSwipeStep test still passes | verifiedBy: check:test
- AC3: the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint

## Exclusions
- No change to SWIPE_MIN_PX or SWIPE_RATIO
- No change to useSwipeStep's pointer handling

## Write
- src/hooks/useSwipeStep.ts
- tests/unit/swipe-step.test.ts

## Target checks
- test
