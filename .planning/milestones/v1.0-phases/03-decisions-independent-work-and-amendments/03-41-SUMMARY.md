---
phase: 03-decisions-independent-work-and-amendments
plan: 41
subsystem: exit-tools
status: complete
tags: [gap-closure, exit-run, supersede-guard, authorization, no-spend, aut-3, aut-5, tdd]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-40's item prompt scope and pause attribution fix; plan 03-29's halted exit evidence; plan 03-28's exit tools and authorization"
provides:
  - "exit tools that label spend and evidence by AVARICE_PHASE3_PLAN (default 03-42), name the authorization file they were given as the pin's source, and keep every extra top-level key of an evidence file"
  - "an authorize guard that refuses a start (exit 2, nothing started) while the run an evidence file supersedes is not failed, cancelled or closed in the owner's ledger"
  - "a per-item prompt-scope count in the dry run (promptScope, 0 for every item of every brief)"
  - "03-41-exit-authorization.json: the owner's approval at 5.62 USD per run, ceiling 25, the three unchanged brief digests, the 2.1.319 pin, with ownerConfirmedAt set"
  - "03-42-evidence-exit.json: the repeated exit's empty evidence file with a supersedes block naming the halted 03-29 file and the cancelled run 1"
affects: [03-42, 03-30]

actuals:
  tokens: 11000
  tasks: 2
  commits: 4
plan_head_before: 7a082d4ba1e942b92eeba1ab714e1e0ecb6d74ba
plan_head_after: b1cf924f5be9e65696b21bb29ceabe46b8c70928
commits: 4

tech-stack:
  added: []
  patterns:
    - "A re-run of a stopped exit writes a new evidence file whose supersedes block names the halted file, the run and the reason, and the start tool reads the superseded run's state from the owner's ledger read-only"
    - "The owner's confirmation is recorded in the authorization file with the reply text and the read-only ledger check made at that time"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-41-exit-authorization.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-41-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-41-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-42-evidence-exit.json
  modified:
    - scripts/exit-run-phase3-tools.ts
    - scripts/exit-run-phase3.sh
    - test/unit/exit-evidence.test.ts

key-decisions:
  - "The per-run cap is 5.62 USD (the owner's decision, STATE.md a7d7f0b): three runs cap 16.86 of the 16.883 USD headroom, so nothing else may spend in Phase 3 before the exit's three runs"
  - "The brief digests are unchanged from 03-28's authorization, so the old approval carries over by digest; the new authorization says so and the owner confirmed it"
  - "The halted 03-29 evidence file is never written again; the repeat starts a new file on a recorded reason (D-03 is not bypassed silently)"
  - "No requirement is marked complete: requirements.ready-ids reported 0 of 2 ready (AUT-3 and AUT-5 are declared by sibling plans without a SUMMARY yet)"

requirements-completed: []

coverage:
  - id: D1
    description: "The exit tools label spend and evidence by AVARICE_PHASE3_PLAN, name the authorization file given as the pin's source, keep extra top-level evidence keys, and refuse a start while a superseded run is not terminal"
    requirement: "AUT-3"
    verification:
      - kind: unit
        ref: "test/unit/exit-evidence.test.ts (60 cases in this file and exit-drafts.test.ts, all pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A no-spend dry run with the fixed code compiles the three approved briefs against the portfolio pin (conventions ok, staleness ok), shows promptScope 0 for every item, reports 5.62 USD fits three runs, and leaves the portfolio unchanged"
    requirement: "AUT-5"
    verification:
      - kind: other
        ref: "env EXIT_DRY_RUN_OUT=<abs>/03-41-dry-run.json scripts/exit-run-phase3.sh --dry-run (0 problems, 2 warnings)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The owner's authorization at 5.62 USD with the same brief digests and the 2.1.319 pin, confirmed by the owner, and the seeded empty evidence file naming the cancelled run 1"
    requirement: "AUT-5"
    verification:
      - kind: other
        ref: "Task 2 node -e verify (exit 0); authorize on the pinned 2.1.319 binary prints 'authorized ... run 1 of 3' and starts nothing"
        status: pass
    human_judgment: true
    rationale: "The owner's own confirmation and cancel are the evidence; automation only checks that the record matches the ledger"

duration: 2h (across the dry-run session and the owner checkpoint)
completed: 2026-11-10
---

# Phase 3 Plan 41: Prepare the repeated exit Summary

**Exit tools that record a supersede and refuse a start while the cancelled run is open, a no-spend dry run proving no item prompt carries another item's choice, and the owner's confirmed 5.62 USD authorization with run 1 cancelled and the repeat's evidence file seeded**

## Performance

- **Duration:** about 2h wall clock including the owner's wait at Task 2
- **Completed:** 2026-11-10T01:45Z (owner confirmation recorded)
- **Tasks:** 2 (Task 1 auto with TDD, Task 2 blocking-human checkpoint)
- **Files modified:** 7 (3 modified, 4 created, counting the three plan JSON records and the seeded evidence file)
- **Spend:** 0 USD; Phase 3 stands at 8.1170 of 25 USD

## Accomplishments

- The exit tools label the spend line and the evidence file by `AVARICE_PHASE3_PLAN`, name the authorization file given as the pin's source, and keep a `supersedes` block when they rewrite an evidence file.
- `authorize` reads the superseded run's state from the owner's ledger (read-only read model) and exits 2 with nothing started while it is not failed, cancelled or closed. On the pinned 2.1.319 binary and the seeded file it now passes and prints `authorized: ... run 1 of 3` (a version probe only, no model run).
- The dry run records `promptScope` per item and shows 0 for every item of every brief. Conventions ok, staleness ok, 0 problems, 2 warnings; the largest per-run cap that fits is 5.62 USD.
- The owner replied "cancelled; authorization approved" (2026-11-09). Read-only reads of the owner's ledger showed run_01M71BDV8MWGEG7XSAWH1GZ80W `cancelled` (updatedAt 2026-11-10T01:44:08.992Z) with dec_01M71BQWZ8FAH7WA93VARR9PR0 and dec_01M71BR2T1RTDA0QTAAQB1BW7J `withdrawn`, none open.
- The portfolio checkout is unchanged through the dry run and after the cancel: composite sha256:36b38e4807e83638677632b41d5e2593cb07a47cdc2332fb66ca042e1a8a7b67, HEAD 9f63d91, 6 refs, 1 status entry, identical to the dry run.
- `ownerConfirmedAt` is set in 03-41-exit-authorization.json with the reply text; 03-42-evidence-exit.json exists with `runs: []` and the supersedes block (file 03-29-evidence-exit.json, the run, state cancelled, stateAt from the ledger, the reason).

## Task Commits

1. **Task 1 (RED): failing cases for plan label, supersede guard, kept keys and per-item prompt scope** - `a6e4682` (test)
2. **Task 1 (GREEN): exit tools record a supersede, guard the cancelled run and check each item's prompt scope** - `71e92c3` (feat)
3. **Task 1 (records): no-spend dry run and the 5.62 USD exit authorization, owner confirmation pending** - `c436313` (docs)
4. **Task 2: owner confirmation recorded, run 1 cancelled, repeat evidence file seeded** - `b1cf924` (docs)

**Plan metadata:** the docs(03-41) commit that adds this SUMMARY, STATE.md and ROADMAP.md (follows this file; not counted in `commits:` above, which is measured to the Task 2 commit).

## Files Created/Modified

- `scripts/exit-run-phase3-tools.ts` - plan label from AVARICE_PHASE3_PLAN, pinnedBy from the authorization file given, `evidenceFileBody` keeping extra keys, `supersededRunRefusal` and `runStateOf`, `promptScopeOf` in the dry run
- `scripts/exit-run-phase3.sh` - default evidence file 03-42-evidence-exit.json, default plan 03-42, header describing the repeated exit
- `test/unit/exit-evidence.test.ts` - cases for each of the above, including the supersede guard against a real read-only ledger
- `.planning/phases/03-decisions-independent-work-and-amendments/03-41-exit-authorization.json` - the owner's approval at 5.62 USD, confirmed
- `.planning/phases/03-decisions-independent-work-and-amendments/03-41-dry-run.json` - the no-spend dry run record
- `.planning/phases/03-decisions-independent-work-and-amendments/03-41-red-evidence-task1.json` - the RED run of Task 1
- `.planning/phases/03-decisions-independent-work-and-amendments/03-42-evidence-exit.json` - the repeated exit's empty evidence file with its supersedes block

## Decisions Made

See key-decisions above. The 5.62 USD cap and the host pin are the owner's decisions, recorded, not made here. Claude ran neither the cancel nor any other owner command and answered, cancelled or resumed no portfolio run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] live_setup exported a hardcoded plan label**
- **Found during:** Task 1
- **Issue:** `scripts/exit-run-phase3.sh` `live_setup` exported `AVARICE_PHASE3_PLAN=03-29`, which would have labelled the repeat's spend and evidence as plan 03-29 despite the tool change.
- **Fix:** it now exports `${AVARICE_PHASE3_PLAN:-03-42}`.
- **Files modified:** scripts/exit-run-phase3.sh
- **Committed in:** 71e92c3

**2. [Rule 1 - Bug] The dry-run record's plan was fixed**
- **Found during:** Task 1
- **Issue:** the dry-run record carried a constant plan label, so a record written to 03-41-dry-run.json would have said 03-28.
- **Fix:** the plan comes from the output filename prefix.
- **Files modified:** scripts/exit-run-phase3-tools.ts
- **Committed in:** 71e92c3

**3. [Rule 3 - Blocking] RED evidence file added**
- **Found during:** Task 1
- **Issue:** the RED run was a whole-file link failure (the new exports did not exist), so the plan's per-case RED evidence could not be captured case by case.
- **Fix:** 03-41-red-evidence-task1.json records the failing run with a semantic assessment that the failure is the missing deliverable, not an environment error.
- **Files modified:** .planning/phases/03-decisions-independent-work-and-amendments/03-41-red-evidence-task1.json
- **Committed in:** a6e4682

### Harness limits (not code deviations)

- `root-pin.sh` was refused by the harness during Task 1, so the root was compared by hand (`git rev-parse --show-toplevel` against the worktree's); from Task 2 on the script ran clean.
- The dry run was run as `env EXIT_DRY_RUN_OUT=<abs path> scripts/exit-run-phase3.sh --dry-run` because the harness refuses a bare leading assignment.
- The per-plan commit ledger file (`gsd-plan-head-before-03-41` in the worktree git dir) could not be written from this session (the harness refuses writes under the shared `.git` path), so `plan_head_before` is the value the orchestrator gave (7a082d4) and `commits: 4` is measured by `git rev-list --count 7a082d4..HEAD` at b1cf924.
- No `docs/system/` change: no document there covers the exit scripts (they are plan tooling, not built product behavior), and `docs/system/` exists in this checkout, so no new document was warranted.

---

**Total deviations:** 3 auto-fixed (2 bug, 1 blocking), plus harness limits
**Impact on plan:** none on scope or spend; each fix was needed for the repeat to record under the right plan.

## Issues Encountered

- The first Task 2 attempt stopped at the blocking-human checkpoint as designed; the owner cancelled run 1 and approved the authorization, and this continuation verified both.
- Read-only ledger access used a throwaway script in /tmp (`createDeps` with `readOnly: true`), not a repo file and not an owner command.

## Known Stubs

None.

## Threat Flags

None. The new surfaces are a read-only ledger read in `authorize` and two JSON records, all inside the plan's threat model (T-03-90 to T-03-92): the confirmation was set only after the owner's reply, the halted evidence file is untouched, and the portfolio digest was compared before and after the dry run and after the cancel.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 03-42 can start run 1 of the repeated exit: the authorization is confirmed, the evidence file is seeded, `authorize` passes on the pinned host, and 16.883 USD of headroom covers three runs at 5.62 USD (16.86).
- Nothing else may spend in Phase 3 before the exit's three runs.
- AUT-3 and AUT-5 stay open until their sibling plans have summaries.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-10*

## Self-Check: PASSED

Files found: 03-41-exit-authorization.json, 03-41-dry-run.json, 03-41-red-evidence-task1.json, 03-42-evidence-exit.json, scripts/exit-run-phase3-tools.ts, scripts/exit-run-phase3.sh, test/unit/exit-evidence.test.ts. Commits a6e4682, 71e92c3, c436313 and b1cf924 are ancestors of HEAD. 03-28-exit-authorization.json, 03-29-evidence-exit.json and the three brief files are unchanged. Unit cases 60 of 60 pass; `npm run typecheck` exits 0.
