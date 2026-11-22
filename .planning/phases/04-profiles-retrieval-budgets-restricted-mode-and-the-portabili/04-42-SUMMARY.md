---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 42
subsystem: approval gate, resume, path-scoped mapping
tags: [no-replay, privileged-action, resume, reap, mapping-scope, gap-closure]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: the approval gate (04-16), run reconcile (04-20), onboarding resume and promotion (04-21), path-scoped refresh (04-14)
provides:
  - gate-level no-replay rule `interrupted-action-open` with exact start matching by `startSeq`
  - re-block of a blocked run that has an interrupted privileged action
  - fail-closed onboarding resume for an unreapable started launch
  - refusal of a damaged path-scoped mapping plan
affects: [04-53 documentation plan]

actuals:
  tokens: 8921
  tasks: 3
  commits: 6
plan_head_before: 2f25defed40981c68df073f44c176ac3442329e5
plan_head_after: af1a505f702ef66f8029f6e552ab13959b00e5a3

tech-stack:
  added: []
  patterns:
    - "the no-replay rule lives in the gate, not in each caller"
    - "an end event names the start it ends (startSeq); an end without it keeps the earliest-open-start meaning"
    - "a recovery path that cannot vouch for a host or a scope stops with a typed error rather than continuing"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-42-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-42-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-42-red-task3.json
  modified:
    - src/app/authorize.ts
    - src/app/stages/promote.ts
    - src/app/run-resume.ts
    - src/app/resume.ts
    - src/app/invocation.ts
    - src/app/stages/shared.ts
    - test/fault/privileged-no-replay.test.ts
    - test/integration/resume-reap.test.ts
    - test/integration/refresh-scoped.test.ts
    - test/integration/approvals.test.ts
    - test/integration/lease.test.ts

key-decisions:
  - "interrupted-action-open is a denied outcome of authorizeAction (not an error), checked after the policy deny and before any start or approval consumption, only for actions that would record a start"
  - "finishPrivilegedAction takes an optional startSeq (fifth argument) so existing four-argument callers keep their meaning"
  - "a blocked run with any reason other than enforcement_failure is paused and re-blocked with enforcement_failure when it holds an interrupted privileged action"

requirements-completed: [FR-15, FR-12, CON-4, ONB-11]

coverage:
  - id: D1
    description: "The approval gate refuses a second start of an action whose earlier start with the same scope, action and parameter digest has no finish, and records nothing (WR-09)"
    requirement: FR-15
    verification:
      - kind: integration
        ref: "test/fault/privileged-no-replay.test.ts#a second start of the same scope, action and parameters is denied with interrupted-action-open and writes no second action.started"
        status: pass
    human_judgment: false
  - id: D2
    description: "action.finished names its start by startSeq; an earlier open start of other parameters stays reported as interrupted with its own summary; an end without startSeq still closes the earliest open start (WR-09)"
    requirement: FR-15
    verification:
      - kind: integration
        ref: "test/fault/privileged-no-replay.test.ts#an earlier start with parameters X left open stays reported as interrupted, with the summary of X, when a later start with parameters Y finishes"
        status: pass
      - kind: integration
        ref: "test/fault/privileged-no-replay.test.ts#an action.finished written before startSeq existed still closes the earliest open start of its action"
        status: pass
    human_judgment: false
  - id: D3
    description: "A run blocked on an answered item decision with an interrupted privileged action is re-blocked with enforcement_failure and is no longer continuable (WR-08)"
    requirement: FR-15
    verification:
      - kind: integration
        ref: "test/fault/privileged-no-replay.test.ts#resume re-blocks the run with reason enforcement_failure, opens the permission decision, and the supervisor no longer continues it"
        status: pass
    human_judgment: false
  - id: D4
    description: "An onboarding resume stops with an internal error naming the onboarding when a started launch has no host for its mode, a host with no reap, or no session ID, and marks no launch interrupted (WR-07)"
    requirement: CON-4
    verification:
      - kind: integration
        ref: "test/integration/resume-reap.test.ts#resume stops when a started launch cannot be reaped (WR-07, CON-4)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A path-scoped mapping plan with no path, a non-string entry or an invalid scope path is refused with an invalid mapping:plan error and never widened to the whole read scope (WR-10)"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/refresh-scoped.test.ts#a damaged path-scoped mapping plan is refused instead of reading the whole repository (WR-10, ONB-11)"
        status: pass
    human_judgment: false

duration: 75min
completed: 2026-11-22
status: complete
---

# Phase 04 Plan 42: Recovery-path fail-open closures (WR-07 to WR-10) Summary

**The approval gate itself refuses a second start while an earlier identical start is open (ends matched by `startSeq`), a blocked run with an interrupted privileged action is re-blocked with `enforcement_failure`, an onboarding resume stops on an unreapable started launch, and a damaged path-scoped map is refused instead of widened.**

## Performance

- **Duration:** about 75 min
- **Completed:** 2026-11-22
- **Tasks:** 3 (tracer plus two auto, all TDD)
- **Files modified:** 14 (6 source, 5 test, 3 RED evidence records)

## Accomplishments

- WR-09: `authorizeAction` reads the scope's action events before any start is recorded or approval consumed and denies with rule `interrupted-action-open` when an open start has the same action and parameter digest. `finishPrivilegedAction` takes an optional `startSeq` and writes it into `action.finished`; `openSteps` closes exactly the named start, and an `action.finished` without `startSeq` closes the earliest open start of its action as before. Promotion passes the `startSeq` the gate returned.
- WR-08: `blockOnInterruptedActions` now pauses a run blocked on an answered item decision and blocks it again with `enforcement_failure`, mirroring `blockOnChangedRefs`; a run already blocked with `enforcement_failure` is left alone. The supervisor's continuability check refuses the run afterwards.
- WR-07: `reapInterrupted` returns an internal error naming the onboarding when a started launch has no host for its mode, a host without `reap`, or no recorded session ID, before any launch row is marked interrupted.
- WR-10: `prepareInvocation` returns an invalid `mapping:plan` error unless a paths plan has a non-empty list of valid scope paths; `loadMappingPlan` refuses a paths plan with a non-string entry instead of dropping it. The valid narrowing is unchanged.

## TDD Gate Compliance

| Task | RED commit | GREEN commit | RED evidence |
|------|------------|--------------|--------------|
| 1 | c8db2c6 | 70a4222 | 04-42-red-task1.json, `RED_EVIDENCE_OK` |
| 2 | 848c076 | e4efbc8 | 04-42-red-task2.json, `RED_EVIDENCE_OK` |
| 3 | 54454a5 | af1a505 | 04-42-red-task3.json, `RED_EVIDENCE_OK` |

RED semantic assessments:

- Task 1: the second `authorizeAction` returned `allow` where `deny` with `interrupted-action-open` was planned, and a `startSeq` finish left the wrong start open. Other planned cases (finish by startSeq then restart; legacy finish without startSeq) pass before the fix by design (characterisation).
- Task 2: the blocked run kept reason `decision` instead of `enforcement_failure`; each of three `resumeOnboarding` cases returned ok instead of an internal error. The "no restricted host" case was adjusted after the RED commit (the fixture composes the production restricted host, so the test removes it from the deps), and was re-run against the unfixed `resume.ts` to confirm it still fails on the planned assertion.
- Task 3: `prepareInvocation` returned ok (prepared and widened) for an empty list, a number entry, an out-of-scope path and a missing list; the valid-plan control passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing approvals tests started the same action twice with no finish between**
- **Found during:** Task 1 (GREEN verification)
- **Issue:** the plan states `approvals.test.ts` passes unchanged, but two tests ("two identical privileged actions each need their own approval", "the oldest usable approval is consumed first") start the same action with the same parameters twice and expect the second to be allowed. That is exactly what the new gate rule (the plan's first truth) refuses.
- **Fix:** both tests now end the first start with `finishPrivilegedAction(..., startSeq)` before the second start, via a small `finish` helper. No assertion about approvals, consumption order or event counts was weakened.
- **Files modified:** test/integration/approvals.test.ts
- **Commit:** 70a4222

**2. [Rule 1 - Bug] A lease test inserted a started launch with no session ID**
- **Found during:** Task 2 (regression run)
- **Issue:** `lease.test.ts` "with every map file already written..." hand-inserts a `launch:map` row with result `{}`. A real started launch always records a session ID (`prepareInvocation`), and WR-07 now stops a resume on one that does not.
- **Fix:** the inserted row records a random `sessionId`, as the real row does.
- **Files modified:** test/integration/lease.test.ts
- **Commit:** e4efbc8

**Total deviations:** 2 auto-fixed (both Rule 1, both existing test fixtures that modelled an unrealistic or now-refused state). **Impact:** none on production behaviour beyond the planned rules.

## Verification

Run (the full suite was not run, per the run instructions):

- `node --test` over `test/fault/privileged-no-replay.test.ts`, `test/integration/resume-reap.test.ts`, `test/fault/run-reconcile.test.ts`, `test/integration/refresh-scoped.test.ts`, `test/integration/approvals.test.ts`, `test/integration/promotion.test.ts`, `test/unit/mapping.test.ts`: green.
- Touching modules: `test/integration/hook-privileged.test.ts`, `untrusted-authority.test.ts`, `test/fault/approval-consume.test.ts`, `killpoints.test.ts`, `run-resume.test.ts`, `run-decision-resume.test.ts`, `restricted-mode.test.ts`, `lease.test.ts`, `run-resume-refs.test.ts`, `gsd-configure.test.ts`, `graph-incremental.test.ts`, `onboard-adopt.test.ts`, `knowledge-refresh.test.ts`: green (the lease case after the fixture fix).
- `npm run typecheck`: clean. `npm run check:boundaries`: ok (132 files).

## Residual risk

The open-start check in `authorizeAction` reads the events and then records the start in a separate step on the policy and contract paths, so two processes racing the same contract-sourced start could both pass the check. The approval path is unaffected (the approval is consumed in the start transaction). This matches the plan's scope; closing it needs the check inside a ledger transaction.

## Documentation surfaces (for plan 04-53)

- New denial rule `interrupted-action-open` of the approval gate: a second start of an action with the same parameter digest while an earlier start has no end is denied and records nothing.
- `action.finished` event data field `startSeq` (optional; events written before it carry none and close the earliest open start of the action); `finishPrivilegedAction` optional `startSeq` argument.
- Resume refusals: a blocked run (any reason but `enforcement_failure`) with an interrupted privileged action is re-blocked with `enforcement_failure`; an onboarding resume with a started launch that has no host for its mode, no `reap`, or no session ID stops with an internal error naming the onboarding and marks no launch interrupted.
- Scoped-map refusal: an `invalid` error with field `mapping:plan` for a `paths` plan that lists no path, a non-string entry, or a path failing the scope-path check; the map is not launched and the read scope is never widened.

## Known Stubs

None.

## Threat Flags

None. All new surface is within the plan's threat model (T-04-112 to T-04-115 mitigated).

## Self-Check: PASSED

- Created RED evidence files exist (04-42-red-task1/2/3.json); modified source and test files present.
- Commits c8db2c6, 70a4222, 848c076, e4efbc8, 54454a5, af1a505 are ancestors of HEAD.
