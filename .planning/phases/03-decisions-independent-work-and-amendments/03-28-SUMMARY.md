---
phase: 03-decisions-independent-work-and-amendments
plan: 28
subsystem: exit-benchmark
status: complete
tags: [exit-briefs, dry-run, owner-authorization, spend-cap, host-pin, portfolio, read-only]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "plan 03-27 to 03-39 live run-purpose cases, the Phase 3 spend ledger (7.9739 USD) and the pinned 2.1.319 host"
provides:
  - "three approved Phase 3 exit briefs (copy fallback, graduation label, theme toggle), each with one planted owner decision"
  - "scripts/exit-run-phase3.sh and scripts/exit-run-phase3-tools.ts: the no-spend dry run, the launch preflight and the evidence collector"
  - "03-28-dry-run.json: the portfolio-pin dry run record (exit 0, 0 problems, 2 warnings, 0 USD, portfolio unchanged)"
  - "03-28-exit-authorization.json: the owner's recorded approval, per-run cap 5.67 USD, ceiling 25 USD, spend so far 7.9739 USD, and the 2.1.319 host pin"
affects: [03-29, 03-30, phase-3-exit]

actuals:
  tokens: 14000
  tasks: 2
  commits: 3
plan_head_before: 132bc65e5d596cd2f3d5f3584e4f3fbfc067e8dd
plan_head_after: 6a7a25636b6a905dbeef853124a792e10c208eec

tech-stack:
  added: []
  patterns:
    - "Authorization file as the only key to live spend: the exit script refuses --run without --authorization-file"
    - "Brief digests are parseBrief's canonical digests, not file hashes"

key-files:
  created:
    - test/benchmark/phase3/p3-run1-copy-fallback.md
    - test/benchmark/phase3/p3-run2-graduation-label.md
    - test/benchmark/phase3/p3-run3-theme-toggle.md
    - scripts/exit-run-phase3.sh
    - scripts/exit-run-phase3-tools.ts
    - test/unit/exit-drafts.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-28-dry-run.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-28-exit-authorization.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-28-red-evidence-task1.json
  modified:
    - scripts/exit-run-phase2-tools.ts

key-decisions:
  - "Owner approved all three drafted briefs as written with a per-run cap of 5.67 USD (--budget costUsdPerRun=5.67, lower-only); the Phase 3 ceiling stays 25 USD"
  - "Exit runs are pinned to host 2.1.319: plans 03-29 and 03-30 run every avarice start with AVARICE_CLAUDE_BIN=/Users/aphan/.local/share/claude/versions/2.1.319, and every owner-terminal avarice decide and resume is given with the same variable; ADMITTED_CLAUDE_VERSIONS and the default binary stay unchanged"
  - "Item A stays small (haiku) in all three briefs; no brief change"

requirements-completed: []

coverage:
  - id: D1
    description: "Three exit briefs compile against the portfolio pin, each with a planted owner decision and an independent item; the exit-drafts test and the no-spend dry run pass"
    verification:
      - kind: unit
        ref: "test/unit/exit-drafts.test.ts"
        status: pass
      - kind: other
        ref: "scripts/exit-run-phase3.sh --dry-run (03-28-dry-run.json: exit 0, 0 problems, 0 USD, portfolio unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The owner's authorization of the three briefs, the 5.67 USD per-run cap, the 25 USD ceiling and the 2.1.319 host pin is recorded, with brief digests equal to the dry run's and spentUsdSoFar equal to the ledger total"
    verification:
      - kind: other
        ref: "Task 2 automated verify (node -e check of selection, cap, ceiling, three briefs) plus digest and spend comparison with 03-28-dry-run.json"
        status: pass
    human_judgment: false

duration: not recorded (continuation after the Task 2 checkpoint)
completed: 2026-11-09
---

# Phase 3 Plan 28: Exit briefs, dry run and owner authorization Summary

**Three owner-approved Phase 3 exit briefs, a no-spend dry run against the portfolio pin, and a recorded authorization for a 5.67 USD per-run cap under the 25 USD ceiling, with the exit runs pinned to host 2.1.319.**

## Performance

- **Tasks:** 2 (Task 1 TDD: RED then GREEN; Task 2 owner decision checkpoint, resolved by `approve`)
- **Files created or modified:** 10
- **Live spend in this plan:** 0 USD; the portfolio was read as git objects only and its checkout digests were unchanged

## Accomplishments

- Drafted three briefs, each with an independent item and one planted owner decision (`fallback-wording` and two others), compiled by `parseBrief` against the portfolio pin 9f1cd8d.
- Wrote `scripts/exit-run-phase3.sh` (`--dry-run`, `--run`, `--authorization-file`) and `scripts/exit-run-phase3-tools.ts` (`dry-run`, `preflight`, `evidence`); `--run` refuses to spend without an authorization file.
- Dry run: exit 0, 0 problems, 2 warnings (three 10.00 USD caps do not fit the headroom; run 3 creates `tests/unit/theme-toggle.test.tsx`). Phase 3 spend 7.9739 of 25 USD, headroom 17.0261 USD, the largest per-run cap that fits three runs is 5.67 USD.
- Recorded the owner's decisions in `03-28-exit-authorization.json`.

## Task Commits

1. **Task 1 (RED): failing cases for the briefs and the dry-run record** - `23bb459` (test)
2. **Task 1 (GREEN): three briefs, dry-run script and tools, dry-run record** - `8d236e1` (feat)
3. **Task 2: owner authorization, cap and host pin** - `6a7a256` (docs)

**Plan metadata:** the commit that adds this summary and the STATE.md and ROADMAP.md updates.

## Owner Decisions (Task 2 checkpoint, 2026-11-09)

1. **approve** all three drafted briefs as written, with a per-run cap of 5.67 USD (`--budget costUsdPerRun=5.67`, lower-only). The ceiling stays 25 USD. Digests recorded:
   - `test/benchmark/phase3/p3-run1-copy-fallback.md`: `sha256:1a30e04c02129a985c65e413d87931135eafb4a4977fbb90ee201e7cc38915b0`
   - `test/benchmark/phase3/p3-run2-graduation-label.md`: `sha256:f0c9395bc0fddda5ef7e3b7c0844c5f0ae38444a9b8a27a4f4f716694abc7823`
   - `test/benchmark/phase3/p3-run3-theme-toggle.md`: `sha256:4019f32906cc1ad90571389b14cd2bee47d71b1e6853d78d36f1411ebc78631b`
2. **Host pin 2.1.319.** Plans 03-29 and 03-30 must run every `avarice start` with `AVARICE_CLAUDE_BIN=/Users/aphan/.local/share/claude/versions/2.1.319` (the exit script's pick-claude step already selects it; the authorization records the pin so 03-29 makes it explicit). Every owner-terminal `avarice decide` and `resume` must be given with that same `AVARICE_CLAUDE_BIN`, and plans 03-29 and 03-30 print the exact command for the owner. `ADMITTED_CLAUDE_VERSIONS` and the default binary are unchanged.
3. **Item A stays small (haiku)** in all three briefs; no brief change.

The pin and the owner-terminal requirement are recorded in the `host` object of the authorization file. The plan's verify reads only `selection`, `perRunCapUsd`, `ceilingUsd` and `briefs`, so the extra fields are tolerated.

## Files Created/Modified

- `test/benchmark/phase3/p3-run1-copy-fallback.md`, `p3-run2-graduation-label.md`, `p3-run3-theme-toggle.md`: the three exit briefs
- `scripts/exit-run-phase3.sh`, `scripts/exit-run-phase3-tools.ts`: dry run, preflight, evidence collection and the spend gate
- `scripts/exit-run-phase2-tools.ts`: small shared-helper change needed by the Phase 3 tools
- `test/unit/exit-drafts.test.ts`: checks on the three drafts
- `03-28-dry-run.json`, `03-28-exit-authorization.json`, `03-28-red-evidence-task1.json`: dry-run record, authorization, RED evidence

## Decisions Made

See key-decisions above; all three came from the owner at the Task 2 checkpoint. Nothing was decided by the executor.

## Deviations from Plan

None - plan executed exactly as written. The authorization carries two fields beyond the plan's list (`host` and `itemA`), which the owner's decisions required and the verify tolerates.

## Issues Encountered

- Brief digests in the authorization are parseBrief's canonical digests (as in `03-28-dry-run.json`), not `sha256sum` of the files; the two differ by design, and the acceptance criterion names parseBrief's digests.
- `requirements.ready-ids` reported 0 of 3 requirements (AUT-3, AUT-5, RC-6) ready, because sibling plans in the phase that declare them have no SUMMARY yet; none was marked complete.

## Known Stubs

None.

## Threat Flags

None. T-03-53 (portfolio writes) held: the dry run read git objects only and the checkout digests were equal before and after. T-03-54 (spend without approval) is mitigated by the recorded authorization that `--run` requires.

## User Setup Required

None. Before plan 03-29 starts live runs, the owner terminal needs `AVARICE_CLAUDE_BIN=/Users/aphan/.local/share/claude/versions/2.1.319` for any `avarice decide` or `resume`; plans 03-29 and 03-30 print the exact command.

## Next Phase Readiness

Plan 03-29 can start run 1 under this authorization. Open: the installed default claude binary is 2.1.321, which is not admitted, hence the pin. A run that needs more than 5.67 USD ends `budget_exhausted`, which fails the D-03 bar.

## Self-Check: PASSED

Created files exist on disk (briefs, scripts, test, dry-run, authorization, red evidence); commits `23bb459`, `8d236e1` and `6a7a256` are ancestors of HEAD; Task 2 verify passes.

---
*Phase: 03-decisions-independent-work-and-amendments*
*Completed: 2026-11-09*
