---
phase: 03-decisions-independent-work-and-amendments
plan: 29
subsystem: exit-benchmark
status: halted
tags: [exit-run, portfolio, d-03-stop, pause-detection, spend-guard, host-pin]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-28: approved briefs, the 5.67 USD per-run cap, the 25 USD ceiling and the 2.1.319 host pin"
provides:
  - "scripts/exit-run-phase3.sh --run and --finish, and the tools' authorize, snapshot, field and evidence subcommands, with the D-05 spend guard (exit 75) and the host pin"
  - "03-29-evidence-exit.json: run 1's record, a D-03 stop with the diagnosis"
affects: [03-30, phase-3-exit]

actuals:
  tokens: 21000
  tasks: 1
  commits: 2
plan_head_before: c2ee81aa644901b84a80f723b718f2c707765924
plan_head_after: 40213cab7ad65bff42093771df24de8cb067fd71

tech-stack:
  added: []
  patterns:
    - "Two-stage evidence per run: stage start records the stop and the session each item carried; stage finish waits for the next stop and compares the resumed session with that record"
    - "Spend recorded as the delta between the run's costUsd budget and what the Phase 3 ledger already holds for its run ID"

key-files:
  created:
    - test/unit/exit-evidence.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-29-evidence-exit.json
  modified:
    - scripts/exit-run-phase3.sh
    - scripts/exit-run-phase3-tools.ts
    - scripts/exit-run-phase2-tools.ts
    - test/containment/live-spend-phase3.jsonl

key-decisions:
  - "The plan stops at Task 1 under D-03: run 1 did not block only the owner-choice item. Tasks 2 and 3 were not run, no decision was answered, and no second run was started"
  - "The 03-28 authorization and the 2.1.319 pin were used unchanged; AVARICE_LIVE_ADMIT_CLAUDE_VERSION was never set"

requirements-completed: []

coverage:
  - id: D1
    description: "The exit script's --run and --finish modes with the D-05 guard, the host pin and the checkout digests"
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts"
        status: pass
      - kind: other
        ref: "tools authorize with AVARICE_PHASE3_CEILING_USD=10 exits 75; with the 2.1.321 binary exits 2; with the pinned binary exits 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Run 1 blocks only the owner-choice item on its own pause, completes the independent item with its commit, and resumes after the owner's answer"
    verification:
      - kind: other
        ref: "bash scripts/exit-run-phase3.sh --run test/benchmark/phase3/p3-run1-copy-fallback.md (exit 1, four problems in 03-29-evidence-exit.json)"
        status: fail
    human_judgment: true
    rationale: "Not achieved: the run stopped on two decisions with item A parked uncommitted. A fix plan and a repeat of all three runs are the owner's call (D-03)"

duration: 12 min of live run (23:48:47Z to 23:54:26Z), plus the preparation
completed: 2026-11-09
---

# Phase 3 Plan 29: Exit part 1, run 1 on the portfolio Summary

**The exit script's live modes work end to end against the owner's portfolio, but run 1 stopped on two pause decisions instead of one: item A, the independent item, asked item B's question and was parked uncommitted, which D-03 counts as an exit failure.**

## Performance

- **Started:** 2026-11-09T23:48:47Z (run 1 start); **run 1 stopped:** 2026-11-09T23:54:26Z
- **Tasks:** 1 of 3 executed (Task 1; Task 2 is the owner's checkpoint and was not reached, Task 3 depends on it in the plan's order)
- **Live spend in this plan:** 0.1430 USD (run 1). Phase 3 spend is now 8.1170 USD of 25 USD.

## What happened

`bash scripts/exit-run-phase3.sh --run test/benchmark/phase3/p3-run1-copy-fallback.md --authorization-file .../03-28-exit-authorization.json` ran the authorization (brief digest approved, host `2.1.319` pinned and admitted, preflight `conventions: ok` and `staleness: ok`, guard 7.9739 + 5.67 fits 25 USD), took the checkout snapshot, started the run with `--budget costUsdPerRun=5.67` and recorded the evidence.

Run `run_01M71BDV8MWGEG7XSAWH1GZ80W` ended `blocked_on_decision` (exit 3) with:

| Item | State | Attempts | Note |
| ---- | ----- | -------- | ---- |
| A (haiku) | blocked_on_decision | 1 | the unit did the work and verified it, then asked B's question; its delta is parked, nothing committed |
| B (sonnet) | blocked_on_decision | 1 | the unit asked before starting, as the brief says (correct) |
| C (haiku) | ready | 0 | undelegated (correct) |

| Decision | Items | Class | Origin | State |
| -------- | ----- | ----- | ------ | ----- |
| `dec_01M71BQWZ8FAH7WA93VARR9PR0` | A | acceptance | pause (numbered-choice) | open |
| `dec_01M71BR2T1RTDA0QTAAQB1BW7J` | B, C | acceptance | pause (numbered-choice) | open |

Both decisions carry the two wordings the brief names (`1. Couldn't copy. Email me at <address>.` and `2. Couldn't copy the address. Opening your mail app to <address>.`). Two notification rows (both delivered). Cost 0.1430 USD (A 0.0733, B 0.0697). Portfolio checkout digest equal before and after, no new refs.

## Diagnosis (D-03)

Item A's unit finished item A (planner, checker, executor and verifier ran; dates tests 4/4, full suite 410/410, typecheck, lint and prettier clean) and then ended its final message with the owner-choice question of item B and the two numbered wordings. `detectPause` reads that shape (a question line followed by `1.` and `2.` lines) as `numbered-choice`, so item A was classified `paused`, its delta was parked, and a decision opened on A. Item B's own unit then asked the same question before starting, and a second decision opened on B and C.

So the model did not pick silently and G1 did not catch anything: both decisions are pause-origin. What failed is the shape of the stop. The expected run has one decision, on B only, and A committed with evidence. The likely cause is that an item's unit sees the whole brief, including the other items' open choices, and reports them as its own question. This is for a fix plan to settle; the options include giving each unit only its own item's text, and not classifying a numbered choice as a pause when the unit's own work is done and verified. Neither was attempted here.

The four problems the evidence tool recorded: two decisions where D-02 wants one; item B blocked where only the owner-choice item was expected to be; item C not delegated, which is itself correct (the tool flagged it because the second decision's affected set made B and C both the "planted" items); two notification rows where one was expected.

## Deviations from Plan

### Auto-fixed Issues

None. The plan's action also asks the script to read `status --json`; `--finish` and the start stage read the same ledger read model (`getRunStatuses`, the source of `status --json`) in process instead, with a read-only profile.

### Additions beyond the plan's file list

- `scripts/exit-run-phase2-tools.ts`: `compositeOf` is exported so the Phase 3 evidence tool compares the same checkout composite as Phase 2.
- `test/unit/exit-evidence.test.ts`: tests for the judging helpers (origin, start stop, finish resume, spend guard, transcript readers). 12 tests pass.

## Issues Encountered

- The run stopped as described above; the plan stops here (D-03: "anything else stops the plan with a diagnosis"). The run is left `blocked_on_decision` in the owner's profile with two open decisions and a parked item A in its clone. Nobody answered either decision. The owner may cancel it with `avarice cancel`; the run branch was never fetched, so the portfolio has no `avarice/run_*` ref for it.
- The installed `avarice` alias points at the main checkout, whose CLI has no `decide`. The command printed for the owner therefore uses this checkout's `bin/avarice` and the pinned `AVARICE_CLAUDE_BIN`.

## Known Stubs

None.

## Threat Flags

None. T-03-55 held (checkout digest equal, no refs added or changed, nothing written to the portfolio). T-03-56 held: the guard ran before the start (exit 75 verified with a lowered ceiling), and the run's cap was 5.67 USD.

## User Setup Required

None.

## Next Phase Readiness

Blocked. Plan 03-30 depends on run 2 being started by Task 3 of this plan, and the exit bar is 3 of 3 runs from one `avarice start` each. A fix plan is needed for the unit scope or pause classification, after which all three runs repeat (the authorization's 17.0 USD headroom less 0.1430 spent leaves 16.88 USD; three runs at 5.67 USD need 17.01 USD, so the owner must decide the cap or a ceiling question before a repeat, D-05). The evidence file refuses a second start of the same brief digest, so a repeat needs a new evidence file or an owner-approved reset.

## Self-Check: PASSED

Files exist: `scripts/exit-run-phase3.sh`, `scripts/exit-run-phase3-tools.ts`, `test/unit/exit-evidence.test.ts`, `03-29-evidence-exit.json`. Commits `e474bfa` and `40213ca` are ancestors of HEAD. Typecheck clean; `node --test test/unit/exit-evidence.test.ts test/unit/exit-drafts.test.ts` passes (48 tests).

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09 (halted at Task 1)*
