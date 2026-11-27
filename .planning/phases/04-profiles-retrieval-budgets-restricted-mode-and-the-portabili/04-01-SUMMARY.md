---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 01
subsystem: testing
tags: [live-spend, ledger, ceiling, node-test, typescript]

requires:
  - phase: 03
    provides: "Phase 3 spend-ledger shape and phaseSpendLedger helper"
provides:
  - "Phase 4 live-spend ledger (test/containment/live-spend-phase4.jsonl) with a 40 USD lower-only ceiling (D-03)"
  - "PHASE4_CEILING_USD, phase4LedgerPath, phase4Ceiling, phase4Spent, fitsPhase4Ceiling, recordPhase4Spend; CURRENT_SPEND_PHASE = 4"
affects: [04-31, 04-34, 04-35, 04-36, 04-38]

actuals:
  tokens: 9000
  tasks: 2
  commits: 3
plan_head_before: 876bbf53de91b56077dba262c504ec8ed4d7c2c7
plan_head_after: 58311273ea56d610417a1400a64132e0bc52cf84
commits: 3

tech-stack:
  added: []
  patterns:
    - "Per-phase spend ledger selected by phase through a record keyed on 2 | 3 | 4, with the owner decision tag per phase"

key-files:
  created:
    - test/containment/live-spend-phase4.jsonl
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-01-red-task1.json
  modified:
    - test/helpers/live-harness.ts
    - test/unit/live-spend-ceiling.test.ts

key-decisions:
  - "CURRENT_SPEND_PHASE is the literal 4; currentSpendLedger and the refusal tag are looked up by phase, so a later phase adds one record entry"
  - "Phase 3 plan-group total tests now judge against the current (Phase 4) ledger, because planGroupTotalRefusal reads currentSpendLedger"

requirements-completed: [CON-4, ONB-6, FR-3]

coverage:
  - id: D1
    description: "Phase 4 ledger with a 40 USD ceiling that AVARICE_PHASE4_CEILING_USD can only lower"
    requirement: CON-4
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts#lets AVARICE_PHASE4_CEILING_USD lower the ceiling, never raise it, and ignores a non-number"
        status: pass
    human_judgment: false
  - id: D2
    description: "fitsCap refuses a live case that would pass the ceiling, with a refusal naming Phase 4, 40.00 USD, D-03 and the owner"
    requirement: CON-4
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts#names Phase 4, the 40.00 USD ceiling, D-03 and the owner in the refusal for a 0.60 USD case at 39.50"
        status: pass
    human_judgment: false
  - id: D3
    description: "CURRENT_SPEND_PHASE is 4 and the Phase 2 and Phase 3 ledgers stay readable and unchanged"
    requirement: CON-4
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts#keeps the Phase 2 and Phase 3 ledgers readable beside the Phase 4 ledger"
        status: pass
    human_judgment: false
  - id: D4
    description: "A corrupt Phase 4 ledger line makes the guard throw instead of reading as zero spend"
    requirement: CON-4
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts#throws an Error naming the line number for a corrupt line, never reading it as 0"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 01: Phase 4 spend guard Summary

**Phase 4 live-spend ledger with a 40 USD ceiling that the environment can only lower, a D-03 refusal text, and a throw on any corrupt ledger line**

## Performance

- **Duration:** 14 min
- **Completed:** 2026-11-16T07:18:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `test/helpers/live-harness.ts` now holds `PHASE4_CEILING_USD = 40`, the Phase 4 helpers beside the Phase 3 ones, and `CURRENT_SPEND_PHASE = 4`. Every recorder and guard that goes through `currentSpendLedger` writes and reads `test/containment/live-spend-phase4.jsonl`.
- `AVARICE_PHASE4_CEILING_USD` lowers the ceiling and cannot raise it; a non-numeric or non-positive value is ignored. `AVARICE_PHASE4_LEDGER` redirects the ledger for tests and `AVARICE_PHASE4_PLAN` names the plan new spend is recorded under.
- `ceilingRefusal` words the refusal as `not run: Phase 4 spend ... would pass the 40.00 USD ceiling (D-03); ask the owner`.
- A non-JSON line, or a line with no finite non-negative `costUsd`, throws and names the line number.
- The spend guard spends nothing. The empty ledger is 0 bytes and the Phase 3 ledger is unchanged.

## Task Commits

1. **Task 1: tracer, Phase 4 case cap checked against the Phase 4 ledger**
   - `3764e92` test: failing Phase 4 spend-guard tests, a scaffold whose Phase 4 exports still read the Phase 3 ledger, the empty ledger, and the RED evidence record
   - `4d2c2e4` feat: Phase 4 ledger, 40 USD ceiling, D-03 tag, `CURRENT_SPEND_PHASE = 4`
2. **Task 2: current-ledger default and per-plan sums** - `5831127` (test)

## TDD Gate Compliance

RED evidence `04-01-red-task1.json` was classified `RED_EVIDENCE_OK` (`target_test_failed`, TAP, 13 failing of 34). The first RED attempt failed at module load (the new exports did not exist), which is `fixture_or_load_failure` and not RED. A scaffold with the Phase 4 names reading the Phase 3 ledger made the tests fail on their assertions, which is the evidence recorded. Semantic assessment: the target test ran and failed on `phase4Ceiling()` equal to 40, for the intended reason. GREEN followed in `4d2c2e4`.

Tracer gate: the `<verify>` command was re-run on the proven slice (34 of 34 passing) before Task 2.

## Files Created/Modified

- `test/helpers/live-harness.ts` - Phase 4 ceiling, ledger helpers, per-phase ledger and decision-tag lookup
- `test/unit/live-spend-ceiling.test.ts` - Phase 4 describe block, Phase 3 current-ledger cases moved to Phase 4
- `test/containment/live-spend-phase4.jsonl` - empty Phase 4 ledger
- `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-01-red-task1.json` - RED evidence

## Decisions Made

- `CURRENT_SPEND_PHASE` stays a bare literal (`= 4`) so the acceptance grep holds. Lookups are `Record<2 | 3 | 4, ...>` tables, so a later phase adds one entry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing Phase 3 "current ledger" tests asserted the old current phase**
- **Found during:** Task 1
- **Issue:** Tests asserting `CURRENT_SPEND_PHASE === 3`, the D-05 refusal text, the Phase 3 `fitsCap` coupling, the Phase 3 recorder, and the plan-group totals were written against Phase 3 as the current phase. Setting `CURRENT_SPEND_PHASE = 4` makes them fail by design.
- **Fix:** Moved the "current ledger" assertions into the Phase 4 block. The plan-group total tests now write the current (Phase 4) ledger, since `planGroupTotalRefusal` reads `currentSpendLedger`. The Phase 3 direct-ledger tests (sum, corrupt line, ceiling, append) are unchanged.
- **Files modified:** test/unit/live-spend-ceiling.test.ts
- **Verification:** 54 of 54 tests pass across the ceiling and hygiene suites.
- **Committed in:** 3764e92

**2. [Rule 3 - Blocking] RED scaffold needed so the failure is an assertion, not a load error**
- **Found during:** Task 1
- **Issue:** Importing exports that did not exist failed at module load, which the RED gate rejects.
- **Fix:** Added Phase 4 exports reading the Phase 3 ledger in the RED commit, replaced by the real implementation in GREEN.
- **Committed in:** 3764e92, 4d2c2e4

**Total deviations:** 2 auto-fixed (2 blocking). **Impact on plan:** None on scope. The two Task 2 unit tests were written in the Task 2 commit as planned.

## Issues Encountered

Re-running the closed Phase 3 live suites (`live-run-phase3.test.ts`, `spike-pause-resume.test.ts`) now records into the Phase 4 ledger under plan `unknown`, because they record through `currentSpendLedger` and read `AVARICE_PHASE3_PLAN`, which the Phase 4 ledger ignores. Their evidence is closed and the plan said to leave them; noted for anyone who reruns one. The suites were not touched and nothing was spent.

## Documentation surfaces (for plan 04-38)

- Test environment variables: `AVARICE_PHASE4_CEILING_USD` (lower-only, ceiling 40 USD), `AVARICE_PHASE4_LEDGER` (ledger path override), `AVARICE_PHASE4_PLAN` (plan under which spend is recorded)
- Ledger file `test/containment/live-spend-phase4.jsonl`: one JSON object per line (`at`, `plan`, `case`, `costUsd`, `claudeVersion`)
- Refusal text with tag D-03 when a case cap would pass the ceiling

## Known Stubs

None.

## Threat Flags

None. The two trust boundaries (environment into the harness, ledger file into the guard) are the ones in the plan's threat model, mitigated by T-04-01 and T-04-02 and covered by tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 04-31, 04-34, 04-35 and 04-36 can record spend into the Phase 4 ledger and are refused past 40 USD.

## Self-Check: PASSED

- Files present: live-harness.ts, live-spend-ceiling.test.ts, live-spend-phase4.jsonl (0 bytes), 04-01-red-task1.json
- Commits present on this branch: 3764e92, 4d2c2e4, 5831127
- Plan verification: ceiling and hygiene tests 54 of 54, `npm run typecheck` clean, `check:boundaries` ok (99 files), Phase 3 ledger has no diff

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
