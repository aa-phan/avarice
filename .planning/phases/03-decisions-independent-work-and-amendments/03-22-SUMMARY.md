---
phase: 03-decisions-independent-work-and-amendments
plan: 22
subsystem: run-supervisor
status: complete
tags: [resume, session, unpark, park, fallback, decisions, sc3, aut-3, aut-5, aut-12, kill-points]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "the --resume launch line, the park and unpark port and the spike verdicts for a resume and an unknown session (03-08, 03-09, 03-13), park.ts, the item-local block, the answered item as a fresh unit and the supervisor pickup (03-18), the first-unit session on the work item and the item base step (03-19), the decide command that answers and starts the supervisor (03-20)"
provides:
  - "resume of an answered item: its parked delta is put back on a clean snapshot of the current HEAD and the host is launched with --resume of the item's own gsd_session, the owner's answer as data and the item's model (attempt reason resume)"
  - "PrepareRunOptions.resumeSessionId: the request carries it as the session, so the launch:run step records it and a reap after a kill finds the host by it"
  - "fallbacks to a fresh unit with the answer (attempt reason answer, new gsd_session) for an unknown session, a crashed resume, an unparkable delta and a missing park ref; the run step resume:fallback and the event item.unpark_conflict"
  - "the unpark checkpoint (a next action of a running run), the mid-unpark fault point, the reconcile of a resume attempt and RESUME_KILL_POINTS"
affects: [03-25, 03-31]

actuals:
  tokens: 21200
  tasks: 3
  commits: 5
plan_head_before: a03090577675db4f6efb9b30883d3b1b3329386f
plan_head_after: 608fb7c3aa711b2e91e905abb5512cfbb99534fc
commits: 5

tech-stack:
  added: []
  patterns:
    - "A resume is judged like any unit, against the item's own base: the snapshot is taken on the clean tree before the delta is put back, so the item's work is the delta plus whatever the resumed unit adds, and G1, G2 and the commit read it as one"
    - "The resume gives way, never retries: an unknown session, a crashed unit, a delta that does not apply and an interrupted resume all discard to the item base and run a fresh unit that carries the answer; that unit has its own CON-16 retry"
    - "The park ref goes when the host is launched: after that every road (a commit, a new block, a fallback) starts from the item base, never from the ref, and a second park of the item must not meet the first one"

key-files:
  created:
    - test/integration/run-decision-resume.test.ts
    - test/fault/run-resume-session.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-22-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-22-red-evidence-task2.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-22-red-evidence-task3.json
  modified:
    - src/app/run-stages/item.ts
    - src/app/invocation.ts
    - src/app/run-resume.ts
    - src/domain/run-lifecycle.ts
    - test/helpers/fault-run.ts
    - test/helpers/fake-run-host.ts
    - test/unit/fake-run-host.test.ts
    - test/unit/run-lifecycle.test.ts
    - test/fault/run-killpoints.test.ts
    - test/integration/run-independent-work.test.ts
    - test/integration/run-g1.test.ts

key-decisions:
  - "An answered item resumes only when it has a completed park record and a work_items.gsd_session that is a UUID; the session is read from the ledger, never from user input, and checked again before it reaches a launch line (T-03-42)"
  - "The resumed unit is classified against the item base (the clean snapshot taken before the unpark), not against a snapshot taken after it: the parked records and plan count as the item's work, so a resumed unit that only finishes the item is judged progressed, and a WAITING.json or a human_needed VERIFICATION it left in place reads as still waiting"
  - "A resume never retries as a resume: an unknown session (the structural shape of spike S3-A), a crash with no moved HEAD, an interrupted resume and an unparkable delta all end the attempt `discarded` at the item base and run a fresh unit with reason `answer`; the step resume:fallback names the decision and the reason, and it is what keeps the item from resuming twice"
  - "An unpark conflict does not open a new decision (the flagged assumption): the owner's answer still applies, the delta is dropped with its ref, nothing is written over the other item's change, and item.unpark_conflict carries the run, the item and the count of paths"
  - "The park ref is dropped when the host is launched, not after the item's commit: a resumed unit that asks again would otherwise meet the old ref at its next park. The commit drops it again (an absent ref is success) so a ref a killed supervisor left is cleaned"
  - "A resume attempt killed inside its host call falls back to a fresh unit instead of resuming again: the session file of a killed host is in an unknown state, and the reconcile that reaps it by the resumed session ID cannot read it"
  - "The kill points of the resume are RESUME_KILL_POINTS beside PARK_KILL_POINTS, not RUN_KILL_POINTS: the single-item reference of the kill suite never reaches them"

patterns-established:
  - "An item's attempts after its answer are resume -> answer -> con16-retry: reason by what the item has tried for the decision, read from steps (launch:run, resume:fallback), never from a counter"

requirements-completed: []

coverage:
  - id: D1
    description: "SC3 offline on S-17: `decide <dec> 2 --wait` makes the supervisor unpark B's delta and launch B's resumed request with resumeSessionId equal to the gsd_session B first ran under, a prompt with the answer under the fixed data line, B's model and B's parked file in the clone when the unit began; B's attempt has the reason resume, its launch:run step carries the resumed session, B is gated at G2 and committed with the parked and the resumed changes, D then runs, B's park ref is gone and the run reaches ready_for_review"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/run-decision-resume.test.ts#SC3 offline: decide answers, the supervisor unparks B and resumes B's own session with the answer, and the run finishes (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A session the host does not know (the spike S3-A shape: an error_during_execution result, no turns, no cost, exit 1) discards to the item base and runs a fresh unit that carries the question and the answer; the work item takes the new session, both calls are charged, and the run finishes"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/run-decision-resume.test.ts#a session the host does not know: the item falls back to a fresh unit with the answer (spike S3-A)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A resumed unit that crashes with no moved HEAD takes the same fallback and nothing it wrote stays; another item's committed change to a parked path makes unpark refuse, item.unpark_conflict records the count of paths, the other item's file is unchanged at HEAD, B runs fresh from the current HEAD and its park ref is dropped"
    requirement: "AUT-3"
    verification:
      - kind: integration
        ref: "test/integration/run-decision-resume.test.ts#a resumed unit that crashes with no moved HEAD: the same fallback, and nothing the crash wrote stays"
        status: pass
      - kind: integration
        ref: "test/integration/run-decision-resume.test.ts#another item committed a change to a path B parked: the delta is never written over it (T-03-43)"
        status: pass
    human_judgment: false
  - id: D4
    description: "With the invocations budget spent before the fallback the item blocks on a budget decision that names invocations and no fresh unit runs"
    requirement: "AUT-5"
    verification:
      - kind: integration
        ref: "test/integration/run-decision-resume.test.ts#the invocations budget spent before the fallback: the item blocks with a budget decision naming invocations"
        status: pass
    human_judgment: false
  - id: D5
    description: "A supervisor killed at after-checkpoint:unpark, at mid-unpark and inside the resumed unit (with its host process left running) and then resumed reaches ready_for_review equal to the uninterrupted resume: the survivor is reaped by the resumed session ID, no step is left in flight, every attempt ends, the delta is in the commit once and B's park ref is gone"
    requirement: "AUT-12"
    verification:
      - kind: integration
        ref: "test/fault/run-resume-session.test.ts#a supervisor killed inside the resume ends the run as the uninterrupted one does (AUT-12)"
        status: pass
    human_judgment: false
  - id: D6
    description: "RUN_NEXT_ACTIONS.running lists unpark between context-pack and launch:run, and the kill-point coverage test accepts the resume suite as the home of its kill points"
    requirement: "AUT-12"
    verification:
      - kind: unit
        ref: "test/unit/run-lifecycle.test.ts and test/fault/run-killpoints.test.ts#lists an after-checkpoint point for every action of contract_ready, running and verifying"
        status: pass
    human_judgment: false
  - id: D7
    description: "Whether a real model resumes its paused GSD session under the contained launch line and finishes the item with the answer (the live S-17 case)"
    requirement: "AUT-5"
    verification: []
    human_judgment: true
    rationale: "Offline the fake host proves the launch line, the session choice, the unpark and the fallbacks; spike S3-A measured the host's resume and its error for an unknown session on 2.1.319, but no live run resumes an answered item through the supervisor"

duration: 45 min
completed: 2026-11-09
---

# Phase 3 Plan 22: `claude -p --resume` for an answered item Summary

**An answered item now continues its own paused GSD session: the supervisor puts the item's parked delta back on the current HEAD, launches `--resume <work_items.gsd_session>` with the owner's answer as data and the item's model, judges and commits the resumed unit like any other, and falls back to a fresh unit that carries the answer when the host does not know the session, the resume crashes, the delta cannot be put back or the resumed host is killed.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-11-09T10:23:31Z
- **Completed:** 2026-11-09T11:12:00Z
- **Tasks:** 3 (a tracer and two auto tasks, each with a RED commit)
- **Files:** 16 touched (5 created including three RED records, 11 modified)
- **Commits:** 5 (the plan metadata commit follows)

## Accomplishments

- **The resume (D-08, D-16, SC3).** After an answer, the first attempt of the item is an attempt with the reason `resume`: the configure step, a snapshot of the clean tree at the current HEAD (recorded as the attempt's snapshot and as the item's base), the `unpark` checkpoint, the unpark of the item's latest park record, then a `launch:run` step whose session ID is the resumed one and a host call with `resumeSessionId`. The prompt is `runResumePrompt` (the item line, the fixed data line, the answer by its number and label); the model is the item's. The item keeps its session on the work item.
- **Judged like any unit.** Classification, G1, G2, the repair road and the supervisor's commit read the item's work since the base snapshot taken before the unpark, so the commit holds the parked and the resumed changes once. The park ref is dropped when the host is launched, and again after the commit.
- **Fallbacks keep the answer.** An unknown session (the S3-A shape), a crash with no moved HEAD, a delta that conflicts with another item's commit, or a park ref that is gone discards the attempt to the item base (which takes the unparked delta out) and runs a fresh unit with reason `answer`, whose prompt carries the question it asked and the answer, whose session becomes the work item's, and whose crash gets its own CON-16 retry. A conflict records `item.unpark_conflict` with the count of paths and drops the ref; nothing is written over another item's change. A spent invocations budget before the fresh unit blocks on a budget decision naming invocations.
- **Safe to interrupt.** `unpark` is a next action of a running run; `mid-unpark` follows the unpark. A resume attempt left in flight is reconciled: one that never launched a unit goes back to the snapshot and resumes again; one that did is reaped by the resumed session ID and takes the fresh unit. Kills at the unpark checkpoint, after the unpark and inside the resumed unit each end equal to the uninterrupted resume.

## Task Commits

1. **Task 1: tracer, SC3 offline** - `3101135` (test, RED), `4c4d21d` (feat, GREEN together with Task 2)
2. **Task 2: the fallbacks** - `71b808a` (test, RED), `4c4d21d` (feat)
3. **Task 3: reconcile and kill points** - `9e4de23` (test, RED), `608fb7c` (feat, GREEN)

**Plan metadata:** the docs commit that carries this file, STATE.md and ROADMAP.md.

## TDD gate

- RED task 1 (`3101135`): 4 of the 5 tests of the tracer file failed (the record of the resumed call was never written, the attempts were `answer`, B's commit held the fresh unit's content); the first test (the run finishes) passed, as it should.
- RED task 2 (`71b808a`): recorded against a clean export of the tree after Task 1 with the Task 2 code taken out; 4 of 9 failed (the run ended `blocked_on_decision` instead of `ready_for_review`; the budget case ended with reason `decision` instead of `budget_exhausted`).
- RED task 3 (`9e4de23`): recorded against a clean export of the tree after Task 2; `mid-unpark` did not exist (the supervisor finished instead of dying) and a resumed host killed mid-invocation ended the run `blocked_on_decision` through the CON-16 reconcile.
- All three records pass `check tdd-red-evidence` (`RED_EVIDENCE_OK`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The park ref must go when the host is launched, not after the commit**
- **Found during:** Task 2 (RED export run)
- **Issue:** the plan drops the ref after B's commit. A resumed unit that asks again, or whose G2 fails, parks its delta again under the same ref name, and the workspace refuses a second park of a different delta over a ref that is still there (`conflict`).
- **Fix:** the existing drop at the start of an answered attempt now covers a resume too (the delta is back in the tree, and every road after the host call starts from the item base); the commit still drops the ref, so a ref left by a killed supervisor is cleaned.
- **Files modified:** src/app/run-stages/item.ts
- **Committed in:** 4c4d21d

**2. [Rule 1 - Bug] The fake host's `missingSession` did not match the spike**
- **Found during:** Task 2 (the sequential note binds S3-A)
- **Issue:** the fake ended a resume of an unknown session with no result event; the host prints an `error_during_execution` result (an error, 0 turns, 0 cost, exit 1).
- **Fix:** the fake reports that shape and its unit test asserts it; the stage keys the fallback on the structural fields and also on any crash, so both shapes fall back.
- **Files modified:** test/helpers/fake-run-host.ts, test/unit/fake-run-host.test.ts
- **Committed in:** 71b808a

### Plan readings and judgment calls

**3. Classification against the item base.** The plan says the normal path with S2 as the item base. The resumed unit is also classified against S2 (the clean snapshot before the unpark): a snapshot taken after it would not see the parked records or the parked in-scope change, so a unit that only finishes the item would read as `no_progress`.

**4. The resume attempt is recorded before the unpark.** The item base step names an attempt, so the attempt, the move to delegated and the snapshot come first and the `unpark` checkpoint follows; `mid-unpark` is after the unpark and before `launch:run` starts.

**5. Reconcile lives in item.ts.** `reconcileItem` already routes a delegated item; `reconcileResume` sits beside `reconcileRepair`. src/app/run-resume.ts changed only in its header comment.

**6. Kill points in `RESUME_KILL_POINTS`.** As plan 03-18 did for the park, they are not added to RUN_KILL_POINTS (the single-item reference never reaches them); the coverage test excludes `unpark` from its per-action list the way it excludes `park`, naming the resume suite.

**7. A resume killed mid-invocation falls back to a fresh unit** rather than resuming again (see key-decisions); the plan's "same road as any attempt, with the fallback of Task 2" reads this way.

**8. The fault suite starts the supervisor with `supervise`** after answering through the ledger, not through `decide`: the point of the suite is the supervisor's death, and `decide` is covered by the tracer.

**9. Tasks 1 and 2 share one GREEN commit** (`4c4d21d`): the fallback code sits in the same functions as the resume (launch, routing, attempt choice), so the production change was written and committed once; Task 2's RED was recorded against an export without it.

**10. [Plan-directed change to existing tests]** `run-independent-work` and `run-g1` expected a fresh `answer` unit after an answer; they now expect `resume`, and their host scripts give B's resumed call its own quick directory (a unit rewrites the parked records only after it reads them, and the fake host does not). `test/unit/run-lifecycle.test.ts` lists `unpark`.

**Total deviations:** 2 auto-fixed (2 bugs), 8 plan readings. **Impact:** none on the plan's truths; the ref drop is earlier than the plan says and the answer is kept on every road.

## Issues Encountered

- A first full-suite run overlapped edits to the tree and showed five failures that were the plan-directed test changes above (answer -> resume, the kill-point coverage test, the G1 test); after them the full suite passes.
- Compound shell commands with a heredoc that contained the word `git` were refused by the session's command checks; the files were written with the Edit and Write tools instead.
- Commit trailers follow the orchestrator prompt (Claude Opus 5.5); the harness attribution named another model.

## Documentation surfaces (for plan 03-31)

`docs/system/` exists in this checkout but was not edited: the plan defers it to the phase's documentation plan, as plans 03-02 to 03-21 did. What it must cover:

- **Resume flow (runs.md, processes.md):** an answered item with a completed park record and a `gsd_session` that is a UUID resumes: configure, snapshot of the clean tree at the current HEAD (the attempt's snapshot and the item's base), checkpoint `unpark`, the park record put back (`unpark`), fault point `mid-unpark`, `launch:run` with the resumed session, the resume prompt (item line, fixed data line, the answer by number and label, the re-read and no-commit sentences), the item's model, then classify against the item base, G1, G2, the repair road and the commit. Attempt reason `resume`; the item's session is unchanged. The park ref is dropped when the host is launched and again after the commit.
- **Fallbacks:** the step `resume:fallback` `{attemptId, itemId, decisionId, reason}` with reasons `session-gone`, `crashed`, `unpark-conflict`, `park-missing` and `interrupted`; the resume attempt ends `discarded` at the item base; the next attempt has reason `answer`, a new session (which becomes `work_items.gsd_session`) and a prompt with the question and the answer. The session-gone trigger is structural: kind `failed`, result seen, `is_error`, subtype `error_during_execution`, 0 turns, 0 cost, exit 1; any crash with no moved HEAD and no host refusal also falls back. A host refusal (no sandbox, a failed self-test) does not. Before the fresh unit a spent invocations budget blocks the run on a budget decision naming invocations.
- **Events and steps:** `item.unpark_conflict` `{runId, itemId, paths}` (warn; a count, never the paths); the run step `resume:fallback`; the checkpoint `unpark` (next action of a running run, between `context-pack` and `launch:run`); the `launch:run` step of a resume carries `sessionId` equal to the resumed session and `answeredDecisionId`.
- **Reconcile:** a delegated resume attempt that never launched its unit goes back to its snapshot (the delta is taken out) and the item resumes again; one that did, whether its host was killed or its result was never classified, is reaped by the resumed session ID (the reap searches the process table for the session ID the `launch:run` step recorded) and takes the fresh unit with the answer, unless the invocations budget is spent (then the run blocks on the budget).
- **Findings to record:** a resumed session whose unit leaves the parked `WAITING.json` in place, or a parked VERIFICATION with `human_needed` that it does not rewrite, reads as paused again and opens a new decision; the resume is judged by `classifyOutcome` against the item base, so a resumed unit that makes no change of its own and writes no records is judged progressed whenever the parked delta carries a SUMMARY and an in-scope change; the resume prompt carries the answer but not the question (the session remembers asking), while the fresh fallback unit carries both; a stored `gsd_session` that is not a UUID makes the item run fresh without a record of why.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None. The new surface (a host launched with `--resume` of a ledger session, a parked delta written back into the clone) is inside the plan's trust boundaries and T-03-42 and T-03-43.

## Threat mitigations

- **T-03-42:** the session ID is `work_items.gsd_session` of the answered item, checked against the UUID shape before it reaches the request; the adapter refuses anything else; no command line or answer text ever supplies it (the fault suite asserts the in-flight launch step carries exactly the first session).
- **T-03-43:** `unpark` refuses when a parked path changed at HEAD or is modified in the tree and changes nothing; the stage then records `item.unpark_conflict`, drops the ref and runs a fresh unit; the test asserts the other item's file content at HEAD is the one it committed.
- **T-03-SC:** no package installs.

## Next Phase Readiness

Ready for 03-25 (the terminal prompt after the record view) and 03-31 (the documentation plan: the surfaces above). Requirements AUT-3, AUT-5 and AUT-12 are declared by other incomplete plans, so `requirements.ready-ids` reports none ready and none is marked complete here.

## Self-Check: PASSED

Created files exist (test/integration/run-decision-resume.test.ts, test/fault/run-resume-session.test.ts, three RED records); commits `3101135`, `71b808a`, `4c4d21d`, `9e4de23` and `608fb7c` are ancestors of HEAD; `npx tsc -p .` and `node scripts/check-boundaries.ts` (94 files) are clean; the plan's verification set (run-decision-resume, run-resume-session, run-killpoints, resume-reap: 37 tests with the killpoints and reap files, plus run-independent-work, run-discard-retry, run-g1 and the unit files) passes; the full suite passes (3314 tests, 3254 pass, 0 fail, 60 skipped).
