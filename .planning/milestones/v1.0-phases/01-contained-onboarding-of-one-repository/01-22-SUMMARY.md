---
phase: 01-contained-onboarding-of-one-repository
plan: 22
subsystem: git-staging-containment
tags: [git, staging-diff, gitignore, scope-of-writes, activation-scope, tdd]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: staging diff (StagingBase.changes), validation scope-of-writes, activation scopeCheck (T-01-67)
provides:
  - "Staging diff that lists every ignored untracked file, one record per file"
  - "parseStatus that reads `!` records as untracked"
  - "Hostile `.gitignore` of `*` tests for validate and activate, positive controls and a preflight check"
affects: [validation, activation, index-stage, preflight]

plan_head_before: 5dbcf40c17651571bdc91f546809155457739236
plan_head_after: 335c67431da47c83a243353449fbb619ed3e9ffd

actuals:
  tokens: 7000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The repository is the hostile input: its committed .gitignore is part of the staging checkout and must not shape what the detection backstop sees"

key-files:
  created:
    - test/integration/ignored-writes.test.ts
    - test/unit/repo-facts.test.ts
    - .planning/phases/01-contained-onboarding-of-one-repository/01-22-red-evidence-task1.json
  modified:
    - src/adapters/git/staging-base.ts
    - src/adapters/git/repo-facts.ts
    - test/integration/staging-adapters.test.ts

key-decisions:
  - "Use `--ignored=traditional` with `--untracked-files=all`, not the gap text's `--ignored=matching`: matching collapses an ignored directory into one `dir/` record that hides its files (and `.planning/codebase/` would be read as an extra map file); traditional prints one `!` record per file"
  - "No write set widened: AVARICE_WRITE_SET, AVARICE_TRACKED_WRITABLE and the agent write sets are untouched; positive controls prove AVARICE's own outputs stay admitted under a `*` ignore"
  - "collectRepoFacts keeps its status call on the user's checkout with no ignored mode, so ignored checkout files (local .env, build output) never become preflight facts"

patterns-established:
  - "Hostile-repository fixture: hostileIgnoreRepo() commits a force-added `.gitignore` of `*` and returns the pin of that commit"

requirements-completed: [ONB-3]

coverage:
  - id: D1
    description: "changes() lists each ignored untracked file of staging as its own `added` record, sorted, with no collapsed directory record"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/staging-adapters.test.ts#lists every untracked file of staging, one record per file, when the committed .gitignore ignores everything"
        status: pass
    human_judgment: false
  - id: D2
    description: "Validation's scope-of-writes check fails an ignored out-of-set write, remaps once, blocks with a decision, and the containment.finding names the file path (including per-file and prefix-adjacency cases)"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/ignored-writes.test.ts#validation under a hostile .gitignore of `*`"
        status: pass
      - kind: integration
        ref: "test/integration/ignored-writes.test.ts#validation reports ignored files one by one"
        status: pass
    human_judgment: false
  - id: D3
    description: "Activation blocks with enforcement_failure and an activation-scope finding when an invocation writes an ignored stray file; a clean hostile-repository run still activates, with the real graphify too"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/ignored-writes.test.ts#activation under a hostile .gitignore of `*`"
        status: pass
      - kind: integration
        ref: "test/integration/ignored-writes.test.ts#the real code graph under a hostile .gitignore of `*`"
        status: pass
    human_judgment: false
  - id: D4
    description: "Preflight facts do not list ignored files of the user's checkout; parseStatus reads ! records as untracked, sorted"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/ignored-writes.test.ts#preflight facts"
        status: pass
      - kind: unit
        ref: "test/unit/repo-facts.test.ts#parseStatus"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-04
status: complete
---

# Phase 01 Plan 22: Ignored Writes Visible to the Staging Diff Summary

**One git flag (`--ignored=traditional`) and one parser case (`!` records) stop a hostile repository's committed `.gitignore` of `*` from hiding an out-of-set write from validation's scope-of-writes check and the activation scope check.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-11-04T09:50:22Z
- **Completed:** 2026-11-04T09:57:00Z
- **Tasks:** 2
- **Files modified:** 6 (plus the RED evidence record)

## Accomplishments

- Gap P-2 (review CR-03) closed: `GitStagingWorkspace.changes()` now passes `--ignored=traditional` to `git status`, and `parseStatus` pushes `!` records into `untracked`, so `added` carries every ignored file of staging by file path.
- A hostile repository (committed `.gitignore` of `*`) with an out-of-set write now fails validation through the real CLI (exit 3, blocked/decision, two rejected `validate` steps, `containment.finding` check `scope-of-writes` with paths `['evil.txt']`) and blocks activation in-process (`enforcement_failure`, `activation-scope` finding naming `evil.txt`).
- Positive controls show AVARICE's own outputs stay admitted under `*` by the unchanged write sets: the in-process run with the fake intel host reaches `active` with five intel files, and the CLI run with the real graphify reaches `active` with `indexes.graph`.
- Preflight is unchanged: `collectRepoFacts` still runs status without an ignored mode, and a test pins that an ignored `local.secret` in the checkout is not a fact.

## Task Commits

1. **Task 1 (tracer): hostile `.gitignore` no longer hides an out-of-set write** - `8196b96` (test, RED), `c7756a1` (feat, GREEN)
2. **Task 2: activation, per-file, prefix, positive controls, preflight, parseStatus unit** - `335c674` (test)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## TDD Gate Compliance

- **RED (`8196b96`):** two target tests were added and failed on the planned assertion: the `changes()` test (`added` was `[]`, expected the four ignored files) and the CLI validate test (onboarding exited 0 and reached `active` instead of exit 3). `gsd-tools check tdd-red-evidence` on `01-22-red-evidence-task1.json` returned `RED_EVIDENCE_OK` (`target_test_failed`, TAP, 23 tests, 1 failing = the target). Semantic assessment: the target executed and failed because a committed `*` hides every staging write, not because of syntax, fixture or unrelated faults.
- **GREEN (`c7756a1`):** the flag and the parser case made both RED tests pass (24/24 in the two files).
- **REFACTOR:** none needed.
- Task 2 is a coverage and positive-control task over the Task 1 behaviour, so its tests were green on arrival (its single new RED-able behaviour, the activation case, was verified by the mutation check below).

**Mutation check (Task 2 acceptance):** removing `--ignored=traditional` from `staging-base.ts` (saved copy restored afterwards, `git diff` empty) turned four tests red: the validate CLI test, the per-file test, the prefix-adjacency test and the activation test. The positive controls and the preflight test stay green, as they should.

## Files Created/Modified

- `src/adapters/git/staging-base.ts` - `changes()` status argv gains `--ignored=traditional`; comment gives the reason and the git 2.39.5 observation
- `src/adapters/git/repo-facts.ts` - `parseStatus` reads `!` like `?`; comment states only the staging diff asks for ignored files
- `test/integration/ignored-writes.test.ts` - `hostileIgnoreRepo()`, validate/per-file/prefix/activation tests, two positive controls, preflight check (7 tests)
- `test/unit/repo-facts.test.ts` - `parseStatus` record coverage (5 tests)
- `test/integration/staging-adapters.test.ts` - one new `changes()` test on a clone staging of a hostile repository
- `.planning/phases/01-contained-onboarding-of-one-repository/01-22-red-evidence-task1.json` - RED evidence record

## Decisions Made

See `key-decisions`. The one departure from the gap text (`--ignored=matching` to `--ignored=traditional`) is the plan's own, made on a recorded git probe, and the new `changes()` test pins the per-file listing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fixture] Used `src/c.ts` instead of `src/b.ts` for the new staging-adapters test**
- **Found during:** Task 1 (RED)
- **Issue:** The plan's expected `added` includes `src/b.ts`, but `BASE_FILES` in staging-adapters.test.ts already tracks `src/b.ts`, so writing it would be a modification, not an added ignored file.
- **Fix:** Wrote `src/c.ts` instead; the expected `added` is `['.planning/codebase/STACK.md', 'evil.txt', 'evil/x.sh', 'src/c.ts']`.
- **Files modified:** test/integration/staging-adapters.test.ts
- **Committed in:** `8196b96`

---

**Total deviations:** 1 auto-fixed (test fixture name)
**Impact on plan:** None on behaviour or scope.

## Verification

- `node --test` on staging-adapters, ignored-writes, repo-facts, validation-failures, intel-step, index-stage, knowledge-pass, skeleton: pass 134, fail 0, skipped 0
- `node --test test/fault/killpoints.test.ts`: pass 22, fail 0
- `npx tsc -p .` exit 0; `node scripts/check-boundaries.ts`: `ok (53 file(s))`
- Full suite `npm test` (`node --test`): tests 1206, pass 1184, fail 0, skipped 22 (skips predate this plan)
- `grep -c "ignored=traditional" src/adapters/git/staging-base.ts` = 1; `grep -c "case '!'" src/adapters/git/repo-facts.ts` = 1; `src/domain/validation.ts` unchanged
- The CLI graphify positive control ran and passed on this machine (graphify installed at `~/.local/bin/graphify`), it did not skip

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. T-01-75 (mitigate) and T-01-77 (mitigate) are covered by the tests above; T-01-76 (accept) is evidenced by the positive controls.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Gap P-2 is closed; the remaining gap-closure plans of the phase are unaffected. One behavioural note for later runs: a GSD verb that writes an ignored file (for example a lock file) into staging outside the write sets will now be reported and block activation with an `activation-scope` finding naming the path. The planning-time probe of the 01-19 exit-run staging showed zero ignored files, so the recorded target run is unaffected.

## Self-Check: PASSED

- FOUND: test/integration/ignored-writes.test.ts, test/unit/repo-facts.test.ts, 01-22-red-evidence-task1.json
- FOUND commits: 8196b96, c7756a1, 335c674

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-04*
