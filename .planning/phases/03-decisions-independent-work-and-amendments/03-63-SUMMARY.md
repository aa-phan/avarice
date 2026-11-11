---
phase: 03-decisions-independent-work-and-amendments
plan: 63
subsystem: exit-run2-attempt2
tags: [exit, run2, attempt2, d-26, d-27, d-28, d-29, d-33, product-defect, halted]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-61's baseline-red fix, plan 03-62's readiness read and plan 03-56's authorization
provides:
  - "03-57-evidence-exit.json: run 2's attempt 2, its stop, Claude's proposal (product-defect) and the owner's confirmed ruling (product-defect)"
affects: [03-58, 03-59, 03-60, gap-plan]

actuals:
  tokens: 5000
  tasks: 3
  commits: 2
plan_head_before: 412f9be
plan_head_after: b0867e93b196abdea0551b8bb6a47064b50d876b

key-files:
  created: []
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-SUMMARY.md
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "Run 2's attempt 2 stopped unexpectedly at its start (two open pause decisions), so Task 2 was not presented and Task 3 became the owner's ruling on the stop: product-defect"

requirements-completed: []

completed: 2026-11-11
status: halted
---

# Phase 3 Plan 63: Run 2's attempt 2 started once, stopped on item A's human_needed verification, ruled a product defect Summary

**Run 2's attempt 2 repeated the shape of attempt 1 for a new reason: plan 03-61's fix held for `format:check`, but item A's unit cannot make `npm run build` and `npm run check:meta` pass because the check env the conventions declare (`VITE_SITE_ORIGIN`) reaches only the supervisor's own check runs, and the owner ruled this a product defect; D-29 is now exhausted for run 2.**

## Task 1 (tracer, commit a6e0853)

- Run `run_01M75NPTEF7FKDNW8ABQ9Q16WS`, run 2, attempt 2, plan 03-63, host 2.1.319, cap 4.50 USD. Spend 0.1452 USD; Phase 3 ledger 11.6610 USD (at most 25), this plan's spend 0.1452 USD (at most 4.50).
- The run stopped `blocked_on_decision` on two open pause decisions, not the one the brief expects:
  - item A, `dec_01M75NZ08K3RYRX1V6HFX7N6FA`, `verification-human-needed`: the unit and its verifier ran `npm run build` and `npm run check:meta` without `VITE_SITE_ORIGIN`, so both stopped at config load. The supervisor runs those checks with that variable (the conventions' check env) and recorded both as passed;
  - item B, `dec_01M75NZ5ZDY47BAM3BYNH1FE07`, the planted numbered choice.
- What item A's unit and G2 did with `format:check`: plan 03-61's fix worked. The unit reported `format:check` as pre-existing (red at the pin on `index.html`, outside the write set) and did not pause on it.
- Claude's proposal (D-26): `product-defect`. Alternative reading offered to the owner: `brief-harness-defect`.

## The defect, with evidence

The unit's allowed command list is built from each required check's argv alone, dropping the check's `env`. The unit is told to run the check "exactly as written", cannot set the env, and so cannot make the check pass. Its verifier then reports `human_needed`, which raises a pause decision.

- `src/domain/run-contract.ts:635`: allowed commands built from argv only, env dropped.
- `src/app/run-gsd-config.ts:143`: the instruction to run the commands "exactly as written".
- `src/app/checks.ts:216`: only the supervisor's runs receive `spec.env`.
- `src/domain/outcome.ts:116`: a verification `human_needed` becomes a pause signal.
- `src/app/run-stages/item.ts:390`: the item stage acts on that signal.

AVARICE behaved as `docs/system/runs.md` ("The unit") and `docs/system/checks-and-evidence.md` document, because neither says the unit's commands carry the check env. This is the same kind of gap the owner ruled a product defect on attempt 1: the unit is not told, or given, what the gate already knows.

## Task 2

Not presented: the start stopped unexpectedly, so the precondition for the owner's amend and answers did not hold. Claude ran no `avarice cancel`, `contract amend`, `decide` or `resume`.

## Task 3 (the owner's ruling)

The owner replied `product-defect`. It is recorded in the entry with `classify --confirm --by owner --class product-defect`, with the reply quoted and D-26 and D-27 named. Claude's proposal and the owner's confirmation are both in `classification`.

03-57-SUMMARY.md is marked superseded: `status: superseded`, `superseded_by: ["03-61", "03-62", "03-63"]`, `superseded_note`, and the appended section `## Superseded by the gap plans`. The Task 3 check against e9b8845 passes: every other line of the file is unchanged. Commit b0867e9.

Task 3 automated checks: `run2-attempt2-ruled:product-defect`; Phase 3 spend 11.6610 USD, this plan 0.1452 USD; `supersede ok`.

## Run 1 headroom

25 - 4.50 - 11.6610 = 8.8390 USD is the most run 3 may spend before run 1's start would be refused with exit 75 (D-05, D-33). No run was started beyond attempt 2.

## Why this plan is halted, and the follow-ups

Run 2 has failed twice, so D-29 exhausted its attempts, and the tools refuse a third start of run 2 with exit 75. This stop is evidence, not a pass (D-28).

1. A gap plan makes each required check's `env` from the conventions available to the unit's allowed commands and to the verifier, with tests and `docs/system` surfaces (`runs.md` "The unit", `checks-and-evidence.md`). It adds an offline, no-spend parity check that every required check the unit is told to run behaves for the unit as it does for the supervisor on the pinned portfolio.
2. The owner re-decides D-29 (through `/gsd-discuss-phase 3`) before any third attempt of run 2. No further live spend until then.
3. `run_01M75NPTEF7FKDNW8ABQ9Q16WS` stays `blocked_on_decision` until the owner cancels it in their own terminal. Claude never cancels.

Plans 03-58 to 03-60 stay blocked.

## Deviations from Plan

None. The plan's unexpected-stop branch (Task 1 to Task 3) and its `product-defect` option were followed as written.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits a6e0853 and b0867e9 are ancestors of HEAD.
- `classification.confirmed.by` is `owner` with class `product-defect` in the newest run 2 entry.
- 03-57-SUMMARY.md supersede check passed.
