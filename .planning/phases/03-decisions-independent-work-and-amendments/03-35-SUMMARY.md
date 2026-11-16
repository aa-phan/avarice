---
phase: 03-decisions-independent-work-and-amendments
plan: 35
subsystem: live-probe-small-unit-haiku
status: complete
tags: [gap-closure, rc-8, aut-3, haiku, live-probe, plan-group-spend-guard, owner-decision]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-34's prompt, refusal-reason and agent-note fix, and its prediction that a haiku unit now finishes a small item"
provides:
  - "test/helpers/live-harness.ts: planGroupTotalRefusal, LIVE_PLAN_03_27_GROUP (03-27, 03-35, 03-36), LIVE_PLAN_03_27_TOTAL_USD = 10.0, LiveRunSpec.planCap.group, RunUnitSpec.planGroup"
  - "test/containment/live-run-phase3.test.ts: the group PLAN_CAP, plan in every result line, probe-small-1..3 and PROBE_RESULTS"
  - "test/containment/live-small-probe.jsonl: two measured probe lines (probe-small-1, both FAIL on fact 3)"
  - "spikes/phase-3-wave-0/S3-B-small-unit-haiku.md: the live section, the verdict on 03-34's prediction and the owner's decision"
  - "the owner's decision proceed-haiku (2026-11-09): small items stay on haiku, plan 03-36 runs as planned"
affects: [03-36, 03-28, 03-31, 03-32, 03-33]

# actuals.tokens: chars/4 over the realized diff from plan_head_before to plan_head_after (43724 characters)
actuals:
  tokens: 10931
  tasks: 3
  commits: 4
plan_head_before: 73c761884ffbe67e61b6f10c80336d365c16728a
plan_head_after: bf5f6d7390a8fd4f9e62ac905d9d9963cfa48005
commits: 4

tech-stack:
  added: []
  patterns:
    - "A spend guard over a group of plans (sum of recorded spend across the group plus the run's cap against one total), beside the per-plan and the Phase ceiling guards"
    - "A live judge that reads ground truth only (ledger, launch log, init event, clone commits, transcript Write calls and the classify step), recording each fact before the next so a later failure does not hide an earlier one"

key-files:
  created:
    - test/containment/live-small-probe.jsonl
  modified:
    - test/helpers/live-harness.ts
    - test/unit/live-spend-ceiling.test.ts
    - test/containment/live-run-phase3.test.ts
    - test/containment/live-spend-phase3.jsonl
    - spikes/phase-3-wave-0/S3-B-small-unit-haiku.md
    - test/containment/LIVE-CASES.md

key-decisions:
  - "Owner decision 2026-11-09, option proceed-haiku: keep haiku for small items (D-10 and RC-8's size-to-model map unchanged) and run plan 03-36 as planned; the owner accepts the measured result and attributes the extra test/slug.test.ts edit to the probe brief's fixed text"
  - "Probe-small-2 and probe-small-3 were not run (owner decision); the plan's three-of-three reliability bar was not met, and the owner accepted the two-run measurement"
  - "The judge reads the quick records from the host's Write calls and the classify step, not from the clone, because the unit's .planning/quick records are archived out of the clone before the commit (D-17)"

requirements-completed: []

coverage:
  - id: D1
    description: "A plan-group spend guard refuses a live start when the group 03-27, 03-35 and 03-36's recorded spend plus the run's cap would pass 10.00 USD, beside the unchanged Phase 3 25 USD guard"
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts (planGroupTotalRefusal cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two live probe-small-1 runs measured a small item on haiku: the whole quick workflow ran, no refusal loop, no decision, 0.0819 and 0.1019 USD; both failed the judge's fact 3 because the commit also holds test/slug.test.ts"
    verification:
      - kind: other
        ref: "test/containment/live-small-probe.jsonl lines 1 and 2 (live runs, not repeatable offline)"
        status: pass
    human_judgment: true
    rationale: "The probes are live and paid; the verdict on whether haiku is reliable enough for small items is the owner's decision, recorded at Task 3 as proceed-haiku"
  - id: D3
    description: "The S3-B record's live section, the verdict on plan 03-34's prediction and the owner's decision, and the LIVE-CASES.md probe section and spend rows"
    verification:
      - kind: other
        ref: "spikes/phase-3-wave-0/S3-B-small-unit-haiku.md 'Live probe (plan 03-35)'; test/containment/LIVE-CASES.md 'Small-unit probe on haiku (plan 03-35)'"
        status: pass
    human_judgment: false

duration: "about 45 min across the live session and this continuation, plus the owner checkpoint"
completed: 2026-11-09
---

# Phase 3 Plan 35: Small-item probe on haiku Summary

**Plan-group spend guard (03-27, 03-35 and 03-36 against 10.00 USD) and two live haiku probe runs of a small item that ran the whole quick workflow for 0.08 to 0.10 USD, both failing the judge only on an extra test file; the owner chose proceed-haiku.**

## Performance

- **Duration:** about 45 min of execution across the live session and this continuation (the owner checkpoint wait is not counted)
- **Started:** 2026-11-09 (first commit 12:08 CST, `c6fa770`)
- **Completed:** 2026-11-09
- **Tasks:** 3 (Task 1 done with two live runs; Task 2 not run by owner decision; Task 3 reached and answered)
- **Files modified:** 7 (6 modified, 1 created), 43724 characters of diff

## Accomplishments

- `planGroupTotalRefusal` sums recorded spend over the group 03-27, 03-35 and 03-36 and refuses a start that would pass 10.00 USD (owner decision 2 of 2026-11-09); both live guards use it when a group is given; the Phase 3 25 USD guard is unchanged.
- Three probe tests (`live probe-small-1..3`) built from plan 03-27's item A alone, judged from ground truth only, recorded one fact at a time in `live-small-probe.jsonl`.
- Two live `probe-small-1` runs on haiku (`claude-haiku-5-5`, Claude Code 2.1.319), measured and recorded (see the table).
- The S3-B record gained its live section: per-run facts, cost, refusals and how each was followed, the cause of the failed fact, the verdict on plan 03-34's prediction and the owner's decision.
- LIVE-CASES.md gained the probe section and spend rows; the Phase 3 spend table gained the 03-35 row.

## Probe results

| Run | Run ID | Verdict | Cost (USD) | Tool calls | Agent calls | Hook denies |
|---|---|---|---|---|---|---|
| 1 | `run_01M70QY9KAA9ABJ2274FDJSY3R` | FAIL, fact 3 (fact 5 failed under the first judge, passed re-judged) | 0.1019 | 76 | planner 2, plan-checker 2, executor 1, verifier 1 | `shell-syntax` 1, `shell-not-allowed` 1 |
| 2 | `run_01M70RGRVDPC6QNHXN5F5TMVJP` | FAIL, fact 3 | 0.0819 | 51 | one of each | `shell-syntax` 1 |

Both runs: haiku by launch flag, `launch:run` step and init event; state `ready_for_review`, item A `done`; G1 and G2 passed with passed check evidence; the quick PLAN, SUMMARY and VERIFICATION (status passed) were written; no decision; no `loop.limit` event; each cost within the 0.30 USD haiku cap. The one failed fact is the same in both runs: the single commit holds `src/shout.ts`, `test/shout.test.ts` and `test/slug.test.ts`, not the two files the judge expects.

**Cause of the failed fact.** The probe brief is built with `itemsBriefText` (`test/helpers/run-fixtures.ts`), whose fixed "Behavior" sentence reads "A slug never contains two dashes in a row, and the slug rules are covered by tests." Both units took it as part of the task and edited `test/slug.test.ts`, inside the brief's `test/**` write set. It is a probe-brief artifact, contained by the run's rules, and not a haiku reliability, hook or gate failure.

**Prediction of plan 03-34:** confirmed (the whole workflow ran, refusals were corrected, no loop), with the fact 3 exception explained above.

## Task Commits

1. **Task 1: Tracer, plan-group spend guard and probe tests** - `c6fa770` (feat)
2. **Task 1: probe judge fix, quick records read from the transcript and the classify step** - `61a9186` (fix)
3. **Task 1: the two probe-small-1 runs and their spend** - `bafd190` (test)
4. **Task 3: the live record, the owner's decision and the LIVE-CASES rows** - `bf5f6d7` (docs)

**Plan metadata:** the commit of this SUMMARY with STATE.md and ROADMAP.md (docs: complete plan)

## Files Created/Modified

- `test/helpers/live-harness.ts` - `planGroupTotalRefusal`, `LIVE_PLAN_03_27_GROUP`, `LIVE_PLAN_03_27_TOTAL_USD = 10.0`, the `group` and `planGroup` options
- `test/unit/live-spend-ceiling.test.ts` - the group guard's boundary cases (fits at 9.50 with cap 0.50, refuses at 9.51)
- `test/containment/live-run-phase3.test.ts` - the group `PLAN_CAP`, `plan` in every line, `PROBE_RESULTS`, probe-small-1..3 and the probe judge
- `test/containment/live-small-probe.jsonl` - the two probe lines
- `test/containment/live-spend-phase3.jsonl` - the two ledger lines under plan 03-35
- `spikes/phase-3-wave-0/S3-B-small-unit-haiku.md` - the live section, the verdict and the decision
- `test/containment/LIVE-CASES.md` - the probe section, spend rows and the Phase 3 table row

## Decisions Made

- **Owner decision at Task 3, 2026-11-09: `proceed-haiku`.** Keep haiku for small items (D-10 and RC-8's map unchanged) and run plan 03-36 as planned. The owner's reasoning: the 03-34 fix removed the reliability failure (the whole workflow completed, no refusal loop, about 0.09 USD per unit); the extra `test/slug.test.ts` edit is attributed to the probe brief's fixed text and stayed inside the write set. The owner did not ask for probe-small-2 or probe-small-3 and asked that no other live case run in this plan.
- The plan's reliability bar (three probe runs, none failed) was therefore not met on its own terms: two runs, both failed fact 3, both completed the work. The owner accepted the measurement. This is recorded here and in S3-B so that a later reader does not read "complete" as "three of three PASS".

## Notes for plan 03-36 and the documentation plans

- **Slug-brief finding (for 03-36).** Plan 03-36's cases that are built with `itemsBriefText` carry the same "Behavior" sentence, so a small item may again touch `test/slug.test.ts`. Their judges should allow that file, or the cases should use a brief text without the sentence. `03-36-PLAN.md` was not edited here; the executor of 03-36 should read this note and the S3-B section before judging a commit's file list.
- **Glob and Grep (for the documentation plan's findings list).** The host session has no `Glob` or `Grep` tool (run 2 met three "No such tool available" errors), while the unit prompt of plan 03-34 names the Read, Grep and Glob tools; the host's advice points to `grep` through Bash, which the hook does not admit. The unit recovered each time. No change was made here (no `src/` or `docs/system/` change in this plan).
- Spend left: group 6.3601 of 10.00 USD for plan 03-36; Phase 3 20.2674 of 25 USD.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The probe judge looked for the quick records in the clone**
- **Found during:** Task 1 (probe-small-1, run 1)
- **Issue:** the judge's fact 5 reported "no PLAN under .planning/quick" although the unit wrote all three records; the records are archived out of the clone before the commit (D-17), so the clone cannot show them.
- **Fix:** fact 5 now reads the host's Write calls, the classify step's verification and summary flags and the gsd-verdict evidence; no cap, spec or other fact changed.
- **Files modified:** `test/containment/live-run-phase3.test.ts`
- **Verification:** run 2 was judged by the corrected judge (`quickRecordsWritten` all true, `classifyVerification` passed); run 1's transcript shows the three Writes and `status: passed`. Line 1 of the probe file was not rewritten and still shows its original fact 5 text.
- **Committed in:** `61a9186`

### Plan steps not carried out

- **Task 2 (probe-small-2, probe-small-3) was not run**, by the owner's decision at Task 3, so its two verify commands were not run. The S3-B live section and the LIVE-CASES probe section were written from the two probe-small-1 runs, and the plan's Task 2 closing check (a line for each of three probes) does not hold: it would fail on probes 2 and 3 by design.

---

**Total deviations:** 1 auto-fixed (1 bug in the judge), 1 plan step omitted by owner decision
**Impact on plan:** the judge fix was necessary for a correct verdict and changed no cap or spec. The omitted probes leave the plan's three-run bar unmet; the owner accepted that.

## Issues Encountered

- Both probe runs failed the judge's fact 3 for the reason above, which is how the plan reached its blocking-human checkpoint.
- The review banner failed `osascript-missing` three times in each run, as the quiet profile intends; no banner was posted.

## Authentication Gates

None.

## Known Stubs

None. (No placeholder or hard-coded empty values flow to rendering in the files this plan touched.)

## Threat Flags

None. The plan added no network endpoint, auth path or schema; T-03-67 (spend) was held by the group guard and the fixed caps (plan spend 0.1838 of its 2.00 worst case, group 3.6399 of 10.00, Phase 3 4.7326 of 25), T-03-68 by the ground-truth judge and T-03-69 by leaving `ROUTINE_PRESET` and every `src/` file unchanged until the owner chose.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 03-36 may run as planned (owner decision proceed-haiku); read the slug-brief finding above before judging its commit file lists.
- Spend headroom: group 6.3601 USD of 10.00, Phase 3 20.2674 USD of 25.
- No blocker. `RC-8` and `AUT-3` stay open: other plans of the phase declare them and `requirements.ready-ids` reports neither ready.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09*

## Self-Check: PASSED

All six files named above exist; commits c6fa770, 61a9186, bafd190 and bf5f6d7 are on the branch. No src/ or docs/system/ file changed in this plan, and no live run was made in the continuation.
