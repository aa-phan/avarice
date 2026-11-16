---
phase: 03-decisions-independent-work-and-amendments
plan: 60
subsystem: exit-record
tags: [exit, verdict, supplementary, correct-stop, d-26, d-28, d-33, d-34, live-spend, complete]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-59's run 1 attempt 1 pass, plan 03-74's run 3 attempt 3 pass, plan 03-73's run 2 attempt 4 pass, each with the owner's `continue`; plan 03-56's authorization
provides:
  - "03-57-evidence-exit.json: top-level verdict `exit: 3/3 ready_for_review`, verdictRuns, correctStops, verdictAt and supplementary, all written by the exit tools"
  - "test/containment/LIVE-CASES.md: the Exit (plans 03-57 to 03-68) section, one row per attempt, and the Phase 3 spend table carried to the ledger sum"
affects: [03-31, 03-32, 03-33]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 36ed80a85a466fb9f93fff617b134d9d9d570104
plan_head_after: 63abf2fcaeaf5762e2ac3a1ed4796bae60f43337

tech-stack:
  added: []
  patterns: ["the exit verdict computed by the tools over the current D-26 epoch, with correct stops and a superseded run kept as non-counting evidence"]

key-files:
  created: []
  modified:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-57-evidence-exit.json
    - test/containment/LIVE-CASES.md

key-decisions:
  - "The verdict is 3 of 3, computed by the tools: run 2 attempt 4, run 3 attempt 3 and run 1 attempt 1 count; the plan is complete, not halted"
  - "LIVE-CASES.md keeps the heading `Exit (plans 03-57 to 03-68)` because the plan's must_haves, action, verify pattern and key_links all name it literally; the section lists every attempt, including plans 03-69 to 03-74 and 03-59, and says so in its second paragraph"

requirements-completed: [AUT-1, AUT-2, AUT-3, AUT-4, AUT-5, AUT-6, RC-6]

coverage:
  - id: D1
    description: "The evidence file's verdict is `exit: 3/3 ready_for_review`, written by `verdict` against 03-56-exit-authorization.json, with verdictRuns naming run2 (attempt 4), run3 (attempt 3) and run1 (attempt 1)"
    requirement: AUT-5
    verification:
      - kind: other
        ref: "03-60 Task 1 verify: jq over 03-57-evidence-exit.json (verdict equals the 3/3 line)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Old run 1 (run_01M73RX3RF0ZJETYWVF52WFZ5B) is in `supplementary` with countsToward3of3 false, written by `supplement` from 03-48-evidence-exit.json; run 3 attempt 1 is the one correct stop; four earlier attempts are listed as not counted"
    requirement: AUT-3
    verification:
      - kind: other
        ref: "03-60 Task 1 verify: jq over supplementary and correctStops"
        status: pass
    human_judgment: false
  - id: D3
    description: "LIVE-CASES.md has the Exit section with 8 attempt rows, the old run 1 line, the correct-stop line and the cumulative spend 16.6429 USD, equal to the ledger sum over 59 lines and under 25 USD"
    requirement: AUT-2
    verification:
      - kind: other
        ref: "03-60 Task 2 verify: ledger sum 16.6429 found after the Exit heading, sum under 25"
        status: pass
    human_judgment: false

duration: "one dispatch; verdict recorded 2026-11-14T21:57:59Z"
completed: 2026-11-14
status: complete
---

# Phase 3 Plan 60: The Exit Record Summary

**The exit tools computed `exit: 3/3 ready_for_review` over the current D-26 epoch (run 2 attempt 4, run 3 attempt 3, run 1 attempt 1), kept old run 1 as supplementary evidence and run 3 attempt 1 as a correct stop, and LIVE-CASES.md now states all eight attempts and the Phase 3 spend of 16.6429 of 25 USD.**

## Performance

- **Tasks:** 2 (a tracer and one auto task); no live run started, no spend, nothing cancelled, decided, resumed or amended
- **Files modified:** 2 (the evidence file and LIVE-CASES.md)

## Accomplishments

- Task 1 (commit 48d39f2): `supplement` recorded old run 1 from 03-48-evidence-exit.json with a note naming D-34 and its five facts (A independent and committed; B's delegated session resumed under the recorded configuration directory; G2 passing a resumed unit; the protected-write refusal, plan 03-49 scenario P, exit 64; the honest `gaps_found` stop). `verdict` then exited 0 and wrote `verdict`, `verdictRuns`, `correctStops` and `verdictAt`.
- Task 2 (commit 63abf2f): added `## Exit (plans 03-57 to 03-68)` to LIVE-CASES.md after the Phase 2 exit section, and carried the Phase 3 spend table (stale at plan 03-39, 7.9739 USD) through plan 03-59 to the ledger sum.

## The verdict

| Role | Run | Attempt (plan) | Result |
|---|---|---|---|
| run 2 | `run_01M7C1JN8KNG3TXP4Z93CZPY90` | 4 (03-73) | counted |
| run 3 | `run_01M7C32K11S8YDK4W2K8VHCXV3` | 3 (03-74) | counted |
| run 1 | `run_01M7DVKCXRR2MYYPK3K46B3ED0` | 1 (03-59) | counted |

All three ended `ready_for_review` clean, each from one `avarice start`, and the owner ruled `continue` on each.

## Attempts and rulings

| Run | Attempt (plan) | Outcome | Counts |
|---|---|---|---|
| `run_01M74RNSAHDTSHE8JDEZ5XW6F9` (run 2) | 1 (03-57) | stopped; owner ruled product-defect (fixed by 03-61) | no, new epoch |
| `run_01M75NPTEF7FKDNW8ABQ9Q16WS` (run 2) | 2 (03-63) | stopped; owner ruled product-defect (fixed by 03-64) | no, new epoch |
| `run_01M770J8CYMCQSXJWVXBFAEGCW` (run 2) | 3 (03-68) | passed, before the epoch that began 2026-11-13T22:50:44Z | no, earlier epoch |
| `run_01M7C1JN8KNG3TXP4Z93CZPY90` (run 2) | 4 (03-73) | passed | yes |
| `run_01M78966NJ0SW8NB54564MFFZW` (run 3) | 1 (03-58) | stopped; owner ruled brief-harness-defect, fix first | no, correct stop (D-28) |
| `run_01M79HRGD1R1538H52AH0B8FEX` (run 3) | 2 (03-70) | stopped; owner ruled product-defect (fixed by 03-71, reset in 03-72) | no, new epoch |
| `run_01M7C32K11S8YDK4W2K8VHCXV3` (run 3) | 3 (03-74) | passed | yes |
| `run_01M7DVKCXRR2MYYPK3K46B3ED0` (run 1) | 1 (03-59) | passed | yes |

## Correct stops and supplementary record

- Correct stop (D-28, evidence and not a pass): run 3 attempt 1, stopped at item A's own `human_needed` verification (the verifier could not run a repo-wide search); AVARICE conformed to `docs/system/runs.md`.
- Supplementary (D-34): old run 1, `countsToward3of3` false.

## Spend

The eight attempts cost 5.3444 USD. The Phase 3 ledger sums to 16.6429 USD over 59 lines, so 8.3571 USD remain under the 25 USD ceiling (D-05).

## Heading choice

The plan's text pins the heading `Exit (plans 03-57 to 03-68)` in must_haves, the action, the key_links pattern and the verify's `sed` anchor, so widening it would have failed the plan's own verify. I kept the heading and listed every attempt under it, including plans 03-69 to 03-74 and 03-59; a paragraph in the section says the range names the plans that first planned it.

## Deviations from Plan

None - plan executed exactly as written. One addition within Task 2's scope: the Phase 3 spend table in LIVE-CASES.md had stopped at plan 03-39, so its missing 13 plan rows (03-29 to 03-59) were added to bring the running total to the ledger sum, as the action asks.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- FOUND: 03-57-evidence-exit.json with verdict `exit: 3/3 ready_for_review`
- FOUND: test/containment/LIVE-CASES.md Exit section; ledger sum 16.6429 present
- FOUND commits: 48d39f2, 63abf2f
