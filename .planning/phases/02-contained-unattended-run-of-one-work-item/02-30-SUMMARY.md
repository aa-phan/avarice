---
phase: 02-contained-unattended-run-of-one-work-item
plan: 30
subsystem: run-supervisor
tags: [lease, abort-signal, resume, reap, git-parents, containment, fault-injection]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: run supervisor and lease (02-12), resume reconcile (02-17), the 02-26 gap-closure base
provides:
  - RunStageContext.signal aborted when the supervisor loses the run lease, handed to the unit's host
  - a stage that stops with a conflict before classifying a unit whose lease was lost
  - a resume that stops, rows still started, on a launch it cannot reap (no session ID or no host reap)
  - HeadTrailers.parents and a single-parent-equals-snapshot check in the gated-item reconcile
  - FakeRunHost hangUntilAbort option and test/fault/run-lease-loss.test.ts
affects: [02-35 documentation pass, verify-work 2]

plan_head_before: d401362ea3ab14888a233e44debdab656cb11156
plan_head_after: 91c9750dedc4cc29ac03e558afffb0e7a2491a9c

actuals:
  tokens: 14000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "a per-supervisor AbortController aborted from both lease-renewal failure branches, never from the finally block"
    - "a git log format of %P then %B read in one call, parents validated against the commit pattern"

key-files:
  created:
    - test/fault/run-lease-loss.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-30-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-30-red-evidence-task2.json
  modified:
    - src/app/run-stages/stage.ts
    - src/app/run-service.ts
    - src/app/run-stages/item.ts
    - src/app/run-resume.ts
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts
    - test/helpers/fake-run-host.ts
    - test/integration/run-supervisor.test.ts
    - test/integration/run-resume.test.ts
    - docs/system/runs.md

key-decisions:
  - "A SIGTERM abort of the unit was not added (R-IN-06 optional part): a handler would turn an operator stop into a cancelled unit that the stage then classifies and retries, which needs its own design and an owner decision. Today SIGTERM ends the supervisor at once and the next resume reaps the host by session ID."
  - "The unit stopped by a lost lease returns a conflict error after completeRunInvocation, so the invocation is settled and stays charged but nothing is classified, discarded or retried."
  - "headTrailers carries the parents so no new port method is needed; reconcileGated treats anything but one parent equal to the snapshot head as enforcement_failure with finding check head-moved."

patterns-established:
  - "Own-fixture describes for each reconcile fault case, so a base-run RED of one case cannot contaminate the next"

requirements-completed: [FR-7, CON-13]

coverage:
  - id: D1
    description: "A supervisor that loses its lease during a unit aborts the unit's host at once (process group ended, abort seen within 2000 ms), stops before classify, returns an error, and the invocation stays charged"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/fault/run-lease-loss.test.ts#a lease lost while the unit is in flight aborts the unit (R-IN-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A resume that finds a started launch with no session ID, or a host with no reap, stops with every launch row still started and a failed reconcile step"
    requirement: "CON-13"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a started launch the resume cannot reap stops the resume with every row still started (R-IN-05, T-02-105)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a host composed without reap cannot end a started launch (R-IN-05, T-02-105)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A gated item's moved HEAD is the supervisor's commit only with matching trailers and a single parent equal to the attempt's snapshot head; any other blocks with enforcement_failure"
    requirement: "FR-7"
    verification:
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a commit that carries this attempt's trailers but sits on another parent is not the item's commit (R-IN-08, T-02-57)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume.test.ts#the HEAD commit of a clone names its parents (R-IN-08)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume.test.ts#a supervisor killed between the commit and its record: the commit is recognised by its trailer and kept, never repeated (FR-7, T-02-57)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/system/runs.md describes the lease-loss abort, the unreapable-launch stop, the parent check and the SIGTERM quirk as built"
    verification: []
    human_judgment: true
    rationale: "Prose accuracy and house style are judged by the fresh prose review in plan 02-35, not by a test"

duration: 60min
completed: 2026-11-07
status: complete
---

# Phase 2 Plan 30: Lease-loss abort, unreapable launches and the gated-commit parent Summary

**A supervisor that loses its run lease now aborts its unit's host through a context abort signal and stops before classifying; resume refuses to walk past a launch it cannot reap; and a gated commit is the supervisor's own only when it sits directly on the attempt's snapshot.**

## Performance

- **Duration:** about 60 min (wall clock includes about 25 min of suite runs)
- **Completed:** 2026-11-08T02:44Z
- **Tasks:** 3
- **Files modified:** 13 (including the two RED evidence files)

## Accomplishments

- R-IN-06 fixed: `RunStageContext.signal` is aborted from the lease-renewal timer's failure branch and from the loop's own renewal failure. The unit is invoked with it, and after the invocation is settled the stage returns a conflict ("the run lease was lost during the unit") before the classify checkpoint. Proven with a real process group: the host sees the abort within 2000 ms of the theft (observed about 200 ms, one renewal tick at a 600 ms lease), the group is gone, no classify or discard checkpoint exists, the budget shows 1 used and 0 reserved, and the unit was invoked once.
- R-IN-05 fixed: the reap prelude returns an internal error for a started launch whose step has no session ID or whose host has no reap, instead of `continue`. Every check and reap still completes before any row is marked. `resume --wait` exits 70 with the failed reconcile step naming the missing session ID, all rows stay `started`, and restoring the session ID lets the next resume reap and finish.
- R-IN-08 fixed: `HeadTrailers.parents` (read with the message in one `git log --format=%P%n%B` call) and a check in the gated-item reconcile that the single parent is the snapshot head. A second commit repeating the supervisor's trailers on top of its commit blocks with `enforcement_failure`, records no commit step and hands nothing off. The existing trailer-recognition case still reaches verifying with no second commit.
- `docs/system/runs.md` updated in four places (lease section, reap step, gated-item bullet, one quirk).

## Task Commits

1. **Task 1: Tracer, lease lost during the unit aborts the host (R-IN-06)**
   - RED `07a39a0` (test): fault test and `hangUntilAbort` fake host option
   - GREEN `ce09fa9` (feat): context signal, both abort sites, stop before classify
2. **Task 2: unreapable launch (R-IN-05) and gated-commit parent (R-IN-08)**
   - RED `3cb25ef` (test): four new describes in run-resume.test.ts
   - GREEN `b44e22c` (feat): reap error, `HeadTrailers.parents`, parent check
3. **Task 3: runs.md** - `91c9750` (docs)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Both TDD tasks have a `test(02-30)` commit before the `feat(02-30)` commit. No refactor commits.

- **RED, Task 1** (`02-30-red-evidence-task1.json`): `node --test test/fault/run-lease-loss.test.ts` on the base. Target `the host observes the abort within 2000 ms of the theft` failed with `the host never saw an abort (the unit hung for 10718 ms)`. The error, no-classify and charged-invocation assertions already passed at base because the stolen fence refuses the classify checkpoint, as the plan anticipated. Semantic assessment: the target ran (7 tests, none skipped) and failed on the planned assertion for the intended reason.
- **RED, Task 2** (`02-30-red-evidence-task2.json`): `node --test test/integration/run-resume.test.ts`. 31 tests, 6 failed: the session-ID case (0 !== 70), the no-reap reconcile (ok true !== false), the foreign-parent case (0 !== 3) and the two `parents` cases (undefined). The sixth failure (restore the session ID, then reap) is a knock-on of the session-ID case at base and is recorded as such. Each case runs on its own killed run, so none contaminates another. The first RED run had the no-reap case inside the session-ID describe and leaked the lease on an assertion failure; the cases were split into their own fixtures and the lease release moved to `finally` before the evidence was recorded. The GREEN gate validation was done by the commit log; the `gsd_run check tdd-red-evidence` classifier was not run, because the evidence files follow the plan's own shape (as the earlier plans of this phase do) and not the classifier's `output` record.

## Files Created/Modified

- `src/app/run-stages/stage.ts` - `RunStageContext.signal`
- `src/app/run-service.ts` - one AbortController per supervisor, aborted from the timer branch and the loop branch, left alone by `finally`
- `src/app/run-stages/item.ts` - unit invoked with `ctx.signal`; conflict error after an aborted unit; `reconcileGated` parent check
- `src/app/run-resume.ts` - an unreapable started launch returns an error naming the step, its attempt and what is missing
- `src/ports/run-workspace.ts`, `src/adapters/git/run-workspace.ts` - `HeadTrailers.parents`
- `test/helpers/fake-run-host.ts` - `hangUntilAbort` (sleeper in its own process group, SIGTERM then SIGKILL after 500 ms)
- `test/fault/run-lease-loss.test.ts` - new, 7 tests
- `test/integration/run-resume.test.ts` - four new describes; `run-supervisor.test.ts` - context literal gets a signal
- `docs/system/runs.md` - the four additions

## Decisions Made

- SIGTERM abort not added. The review called it optional. A SIGTERM handler would change how an operator stop ends a supervisor: today the process ends at once and the next resume reaps the host (the documented recovery path); with a handler the stop would become a cancelled unit that the stage goes on to classify and retry, which needs its own design and an owner decision. Plan 02-35 records this reason with the finding's disposition (threat T-02-108, accepted). runs.md carries a quirk bullet.
- `containment.md` (owned by plan 02-27 in this wave) was not touched. For plan 02-35: its host paragraph says the caller passes an abort signal together with the wall-clock timeout. A run-specific sentence is warranted there: for a run the signal is also aborted when the supervisor loses its lease, which ends the host's process group within the adapter's grace like a timeout does, and the invocation stays charged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The fault test drives the supervisor itself, not through `runInProcess`**
- **Found during:** Task 1 (RED)
- **Issue:** `runInProcess` asserts that the supervisor returns ok; here it ends with an error by design.
- **Fix:** the test composes the deps, starts the run and calls `runSupervisor` directly, the way the stale-fence fault test does. `run-fixtures.ts` is unchanged.
- **Files modified:** test/fault/run-lease-loss.test.ts
- **Committed in:** `07a39a0`

**2. [Rule 1 - Bug] RED fixtures of Task 2 shared state between cases**
- **Found during:** Task 2 (first RED run)
- **Issue:** the in-process no-reap case ran before the CLI session-ID case on the same killed run; at base it marked the rows interrupted and, on assertion failure, left a held lease, so the session-ID case failed with a lease conflict instead of the planned assertion (an invalid RED).
- **Fix:** the no-reap case got its own describe and fixture, and its lease release moved into `finally`. The RED was re-run before the evidence was written.
- **Files modified:** test/integration/run-resume.test.ts
- **Committed in:** `3cb25ef`

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug), both in test construction. **Impact:** none on the shipped behavior; no scope creep.

## Issues Encountered

None in the code under change. The known load-sensitive full-suite failures from earlier plans (the SIGTERM case of claude-host.test.ts, fail-closed.test.ts WR-07 and FC-10, the ENOTEMPTY in run-start.test.ts) did not occur; the full suite was clean. This plan touches the supervisor and lease handling, and run-supervisor, run-start and the kill-point suites all passed.

## Verification Results

- `node --test test/fault/run-lease-loss.test.ts test/integration/run-supervisor.test.ts`: 22 pass
- `node --test test/fault/run-killpoints.test.ts test/fault/run-discard-stale-fence.test.ts test/unit/hook-decision.test.ts`: 209 pass, `AC-3: 24/24 interrupted attempts identified`
- `node --test test/integration/run-resume.test.ts test/integration/resume-reap.test.ts test/integration/run-workspace.test.ts`: 68 pass
- `node --test test/fault/run-discard-retry.test.ts test/fault/run-killpoints.test.ts`: 41 pass, AC-3 24/24
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts` ok (79 files)
- `npm test` (full suite): 2567 tests, 2512 pass, 0 fail, 55 skipped (the skips predate this plan); `AC-3: 24/24`
- Acceptance greps: no `new AbortController().signal` left in item.ts; `ctx.signal` at the invoke and the aborted check; `abort()` twice in run-service.ts; `parents` in the port, the adapter and item.ts; the three runs.md greps (aborts, parent, session ID) match; no dash characters in the edited prose.

## Known Stubs

None.

## Threat Flags

None. The plan's register is closed: T-02-105 (unreapable launch), T-02-106 (lost-lease host) and T-02-107 (foreign parent) are mitigated and tested; T-02-108 (operator SIGTERM) is accepted and documented in runs.md.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for the remaining plans of the round and the documentation pass (02-35). To carry into 02-35: the SIGTERM disposition and reason above, the optional containment.md host-paragraph sentence above, and a fresh prose review of the four runs.md additions.

## Self-Check: PASSED

- Files exist: test/fault/run-lease-loss.test.ts, both red-evidence JSON files, this SUMMARY.
- Commits exist on the branch: 07a39a0, ce09fa9, 3cb25ef, b44e22c, 91c9750.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-07*
