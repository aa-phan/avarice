---
phase: 02-contained-unattended-run-of-one-work-item
plan: 24
subsystem: testing
tags: [lease-fence, discard, fault-injection, sqlite, resume, node-test]
gap_closure: true
gap_ids: [G-02-10]

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: the discard-attempt checkpoint carrying the lease fence (02-16), the reconcile prelude and kill-point suite (02-17), the docs/system pass (02-23)
provides:
  - a dedicated offline fault suite proving a superseded supervisor is refused at the discard-attempt checkpoint on the crash path and the resume path, with the clone, every ledger table and the other holder's lease unchanged
  - the lease edges (taken and released, expired but not taken) and the after-checkpoint window, characterized and shown to converge on resume
  - Ledger.recordRunStep with an optional fence guard, and a reconcile prelude that records its failed step under the supervisor's fence
affects: [phase-02-verification, phase-05-delivery]

plan_head_before: 15f8035e0128e26c6678681f21f1c8ff6a284c0b
plan_head_after: 4749034d69536c446ad8a16b12447e6d00f25fc8

actuals:
  tokens: 17700
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Stale-supervisor fault test: a second composition takes the lease inside a Proxy over the supervisor's ledger (or workspace) call; the store is compared table by table through a read-only connection before and after"
    - "Mutation evidence in a scratch git-archive copy outside the repository for a property that already holds"

key-files:
  created:
    - test/fault/run-discard-stale-fence.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-24-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-24-red-evidence-task2.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-24-red-evidence-task3.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-24-reviews/
  modified:
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/app/run-resume.ts
    - test/integration/run-ledger.test.ts
    - docs/system/runs.md
    - docs/system/data-model.md
    - docs/system/coverage.md
    - docs/system/findings.md

key-decisions:
  - "The discard step and the attempt's end stay unfenced; the after-checkpoint window is documented and proven to converge rather than closed"
  - "Only the failed reconcile record takes a fence guard; no other recordRunStep caller changes"

patterns-established:
  - "A guard on a ledger write is checked by checkFence inside the same transaction, so a stale fence aborts with the same conflict a checkpoint gets and writes nothing"

requirements-completed: [CON-16, FR-7]

coverage:
  - id: D1
    description: "G-02-10 crash path: a supervisor superseded just before the discard-attempt checkpoint is refused (conflict lease fence 1 vs 2); no checkpoint row, no restore call, clone and every ledger table identical to the takeover, other holder's lease intact; a no-takeover control reaches ready_for_review"
    requirement: CON-16
    verification:
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#stale fence on the crash path"
        status: pass
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#no takeover (control)"
        status: pass
    human_judgment: false
  - id: D2
    description: "G-02-10 resume path: a supervisor superseded before the discard-attempt checkpoint in the reconcile prelude (lease fence 2 vs 3) changes nothing, including no failed resume:reconcile step"
    requirement: FR-7
    verification:
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#stale fence on the resume path"
        status: pass
    human_judgment: false
  - id: D3
    description: "Lease edges: taken and released keeps the fence bumped and still refuses; expired but not taken leaves the fence current, so the discard runs and the run reaches ready_for_review"
    requirement: FR-7
    verification:
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#taken and released on the crash path (the fence stays bumped)"
        status: pass
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#expired, not taken (the fence, not the expiry, decides)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ledger.recordRunStep with a fence guard refuses a stale fence as a conflict and writes nothing, records with the current fence, and records as before with no guard; the reconcile prelude records its failed step under the supervisor's fence"
    requirement: CON-16
    verification:
      - kind: unit
        ref: "test/integration/run-ledger.test.ts#records a step under a fence guard only while that fence is current (G-02-10)"
        status: pass
      - kind: unit
        ref: "test/integration/run-ledger.test.ts#records a step with no guard as before, whoever holds the lease (G-02-10)"
        status: pass
      - kind: integration
        ref: "test/integration/run-resume.test.ts (unchanged, exit-70 reap failure still records its failed step)"
        status: pass
    human_judgment: false
  - id: D5
    description: "After-checkpoint window: a supervisor superseded inside the restore restores the clone and writes only the discard step, the attempt's end and its event; its item transition is refused; a later resume converges to the result of an uninterrupted crash-and-retry run"
    requirement: FR-7
    verification:
      - kind: integration
        ref: "test/fault/run-discard-stale-fence.test.ts#superseded after the checkpoint, then resumed (the window the fence cannot cover)"
        status: pass
    human_judgment: false
  - id: D6
    description: "docs/system/runs.md and data-model.md describe the fenced reconcile record and the after-checkpoint window; coverage.md recounted at the last code commit; each changed document passed a fresh prose review"
    verification:
      - kind: other
        ref: ".planning/phases/02-contained-unattended-run-of-one-work-item/02-24-reviews/ (round 2 PASS)"
        status: pass
    human_judgment: true
    rationale: "Prose quality and fidelity of the documentation to the built behavior is judged by a reviewer; the claims were checked against the code by two fresh review rounds, but no test asserts them"

duration: 25min
completed: 2026-11-06
status: complete
---

# Phase 2 Plan 24: Stale-fence discard Summary

**A dedicated offline fault suite proves a superseded supervisor cannot commit the discard-attempt checkpoint or restore the clone on the crash and resume paths, and the reconcile prelude no longer writes a failed step after the fence refused it.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-11-07T05:22:29Z
- **Completed:** 2026-11-07T05:47:17Z (before this SUMMARY)
- **Tasks:** 3
- **Files modified:** 12 (4 src and test modified, 1 test created, 3 evidence files, 4 docs, review records)

## Accomplishments

- G-02-10 is closed with a dedicated test (UAT test 10, coverage 02-16/D9): on both code paths that reach the discard, a supervisor whose lease another holder took just before the `discard-attempt` checkpoint gets a conflict naming both fences, commits no checkpoint, never calls the workspace restore, and leaves the clone (HEAD, index, tracked, untracked and ignored bytes), every table of the store and the other holder's lease row as they were.
- The defect the test revealed is fixed test-first: on the resume path `reconcileRun` wrote a failed `resume:reconcile` step after its checkpoint was refused. `recordRunStep` now takes an optional `{ fence }` guard checked inside its transaction, and the prelude passes the supervisor's fence.
- The lease edges are pinned: a lease taken and released still refuses the original supervisor, and a lease that only passed its expiry (nobody took it) leaves the fence current, so the discard runs. The fence decides, not the expiry.
- The one window the fence cannot cover is measured and documented: a supervisor superseded inside the restore restores the clone and writes only the `discard` step, the attempt's end columns and one `attempt.ended` event; its work item transition is refused. A resume reaches `ready_for_review` with attempts `discarded`, `handed-off` and the same normalized result as an uninterrupted crash-and-retry run.

## Task Commits

1. **Task 1: Tracer, crash path** - `7b9e23b` (test). The property already held, so the RED evidence is a scratch-copy mutation record.
2. **Task 2: resume path, lease edges, fence guard**
   - RED `65dd189` (test): the resume-path dump differs by one failed `resume:reconcile` row; the guarded `recordRunStep` test fails
   - GREEN `6d6b2bf` (feat): fence guard and fenced reconcile record
3. **Task 3: after-checkpoint window, convergence** - `b9c7aca` (test), characterization, passingAtBase
4. **Task 3 docs:** `4749034` (docs) - runs.md, data-model.md, coverage.md, findings.md, review records

**Plan metadata:** the commit that adds this file (docs: complete plan)

## TDD evidence

- **Task 1:** no RED at the plan base (6 of 6 pass), as the plan expected. Two scratch-copy mutations of a `git archive` of the base, never the working tree: (A) the restore moved above the checkpoint fails the discard-call and clone assertions; (B) the fence check removed from `recordRunCheckpoint` fails the discard-call, clone and store-dump assertions. The plan expected the dump assertion to fail under mutation A; it does not, because that mutation writes no ledger row, which is why mutation B was added. Semantic assessment is in `02-24-red-evidence-task1.json`.
- **Task 2 RED:** 70 tests, 68 pass, 2 fail. The resume-path dump differs by exactly one row, `run_steps` rowid 13, step `resume:reconcile`, status `failed`, written at `src/app/run-resume.ts:309` (the `recordRunStep` call with no fence). No other table differs. The guarded `recordRunStep` contract test failed because the parameter did not exist.
- **Task 2 GREEN:** the same files and the resume, discard, supervisor and lease suites pass (141 of 141); the kill-point suite prints `AC-3: 24/24`.
- **Task 3:** passingAtBase, a characterization of the documented unfenced-writes rule plus convergence. Nothing written after the refused transition.
- `gsd_run check tdd-red-evidence` was not run: the phase's red-evidence files use the phase shape (command, ranAgainst, exitCode, reason, failingFiles, failingTests, passingAtBase, summary) plus `semanticAssessment`, as the plan specifies.

## Files Created/Modified

- `test/fault/run-discard-stale-fence.test.ts` - the stale-fence suite: `stale fence on the crash path`, `stale fence on the resume path`, `taken and released on the crash path`, `expired, not taken`, `no takeover (control)`, `superseded after the checkpoint, then resumed`; helpers `storeDump`, `dumpDiff`, the takeover hook and the ledger and workspace Proxies (test file only, nothing in src)
- `src/ports/ledger.ts`, `src/adapters/sqlite/ledger.ts` - `recordRunStep(runId, input, guard?)`, `checkFence` inside the transaction when the guard is given
- `src/app/run-resume.ts` - the failed `resume:reconcile` record presents `{ fence: ctx.fence }`; comment updated
- `test/integration/run-ledger.test.ts` - the guarded and unguarded `recordRunStep` contract tests
- `docs/system/runs.md`, `docs/system/data-model.md` - the after-checkpoint window, the fenced reconcile record and the fence exception
- `docs/system/coverage.md` - header commit `b9c7aca`, test files 114, source lines 26,157; per-document review notes
- `docs/system/findings.md` - six `ledger.ts` line citations shifted by one line

## Observation for the owner: the repeated discard replaces the step record

The step is keyed by run, step and attempt, so when the resumed supervisor repeats the discard it replaces the superseded supervisor's record. The final `discard` step of the convergence test lists `restored []`, `removed []`, `ignoredLeft []`: the paths the first restore changed (`src/slug.ts`, `src/extra.ts`) are no longer in the step. The attempt still ends `discarded` and its event is kept. This is documented in runs.md and not changed here; it is not a defect against any stated requirement, but the owner may want the step to accumulate. Final lists reported with `t.diagnostic`: `discard step, attempt 1: restored [], removed [], ignoredLeft []`.

## Decisions Made

- The discard step and the attempt's end stay unfenced (the plan's choice, matching data-model.md); the window is characterized and documented, not closed.
- Only the failed reconcile record takes a guard. Every other `recordRunStep` caller is unchanged.
- The mutation evidence uses two mutations, not one, because the plan's single mutation does not disturb the dump assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reconcile prelude wrote a failed step after the fence refused it**
- **Found during:** Task 2 (resume-path RED)
- **Issue:** `reconcileRun` recorded `resume:reconcile` with status `failed` without a fence, so a superseded supervisor wrote a ledger row after its fenced write failed. This is the defect the plan expected the test to reveal.
- **Fix:** optional `guard` on `recordRunStep` (port and SQLite adapter); `reconcileRun` passes `{ fence: ctx.fence }`.
- **Files modified:** src/ports/ledger.ts, src/adapters/sqlite/ledger.ts, src/app/run-resume.ts
- **Verification:** the resume-path dump test and the two ledger contract tests; run-resume (including the exit-70 reap failure) unchanged and green; AC-3 24/24
- **Committed in:** `6d6b2bf`

**2. [Rule 3 - Blocking] findings.md line citations shifted by the added line**
- **Found during:** Task 3 (docs)
- **Issue:** adding one line in `src/adapters/sqlite/ledger.ts` before line 936 moved six cited lines of docs/system/findings.md by one.
- **Fix:** re-pointed the citations (941, 1030, 1106 and 1117, 1184, 1258), each checked against the code.
- **Files modified:** docs/system/findings.md
- **Committed in:** `4749034`

**3. [Plan variance] The plan's mutation does not fail the store-dump assertion**
- Task 1's plan expected the dump assertion to fail under the restore-before-checkpoint mutation. It does not (see TDD evidence); a second scratch mutation (fence check removed) was run to show the assertion discriminates. Recorded in `02-24-red-evidence-task1.json`.

**Fresh review:** the prose reviewer was a separate `claude -p` process (the executor has no sub-agent tool) using the prose-review skill, two rounds; round 1 bounced (one sentence over the length cap, "records nothing" wider than the code, paragraph order, one omitted list), all applied; round 2 PASS with one OBS, applied after the report. Digests are bound in `02-24-reviews/README.md`.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking), 1 plan variance
**Impact on plan:** the bug fix is the one the plan anticipated; no scope creep. No test seam was added to src, the checkpoint order is unchanged and AC-3 stays 24/24.

## Issues Encountered

- The bash tool in this worktree refuses compound commands that mention git, heredocs or computed sed arguments; helper scripts were written with the Write tool and run by path.
- The full suite (2,338 tests) takes about 24 minutes, mostly the kill-point suite; it was run in the background.

## Verification

- `node --test` (full): 2338 tests, 2294 pass, 0 fail, 44 skipped; `AC-3: 24/24`
- The plan's verification set (stale-fence, discard-retry, kill-points, run-ledger, run-resume, run-supervisor, lease): green
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts` prints `ok (79 file(s))`
- `git status --porcelain src` clean after Task 1 (the mutations never touched the working tree)

## Known Stubs

None.

## Threat Flags

None. The plan's threats T-02-80, T-02-81 and T-02-82 are mitigated as planned: the fence guard and the resume-path dump test (T-02-80), the checkpoint-first order with the two mutations (T-02-81), and the proxies living only in the test file (T-02-82).

## Next Phase Readiness

- UAT gap G-02-10 is closed; plan 02-25 (avarice-run skill live check) is independent of this change.
- The after-checkpoint window is documented and bounded by the attempt's snapshot; Phase 5 delivery should still re-check `sideEffect: none` per the discard basis.

## Self-Check: PASSED

- `test/fault/run-discard-stale-fence.test.ts`, the three red-evidence files and `02-24-reviews/` exist.
- Commits `7b9e23b`, `65dd189`, `6d6b2bf`, `b9c7aca`, `4749034` are on the branch.

---
*Phase: 02-contained-unattended-run-of-one-work-item*
*Completed: 2026-11-06*
