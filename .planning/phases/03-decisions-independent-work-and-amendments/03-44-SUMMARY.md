---
phase: 03-decisions-independent-work-and-amendments
plan: 44
subsystem: exit-evidence
status: complete
tags: [exit, evidence, host-config-dir, authorization, dry-run, gap-closure]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-43's recorded host configuration directory (run step host:config-dir)"
provides:
  - "the exit evidence records each run's recorded host configuration directory (hostConfigDir); the start judge lists a problem for a run that has none"
  - "03-44-dry-run.json: the no-spend dry run with the fixed code"
  - "03-44-exit-authorization.json: the owner's approval at 5.27 USD per run, confirmed at 2026-11-10T06:20:42Z"
  - "03-45-evidence-exit.json: the repeat's evidence file, runs [], with a supersedes block naming the cancelled run 1"
affects: [03-45, 03-30, 03-31, 03-32, 03-33]

actuals:
  tokens: 21000
  tasks: 2
  commits: 4
plan_head_before: f797b4a09ff6c04108d442c8309d5daa7209f4d0
plan_head_after: 0695c4078e8699b3b612a943e95494421d168d72

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-44-exit-authorization.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-44-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-44-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-45-evidence-exit.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - scripts/exit-run-phase3.sh
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "The finish judge's session checks are unchanged; hostConfigDir is added beside the resume facts, and the start judge requires it for a run started by the fixed code."
  - "The confirmation time recorded in the authorization is the time Claude read the ledger after the owner's reply (2026-11-10T06:20:42Z), not a time the owner supplied."

requirements-completed: [AUT-3, AUT-5]

coverage:
  - id: D1
    description: "The exit evidence entry carries the host configuration directory a run recorded at start, and the start judge lists a problem when a run has none"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts#collect carries the host configuration directory the run recorded at start into its evidence entry"
        status: pass
    human_judgment: false
  - id: D2
    description: "A no-spend dry run with the fixed code shows conventions ok, staleness ok, no problem, promptScope 0, a fitting cap of 5.27 USD, and an unchanged portfolio"
    requirement: "AUT-3"
    verification:
      - kind: other
        ref: "EXIT_DRY_RUN_OUT=.planning/phases/03-decisions-independent-work-and-amendments/03-44-dry-run.json bash scripts/exit-run-phase3.sh --dry-run"
        status: pass
    human_judgment: false
  - id: D3
    description: "The owner cancelled run 1 and approved the 5.27 USD authorization; the repeat's evidence file is seeded and the tools' authorize passes on the pinned 2.1.319 host"
    requirement: "AUT-3"
    verification:
      - kind: other
        ref: "Task 2 automated verify (node -e over 03-45-evidence-exit.json and 03-44-exit-authorization.json) and `tools authorize` for the first brief: exit 0"
        status: pass
    human_judgment: true
    rationale: "The owner's cancel and approval are a human act; the ledger read and the file checks only confirm their effect"

duration: 3h
completed: 2026-11-10
---

# Phase 3 Plan 44: Exit repeat preparation Summary

**The exit evidence now records each run's recorded host configuration directory, a no-spend dry run with the fixed code passes at a 5.27 USD per-run cap, the owner cancelled stopped run 1 and approved the authorization, and 03-45-evidence-exit.json is seeded with its supersedes block.**

## Performance

- **Tasks:** 2 (Task 1 tracer with RED/GREEN, Task 2 blocking-human checkpoint)
- **Files modified:** 7 (3 tool/test files, 4 planning records)
- **Spend:** 0 USD; no model host launched; no owner command run by Claude

## Accomplishments

- `collect` reads the run's `host:config-dir` step through the read-only read model and writes `hostConfigDir` into the entry. `judgeStart` lists "the run recorded no host configuration directory (the fix of plan 03-43 did not run)" for a run without it. `judgeFinish` copies it beside the resume facts and keeps its session checks. The script's default evidence file is 03-45-evidence-exit.json.
- Dry run (03-44-dry-run.json): 0 problems, 2 warnings; conventions ok, staleness ok; promptScope 0 for every item; the three brief digests equal 03-41's. Phase 3 stands at 9.1851 of 25 USD, headroom 15.8149, largest per-run cap that fits three runs 5.27 (exact 5.271619). Portfolio composite sha256:36b38e4807e83638677632b41d5e2593cb07a47cdc2332fb66ca042e1a8a7b67, HEAD 9f63d91, 6 refs.
- 03-44-exit-authorization.json: approval, 5.27 USD per run, ceiling 25, the three briefs, the 2.1.319 pin. Task 2 set `ownerConfirmedAt` to 2026-11-10T06:20:42Z and recorded the owner's reply "cancelled; authorization approved".
- Run run_01M71J9AVJ3N1BEKC4EM2P0GGF is `cancelled` (stateAt 2026-11-10T06:18:59.148Z) in the owner's ledger, read through the read-only read model. Its two decisions are answered (dec_01M71JMC67N5M4NVZ329CHNBGV) and withdrawn (dec_01M71M4PB9EQJFNH0S75HTYWSR); none is open. The portfolio snapshot after the cancel equals the dry run's.
- 03-45-evidence-exit.json: schema 1, plan 03-45, decision "D-03, D-05", runs [], supersedes { file 03-42-evidence-exit.json, runId, state cancelled, stateAt, reason }. The tools' `authorize` for the first brief exits 0 on the pinned 2.1.319 host (a `--version` probe only): "Phase 3 spend 9.1851 plus 5.27 fits 25 USD, run 1 of 3".

## Task Commits

1. **Task 1 (RED):** `84048a3` test(03-44) failing tests for the recorded host configuration directory
2. **Task 1 (GREEN):** `7d005f3` feat(03-44) the exit evidence records each run's host configuration directory and the start judge requires it
3. **Task 1 (artifacts):** `7d07aed` chore(03-44) no-spend dry run and the 5.27 USD authorization, ownerConfirmedAt null
4. **Task 2:** `0695c40` chore(03-44) the owner cancelled run 1 and approved the authorization; the repeat's evidence file is seeded

## Deviations from Plan

None - plan executed exactly as written.

The one procedural difference: the owner's first attempt to cancel went through the Claude session's `!` shell, not a terminal, and the identity rule refused it with no change. The owner then ran the cancel in their own terminal. Claude ran no owner command at any point.

## Issues Encountered

- `AVARICE_PHASE3_PLAN` still defaults to 03-42 in scripts/exit-run-phase3.sh. Plan 03-45 sets it explicitly for its starts, so the default was left alone.
- The whole test suite was not run in this plan. The plan's own checks passed: `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts` (76 pass, 0 fail) and `npm run typecheck`.
- The root-pin script could not be executed by the harness (it refused a bash script call); the root was compared by hand with `git rev-parse --show-toplevel` against the pinned worktree and matched before the edits and the commits.

## Next Phase Readiness

- Plan 03-45 can start exit part 1: its precondition (`ownerConfirmedAt` set) holds, `authorize` passes, and the supersedes guard is satisfied. Three runs at 5.27 USD cap 15.81 of the 15.8149 USD headroom, so there is no room for another repeat.
- The owner commands for 03-45 and 03-30 keep `AVARICE_CLAUDE_BIN` and carry no `CLAUDE_CONFIG_DIR`.

## Threat Flags

None.

## Self-Check: PASSED

- 03-44-exit-authorization.json, 03-44-dry-run.json, 03-44-red-evidence-task1.json, 03-45-evidence-exit.json: found.
- Commits 84048a3, 7d005f3, 7d07aed, 0695c40: found on HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10*
