---
phase: 03-decisions-independent-work-and-amendments
plan: 47
subsystem: exit-evidence
status: complete
tags: [exit, evidence, authorization, dry-run, gap-closure, no-spend]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-46's fenced VERIFICATION shape and --finish recording a second stop"
provides:
  - "the exit script's default evidence file is 03-48-evidence-exit.json"
  - "03-47-dry-run.json: the no-spend dry run with the code of plan 03-46"
  - "03-47-exit-authorization.json: the owner's approval at 4.95 USD per run, confirmed at 2026-11-10T22:20:30Z"
  - "03-48-evidence-exit.json: the fourth attempt's evidence file, runs [], with a supersedes block naming the cancelled run 1"
affects: [03-48, 03-30, 03-31, 03-32, 03-33]

actuals:
  tokens: 5600
  tasks: 2
  commits: 4
plan_head_before: 7aca1fa7ea24071febc72538ce6290c0d382b596
plan_head_after: b02767569a3b66b816656fba8d85bf77c72f5c1d

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-47-exit-authorization.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-47-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-48-evidence-exit.json
  modified:
    - scripts/exit-run-phase3.sh
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "The confirmation time recorded in the authorization (2026-11-10T22:20:30Z) is the time Claude read the ledger and the portfolio after the owner's reply, not a time the owner supplied."
  - "The three runs at 4.95 USD cap 14.85 of the 14.8706 USD headroom, so Phase 3 ends at most at 24.9794 USD and there is no room for another repeat."

requirements-completed: [AUT-3, AUT-5]

coverage:
  - id: D1
    description: "The exit script's default evidence file is 03-48-evidence-exit.json, and the header names the earlier evidence files as history"
    requirement: "AUT-5"
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts (default-evidence case); node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts: 84 pass, 0 fail"
        status: pass
    human_judgment: false
  - id: D2
    description: "A no-spend dry run with the code of plan 03-46 shows conventions ok, staleness ok, no problem, promptScope 0, a fitting cap of 4.95 USD, and an unchanged portfolio"
    requirement: "AUT-3"
    verification:
      - kind: other
        ref: "EXIT_DRY_RUN_OUT=.planning/phases/03-decisions-independent-work-and-amendments/03-47-dry-run.json scripts/exit-run-phase3.sh --dry-run"
        status: pass
    human_judgment: false
  - id: D3
    description: "The owner cancelled run 1 and approved the 4.95 USD authorization; the repeat's evidence file is seeded and the tools' authorize passes on the pinned 2.1.319 host"
    requirement: "AUT-3"
    verification:
      - kind: other
        ref: "Task 2 automated verify (node -e over 03-48-evidence-exit.json and 03-47-exit-authorization.json) and `tools authorize` for the first brief: exit 0"
        status: pass
    human_judgment: true
    rationale: "The owner's cancel and approval are a human act; the ledger read and the file checks only confirm their effect"

duration: 3h
completed: 2026-11-10
---

# Phase 3 Plan 47: Exit repeat preparation (fourth attempt) Summary

**The exit script now defaults to 03-48-evidence-exit.json, a no-spend dry run with the code of plan 03-46 passes at a 4.95 USD per-run cap, the owner cancelled stopped run 1 and approved the authorization, and 03-48-evidence-exit.json is seeded with its supersedes block.**

## Performance

- **Tasks:** 2 (Task 1 tracer with RED/GREEN, Task 2 blocking-human checkpoint)
- **Files modified:** 5 (script, test, three planning records)
- **Spend:** 0 USD; no model host launched; no owner command run by Claude

## Accomplishments

- The default-evidence case in `test/unit/exit-evidence.test.ts` asserts 03-48-evidence-exit.json (RED against the script's 03-45 default, then GREEN). The script's header names the 03-29, 03-42 and 03-45 evidence files as the history of the three halted attempts.
- Dry run (03-47-dry-run.json): 0 problems, 2 warnings; conventions ok, staleness ok; promptScope 0 for every item; the three brief digests equal 03-44's. Phase 3 stands at 10.1294 of 25 USD, headroom 14.8706, largest per-run cap that fits three runs 4.95 (exact 4.956863). Portfolio composite sha256:36b38e4807e83638677632b41d5e2593cb07a47cdc2332fb66ca042e1a8a7b67, HEAD 9f63d9114c5d3d720b8496b08cec85382cfaa357, 6 refs, unchanged.
- 03-47-exit-authorization.json: approval, 4.95 USD per run, ceiling 25, the three briefs, the 2.1.319 pin. Task 2 set `ownerConfirmedAt` to 2026-11-10T22:20:30Z and recorded the owner's reply "cancelled; authorization approved" with the ledger and portfolio checks.
- Run run_01M7220WKE6WAP7N0FTPSH95RV is `cancelled` (stateAt 2026-11-10T08:26:25.857Z, version 7) in the owner's ledger, read through the read-only read model. Its two decisions are answered (dec_01M722AMGKSDC2RPA5SZ1VE7N6) and withdrawn (dec_01M7274XVDJAH8MC3XZ6M89DR4); none is open. The portfolio snapshot after the cancel equals the dry run's (same composite, HEAD and ref count).
- 03-48-evidence-exit.json: schema 1, plan 03-48, decision "D-03, D-05", runs [], supersedes { file 03-45-evidence-exit.json, runId, state cancelled, stateAt, reason }. The tools' `authorize` for the first brief exits 0 on the pinned 2.1.319 host (a `--version` probe only): "Phase 3 spend 10.1294 plus 4.95 fits 25 USD, run 1 of 3". `field --pick perRunCapUsd` prints 4.95.

## Task Commits

1. **Task 1 (RED):** `97b1d49` test(03-47) the default evidence file is 03-48-evidence-exit.json
2. **Task 1 (GREEN):** `1c34f1d` feat(03-47) the exit script's default evidence file is 03-48-evidence-exit.json
3. **Task 1 (artifacts):** `35677ed` chore(03-47) no-spend dry run and the 4.95 USD authorization, ownerConfirmedAt null
4. **Task 2:** `b027675` chore(03-47) the owner's confirmation, run 1 cancelled, 03-48 evidence file seeded

## Deviations from Plan

None - plan executed exactly as written.

Two procedural differences, neither a change of scope:

- The root-pin script refused to run in the first agent's session, so the root was compared by hand with `git rev-parse --show-toplevel` against the pinned worktree before the edits and commits. It ran normally in the continuation.
- The dry run was run as `env EXIT_DRY_RUN_OUT=... scripts/exit-run-phase3.sh --dry-run`, since the harness refused the bare environment-variable prefix form.

## Issues Encountered

- `AVARICE_PHASE3_PLAN` still defaults to 03-42 in scripts/exit-run-phase3.sh. Plan 03-48 sets it explicitly for its starts, so the default was left alone.
- The whole test suite was not run in this plan. The plan's own check passed: `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts` (84 pass, 0 fail).
- The harness refused a shell command that computed a git path at run time, so the portfolio snapshot was taken with the tools' own `snapshot` verb (git objects and file reads, no write) instead of `git -C`.

## Next Phase Readiness

- Plan 03-48 can start exit part 1: its precondition (`ownerConfirmedAt` set) holds, `authorize` passes, and the supersedes guard is satisfied. Three runs at 4.95 USD cap 14.85 of the 14.8706 USD headroom, so there is no room for another repeat.
- The owner commands for 03-48 and 03-30 keep `AVARICE_CLAUDE_BIN` and carry no `CLAUDE_CONFIG_DIR`, and are run in the owner's own terminal window.

## Threat Flags

None.

## Self-Check: PASSED

- 03-47-exit-authorization.json, 03-47-dry-run.json, 03-48-evidence-exit.json: found.
- Commits 97b1d49, 1c34f1d, 35677ed, b027675: found on HEAD.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10*
