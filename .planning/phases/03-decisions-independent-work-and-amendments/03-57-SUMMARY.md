---
phase: 03-decisions-independent-work-and-amendments
plan: 57
subsystem: exit-run2
tags: [exit, run2, d-26, d-27, d-28, d-29, d-33, product-defect, halted]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-56 authorization (approve, order run2, run3, run1, 4.50 USD per run, 25 USD ceiling)
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-53 attempt bookkeeping, classify and startRefusal
provides:
  - "03-57-evidence-exit.json: run 2's attempt 1, its stop, Claude's proposal (brief-harness-defect) and the owner's confirmed ruling (product-defect)"
affects: [03-58, 03-59, 03-60, gap-plan]

actuals:
  tokens: 4000
  tasks: 2
  commits: 2
plan_head_before: 63f6974
plan_head_after: 0fc688785673001044d5cc5ce2b87475eb39a826

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
  modified:
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "Run 2 stopped unexpectedly at its start (two open pause decisions), so Task 2 was not presented and Task 3 became the owner's ruling on the stop"
  - "The owner ruled product-defect (D-26, D-27), overriding Claude's brief-harness-defect proposal; the exit halts for a gap plan"

requirements-completed: []

duration: resumed in two sessions
completed: 2026-11-11
status: halted
---

# Phase 3 Plan 57: Run 2 started once, stopped unexpectedly, ruled a product defect Summary

**Run 2 was started once. It stopped on two open pause decisions instead of the one planted pause, and the owner ruled the stop a product defect. The exit halts here until a gap plan fixes the product and all three runs are re-run in the order 2, 3, 1.**

## What happened

- **Task 1 (commit 8080282):** `exit-run-phase3.sh` started run 2 once under plan 03-57 (`run_01M74RNSAHDTSHE8JDEZ5XW6F9`, attempt 1, expects `amend-stale`). The run stopped `blocked_on_decision` on two decisions, not one:
  - `dec_01M74S0V3JFCE404VF02YMY034`: item A, pause signal `verification-human-needed`. The unit ran the required `format:check`, which is red at the base revision on `index.html`, a file item A never touched. Item A's verifier reported human-needed and the unit parked on its own pause decision.
  - `dec_01M74S116V4TRTNPAZN3R94BD5`: item B, the planted numbered-choice pause.
  The exit tool judged the stop unexpected (exit 1) and Claude proposed `brief-harness-defect`. Spend was 0.2173 USD; the Phase 3 ledger stands at 11.5158 of 25 USD.
- **Task 2:** not presented: the start stopped unexpectedly (two open pause decisions). Claude ran no amend or decide.
- **Task 3:** the owner saw Claude's proposal and the orchestrator's recommendation and replied `product-defect`. Claude recorded it with `classify --confirm --by owner --class product-defect` (commit 0fc6887), quoting the reply and naming D-26 and D-27. The entry now holds `classification.proposed` (by claude, brief-harness-defect) and `classification.confirmed` (by owner, product-defect, overrides brief-harness-defect).

## The defect the owner ruled

`docs/system/checks-and-evidence.md:129` says a failing baseline check blocks nothing, and G2 treats a required check failing at baseline and again as pre-existing. Yet a required check already red at baseline (`format:check` on `index.html`) paused the run through the unit's verifier, because AVARICE never tells the unit or its verifier that a baseline-red required check is tolerated by G2. The unit therefore parked item A on a verification-human-needed decision. The gate behaves as documented; the verification signal the unit and verifier produce does not.

Evidence from Task 1:

- `src/domain/outcome.ts:116`: a VERIFICATION status of `human_needed` becomes a pause signal.
- `src/app/run-stages/item.ts:390`: the item stage routes that status to a pause decision.
- `docs/system/runs.md:231` and `:266`: the documented pause-signal routing the run followed.
- `docs/system/checks-and-evidence.md:129`: a failing baseline blocks nothing.

The same red check appeared earlier in plan 03-45 and will recur on runs 3 and 1 unless the product is fixed.

## Follow-up (the exit is halted)

1. A gap plan (`/gsd-plan-phase 3 --gaps`) that makes a required check already failing at baseline not route the unit's verification to `human_needed`. Either tell the unit and verifier the baseline results, or treat a pre-existing failure as non-blocking in the verification signal. It needs tests and `docs/system/` updates in the same change.
2. Re-runs of all three runs in the order 2, 3, 1 (D-26, D-33).
3. What the tools will do (03-53's epoch rule): a confirmed product defect sets the epoch to its confirmation time. Run 2's entry started before it, so it satisfies neither the order nor the already-passed rule. The ruling releases a re-run of run 2 itself and does not release run 3 or run 1; run 2 must pass again first. The re-run is run 2's attempt 2 of 2 (D-29): the stop-loss counts failed attempts over all entries, so a second failed attempt ends the exit with code 75 for the owner.
4. Run 2 (`run_01M74RNSAHDTSHE8JDEZ5XW6F9`) is still `blocked_on_decision` in the owner's ledger. The tools refuse a re-run while it is open (D-34), so the owner must cancel it in their own terminal first. Claude never cancels.

Plans 03-58 to 03-60 stay blocked until the re-runs complete.

## Deviations from Plan

None in the work itself: the plan's unexpected-stop branch (Task 1 to Task 3) and its product-defect option were followed as written. Task 2's checkpoint was not presented, as its precondition says.

## Verification

- Task 3 automated check 1: prints `run2-stop-ruled:product-defect`.
- Task 3 automated check 2: Phase 3 spend 11.5158 USD (at most 25), this plan's spend 0.2173 USD (at most 4.50).

## Known Stubs

None.

## Threat Flags

None.
