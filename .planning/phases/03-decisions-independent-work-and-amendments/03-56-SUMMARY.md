---
phase: 03-decisions-independent-work-and-amendments
plan: 56
subsystem: exit-authorization
tags: [exit, authorization, d-04, d-26, d-28, d-31, d-33, d-34, readiness, no-spend]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-55 redrafted run 1, the 148-finding classification, the dry run and the seeded evidence file
  - phase: 03-decisions-independent-work-and-amendments
    provides: plan 03-52 write-authorization, field and brief-gate
provides:
  - "03-56-readiness.json: the no-spend readiness facts of the replanned exit"
  - "03-56-exit-authorization.json: the fresh authorization, selection approve, exitRules D-26..D-35, order run2, run3, run1, 4.5 USD per run, 25 USD ceiling"
affects: [03-57, 03-58, 03-59, 03-60]

actuals:
  tokens: 12000
  tasks: 3
  commits: 2
plan_head_before: f0e4d3d6d22855caa2ef02e84b4b5dbcb69d032c
plan_head_after: 3f8ea09082c422f06cea670815a5902ada2a1fa9

tech-stack:
  added: []
  patterns:
    - "The authorization is written only by write-authorization after the owner's reply; the reply is quoted in decisionRef"

key-files:
  created:
    - .planning/phases/03-decisions-independent-work-and-amendments/03-56-readiness.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-56-exit-authorization.json
  modified: []

key-decisions:
  - "Old run 1 (run_01M73RX3RF0ZJETYWVF52WFZ5B) was already cancelled when read, so Task 2 asked nothing and Claude ran no cancel"
  - "The owner replied approve to the D-04 checkpoint, so the authorization was written with the locked terms: order 2, 3, 1, 4.50 USD per run, 25 USD ceiling"

requirements-completed: [AUT-5, AUT-12]

duration: resumed in two sessions
completed: 2026-11-11
status: complete
---

# Phase 3 Plan 56: Replanned exit authorization Summary

The owner approved the three gated briefs and the 148-finding classification, and `write-authorization` wrote the fresh authorization that alone can start the replanned exit. This plan spent nothing and launched no model host.

## Readiness facts (Task 1, commit 7ccdc81)

`03-56-readiness.json` records, with `spentUsd` 0 and `modelHostLaunched` false:

- Old run 1 `run_01M73RX3RF0ZJETYWVF52WFZ5B` is `cancelled` (read-only `avarice status --json`, last checkpoint seq 41, nextAction park, 2026-11-11T01:05:39Z).
- `brief-gate` exits 0: 148 findings classified in 3 briefs, repository unchanged.
- Host version 2.1.319 (Claude Code).
- `field` refuses the 03-49 authorization, selection "answer-2-in-place" (D-28).
- Phase 3 spend is 11.2986 USD. Three runs at 4.50 USD give a worst case of 24.7986 USD, which fits the 25 USD ceiling (D-05).
- Digests are current: run2 f0c9395b..., run3 fe8742f4..., run1 2183c317.... Order is run2, run3, run1, with every attempt count at 0 (D-29).

## Old run 1 (Task 2)

Skipped by its own precondition: `status --json` already showed the run as cancelled. Claude ran no cancel, and the status does not say who cancelled it. Recorded as "already terminal: cancelled" (D-34). Nothing was asked of the owner.

## Owner's D-04 ruling (Task 3)

The owner saw the full checkpoint (run 1's redrafted item C and AC4, the item-B consistency edit, the surface assessment, the 148/148 kept classification table, the gate and dry-run results, the locked terms, the D-35 interpretation advisory, and that old run 1 is already cancelled). The reply, verbatim:

> approve

Recorded at (owner-confirmed-at): 2026-11-11T07:35:45Z.

## Authorization (Task 3, commit 3f8ea09)

`write-authorization` wrote `03-56-exit-authorization.json`: 3 briefs, order run2 (amend-stale), run3 (silence), run1 (block-resume), cap 4.5 USD per run, ceiling 25 USD, gate passed on 148 findings. Host binary `/Users/aphan/.local/share/claude/versions/2.1.319`, version 2.1.319. `decisionRef` quotes the owner's reply `approve` and names D-04 and D-26 to D-35.

Verification:

- `field --pick perRunCapUsd` prints `4.5`.
- `brief-gate` prints `brief-gate: pass: 148 finding(s) classified in 3 brief(s); repository unchanged`.
- `order` is run2, run3, run1.
- `briefCheck.sha256` is `255ca0a0018697da2a922e074af274cfcadfaefe9598c65fa9344c4a742be1cd`, equal to the sha256 of `03-55-brief-classification.json`.
- The brief digests in the authorization match those in the readiness file.

## Deviations from Plan

None - plan executed exactly as written. One observation, not a deviation: the written authorization carries `"plan": "03-29"`, a value `write-authorization` supplies itself. The plan did not pass it and it does not affect the gate or the cap. It is worth a look if later plans read that field.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- `03-56-readiness.json` found.
- `03-56-exit-authorization.json` found.
- Commits 7ccdc81 and 3f8ea09 are in the branch history.
