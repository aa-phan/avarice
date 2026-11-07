Counts re-derived at HEAD 0632fd4, 2026-11-06, command: `node --input-type=module -e` importing the module and printing `.length`.

Documented counts:
- Evidence statuses: 6 of 6 (`EVIDENCE_STATUSES.length`, `src/domain/evidence.ts`).
- G2 rules: 8 of 8 (`G2_RULES.length`, `src/domain/gates.ts`).
- G4 rules: 7 of 7 (`G4_RULES.length`, `src/domain/gates.ts`).
- Skip and focus markers: 12 of 12 (`SKIP_FOCUS_MARKERS.length`, `src/domain/test-inventory.ts`).
- Validation verdicts: 3 of 3 (`CHECK_VERDICTS.length`, `src/app/check-validation.ts`).
- Delta outcomes: 4 blocking reasons plus pre-existing, from the `DeltaReason` type in `src/domain/evidence.ts`.

Code files (all new since the diff base e725db6; `git diff --stat` shows insertions only):
- `src/adapters/exec/allowlist-proxy.ts`: covered (stated as install-step consequences; internals seamed to containment).
- `src/adapters/git/run-workspace.ts`: covered in part (revision, status, snapshot, diff, read behavior; clone, discard, commit, fetch belong to runs).
- `src/app/check-validation.ts`: covered.
- `src/app/checks.ts`: covered.
- `src/app/run-stages/finish.ts`: covered.
- `src/app/run-stages/item.ts`: covered in part (G2 staging, commit-set entry; launch, classification and discard belong to runs).
- `src/app/run-stages/prepare.ts`: covered (install, validate, baseline and G0 actions; clone and GSD configuration belong to runs).
- `src/domain/conventions.ts`: covered for the checks, dependencies and testInventory meaning; the key list is seamed to config-reference.
- `src/domain/evidence.ts`: covered.
- `src/domain/gates.ts`: covered.
- `src/domain/test-inventory.ts`: covered.

Alive proof: `grep -rn "registerRunStage\|AllowlistEgressProxy" src` shows the three stages registered in `src/app/run-service.ts:41-43` and the proxy composed at `src/cli/composition.ts:252`. Dormant states: evidence statuses `skipped` and `stale`, kinds `mutation`, `ci`, `review`, `manual`, independence `external` have no writer (`grep -rn "recordEvidence" src` shows writers only in checks, finish and run-resume).

Not checked: no command was executed in a sandbox; no live evidence file was read; the old proposals were not compared line by line beyond the findings above.
