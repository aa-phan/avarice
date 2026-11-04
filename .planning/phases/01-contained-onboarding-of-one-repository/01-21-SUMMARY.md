---
phase: 01-contained-onboarding-of-one-repository
plan: 21
subsystem: onboarding-resume
tags: [resume, reap, session-id, kill-points, fault-suite, tdd, gap-closure, node-test]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "launch:{purpose} step rows recorded as started by prepareInvocation (01-15), the intel and knowledge invocations (01-17, 01-18), the kill-point suite (01-14)"
provides:
  - "resume reaps the host of every started launch:* row (map, intel, knowledge) by session ID before any stage runs, in every non-stop state including planning_ready"
  - "interrupted intel and knowledge launches are marked interrupted, so their index step relaunches as attempt N+1 and no launch:* row stays started"
  - "exported reapBySessionId(sessionId, killGraceMs?) shared by ClaudeHostAdapter.reap and the fake host"
  - "kill points mid-invocation:intel and mid-invocation:knowledge, a decoy check, and an in-process prelude test (fail closed, ordering, empty)"
affects: [01-22, 01-23, 01-24, phase-01-verification]

actuals:
  tokens: 8800
  tasks: 2
  commits: 4

plan_head_before: 97f32adf21aa58962ac7b356e9878ea6df0521a6
plan_head_after: f8ef6b6ae062a7447a06d103c3702ab0daedfc9c

tech-stack:
  added: []
  patterns:
    - "Reap-then-mark: every reap completes before any ledger row is marked, so a failed reap leaves every row started and the next resume retries"
    - "Fake host that dies inside an invocation and leaves a detached survivor carrying the session ID, reaping through the production reaper"

key-files:
  created:
    - test/integration/resume-reap.test.ts
    - .planning/phases/01-contained-onboarding-of-one-repository/01-21-red-evidence-task1.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-21-red-evidence-task2.json
  modified:
    - src/app/resume.ts
    - src/adapters/host-claude/claude-host.ts
    - test/helpers/fake-agent-host.ts
    - test/helpers/fault-run.ts
    - test/fault/killpoints.test.ts

key-decisions:
  - "reapStartedLaunches runs before reconcileInvocation and no longer reaps inside it: staging is read only after every survivor is gone (T-01-44)"
  - "A launch:map row of a mapping or paused onboarding is left started for reconcileInvocation, which decides reconciled versus interrupted from staging; every other started launch row is marked interrupted"
  - "The reaper body moved verbatim into reapBySessionId; the ps handling (IN-04) is untouched, per D-GAP-02"

patterns-established:
  - "Prelude helpers split into reap (process table) and reconcile (staging) concerns, composed by reconcileOnResume"

requirements-completed: [ONB-1]

coverage:
  - id: D1
    description: "Resume reaps every started launch:* row (map, intel, knowledge) by session ID before reconciliation or any stage, in any non-stop state including planning_ready, and marks each interrupted"
    requirement: "ONB-1"
    verification:
      - kind: integration
        ref: "test/fault/killpoints.test.ts#mid-invocation:intel"
        status: pass
      - kind: integration
        ref: "test/fault/killpoints.test.ts#mid-invocation:knowledge"
        status: pass
      - kind: integration
        ref: "test/fault/killpoints.test.ts#mid-invocation"
        status: pass
    human_judgment: false
  - id: D2
    description: "A reap that cannot search for or end a survivor stops the resume before any row is marked or stage run; reaps run in ledger order; no started launch means no reap call"
    requirement: "ONB-1"
    verification:
      - kind: integration
        ref: "test/integration/resume-reap.test.ts#fail closed"
        status: pass
      - kind: integration
        ref: "test/integration/resume-reap.test.ts#ordering"
        status: pass
      - kind: integration
        ref: "test/integration/resume-reap.test.ts#empty"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only the interrupted invocation's exact session ID is terminated: a decoy carrying another session ID is alive after the resume"
    requirement: "ONB-1"
    verification:
      - kind: integration
        ref: "test/fault/killpoints.test.ts#mid-invocation:intel (decoy assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Extracting reapBySessionId leaves ClaudeHostAdapter.reap behaviour unchanged"
    verification:
      - kind: integration
        ref: "node --test test/integration/claude-host.test.ts (ClaudeHostAdapter.reap)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-04
status: complete
---

# Phase 1 Plan 21: Reap every interrupted launch on resume Summary

**Resume now ends the detached host of every started `launch:*` step (map, intel and knowledge) by its exact session ID before any stage runs, marks those launches interrupted, and stops with an error when a survivor cannot be ended; proved by kill cases inside the intel and knowledge invocations that each resume to the uninterrupted record.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-11-04T09:35:00Z (approximate; the start time was not captured at spawn)
- **Completed:** 2026-11-04T09:49:00Z
- **Tasks:** 2
- **Files modified:** 8 (5 source/test files modified, 3 created including 2 evidence files)

## Accomplishments

- Closed gap P-1 / CR-01: `reapStartedLaunches` in `src/app/resume.ts` reaps every `started` `launch:*` row in ledger order, then marks them `interrupted`; `reconcileOnResume` runs it before `reconcileInvocation`, whose map-only reap was removed.
- `reapBySessionId` is exported from `claude-host.ts` (verbatim move); `ClaudeHostAdapter.reap` delegates and `FakeAgentHost.reap` uses the same function, so the suite exercises the production search and kill rules.
- `FakeAgentHost` can die inside the intel or knowledge invocation, leaving a detached process with `--session-id` in its argv. New kill points `mid-invocation:intel` and `mid-invocation:knowledge` assert: survivor alive and launch row `started` before resume; after resume the survivor is gone, exactly one `invocation.reaped` event with `terminated: 1`, launch rows `interrupted` then `failed`, and the record, map digests, manifest, staging digest and graph snapshot equal the reference run.
- A decoy with another random session ID survives the resume (T-01-73); no `launch:%` row is `started` after any kill point.
- `test/integration/resume-reap.test.ts`: fail-closed (failing reap stops the resume, rows stay `started`, state and version unchanged, no stage result stored), ordering (reaps in ledger order, both rows `started` at both calls, then both `interrupted`, no event for `terminated: 0`, resume reaches `active`) and empty (zero reap calls).

## Task Commits

1. **Task 1: Tracer, intel kill case** (TDD)
   - `4c11754` refactor: extract `reapBySessionId` (behaviour-preserving, needed so the fake host can reap through it)
   - `7b93446` test: failing kill cases (RED)
   - `5d558e9` feat: generic reap on resume (GREEN)
2. **Task 2: Knowledge kill case, decoy, fail-closed/ordered/empty prelude cases** - `f8ef6b6` (test)

**Plan metadata:** committed separately as `docs(01-21): complete ...` after this file.

## TDD Gate Compliance

- **RED:** `7b93446`. `node --test --test-reporter=tap test/fault/killpoints.test.ts` exited 1; `mid-invocation:intel` (and `mid-invocation:knowledge`) failed on `the resume ended the host that carried the interrupted session ID` (`true !== false`), the 20 pre-existing tests passed. Evidence: `01-21-red-evidence-task1.json`, classifier verdict `RED_EVIDENCE_OK`. Semantic assessment: the target executed and failed on the planned assertion because `reconcileInvocation` reaped only `launch:map`; not a syntax, fixture or discovery fault.
- **GREEN:** `5d558e9`. killpoints suite 22/22; `claude-host.test.ts` 34/34.
- **REFACTOR:** the reaper extraction is committed first (`4c11754`) rather than after GREEN, because the RED test helper imports it.
- **Task 2:** its cases pass against the Task 1 implementation, so a conventional RED is not available; the plan's mutation check stands in. Marking rows before reaping (loops swapped, restored from a saved copy, `git status` clean after) fails the fail-closed and ordering tests and passes the empty test. Evidence: `01-21-red-evidence-task2.json`, `RED_EVIDENCE_OK`.

## Files Created/Modified

- `src/app/resume.ts` - `LAUNCH_PREFIX`, `reapStartedLaunches`, `reconcileOnResume`; map-only reap removed from `reconcileInvocation`; header comment updated
- `src/adapters/host-claude/claude-host.ts` - exported `reapBySessionId`; `reap` delegates
- `test/helpers/fake-agent-host.ts` - `killInPurpose`, `survivorPidFile`, `reap`
- `test/helpers/fault-run.ts` - kill points `mid-invocation:intel` and `mid-invocation:knowledge`, `survivorPidFile(roots)`, `runWithFault` mapping
- `test/fault/killpoints.test.ts` - survivor, decoy and no-started-launch assertions; knowledge case skipped with a stated reason when graphify is absent
- `test/integration/resume-reap.test.ts` - three in-process prelude tests

## Decisions Made

- Reap runs in a separate prelude step ahead of `reconcileInvocation`, so staging is read only after every survivor is ended.
- A `launch:map` row of a `mapping` or `paused` onboarding is not marked by the reap; `reconcileInvocation` still decides `reconciled` versus `interrupted`.
- IN-04 (`ps` handling) and WR-02/WR-03 left untouched per D-GAP-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Task ordering] Knowledge kill point, decoy and generalized survivor assertions landed in the Task 1 RED commit**
- **Found during:** Task 1
- **Issue:** The plan introduces `mid-invocation:knowledge` and the decoy in Task 2. The kill-point table, `EXPECTED_AT_KILL` and the per-purpose assertions are one generalized block, so splitting them would have meant writing the intel-only form and rewriting it.
- **Fix:** Wrote the generalized form once in `7b93446`. Task 2 then added only `resume-reap.test.ts` and its mutation evidence.
- **Files modified:** test/helpers/fault-run.ts, test/fault/killpoints.test.ts
- **Verification:** killpoints suite 22/22, both new points run (graphify installed, no skips)
- **Committed in:** 7b93446

**2. [Task ordering] Reaper extraction committed as its own `refactor` commit before RED**
- **Found during:** Task 1
- **Issue:** The fake host's `reap` imports `reapBySessionId`, so the RED test code could not compile without the extraction.
- **Fix:** Committed the verbatim extraction first (`4c11754`); `claude-host.test.ts` passes unchanged.
- **Committed in:** 4c11754

---

**Total deviations:** 2 (both task-ordering, no behaviour change).
**Impact on plan:** None on scope; the commit count is 4 instead of 2-3 per TDD task.

## Issues Encountered

None. During the mutation check `src/app/resume.ts` was temporarily changed and restored from `/tmp/resume.ts.saved`; `git status` showed it clean afterwards.

## Known Stubs

None.

## Threat Flags

None. The changes narrow an existing surface (process-table `pgrep`/`kill` by UUID-validated session ID, unchanged code). T-01-72, T-01-73 and T-01-74 are mitigated as planned: survivor ended and record equal (kill cases), decoy survives, no `launch:*` row left `started`.

## Verification

- `node --test test/fault/killpoints.test.ts test/integration/resume-reap.test.ts` - 25 tests, 25 pass, 0 skipped
- `node --test test/integration/claude-host.test.ts` - 34 pass, 0 fail
- `npx tsc -p .` - exit 0; `node scripts/check-boundaries.ts` - `check-boundaries: ok (53 file(s))`
- Full suite `npm test`: 1193 tests, 1171 pass, 0 fail, 22 skipped (the skips pre-date this plan)
- Acceptance greps: `reapBySessionId` 2 in claude-host.ts and 2 in fake-agent-host.ts; `LAUNCH_PREFIX` 2 and `reconcileOnResume` 2 in resume.ts

## Next Phase Readiness

Ready for 01-22. Gap P-1 `missing` items (generic reap, kill case inside intel, kill case inside knowledge) are closed. The knowledge kill case needs graphify and is skipped with a stated reason without it (WR-03(d) hardening stays out of scope per D-GAP-02).

## Self-Check: PASSED

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-04*
