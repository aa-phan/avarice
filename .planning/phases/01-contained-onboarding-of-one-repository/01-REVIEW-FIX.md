---
phase: 01-contained-onboarding-of-one-repository
fixed_at: 2026-11-04T00:00:00Z
review_path: .planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-11-04
**Source review:** .planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: `computeInvocationScope` can now throw after the invocation has been reserved

**Files modified:** `src/app/invocation.ts`, `src/app/stages/index-knowledge.ts`, `test/fault/budgets.test.ts`
**Commit:** 8e4cd18
**Applied fix:** `prepareInvocation` now computes the scope before `reserveInvocation`. A throw from the work-root check becomes `err({ kind: 'invalid', field: 'workRoot', reason })`, so nothing is reserved, started or recorded. This differs slightly from the suggested fix. The scope does not depend on the reservation, so it moves earlier and `checkedWorkRoot` stays private. In `runKnowledgeStep`, a throw from `planExtractionChunks` becomes an absent index (`invocation-failed`) instead of a crash. New test in `test/fault/budgets.test.ts` passes work roots `relative/work`, `/`, `/work/../x` and `''` and asserts a typed `invalid` error. It also asserts the budget rows are unchanged and no `launch:map` step was recorded. The test fails without the fix (checked by reverting `src/app/invocation.ts`). The `planExtractionChunks` guard has no dedicated test, because the staging path that feeds it is always a realpath.
**Status note:** fixed: requires human verification (ordering and error-handling change).

### WR-02: The `assert-exit` unread gate trusts self-reported counters with no consistency check

**Files modified:** `scripts/assert-exit.ts`, `test/unit/checkout-digest.test.ts`
**Commit:** c638a5a
**Applied fix:** `judgeExit` now fails when `documentsExpected` or `dropped.unread` is not a non-negative integer ("malformed"). It also fails when `documentsExpected < 1` or `unread > documentsExpected` ("inconsistent"). The raw values stay in the JSON facts for diagnosis. New unit cases cover `documentsExpected` of 0, negative and fractional, `unread` negative and fractional, and `unread > documentsExpected`. Two coherent shapes (1 of 1, 25 of 25) still pass.
**Status note:** fixed: requires human verification (gate logic).

### WR-03: `chunkPlanNormalized` swallows every error, so the plan-equality assertions can pass vacuously

**Files modified:** `test/fault/killpoints.test.ts`
**Commit:** 6101f0f
**Applied fix:** Removed the try/catch. A missing or unparseable plan now throws, and a plan that is not a JSON object fails an `assert.ok`. Every `outcomeOf` call runs after a completed onboarding, so a plan is always expected. The reference and compared plans can no longer both be `null`. All 22 tests in `killpoints.test.ts` pass.

## Verification

Gates ran in the isolated review-fix worktree (inside the repository, resolving the main checkout's `node_modules`), before the fast-forward into `gsd/phase-01-contained-onboarding-of-one-repository`. They are reproducible from the main checkout, which now holds the same commits.
- `npx tsc -p . && node scripts/check-boundaries.ts`: clean (53 files).
- `env -u AVARICE_LIVE npm test`: 1301 tests, 1279 pass, 0 fail (the rest skipped). The known SIGTERM/SIGKILL grace flake did not fail in this run.
- AVARICE_LIVE stayed unset, and no live run was started.
- The unrelated working-tree files (`.planning/state.json`, `.planning/config.json`, `.planning/milestone.lock`, `.claude/`) were not staged or committed.

---

_Fixed: 2026-11-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
