---
phase: quick-261104-jnc
plan: 01
subsystem: containment
tags: [hook-decision, grep, CON-1, CR-01, WR-01, WR-03, WR-04, IN-01]
requires: []
provides:
  - "Fail-closed -d/--directories classification in the hook's recursive-grep rule"
  - "LONG_VALUE_OPTIONS and a working-directory fallback for unmodelled long options"
  - "ScopeInput.workRoot required at type level"
affects: [src/domain/hook-decision.ts, src/domain/invocation-scope.ts, docs/containment.md]
key-files:
  modified:
    - src/domain/hook-decision.ts
    - src/domain/invocation-scope.ts
    - docs/containment.md
    - test/unit/hook-decision.test.ts
    - test/unit/invocation-scope.test.ts
    - test/unit/claude-settings.test.ts
    - test/integration/hook.test.ts
    - test/integration/claude-host.test.ts
    - test/containment/failclosed.test.ts
    - test/mutation/scope-and-validation.test.ts
decisions:
  - "Only read and skip (any case) are non-recursive -d/--directories actions; recurse walks; everything else (dereference-recurse, abbreviations, unconsumed values) follows links and is denied shell-recursive-read"
  - "Long options match by exact name only for value consumption; an unmodelled long option followed by an argument adds the cwd to the judged roots"
status: complete
commits: 6
plan_head_before: 50baad4cd87cb70987b73e0f2450b66e1addb91e
plan_head_after: 974d8b13b3ed7ccf29b1c68f29b82ac68e32c866
actuals:
  tokens: 30000
  tasks: 3
  commits: 6
completed: 2026-11-04
---

# Phase quick-261104-jnc Plan 01: Close P-3 (grep -d/--directories recursion) Summary

The hook's recursive-grep detector now fails closed on every `-d`/`--directories` spelling (any case, any abbreviation from `--d`, `dereference-recurse`), long options with a separate value no longer hide the walked root, `ScopeInput.workRoot` is required, and the CON-1 docs row and the WR-04 assertion are truthful.

## Commits

| Commit | Message |
| ------ | ------- |
| 3ee7131 | test: failing tests for -d/--directories recursion spellings (RED, Task 1) |
| 5e67793 | fix: fail closed on every -d/--directories action that is not read or skip (CR-01, P-3) |
| 9a3f7a6 | test: failing tests for long options with a separate value (RED, Task 2) |
| 7ae06e2 | fix: consume separate values of grep long options, judge cwd when unprovable (WR-01) |
| 89f4a39 | docs: CON-1 row states the grep recursion rules; fix the vacuous Read-deny assertion (IN-01, WR-04) |
| 974d8b1 | fix: require ScopeInput.workRoot (WR-03) |

## Evidence

- **Task 1 RED:** `node --test test/unit/hook-decision.test.ts test/integration/hook.test.ts` reported 16 failures (14 spelling cases, the read-root link-following case and the real-hook case), all returning `allow:shell-identity`. After the fix: 119 pass, 0 fail.
- **Task 2 RED:** 3 failing tests (the narrowEnv cwd case, the precise separate-value case including `grep --directories RECURSE x src`, the unmodelled-option case). After the fix: unit and hook files 124 pass, 0 fail.
- **WR-04 mutation:** with `&& !containsStaging(path, staging)` removed from `src/adapters/host-claude/settings.ts`, the "denies the work root and re-allows only this staging" test FAILED on "no Read permission deny names a root that contains the staging". After `git checkout -- src/adapters/host-claude/settings.ts` it PASSED (also passed on the unmodified code before the mutation). The mutation was never committed; settings.ts has no diff.
- **WR-03 tsc pin:** with the field temporarily made optional, `npx tsc -p .` reported `error TS2578: Unused '@ts-expect-error' directive` in `test/unit/invocation-scope.test.ts` (plus a type error in invocation-scope.ts). Field restored to required; tsc exits 0.
- **Final:** `npx tsc -p .` exit 0; `node scripts/check-boundaries.ts` ok (53 files); `npm test`: 1262 tests, 1240 pass, 0 fail, 22 skipped (baseline 1218 pass).
- `package.json` and the lockfile are unchanged.

## Deviations from Plan

None to the plan's behavior. Process note: while proving the WR-03 pin I ran `git checkout` on `src/domain/invocation-scope.ts` to undo the temporary mutation, which also discarded my uncommitted Task 3 production edit; I restored it from the `sed -i.bak` backup and confirmed the diff matches the intended change before running the full suite and committing.

## Known Stubs

None.

## Threat Flags

None.

## Out of scope (unchanged)

WR-02 (which grep the contained shell runs) remains an unresolved residual, now recorded in the CON-1 row. IN-02, IN-03 and the review-disposition ledger were not touched.

## Self-Check: PASSED

All six commits are ancestors of HEAD; the SUMMARY's modified files exist; tsc, boundaries and npm test are green.
