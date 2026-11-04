---
phase: quick-261104-nxh
plan: 01
subsystem: containment
tags: [invocation-scope, work-root, runtime-guard, review-fix]
requires: []
provides:
  - "computeInvocationScope refuses a work root that is not a normalized absolute path below '/' (WR-01)"
  - "npm test exercises the no-work-root call at run time (WR-02)"
affects: [src/domain/invocation-scope.ts, docs/containment.md]
key-files:
  created: []
  modified:
    - src/domain/invocation-scope.ts
    - test/unit/invocation-scope.test.ts
    - docs/containment.md
decisions:
  - "Guard throws TypeError (domain convention for a broken caller invariant), not Result; src/app/invocation.ts unchanged"
  - "Trailing slashes accepted and trimmed; guard judges the trimmed value"
status: complete
commits: 3
plan_head_before: d4a320ae08cc1e396dd2fa262a4ac6506e976716
plan_head_after: e50de6f660af94ec31e33a4cf579c48b094bed9d
actuals:
  tokens: 6000
  tasks: 2
  commits: 3
---

# Quick 261104-nxh: Work-root guard in computeInvocationScope Summary

`computeInvocationScope` now runs `checkedWorkRoot` first and throws a TypeError naming `computeInvocationScope: workRoot` for any work root that is empty, relative, '/', '//', '///', non-normalized or not a string; trailing slashes are trimmed and the trimmed value is the one denied last.

## What changed

- `src/domain/invocation-scope.ts`: private `checkedWorkRoot(value: unknown): string` (string operations only, no new imports). It is the first statement of `computeInvocationScope`, so nothing is computed for a refused root. The later `trimTrailingSlashes(input.workRoot)` was removed. The `ScopeInput.workRoot` comment documents the run-time check.
- `test/unit/invocation-scope.test.ts`: rejection tests (empty for all three purposes, relative, '/', '//', '///', non-normalized, non-string), an acceptance test ('/work', '/work/', '/work///', '/srv/a.b/..c'), and the WR-02 rewrite of the no-work-root test. It keeps `@ts-expect-error` and adds `assert.throws` matched by name and message.
- `docs/containment.md`: one sentence in the sandbox-settings paragraph stating the guard, its reason, and WR-01.

## Commits

- a942bc7 test(261104-nxh): failing tests (RED; 6 new/rewritten tests failed, 32 existing passed)
- 0923c03 fix(261104-nxh): the guard (GREEN; 38/38 in the unit file)
- e50de6f docs(261104-nxh): containment doc

## Verification

- `node --test test/unit/invocation-scope.test.ts`: 38 pass, 0 fail.
- `npm run typecheck` clean (the `@ts-expect-error` directive is still used); `npm run check:boundaries` ok (53 files).
- `npm test`: 1276 tests, 1254 pass (1248 baseline + 6 new), 0 fail, 22 skipped.
- `git diff --stat d4a320a -- src/app package.json package-lock.json` is empty. `src/app/invocation.ts` needs no change because its workRoot comes from `profile-paths.ts` (`resolve()` then `realpathNearest()`) and has already passed `checkRoots`, so it is absolute, normalized and never '/'.

## Deviations from Plan

None - plan executed exactly as written. The plan's `git diff` base was written as 72f0c10; the check was run against the current HEAD at start (d4a320a), which is the same for those paths.

## Known Stubs

None.

## Threat Flags

None.

## Notes

- Pre-existing uncommitted `.planning/state.json` and untracked `.planning/config.json` were not touched. An untracked `.claude/worktrees/` directory appeared during the run (created by the harness, not by this task); it was left alone.

## Self-Check: PASSED

- FOUND: src/domain/invocation-scope.ts, test/unit/invocation-scope.test.ts, docs/containment.md
- FOUND commits: a942bc7, 0923c03, e50de6f
