---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 44
subsystem: restricted-mode-and-promotion
tags: [restricted-run, patch-scope, outputs-as-findings, promotion-paths, gap-closure]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: restricted run stage (04-23), promotion into the owner's checkout (04-21), the contained run's scope rule
provides:
  - restricted patch held to the contract's write scope, out-of-scope paths named and recorded
  - restricted host outputs read as findings; patch cap; outputs step recorded before storage
  - strict promotion paths (.git, dot-only and non-normal-form refused)
affects: [04-53 documentation plan, restricted mode documentation, onboarding promotion documentation]

plan_head_before: 60d9e1c40d1fac90884c6a710f35108138c0457e
plan_head_after: 744ce929cd4bfc7713ffb123561d0c7824212182

actuals:
  tokens: 14000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Outputs of an untrusted host read as findings: a failed read adds a problem line, the run still ends through the one blocking path"
    - "Two-phase step record (judged, then stored) so a failure after the host ran is finished on resume without a second launch"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-44-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-44-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-44-red-task3.json
  modified:
    - src/app/run-stages/restricted.ts
    - src/app/run-stages/item.ts
    - src/adapters/git/promotion.ts
    - test/integration/restricted-mode.test.ts
    - test/integration/promotion.test.ts
    - test/helpers/fake-claude.ts
    - test/fixtures/claude-fake/claude-replay.mjs

key-decisions:
  - "The restricted scope check reuses the contained run's own rule (the breaches function of the item stage, now exported), so a path is out of scope in a restricted run exactly when it would breach a contained one; the host's own restricted directory is not judged"
  - "Out-of-scope paths are recorded with the existing containment.finding event (check scope-of-writes) that the contained path writes, so no new event kind exists"
  - "The block text keeps what it says about problems and out-of-scope paths to 440 characters, so the 1000-character issue cut never removes the ending the owner needs"
  - "The outputs step is recorded twice with the same key: first judged (captured false), then stored (captured true); a resume that finds captured false takes the outputs again from the clone and finishes the block"

requirements-completed: [CON-4, ONB-6]

coverage:
  - id: D1
    description: "A restricted patch whose host edited a path outside the write set or a protected path leaves both out of the stored patch, names them as left out in the block text, and records a scope-of-writes finding (WR-13)"
    requirement: CON-4
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#leaves a path outside the write set and a protected path out of the stored patch, and names both in the block text"
        status: pass
    human_judgment: false
  - id: D2
    description: "An oversize plan, a plan that links out of the clone and a patch over 1 MiB end the run blocked with the problem named; a resume does not launch the host again (WR-12)"
    requirement: CON-4
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#blocks on a plan over 256 KiB, names the unreadable plan, and a resume does not launch the host again"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#blocks on a plan that is a symbolic link out of the clone, naming the problem, with the host launched once"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#does not store a patch over 1 MiB and says so in the block text"
        status: pass
    human_judgment: false
  - id: D3
    description: "Promotion refuses .git in any case, dot-only segments and paths not in normal form with an invalid error naming the path, before anything is written into the checkout (WR-22)"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#refuses \".planning/codebase/.git/HEAD\" with an invalid error naming it, before anything is written into the checkout"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-11-22
status: complete
---

# Phase 04 Plan 44: Restricted patch scope, host outputs as findings and strict promotion paths Summary

**A restricted patch is held to the contract's write scope after the fact, an unreadable, oversize or linked output of the uncontained host ends the run blocked with the host launched once, and promotion refuses `.git`, dot-only and non-normal-form paths (WR-12, WR-13, WR-22).**

## Performance

- **Duration:** 13 min
- **Started:** 2026-11-22T21:30:00Z
- **Completed:** 2026-11-22T21:43:00Z
- **Tasks:** 3
- **Files modified:** 10 (7 source, test and fixture files, 3 RED records), plus this summary

## Accomplishments

- WR-13: after the host returns, the clone's changed paths are compared with the contract's write, create, delete and protected sets by the contained run's own rule. Paths that do not conform are passed to `workspace.patch` as excludes, named in the block text ("... left out of the patch: a, b"), and recorded as a `containment.finding` event (check `scope-of-writes`). The test host edits `src/in-scope.ts`, `.github/workflows/ci.yml` and `package.json`; the stored patch holds only the first (plus the existing `src/slug.ts` edit).
- WR-12: the plan, the question list, the changed-path read and the patch are read as findings. A failed read adds a problem line (`the plan could not be read (307200 bytes exceeds the limit of 262144)`, `(denied: staging-reads-stay-inside-staging)` for a link out of the clone). The patch is capped at `MAX_PATCH_BYTES` (1 MiB): a larger one is not stored and the text says so. The run always ends through `blockWithOutputs`. Only artifact-store and ledger failures are still returned as errors.
- The `restricted:outputs` step is recorded as soon as the outputs are judged and before they are stored; it is recorded again with the artifact digests. A resume that finds the first form takes the outputs again from the clone and finishes the block; it never reaches `resetClone` or the launch.
- WR-22: `checkPromotionPath` refuses a segment equal to `.git` in any letter case or made of dots only, and any path that differs from its segments joined by `/` (empty or `.` segments, trailing slash). The five paths from the plan are refused with an invalid error naming the path and an unchanged checkout digest; `.planning/codebase/STACK.md` is still promoted.

## TDD

- **Task 1 RED** (`d17053b`): the stored patch held `diff --git` headers for `.github/workflows/ci.yml` and `package.json` (assert.deepEqual of the headers failed). RED record `04-44-red-task1.json` returned `RED_EVIDENCE_OK`. Semantic assessment: the run reached `blocked_on_decision`, so the fixture is valid, and the failure is on the planned assertion. **GREEN** `c64a5fb`.
- **Task 2 RED** (`b92d03a`): the oversize and linked plans left the run in `contract_ready` (the stage returned the read error after the host ran); the 1.2 MiB patch was stored with no problem named. RED record `04-44-red-task2.json` returned `RED_EVIDENCE_OK`. **GREEN** `d048520`.
- **Task 3 RED** (`0a501da`): all five paths were promoted (`copyIntoCheckout` returned ok) where an invalid error was expected. RED record `04-44-red-task3.json` returned `RED_EVIDENCE_OK`. **GREEN** `744ce92`.
- No REFACTOR commits.

## Task Commits

1. **Task 1 (tracer): restricted patch scope (WR-13)** - `d17053b` (test), `c64a5fb` (fix)
2. **Task 2: bad outputs end the run blocked, once (WR-12)** - `b92d03a` (test), `d048520` (fix)
3. **Task 3: strict promotion paths (WR-22)** - `0a501da` (test), `744ce92` (fix)

**Plan metadata:** recorded by the docs commit that follows this summary.

## Verification

- `node --test test/integration/restricted-mode.test.ts test/integration/restricted-onboarding.test.ts`: 32 tests, 32 pass, 0 fail (after the Task 2 fix).
- `node --test test/integration/promotion.test.ts test/fault/privileged-no-replay.test.ts`: 36 tests, 36 pass, 0 fail. `test/unit/port-descriptors.test.ts` and `test/integration/skeleton.test.ts` (the other files that name the promotion module): 48 of 48.
- `npm run typecheck`: clean. `npm run check:boundaries`: ok (132 files).
- `grep -c MAX_PATCH_BYTES src/app/run-stages/restricted.ts`: 3.
- The tracer's verify (`node --test test/integration/restricted-mode.test.ts && npm run typecheck`) passed at the Task 1 GREEN commit with 15 of 15; the first expansion task started after it.
- The full `npm test` suite was not run (over an hour here, per the dispatch instructions).

## Decisions Made

- `breaches` in the item stage is exported and reused rather than copied, so the restricted and contained scope rules cannot drift. The restricted stage imports it from `item.ts`; there is no import cycle.
- A path that `workspace.patch` cannot take as an exclude (its check allows only plain relative names, so a path with a space fails) makes the patch a problem ("could not be built ... was not stored") and the out-of-scope paths are still named. The patch is never stored with an out-of-scope hunk in it.
- A failed `workspace.status` fails closed: no patch is stored and the text says the changed paths could not be read.

## Deviations from Plan

**1. [Rule 3 - Blocking] The fake `claude` could not make a symbolic link**
- **Found during:** Task 2 (the linked-plan case)
- **Issue:** the fake host's script only had `writes`; the plan's symbolic-link case needs a link out of the clone.
- **Fix:** added a `symlinks` option (relative path to target, made after the writes) to `test/fixtures/claude-fake/claude-replay.mjs` and `test/helpers/fake-claude.ts`.
- **Files modified:** `test/fixtures/claude-fake/claude-replay.mjs`, `test/helpers/fake-claude.ts`
- **Commit:** `b92d03a`

**2. [Plan interpretation] Two-phase step record**
- The plan says to record the outputs step before anything else that can fail. The artifact store can fail after the outputs are read, so the step is recorded twice (judged, then stored) and a resume of the first form re-takes the outputs from the clone. A single record after storing would have kept the relaunch-on-resume window for store failures.

**3. [Plan gap] No test for a ledger or artifact-bookkeeping failure**
- The behavior "a failure of the ledger or of the artifact bookkeeping itself is still returned as an error" holds by construction (every `storeOutput` and `recordRunStep` result is returned unchanged), but no automated case forces an artifact-store failure; that needs a profile quota or a ledger fault the integration harness does not offer for the restricted stage. Not added.

**Total deviations:** 1 auto-fixed (Rule 3), 2 notes. **Impact:** none on scope.

## Issues Encountered

- The worktree sandbox refused compound shell commands with `git`, shell variables or `sed -i`, so the pin guard, `git` calls and the RED-record builder were run as plain separate commands and file edits went through the edit tool. No effect on the result.

## Known Stubs

None.

## Threat Flags

None. T-04-119, T-04-120 and T-04-121 are mitigated by the changes above; no new endpoint, auth path or trust boundary was added.

## Documentation surfaces

For plan 04-53 (`docs/system/` was not edited here, per the plan):

- **Restricted block text** (restricted-mode document under `docs/system/`): the block text now carries, before the ending, one sentence per problem with an output (`the plan could not be read (<reason>)`, `the question list could not be read (...)`, `the patch could not be built (...) and was not stored`, `the patch is larger than the 1 MiB limit and was not stored`, `the changed paths could not be read (...), so no patch was stored`) and one sentence naming the paths left out of the patch (at most 5 named, 80 characters each, then `and N more`). That part of the text is cut at 440 characters so the ending (`No check and no gate ran ... avarice cancel`) always survives the 1000-character cut.
- **Patch cap and scope rule** (same document): the stored restricted patch is capped at 1 MiB (`MAX_PATCH_BYTES`); a larger patch is not stored. A changed path is out of scope by the contained run's rule (protected; a modified path outside the write set, an added path outside the create set, a deleted path outside the delete set; artifacts paths tolerated) and is excluded from the patch, named in the block text and recorded as a `containment.finding` event with check `scope-of-writes` (first 10 paths, plus the count). The restricted directory is never judged.
- **Restricted outputs and resume** (same document, resume section): an unreadable plan, question list or patch (over 256 KiB for the first two, a non-regular file, a link out of the clone) no longer aborts the stage; the run ends blocked with the problem named. The `restricted:outputs` step is recorded when the outputs are judged (with `problems`, `outOfScope`, `captured: false`) and again after storage (`captured: true`, artifact digests); a resume never launches the host once the step exists, and re-takes the outputs from the clone when only the first form exists.
- **Promotion path rule** (onboarding promotion document): a promoted path is refused unless it is in normal form (no empty or `.` segment, no trailing slash), lies under `.planning/`, has only letters, digits, `.`, `_` and `-` in each segment, and has no segment equal to `.git` in any letter case or made only of dots. This applies to copy and commit mode (both use the same check) and is checked before any write into the owner's checkout.
- `docs/system/findings.md`: none added; WR-12, WR-13 and WR-22 are closed in code.

## Next Phase Readiness

Ready for the next gap-closure plan. Plan 04-53 should carry the documentation surfaces above.

## Self-Check: PASSED

- Files: `src/app/run-stages/restricted.ts`, `src/app/run-stages/item.ts`, `src/adapters/git/promotion.ts`, `test/integration/restricted-mode.test.ts`, `test/integration/promotion.test.ts`, `test/helpers/fake-claude.ts`, `test/fixtures/claude-fake/claude-replay.mjs` and the three `04-44-red-task*.json` records all present.
- Commits `d17053b`, `c64a5fb`, `b92d03a`, `d048520`, `0a501da`, `744ce92` are ancestors of HEAD; `git rev-list --count` from the recorded base gives 6.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
