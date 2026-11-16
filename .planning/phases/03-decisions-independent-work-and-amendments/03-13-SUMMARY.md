---
phase: 03-decisions-independent-work-and-amendments
plan: 13
subsystem: live-spike
status: complete
tags: [spike, claude-code, resume, pause, live-harness, spend-ledger]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "host-side pause and resume (plan 03-08: --resume launch line, outcome.question, RUN_DECISION_SENTENCE, runResumePrompt), PLAN_CITES_ACCEPTANCE_HARD and parseQuickPlan (plan 03-06), the Phase 3 spend ledger and the admitted host 2.1.319 (plan 03-01)"
provides:
  - "Measured live behaviour of pause, resume and a resume of an unknown session on Claude Code 2.1.319, with verdicts for A2, A3, A4 and A10"
  - "RunUnitSpec.resume, resumeOnly, itemId and probe, SPIKE3_PLAN, SPIKE3_TOTAL_CAP_USD, spike3Refusal, promptItemOf and per-invocation CloneFacts in the live harness"
  - "The gated spike suite test/containment/spike-pause-resume.test.ts and the spike record spikes/phase-3-wave-0/S3-A-pause-resume.md"
affects: [03-18, 03-22, the documentation plan 03-31]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: b2bbd38e9e8eb45e603d7657191edc0bb84b9552
plan_head_after: 759b1947eb870b104854ca5acf9e9545ab7bdc33
commits: 2

tech-stack:
  added: []
  patterns:
    - "A resume test shares one harness call with the pause it resumes, because a host session belongs to its working directory"
    - "Spike verdicts read ground truth only (outcome fields, clone diff, quick files, hook decisions); the question text is never written to a results file, only its presence and length"

key-files:
  created:
    - test/containment/spike-pause-resume.test.ts
    - test/containment/live-run-phase3-spike.jsonl
    - spikes/phase-3-wave-0/S3-A-pause-resume.md
  modified:
    - test/helpers/live-harness.ts
    - test/containment/live-spend-phase3.jsonl
    - test/containment/LIVE-CASES.md
    - src/domain/gates.ts

key-decisions:
  - "A3 held in round 1 (a numbered-choice question before any tool call, nothing edited), so RUN_DECISION_SENTENCE is unchanged and round 2 was not run"
  - "PLAN_CITES_ACCEPTANCE_HARD stays false: the one live PLAN cited the item's acceptance ID, but it was written after the resume, one round ran, and the plan's rule asks for both rounds"
  - "A resume of an unknown session ends WITH a result event (error_during_execution, 0 turns, 0 cost, exit 1), so plan 03-22's fresh-unit fallback keys on those structural fields, not on a missing result"
  - "The round-2 tests are the pause and resume pair only; the missing-session test is not repeated at a 2.00 USD cap because its outcome does not depend on the decision sentence"

requirements-completed: [AUT-1, AUT-5]

coverage:
  - id: D1
    description: "A real contained quick unit given RUN_DECISION_SENTENCE and a planted owner choice ended with a question line then numbered choices, made no edit, and the host outcome's question carried it (A3)"
    requirement: "AUT-1"
    verification:
      - kind: live
        ref: "test/containment/live-run-phase3-spike.jsonl line 1 (round-1 pause)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The paused session resumed with --resume under the full containment line and a fresh cost cap, the hook ran in the resumed invocation, a result event and a SUMMARY followed, and no write left the write set (A2, A10)"
    requirement: "AUT-5"
    verification:
      - kind: live
        ref: "test/containment/live-run-phase3-spike.jsonl line 2 (round-1 resume)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A resume of an unknown session ends with a result event of subtype error_during_execution, 0 turns, 0 cost and exit 1, not without a result event"
    requirement: "AUT-5"
    verification:
      - kind: live
        ref: "test/containment/live-run-phase3-spike.jsonl lines 3 and 4 (missing-session)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether the PLAN cites the item's acceptance IDs and how a checkpoint:decision is marked (A4); the gate stays an advisory"
    requirement: "AUT-1"
    verification: []
    human_judgment: true
    rationale: "One live PLAN cited AC2 and had no decision checkpoint. Whether PLAN_CITES_ACCEPTANCE_HARD should become true is a judgment on a one-sample measurement; the owner or a later live PLAN decides."
  - id: D5
    description: "Every live start was guarded by the Phase 3 ledger and the 4.00 USD spike total, and every cost is in the ledger under plan 03-13 (0.9412 USD)"
    requirement: "AUT-5"
    verification:
      - kind: command
        ref: "node -e (sum of costUsd over test/containment/live-spend-phase3.jsonl) gives 24 lines, 1.0927 USD, 0.9412 for plan 03-13"
        status: pass
    human_judgment: false

duration: 15 min
completed: 2026-11-09
---

# Phase 3 Plan 13: Spike S3-A, the live pause and resume Summary

**On Claude Code 2.1.319 a contained quick unit asks a numbered-choice question instead of picking, its session resumes with `--resume` under the same containment flags and a fresh cap, and a resume of an unknown session ends with an `error_during_execution` result event rather than without one; the spike cost 0.9412 USD of its 4.00 USD cap.**

## Performance

- **Duration:** about 15 min (one live round of about 3.5 min)
- **Completed:** 2026-11-09
- **Tasks:** 2 (a tracer and an auto task)
- **Files:** 4 modified, 3 created

## Accomplishments

- The live harness can resume a unit's session through the same adapter, fixture and clone (`RunUnitSpec.resume`), run a resume with no first unit (`resumeOnly`), start from a two-item brief, build the prompt for one work item (`promptItemOf`), and record per-invocation clone facts and a caller probe. A Phase 3 spike refusal checks the Phase 3 ledger and the 4.00 USD plan total before each start, the resume included.
- Round 1 measured three behaviours (results lines 1 to 4 of `test/containment/live-run-phase3-spike.jsonl`):
  - **Pause (A3):** the unit made no tool call, changed nothing, and its final text (356 characters) ended with a question and numbered choices; `detectPause` read `outcome.question` as `numbered-choice` (0.0617 USD).
  - **Resume (A2, A10):** the same session resumed under the full launch line with a fresh 1.50 USD cap, ran 40 tool calls with 33 hook allows and 6 denies (`shell-syntax` 5, `shell-not-allowed` 1), finished the item, wrote a PLAN citing `AC2` and a SUMMARY, left no write outside the write set, and cost 0.8795 USD. No VERIFICATION file was written.
  - **Missing session:** a result event was printed (`error_during_execution`, `is_error` true, 0 turns, 0 cost, exit 1, the host's no-conversation message in its `errors` array); the adapter reports it as kind `failed`.
- The spike record `spikes/phase-3-wave-0/S3-A-pause-resume.md` carries per-round evidence, verdicts for A2, A3, A4 and A10, and what plans 03-18 and 03-22 must assume. `LIVE-CASES.md` has the spend row and a spike section.

## Verdicts

| Assumption | Verdict | Evidence |
|---|---|---|
| A3 a quick unit asks, in a numbered-choice final text the host outcome carries | confirmed (one sample) | results line 1 |
| A2 a resumed contained session accepts the containment line and finishes the unit | confirmed; the classifier called it `denied` for the 6 hook denials, and no VERIFICATION was written | results line 2 |
| A10 a resume accepts a fresh cost cap | confirmed; whether the cap counts from zero or from the session total cannot be told apart at 0.06 vs 0.88 USD | results line 2 |
| A4 the PLAN cites the item's acceptance IDs | the PLAN cited `AC2`; `PLAN_CITES_ACCEPTANCE_HARD` stays false (one sample, written after the resume) | results line 2 |
| A resume of an unknown session ends without a result event | **refuted**: it ends with an `error_during_execution` result event | results lines 3 and 4 |

## What plans 03-18 and 03-22 must assume

- **03-18:** a unit that must ask can leave no tool call, no quick directory and no PLAN, with classifier kind `no_progress`; the pause comes from `outcome.question`, and G1 must not fail a paused unit for an absent PLAN. A resumed unit can end with kind `denied` after improvised shell lines are denied, and can leave a PLAN and SUMMARY and no VERIFICATION; judge it from the clone and the gates. The resume cost 0.88 USD, so give a resume a whole-unit cap. `PLAN_CITES_ACCEPTANCE_HARD` is false.
- **03-22:** the fresh-unit fallback trigger is a resumed request whose outcome is kind `failed` with `resultSeen` true, `isError` true, subtype `error_during_execution`, `numTurns` 0, cost 0 and exit code 1. The adapter drops standard error and does not expose the `errors` text.

## Task Commits

1. **Task 1: tracer, round 1 live (pause, resume, missing session)** - `bfe071b` (feat)
2. **Task 2: verdicts, spike record, spend row** - `759b194` (docs)

The plan's tracer gate (`HUMAN_VERIFY_MODE` end-of-phase, automated verify only) was met by the live round 1 itself: all three tests passed and each left a results line, so expansion (Task 2) went ahead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The resume shares one harness call with its pause**
- **Found during:** Task 1
- **Issue:** the plan names `round-1 pause` and `round-1 resume` as two tests, but a host session is keyed to its working directory, so a resume needs the pause's clone.
- **Fix:** both tests await one memoized `runLiveRunUnit` call that runs the pause and then the resume; each records its own results line. `RunUnitSpec` gained `resumeOnly` for the `missing-session` test, which has no first unit.
- **Files modified:** test/helpers/live-harness.ts, test/containment/spike-pause-resume.test.ts
- **Commit:** bfe071b

**2. [Rule 1 - Bug] First pause line's duration included the resume; evidence directory was deleted**
- **Found during:** Task 1, after the live run
- **Issue:** `durationMs` was read after the resume (204820 ms for the pause line), and the first version of the suite disposed its evidence directory, so the pause and resume transcript bytes were removed.
- **Fix:** the harness now records the first invocation's own duration and the suite keeps its evidence directory (as S2-B did). The pause and resume lines were already recorded with their transcript digests; the spike record states both limits. `missing-session` was re-run (0 USD) so its line carries `numTurns` and its evidence is kept; both lines stay in the results file.
- **Files modified:** test/helpers/live-harness.ts, test/containment/spike-pause-resume.test.ts
- **Commit:** bfe071b

**3. [Plan reading] PLAN_CITES_ACCEPTANCE_HARD left false**
- **Issue:** the plan's action text says set it true when every round's PLAN cited the item's IDs; its truths say both rounds. One round ran (A3 held) and its one PLAN cited `AC2`.
- **Decision:** left false and said so in the record, because one sample, written after the answer settled the choice, does not support hardening a gate that fails runs. Flagged for the owner. A comment in `src/domain/gates.ts` records the measurement; no test change was needed (the gates unit test already asserts false).

**4. [Scope] Round 2 not run, and its missing-session test omitted**
- Round 2 runs only when round 1 shows a silent pick (D-02); it did not. The suite's round-2 pair is the pause and the resume only: a resume of an unknown session does not depend on the decision sentence, and repeating it at a 2.00 USD cap would only risk an assumed cost.

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug), 2 judgment calls. **Impact:** none on the verdicts; the pause and resume transcripts cannot be re-read, only their digests and recorded facts.

One unintended command: `npx eslint` was run once to lint the new files and tried to fetch eslint from the registry because the project has no lint configuration. Nothing was added to the project; it was not repeated.

## Authentication Gates

None.

## Issues Encountered

None that block later plans. Observations for them are under "What plans 03-18 and 03-22 must assume".

## Known Stubs

None. The `round-2` tests exist but are not run unless round 1 shows a silent pick.

## Threat Flags

None. The only new surface is test code that spends model budget behind `AVARICE_LIVE=1`, covered by the plan's T-03-22 (spend refusal) and T-03-23 (the question text is never written to a results file).

## Self-Check: PASSED

Created and modified files exist; commits `bfe071b` and `759b194` are ancestors of HEAD; the results file has four lines (three tests, one re-run); the Phase 3 ledger sums to 1.0927 USD over 24 lines, 0.9412 of it plan 03-13; `npx tsc -p .` is clean; `test/unit/gates.test.ts` and `test/unit/run-gsd-config.test.ts` pass (93 tests); the spike suite skips all 5 tests without `AVARICE_LIVE`.
