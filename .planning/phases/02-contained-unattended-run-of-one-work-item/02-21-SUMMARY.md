---
phase: 02-contained-unattended-run-of-one-work-item
plan: 21
subsystem: exit-preparation
tags: [exit, portfolio, conventions, r1-briefs, dry-run, onb-10, owner-approval, spend-plan]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-04 brief and conventions parsers and compileRunContract; 02-14 check validation (ONB-10) and runRequiredChecks; 02-18 coverage matrix; 02-20 the live run-purpose suite and the default-parents sandbox"
provides:
  - "test/benchmark/portfolio/avarice-config.json: the portfolio's conventions draft, validated against the pin and committed by the owner in ~/aa-phan-portfolio-v2 as 9f63d91 (one commit on 9f1cd8d, touching only .avarice/config.json, byte-identical to the draft)"
  - "Three R1 briefs, one per class (bug fix with a failing test, small refactor, docs plus code), each expectedDecisions 0, pinned to 9f1cd8d: test/benchmark/r1/r1-bug-swipe-nonfinite.md, r1-refactor-copy-textarea.md, r1-docs-dates-predicate.md"
  - "scripts/exit-run-phase2.sh (--dry-run) and scripts/exit-run-phase2-tools.ts (dry-run and preflight subcommands): a no-spend proof in a scratch clone of the portfolio, writing 02-21-dry-run.json"
  - "test/unit/exit-drafts.test.ts: 20 tests over the drafts and the pin"
  - "02-21-exit-authorization.json: the owner's approval of the three briefs and the spend plan (5.00 USD per run, 2.00 per invocation, up to 3 invocations, 3 runs), 5.7565 of 25 USD spent"
  - "Two Rule 1 fixes found by the dry run: the Seatbelt profile gives back the metadata of the directories above a re-allowed path, and the test inventory command may write the cache paths the declared checks name"
affects: [02-22]

actuals:
  tokens: 22000
  tasks: 3
  commits: 4
plan_head_before: 8e3fd115fdb898c9f87add3ae7f83cdd6d0cd510
plan_head_after: dfe1faf45c9c46fedb647c54f3c7e5aead4a0f89
commits: 4

tech-stack:
  added: []
  patterns:
    - "The exit dry run reuses the app's own startRun, validateChecks and runRequiredChecks through createDeps with a temp profile, so its verdicts are the ones a real run gets"
    - "Owner approval is a file in the phase directory naming brief digests (parseBrief digest), cap and spend so far; the live exit run reads it before spending"
    - "Preflight is read-only: it reads git objects of the portfolio, compares the checks digest of the committed conventions with the draft's, and judges D-04 staleness and the D-16 descendant rule"

key-files:
  created:
    - test/benchmark/portfolio/avarice-config.json
    - test/benchmark/r1/r1-bug-swipe-nonfinite.md
    - test/benchmark/r1/r1-refactor-copy-textarea.md
    - test/benchmark/r1/r1-docs-dates-predicate.md
    - scripts/exit-run-phase2.sh
    - scripts/exit-run-phase2-tools.ts
    - test/unit/exit-drafts.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-21-dry-run.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-21-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-21-exit-authorization.json
  modified:
    - src/adapters/exec/seatbelt-profile.ts
    - src/app/checks.ts
    - docs/containment.md
    - docs/contracts-and-state.md
    - test/containment/executor.test.ts
    - test/integration/run-sandbox-other-profiles.test.ts
    - test/integration/run-gates.test.ts

key-decisions:
  - "The conventions draft differs from the plan's text in one place: test:e2e also declares node_modules/.tmp/** and node_modules/.vite-temp/** as writes, because validation saw them written. The checks digest of the corrected draft is sha256:43b374ff784bfcab7e7533545e462d29edac345015ccb4b4328ff9041e99c214; the plan's uncorrected text gives sha256:efe244755fc57d1aaf3627649d5d587f09b91fdbe82d13a4165d18dfead6f555 (computed with checkSpecDigest on both). The owner committed the corrected draft, so the committed file and the draft have the first value."
  - "The brief digest in the authorization file is the parseBrief digest (what avarice start stores and the dry-run JSON lists), not a shasum of the file bytes; both were re-checked against the approved values before the approval was recorded"
  - "test:e2e stays a declared optional check that fails at the pin in the dry run (VITE_SITE_ORIGIN is empty and it needs a browser); no brief targets it and a real run never runs it"

patterns-established:
  - "A re-allowed path under a denied parent needs the parent directories' metadata given back, or node cannot resolve real paths (the seatbelt-profile fix)"
  - "The inventory command (npx vitest list) writes the same caches the declared checks do, so its sandbox takes the checks' declared writes"

requirements-completed: [FR-1, ONB-10, CON-8]

coverage:
  - id: D1
    description: "The portfolio conventions draft and the three R1 briefs parse with the real parsers, compile against each other without a G0 failure, name only scripts and files that exist at the pin, and map every criterion to a deterministic check"
    requirement: FR-1
    verification:
      - kind: unit
        ref: "test/unit/exit-drafts.test.ts (20 pass, 0 fail)"
        status: pass
    human_judgment: false
  - id: D2
    description: "In a scratch clone of the portfolio at the pin, dependencies install through the egress proxy (registry.npmjs.org only), ONB-10 validation activates all 13 declared checks, the baseline passes every required check except format:check (index.html, pre-existing, D-12), and the test inventory lists 322 tests in 23 files; the portfolio's status and HEAD are identical before and after"
    requirement: ONB-10
    verification:
      - kind: other
        ref: "AVARICE_NET=1 bash scripts/exit-run-phase2.sh --dry-run (exit 0; 02-21-dry-run.json)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The owner approved the three briefs and the spend plan before any live spend on the portfolio, and committed the conventions as one commit on the pin touching only .avarice/; preflight reads them from git objects"
    requirement: RC-2
    verification:
      - kind: other
        ref: "node scripts/exit-run-phase2-tools.ts preflight --repo ~/aa-phan-portfolio-v2 --config test/benchmark/portfolio/avarice-config.json (exit 0: staleness ok, conventions ok, digest 43b374ff...)"
        status: pass
    human_judgment: true
    rationale: "Approval of the tasks and the spend, and the commit in the portfolio, are the owner's decisions (D-06, D-09, D-15)"

duration: "3 sessions"
completed: 2026-11-06
---

# Phase 2 Plan 21: Exit preparation Summary

**The portfolio's conventions (13 declared checks, committed by the owner as 9f63d91) and three owner-approved R1 briefs are proven against the pin by a no-spend dry run, with the exit spend plan approved at 5.00 USD per run.**

## Performance

- **Duration:** three sessions: draft and dry run, owner approval, owner commit and close-out
- **Tasks:** 3 of 3 (one tracer, one decision checkpoint, one human-action checkpoint)
- **Commits:** 4 task commits, measured from plan_head_before 8e3fd11
- **Live spend in this plan:** 0 USD (the dry run uses no model); the Phase 2 total stays 5.7565 USD of the 25 USD ceiling (D-15)

## Accomplishments

- Wrote the conventions draft and three briefs and proved them against the pin: `AVARICE_NET=1 bash scripts/exit-run-phase2.sh --dry-run` exits 0 and writes `02-21-dry-run.json`. The dry run clones the portfolio, commits the draft on top of 9f1cd8d in the clone, installs dependencies through the registry-only proxy (15 allowed connections to registry.npmjs.org), and runs ONB-10 validation and a baseline of every declared check in 37 seconds.
- All 13 checks validated `active`. Base status: `format:check` failed (index.html, pre-existing, D-12) and `test:e2e` failed (optional; `VITE_SITE_ORIGIN` empty in the clone, needs a browser and a local server); the other 11 passed. The test inventory lists 322 tests in 23 files, so the criterion references `test:ignores non-finite deltas` and `test:isIsoYearMonth` resolve against the real inventory (the flagged assumption held).
- Each brief compiled through `avarice start`'s own code (parse, preflight, compile, store) with the routine preset budgets: 60 minutes, 3 invocations, 400 tool calls, 2.00 USD per invocation, 5.00 USD per run.
- Portfolio status and HEAD were identical before and after the dry run (`?? .env`, HEAD 9f1cd8d51f83252ad11a8c486c4245b1b9fc3066); nothing was written to it by Claude (T-02-68).
- The owner approved all three briefs and the spend plan; I re-verified the three parseBrief digests against the files on disk before recording it, then recorded `02-21-exit-authorization.json` (T-02-69).
- The owner committed `.avarice/config.json` as 9f63d9114c5d3d720b8496b08cec85382cfaa357 (parent 9f1cd8d, diff touches only `.avarice/config.json`). The committed file is byte-identical to the draft. Final preflight: `pin 9f1cd8d, source HEAD 9f63d91`; `staleness: ok`; `conventions: ok` with checks digest sha256:43b374ff... equal to the draft's, 13 checks.

## Task Commits

1. **Task 1 (tracer): drafts and no-spend dry run** - `5c8db41`
2. **Rule 1 fix: Seatbelt metadata of parent directories** - `0d950af`
3. **Rule 1 fix: test list command cache writes** - `d337825`
4. **Task 2: owner approval recorded** - `dfe1faf`
5. **Task 3:** human action by the owner in ~/aa-phan-portfolio-v2 (9f63d91); no commit in this repository.

(The RED evidence for Task 1 is `02-21-red-evidence-task1.json`: 20 tests, 2 pass and 18 fail at the base with the drafts absent.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Seatbelt profile hid the directories above a re-allowed path**
- **Found during:** Task 1 dry run
- **Issue:** since 02-20 every run sandbox denies the default AVARICE parents and re-allows the run's own clone and scratch. Under that profile node could not resolve real paths in the clone, because the metadata of the directories above the re-allowed path was denied too.
- **Fix:** the profile gives back the metadata of those directories; an integration test uses a real command.
- **Files modified:** src/adapters/exec/seatbelt-profile.ts, docs/containment.md, test/containment/executor.test.ts, test/integration/run-sandbox-other-profiles.test.ts
- **Commit:** 0d950af

**2. [Rule 1 - Bug] The test inventory command could not write the caches it uses**
- **Found during:** Task 1 dry run
- **Issue:** `npx vitest list` writes `node_modules/.vite*` and `.cache`, which the sandbox for the inventory command did not allow.
- **Fix:** the inventory command's sandbox takes the cache paths the declared checks name as writes; a gate test covers it.
- **Files modified:** src/app/checks.ts, docs/contracts-and-state.md, test/integration/run-gates.test.ts
- **Commit:** d337825

**3. [Plan draft correction] test:e2e writes**
- The plan's draft listed test:e2e writes `dist/**`, `test-results/**`, `playwright-report/**`, `node_modules/.vite/**`, `node_modules/.cache/**`. Validation saw `node_modules/.tmp/**` and `node_modules/.vite-temp/**` written too, so the committed draft adds both. This is the only difference from the plan's text and it changes the checks digest (see key decisions: efe24475... for the plan's text, 43b374ff... for the draft the owner committed). The owner committed the corrected draft.

### Authentication gates

None. The two owner stops (approval, conventions commit) are the plan's designed checkpoints.

## Issues Encountered

- The approved digests in the owner's reply were not a shasum of the file bytes; they are the parseBrief digest. Recomputed through `parseBrief`, all three matched the approval exactly, so nothing changed after approval.
- The coordinator's message quoted the checks digest `efe24475...` as the value from the checkpoint. The checkpoint did not quote a digest; that value is what the plan's uncorrected draft text yields. The current draft yields `43b374ff...`, which is what `02-21-dry-run.json` recorded at the dry run and what preflight reports against the owner's commit.

- `requirements.ready-ids` for RC-2, FR-1, ONB-10, CON-8 returned FR-1, ONB-10 and CON-8 as ready; RC-2 was not (plan 02-22 also lists it and proves the contract assembly live), so it stays pending. `mark-complete` checked off FR-1 and ONB-10; CON-8 was already complete.

## Known Stubs

None.

## Threat Flags

None. The plan's register held: T-02-68 (portfolio status and HEAD unchanged, all access by git reads and a clone source), T-02-69 (authorization file recorded before any portfolio spend), T-02-70 (ONB-10 validation and compiler refusals ran; the owner reviewed the file; the committed file equals the draft), T-02-SC (dependencies installed from the portfolio's own lockfile with `--ignore-scripts` in a throwaway clone through the registry-only proxy).

## Carry-over for 02-22

- `scripts/exit-run-phase2.sh --run <brief>... --authorization-file F` and the tools' `evidence` subcommand are not built yet; only `--dry-run` and `dry-run` and `preflight` exist. 02-22 builds them.
- `--dry-run` needs `AVARICE_NET=1` (network for npm only).
- The exit run must read `02-21-exit-authorization.json`: three briefs by parseBrief digest, 5.00 USD per run, 5.7565 USD spent so far, 25 USD ceiling (D-15). Up to 15.00 USD may be needed; stop and ask if the total could pass 25 USD.
- Preflight must be re-run before spending; the portfolio HEAD (now 9f63d91) may move, which D-04 staleness then judges.
- Host-side residual risk from 02-20: roots placed outside the default parents (AVARICE_DATA_ROOT, AVARICE_WORK_ROOT, AVARICE_CONFIG_HOME) are not denied by the default-parents sandbox rule. The exit run uses the default parents, so it is covered; this stays a documented limit.
- Carried findings still apply: the host outcome kind is not the verdict for a unit (judge from the run's checks, clone diff and HEAD); give the model realpath forms of `$TMPDIR` paths.
- `format:check` fails at the pin on index.html (D-12); no brief maps a criterion to it, and the unit may run `npx prettier --check <paths>` itself.

## Self-Check: PASSED

- Files exist: the draft config, the three briefs, both exit scripts, exit-drafts.test.ts, 02-21-dry-run.json, 02-21-red-evidence-task1.json, 02-21-exit-authorization.json.
- Commits exist: 5c8db41, 0d950af, d337825, dfe1faf (all ancestors of HEAD).
- `node --test test/unit/exit-drafts.test.ts`: 20 pass, 0 fail. Preflight: exit 0, `conventions: ok`, `staleness: ok`.
