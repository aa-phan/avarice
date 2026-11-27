---
phase: 03-decisions-independent-work-and-amendments
plan: 62
subsystem: live-exit-readiness
tags: [readiness, run2-attempt2, authorize, spend-arithmetic, d-05, d-29, d-34, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-61's baseline-red fix (preExistingAtStart), plan 03-57's evidence and the owner's product-defect ruling, plan 03-56's authorization
provides:
  - "03-62-readiness.json: attempt 1's state and ruling, the fix's commits, preExistingForItemA, authorize's result, the host and the spend arithmetic"
affects: [03-63]

actuals:
  tokens: 6000
  tasks: 2
  commits: 1
plan_head_before: fde1f8e063f3ea1311630211e00ce39b78103b7a
plan_head_after: e67fb380b56bd4525429a4f2e035b8566acffa46

tech-stack:
  added: []
  patterns: ["a read-only facts file computed from the real tools (status --json, preExistingAtStart, authorize), never narrated"]

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-62-readiness.json
  modified: []

key-decisions:
  - "Task 2 (the owner's cancel) is not presented: the readiness read found run_01M74RNSAHDTSHE8JDEZ5XW6F9 already cancelled, so the plan's own skip rule applies"

requirements-completed: [AUT-5, AUT-12]

duration: 10min
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 62: Run 2 Attempt 2 Readiness Summary

**Every machine check on the way to run 2's attempt 2 of 2 passed without spend or a host launch: attempt 1 is already cancelled, the 03-61 fix tells exactly `format:check` for item A, and authorize admits `run2 attempt 2` under the unchanged authorization.**

## What was checked (Task 1, tracer; commit e67fb38)

All read-only; no model host launched; no `avarice start`, `cancel`, `decide`, `resume` or `contract amend` was run.

- **Attempt 1:** `avarice status --json` (host 2.1.319) shows `run_01M74RNSAHDTSHE8JDEZ5XW6F9` as `cancelled`, with `cancelRequestedAt` set. Its class in `03-57-evidence-exit.json` is `classification.confirmed` by owner: `product-defect`.
- **The fix:** plan 03-61 SUMMARY status `complete`; commits 9785192, 3476fda, c123f10, bce5093 and the SUMMARY f642cfe.
- **Item A's list:** `preExistingAtStart` applied to attempt 1's `base` check rows, with the required checks of the portfolio conventions and run 2's `targetChecks` (`test`), gives exactly `["format:check"]` (`preExistingForItemA`).
- **Host:** `2.1.319 (Claude Code)`.
- **authorize, run 2:** exit 0, last line `authorized: test/benchmark/phase3/p3-run2-graduation-label.md (sha256:f0c9395bc0fd...), host 2.1.319, Phase 3 spend 11.5158 plus 4.50 fits 25 USD, run2 attempt 2`. The digest, the D-31 gate, the order, the preflight and the host all passed.
- **Spend arithmetic (D-05, D-33):** recorded Phase 3 spend 11.5158 USD (ledger 11.51585). Cap 4.50 USD per run, ceiling 25 USD. Three more runs at the full cap would reach 25.0158 USD, so `fullCapsFit` is false by 0.0158. The ceiling still cannot be passed: before every start authorize refuses with exit 75 when spend plus 4.50 exceeds 25. Run 2's attempt 2 and run 3 always fit. Run 1 fits only if runs 2 and 3 together spend at most 25 - 4.50 - 11.5158 = 8.9842 USD (`run1HeadroomUsd` 8.9842). The earlier full attempts cost about 1 USD each. The cap comes only from the authorization (`perStartCapOverride: false`); a lower cap for run 1 needs a new authorization after the owner's fresh approval (D-28). If run 1 is refused, plan 03-59's Task 1 halts on exit 75 and the owner decides.

Task 1's automated verify passed.

## Task 2: already terminal: cancelled

The checkpoint is not presented. The plan's precondition says that when `run2Attempt1.state` is cancelled, failed or closed, the checkpoint is not presented and the SUMMARY records "already terminal: <state>". Run 2's attempt 1 was read as `cancelled` before any request to the owner, so no owner reply exists to quote. The cancel happened in the owner's ledger by a command Claude did not run (D-34); the spend facts above are the facts the owner would have been shown. Task 2's automated verify (`status --json`: the run is cancelled, failed or closed) passes.

## Deviations from Plan

None - plan executed exactly as written (Task 2 took the plan's own skip path).

## Known Stubs

None.

## Threat Flags

None. The threat register's mitigations hold: no cancel by Claude (T-03-165), authorize's D-05 guard and the recorded headroom (T-03-166), authorize admitted `run2 attempt 2` with no other refusal (T-03-167), no package installs (T-03-SC).

## Next

Plan 03-63 starts run 2's attempt 2 of 2 (D-29) under the unchanged 03-56 authorization.

## Self-Check: PASSED

- FOUND: .planning/phases/03-decisions-independent-work-and-amendments/03-62-readiness.json
- FOUND: e67fb38 (git merge-base --is-ancestor)
