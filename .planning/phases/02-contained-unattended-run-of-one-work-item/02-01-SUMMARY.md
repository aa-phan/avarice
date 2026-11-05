---
phase: 02-contained-unattended-run-of-one-work-item
plan: 01
subsystem: testing
tags: [claude-code, containment, live-t3, spend-ledger, host-admission]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: the live T3 containment suite, the harness-only admission override, ADMITTED_CLAUDE_VERSIONS and the 25-case record style in LIVE-CASES.md
provides:
  - One Phase 2 live-spend ledger and a 25 USD ceiling guard that every live case consults before a host start (D-15)
  - Claude Code 2.1.318 admitted for contained launches on recorded evidence (22 live cases, 0 containment failures)
  - The Phase 2 spend table in LIVE-CASES.md with its first row (0.2122 USD of 25)
affects: [02-09, 02-20, 02-21, every plan that starts a live host]

actuals:
  tokens: 14400
  tasks: 2
  commits: 3
plan_head_before: 3b1aa1fbca9b009dd88aa3256470737029b1a486
plan_head_after: f3468682f3ce41398e33a28ee6bbf8efbd8112d8
commits: 3

tech-stack:
  added: []
  patterns:
    - "Spend guard in the harness: fitsCap also requires fitsPhase2Ceiling; spendRefusal builds the skip text; recordSpend also appends to the Phase 2 ledger"
    - "A corrupt spend ledger throws with the line number and never reads as 0"
    - "A host version is admitted only after a recorded live run on that exact version with 0 containment failures"

key-files:
  created:
    - test/unit/live-spend-ceiling.test.ts
    - test/containment/live-spend-phase2.jsonl
    - test/containment/live-run-phase2-admission.jsonl
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-01-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/deferred-items.md
  modified:
    - test/helpers/live-harness.ts
    - src/adapters/host-claude/launch-preflight.ts
    - test/containment/LIVE-CASES.md
    - test/containment/failclosed.test.ts
    - test/unit/live-admission-override.test.ts
    - docs/containment.md
    - docs/extensions.md
    - docs/implementation-plan.md

key-decisions:
  - "Phase 2 live spend is one ledger (test/containment/live-spend-phase2.jsonl) with a 25 USD ceiling that AVARICE_PHASE2_CEILING_USD can only lower; plans name themselves in AVARICE_PHASE2_PLAN"
  - "Claude Code 2.1.318 is admitted on the 2026-11-05 live run (22 of 22 tests pass, 0 containment failures, 0.1596 USD)"
  - "The case 19 knowledge-pass denial on 2.1.318 is a path-form refusal by the host (safe direction), not a containment failure; it is deferred and Phase 2 run purposes must hand the model symlink-resolved paths"

requirements-completed: [CON-1, CON-3]

coverage:
  - id: D1
    description: "Phase 2 spend ledger and 25 USD ceiling guard in the live harness (lower-only env override, corrupt ledger throws, fitsCap also requires the phase ceiling)"
    requirement: "CON-1"
    verification:
      - kind: unit
        ref: "test/unit/live-spend-ceiling.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Claude Code 2.1.318 passes the live T3 containment suite with 0 containment failures and is admitted; an unrecorded version stays refused"
    requirement: "CON-3"
    verification:
      - kind: integration
        ref: "AVARICE_LIVE=1 node --test test/containment/live-onboarding.test.ts (22 pass, recorded in test/containment/live-run-phase2-admission.jsonl)"
        status: pass
      - kind: unit
        ref: "test/unit/live-admission-override.test.ts and test/containment/failclosed.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase 2 spend table in LIVE-CASES.md equals the ledger sum and the last-run column of every case holds this run's verdict"
    verification: []
    human_judgment: true
    rationale: "Documentation accuracy; the ledger sum is checked by command in this summary, the prose is read by the owner"

duration: 55min
completed: 2026-11-05
status: complete
---

# Phase 2 Plan 01: Phase 2 spend ledger and admission of Claude Code 2.1.318 Summary

**A single 25 USD Phase 2 live-spend ledger enforced by the live harness before every host start, and Claude Code 2.1.318 admitted after 22 live containment tests passed with 0 containment failures for 0.16 USD.**

## Performance

- **Duration:** about 55 min (start time was not captured at the first command; estimated from the run logs, two live runs of 9 and 4 minutes)
- **Completed:** 2026-11-05T10:25Z
- **Tasks:** 2 (Task 1 tracer, Task 2 auto)
- **Files modified:** 13 (12 outside `.planning` counting the two new record files)

## Accomplishments

- `PHASE2_CEILING_USD = 25`, `phase2Ceiling()`, `phase2Spent()`, `fitsPhase2Ceiling()`, `recordPhase2Spend()` and `spendRefusal()` in `test/helpers/live-harness.ts`. `fitsCap` now also requires the phase ceiling; `recordSpend` also appends one line per started host run to `test/containment/live-spend-phase2.jsonl` under `AVARICE_PHASE2_PLAN`. The skip text reads `not run: Phase 2 spend <x> plus this case's cap <y> would pass the <z> USD ceiling (D-15); ask the owner`.
- A 10-test offline suite (`test/unit/live-spend-ceiling.test.ts`) proves: missing ledger is 0 and a case under the ceiling runs; a malformed or cost-less line throws naming its line number; 24.60 plus 0.40 fits and 24.61 does not; the env override only lowers the ceiling; the ledger only appends. Red evidence: `02-01-red-evidence-task1.json` (all tests failed on assertions against stub exports).
- Tracer proven end to end: the live admission run of the installed host (`claude` 2.1.318, harness-only override) went through the new guard and ledger. 22 of 22 live tests passed, 0 containment failures, each host `system/init` reported 2.1.318. Cost 0.1596 USD for the full pass plus 0.0526 USD for one diagnostic re-run of case 19: 0.2122 USD.
- `ADMITTED_CLAUDE_VERSIONS` gained `2.1.318`, with the date, record file and cost in the comment above it. `test/unit/live-admission-override.test.ts` now uses `2.1.999` as its unadmitted version, and `failclosed.test.ts` pins the four-entry list.
- `LIVE-CASES.md`: a "Phase 2 spend (D-15)" section (ceiling, ledger, guard, env vars, first table row) and a 2.1.318 run section; the last-run column of all 20 table cases carries this run's verdict and cost. Ledger sum 0.2122 equals the stated cumulative (0.21 to two decimals). Remaining under the ceiling: 24.7878 USD.
- `docs/containment.md`, `docs/extensions.md` and `docs/implementation-plan.md` list 2.1.318 as admitted.

## Task Commits

1. **Task 1 (tracer) offline proof:** `48f8f20` feat(02-01): add Phase 2 live-spend ledger and 25 USD ceiling guard (D-15)
2. **Task 1 live admission run:** `d202567` test(02-01): record live containment admission run of Claude Code 2.1.318
3. **Task 2:** `f346868` feat(02-01): admit Claude Code 2.1.318 on 22 live cases with 0 containment failures

## Verification

| Check | Result |
|---|---|
| `node --test test/unit/live-spend-ceiling.test.ts test/unit/live-admission-override.test.ts` | pass (14 tests incl. the 10 new ones) |
| Live: `AVARICE_LIVE=1 ... node --test test/containment/live-onboarding.test.ts` | 22 pass, 0 fail; every verdict `pass` in the record file |
| `node --test test/unit/launch-args.test.ts test/unit/live-admission-override.test.ts test/integration/claude-host.test.ts test/containment/failclosed.test.ts test/unit/live-spend-ceiling.test.ts` | 96 pass |
| `node --test "test/unit/**/*.test.ts"` | 740 pass, 0 fail |
| `npx tsc -p .` | clean |
| `node scripts/check-boundaries.ts` | `ok (54 file(s))` |
| `grep -n "PHASE2_CEILING_USD = 25" test/helpers/live-harness.ts` | present |
| Ledger sum (`costUsd` over 20 lines) vs LIVE-CASES.md | 0.2122 both |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tests pinning the admitted list and an unadmitted version**
- **Found during:** Task 2
- **Issue:** `test/containment/failclosed.test.ts` pins the exact admitted list, and `test/unit/live-admission-override.test.ts` used 2.1.318 as its example of an unadmitted version, so admitting 2.1.318 would break it.
- **Fix:** list updated to four entries; the override test now uses 2.1.999.
- **Files modified:** test/containment/failclosed.test.ts, test/unit/live-admission-override.test.ts
- **Commit:** f346868

**2. [Rule 2 - Missing critical] Documentation of the admitted list**
- **Found during:** Task 2
- **Issue:** three docs name the admitted versions and would contradict `ADMITTED_CLAUDE_VERSIONS`.
- **Fix:** docs/containment.md, docs/extensions.md, docs/implementation-plan.md list 2.1.318.
- **Commit:** f346868

**3. [Plan scope] One extra live run**
- The plan authorizes one admission run. After case 19 showed a knowledge-invocation denial, one re-run of case 19 alone (0.0526 USD, `AVARICE_LIVE_KEEP=1`) was made to find the cause. It is recorded as the 23rd line of the results file and the 20th ledger line, inside the 25 USD ceiling.

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical) and 1 extra diagnostic run. **Impact:** none on scope; all additions are small and in files the plan already touched or documents that name the same list.

## Issues Encountered

- **Case 19 on 2.1.318 (not a containment failure):** the knowledge invocation ended `denied` in both runs and the project reached `active` with 0 document nodes (on 2.1.317: 8). The AVARICE hook allowed every call. The host's own `permission_denied` event (`decision_reason_type: mode`) refused the model's `Write` of `.avarice-knowledge/.extraction/chunk-01.json` because the model wrote the `/var/folders/...` path form and the generated allow rule names `/private/var/...`. This is the host's known safe-direction path-form behaviour. The test passes because it judges containment and the `denied` ending is a recorded index absence, which never blocks activation. Recorded in `deferred-items.md` and LIVE-CASES.md; Phase 2 run purposes must hand the model symlink-resolved paths.
- The GSD tooling refuses compound Bash commands in this isolated worktree session; commands were split into single calls. No effect on results.

## Next Phase Readiness

Contained launches on this machine are no longer refused with `host-version-not-admitted:2.1.318`. Every later live plan (02-09, 02-20, 02-21) must set `AVARICE_PHASE2_PLAN`, read the table in LIVE-CASES.md and stop for the owner if a case could pass 25 USD. 24.7878 USD remains.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or file access surface; the threat register items T-02-01 (admission only on a recorded 0-failure run) and T-02-02 (ceiling checked before each host start) are mitigated as planned.

## Self-Check: PASSED

- Files found: test/unit/live-spend-ceiling.test.ts, test/containment/live-spend-phase2.jsonl, test/containment/live-run-phase2-admission.jsonl, 02-01-red-evidence-task1.json, deferred-items.md, test/helpers/live-harness.ts
- Commits found on HEAD: 48f8f20, d202567, f346868
