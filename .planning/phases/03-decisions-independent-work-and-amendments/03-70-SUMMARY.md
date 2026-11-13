---
phase: 03-decisions-independent-work-and-amendments
plan: 70
subsystem: exit-run3-attempt2
tags: [exit, run3, attempt2, d-26, d-27, d-28, d-29, d-33, d-36, d-37, product-defect, halted]
requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-69's search-route fix (the launch line keeps Grep and Glob), plan 03-68's run 2 attempt 3 and plan 03-56's authorization
provides:
  - "03-57-evidence-exit.json: run 3's attempt 2, its stop, Claude's proposal (brief-harness-defect) and the owner's confirmed ruling (product-defect, overriding the proposal)"
  - "03-58-SUMMARY.md marked superseded by 03-69 and 03-70"
affects: [03-59, 03-60, gap-plan]
actuals:
  tokens: 6000
  tasks: 3
  commits: 2
plan_head_before: 431e7d1291c1c3cf3b52acf415f204f923288c6a
plan_head_after: 971def76b9f75aa415d824bdd46d33238836cbea
key-files:
  created: []
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-58-SUMMARY.md
    - test/containment/live-spend-phase3.jsonl
key-decisions:
  - "Run 3's attempt 2 stopped unexpectedly at its start (two open pause decisions, not one), so Task 2 was not presented and Task 3 became the owner's ruling on the stop: product-defect, overriding Claude's brief-harness-defect proposal"
requirements-completed: []
completed: 2026-11-13
status: halted
---

# Phase 3 Plan 70: Run 3's attempt 2 started once, stopped on item A's human_needed for the declared non-required check test:e2e, ruled a product-defect Summary

**Run 3's attempt 2 proved the search route that plan 03-69 built (18 Grep and 8 Glob calls, no "No such tool" error, no hook refusal, no loop.limit) and then stopped again on item A's `human_needed`, this time because the unit's admitted-command list holds the declared non-required check `test:e2e`, which cannot pass as written. The owner ruled a product-defect, overriding Claude's brief-harness-defect proposal. The plan is halted: the stop is evidence, not a pass (D-28).**

## The owner's reply

The owner replied, verbatim: "product-defect"

This overrides Claude's proposal (brief-harness-defect). The record is the owner's class: `classification.confirmed` in run 3's attempt-2 entry is `by: owner`, `class: product-defect`, `overrides: brief-harness-defect`, with `ref` quoting the reply, the plan 03-70 Task 3 checkpoint and the date 2026-11-13. This is run 3's ruling for the order (plan 03-59 reads it here).

## Profile config (read-only)

The owner's profile config still forces the banner failure (`notify.local.osascriptPath` `/nonexistent/osascript`, `notify.batchWindowMinutes` 1). Claude edited no profile file. Both banners of attempt 2 were queued with lastError `osascript-missing`, so the forced failure held.

## Task 1 (tracer, commit ec1f0db)

- No-spend readiness checks passed before the start: the probe and scenario S proved the search route on the pinned host (plan 03-69). Attempt 1's run `run_01M78966NJ0SW8NB54564MFFZW` was read as the owner's to cancel.
- Run `run_01M79HRGD1R1538H52AH0B8FEX`, run 3, attempt 2, host 2.1.319, cap 4.50 USD. Started once. It stopped `blocked_on_decision` on two open pause decisions, not the one its brief plants:
  - item A `dec_01M79J7DJHSYS9S4EW51923646`, `verification-human-needed`, free text only;
  - item B `dec_01M79J7VKRH14Q5D129JTHWZG3`, the planted numbered choice.
- Silence facts: no silence step was run, because it needs the one expected decision. Checkout digests were equal before and after and no new ref appeared.

## Did the verifier search with the Grep tool

Yes. Read-only transcript and ledger evidence: 18 Grep and 8 Glob calls across the unit's agents, every result returned, no "No such tool available" error, no hook refusal of a shell call, and no `loop.limit` event (no agent made more than 10 searches against a limit of 25 consecutive). Plan 03-69's fix works live.

## Cause of the stop

- The unit's admitted-command list includes every declared check, required or not (`src/domain/run-contract.ts:671`, `:582`).
- The benchmark conventions declare `test:e2e` with `required: false` and no env (`test/benchmark/portfolio/avarice-config.json:16`). It runs the build, which needs `VITE_SITE_ORIGIN`.
- The unit's planner made "test:e2e exits 0" a gate of its quick plan. The command failed with "VITE_SITE_ORIGIN is empty", the prefixed form is not an admitted command, and the verifier wrote `human_needed` (`src/domain/outcome.ts:116`, `src/app/run-stages/item.ts:390`), which the supervisor reads as a pause.
- The prompt says nothing about declared checks the gate does not judge (`src/app/run-gsd-config.ts:119-121`, `:143`). It tells the unit what the gate does with a required check that failed before the item began, so the unit makes a gate of the one it is not told about.
- Item A's change itself was made and every check the gate reads passed at the run's tree except `format:check`, which is pre-existing.

## Claude's proposal (D-26), and the owner's override

Claude proposed `brief-harness-defect` (AVARICE behaved as `docs/system/runs.md` documents; the benchmark conventions declare a check that cannot pass). It named `product-defect` as the alternative: the prompt is silent about declared checks the gate does not judge, and the unit's list holds a command that cannot work. The owner ruled `product-defect`. The proposal is in the entry as `classification.proposed` (by claude, 2026-11-13T04:25:05Z) and the owner's ruling as `classification.confirmed` (commit 971def7).

## Task 2

Not presented. The start stopped unexpectedly, so the precondition (`silent-and-open-as-expected`) did not hold. Claude ran no `avarice cancel`, `contract amend`, `decide` or `resume`, and no `--silence` or `--finish`.

## Task 3 (the owner's ruling, commit 971def7)

Recorded with `classify --confirm --by owner --class product-defect`. 03-58-SUMMARY.md is marked superseded: only `status: halted` became `status: superseded`, `superseded_by: ["03-69", "03-70"]` and `superseded_note` were added, and the section `## Superseded by the gap plans` was appended, quoting the reply. The line-by-line check against b01bf6c (git run outside node, the heading anchored on its last occurrence) printed `supersede ok`. Automated checks: `run3-attempt2-ruled:product-defect`; Phase 3 spend within caps.

## Spend and what remains

- This plan: 0.2171 USD of 4.50. Phase 3 ledger: 13.1110 of 25 (53 lines).
- Run 1 headroom after the finish: 25 - 4.50 - 13.1110 = **7.3890 USD** (run 1's start is refused with exit 75 below zero, D-05, D-33).
- Run 3 has 2 failed attempts in its epoch, so no further start of run 3 is admitted: authorize refuses it with exit 75 until an owner-confirmed reset (D-29, D-36, D-37, D-38). A product-defect ruling is what makes that reset available.

## Why this plan is halted, and the follow-up

The stop is evidence, not a pass (D-28). Nothing was started or spent after the ruling; Claude ran no `--silence` or `--finish`.

1. **A gap plan** fixes two things:
   - the unit's admitted-command list for declared non-required checks (`src/domain/run-contract.ts`), so the unit is not handed a command that cannot work as declared;
   - the prompt's rule for declared checks the gate does not judge (`src/app/run-gsd-config.ts`), so the unit does not make a gate of one;
   - with the matching `docs/system/runs.md` text.

   The gap plan needs an offline scenario that is red before and green after, parity at the pin, and the owner's D-37 reset confirmation (three proofs).
2. Then run 3 gets a new epoch, and D-26 requires all three runs to pass again in it. Run 3 still runs before run 1 (D-33). Any change to run 3's brief goes through the D-31 gate and a fresh D-04 approval.
3. `run_01M79HRGD1R1538H52AH0B8FEX` stays open (`blocked_on_decision`) until the owner cancels it in their own terminal. Attempt 1's run `run_01M78966NJ0SW8NB54564MFFZW` is likewise the owner's to cancel. Claude never cancels.
4. The profile config still forces the banner failure; the owner restores it, or keeps it for the next run 3 attempt.

Plans 03-59 and 03-60 stay blocked.

## Documentation surfaces for plans 03-31 to 03-33

This plan changed no code, so no `docs/system` surface changed here. The gap plan for the product defect must change these surfaces:

- `docs/system/runs.md`, "Preparation (`contract_ready`)" and "The unit (`running`)": which declared checks are admitted to the unit as commands to run exactly as written (the execution row), and what the unit is told about a declared check the gate does not judge (not required, not a target check, reported not run under D-35).
- `docs/system/runs.md`, "Repository conventions": how a required-false check with no env relates to the unit's list, if the rule changes.

Plans 03-31 to 03-33 describe those sections from the code after the gap plan lands.

## Deviations from Plan

None. The plan's unexpected-stop branch (Task 1 to Task 3) and its `product-defect` option were followed as written; the SUMMARY status is halted with the follow-up named.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits ec1f0db and 971def7 are ancestors of HEAD; `git rev-list --count 431e7d1..HEAD` was 2 before this SUMMARY's commit.
- `classification.confirmed.by` is `owner` with class `product-defect` in run 3's newest entry (attempt 2).
- Task 3 checks passed: `supersede ok`, `run3-attempt2-ruled:product-defect`, run1HeadroomUsd 7.3890.
