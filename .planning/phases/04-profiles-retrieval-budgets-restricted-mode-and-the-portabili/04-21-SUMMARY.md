---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 21
subsystem: onboarding
tags: [promotion, approvals, onboarding-contract, no-replay, create-only-fetch, onb-6, onb-5, fr-12, fr-15, typescript]
status: complete

requires:
  - phase: 04-10
    provides: "the accepted map and the existing-state classes (S-28 fixtures)"
  - phase: 04-14
    provides: "refresh and the reworked preflight"
  - phase: 04-16
    provides: "authorizeAction, finishPrivilegedAction, reconcilePrivilegedSteps"
provides:
  - "delivery.promote of none, copy or commit in the onboarding contract; `avarice onboard --promote none|copy|commit` (src/domain/onboarding-contract.ts, src/domain/preflight.ts, src/cli/commands/onboard.ts)"
  - "promoteStage: authorize onboarding.promote.<mode> with the contract as source, copy or commit, record the outcome (src/app/stages/promote.ts)"
  - "StagingWorkspace.copyIntoCheckout and commitPromotion: the only writes to the user's repository (src/adapters/git/promotion.ts)"
  - "Ledger.openOnboardingDecision and openOnboardingPermissionDecision: a permission decision of an onboarding (src/app/onboarding-decision.ts)"
  - "resume reconciles an interrupted promotion into one decision and never repeats it (src/app/resume.ts, src/app/authorize.ts)"
affects: [04-37, 04-38]

actuals:
  tokens: 24000
  tasks: 3
  commits: 6
plan_head_before: 0b27d667c1918d15785f26e3d80c7c3aea35857b
plan_head_after: cee701a850d265a3be8be5c5b09dc075209c3a4f
commits: 6

tech-stack:
  added: []
  patterns:
    - "A file is created beside its target and hard-linked into place: link refuses an existing name, so a copy cannot replace a file even when one appears between the check and the write"
    - "A commit for the user's repository is built in the staging clone through a temporary index, parked on a ref outside refs/heads, and fetched create-only into refs/heads/avarice/onboard-<id>"
    - "A stage after activation runs in the planning_ready stage of the same lease, because active is a stop state with no stage of its own"
    - "A refused or failed promotion is a recorded step and a note, never a failure of the onboarding"

key-files:
  created:
    - src/adapters/git/promotion.ts
    - src/app/stages/promote.ts
    - src/app/onboarding-decision.ts
    - test/integration/promotion.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-21-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-21-red-task2.json
  modified:
    - src/domain/onboarding-contract.ts
    - src/domain/preflight.ts
    - src/cli/commands/onboard.ts
    - src/app/onboarding-service.ts
    - src/app/resume.ts
    - src/app/authorize.ts
    - src/app/stages/stage.ts
    - src/app/stages/contract.ts
    - src/ports/staging-workspace.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/adapters/git/staging-base.ts
    - docs/system/cli-reference.md
    - docs/system/config-reference.md
    - docs/system/onboarding.md
    - docs/system/data-model.md

key-decisions:
  - "Promotion runs inside the planning_ready stage right after activation, in the same lease, because active is a stop state; a refused, denied or failed promotion leaves the onboarding active and is recorded as step `promote` (refused, failed or completed) with a note"
  - "copy writes only absent targets under .planning/codebase; a target with other bytes, a symbolic link in the way or an oversize file is a conflict, left untouched and listed in one permission decision"
  - "commit builds one commit on the pinned revision holding only the accepted files, parks it on refs/avarice/promote in the staging clone and fetches it create-only into refs/heads/avarice/onboard-<id>; an existing branch of that name is a conflict, not a retry"
  - "An onboarding's permission decision is a decisions row on the carrier run its contract is stored under, opened by a new ledger method, because no run method can see the carrier"
  - "resume of an active onboarding takes the lease only when a privileged start has no end, then reconciles that and nothing else"

requirements-completed: [ONB-6]

coverage:
  - id: D1
    description: "`onboard --promote copy|commit` is accepted by preflight and the contract compiler; any other value exits 64 naming none, copy and commit; no flag or `none` leaves the checkout byte-identical"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#tracer: `onboard --promote copy` copies the accepted map into an empty .planning/codebase through the approval gate (ONB-6, D-15)"
        status: pass
      - kind: unit
        ref: "test/unit/domain-contracts.test.ts#refuses a promotion value other than none, copy or commit, naming the three (RC-5)"
        status: pass
      - kind: unit
        ref: "test/unit/preflight.test.ts#refuses promotion"
        status: pass
    human_judgment: false
  - id: D2
    description: "Promotion is a privileged action authorized by the onboarding contract (action.started source contract, no approvals row) and a policy deny of the action refuses it with the rule ID while the onboarding stays active"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#a policy deny refuses the promotion (T-04-57, FR-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "copy writes only absent or byte-identical targets and never replaces a file; a differing file, a symbolic link or a path outside .planning is left untouched and one permission decision lists the files (S-28)"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#copy never overwrites a file of the checkout (S-28, T-04-56)"
        status: pass
    human_judgment: false
  - id: D4
    description: "commit adds exactly refs/heads/avarice/onboard-<id> with one Conventional Commits commit of the accepted files on the pin and changes no HEAD, index, working-tree file or other ref"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#commit makes one create-only branch and changes nothing else in the repository (D-15, ONB-5, T-04-58)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A promotion killed after its start was recorded (before or after the write) is not replayed on resume: one permission decision names it, resume writes nothing, the stage does not run again"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/promotion.test.ts#a promotion interrupted after its start was recorded is not replayed on resume (FR-15, T-04-44)"
        status: pass
      - kind: fault
        ref: "test/fault/privileged-no-replay.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "An owner can learn from the command output why a promotion did not happen or what it left untouched"
    verification: []
    human_judgment: true
    rationale: "The wording of the notes and the absence of the onboarding decisions from `avarice inbox` is a usability judgment no test asserts"

duration: 20min
completed: 2026-11-17
---

# Phase 4 Plan 21: Promotion of the accepted map Summary

**`avarice onboard --promote copy|commit` copies the accepted map into absent targets of the checkout, or creates one create-only branch `avarice/onboard-<id>`, as a privileged action the onboarding contract authorizes, never overwrites an owner's file and never replays after an interruption.**

## Performance

- **Duration:** about 20 min of execution
- **Started:** 2026-11-17T06:59:00Z (approximate)
- **Completed:** 2026-11-17T07:21:00Z
- **Tasks:** 3 (one tracer, one TDD, one plain)
- **Files modified:** 22 (6 created, 16 modified), 1085 insertions and 58 deletions in src and test

## Accomplishments

- The contract compiler and preflight accept `none`, `copy` and `commit` and name the three when they refuse another value; `--promote` accepts them.
- `promoteStage` runs after activation in the same lease. It passes `authorizeAction` with the contract as its source (action and `{ onboardingId }`), so no approvals row exists; the policy sources, including the repository policy at the pin, still apply and a deny refuses the promotion without failing the onboarding.
- `copyIntoCheckout` writes absent files by linking a temporary file into place (an existing name is never replaced), counts identical files as present and reports everything else as a conflict, including a `.planning` that is a symbolic link out of the checkout.
- `commitPromotion` builds one commit through a temporary index in the staging clone and fetches it create-only into the user's repository. A test measures that exactly one ref is added and that HEAD, the index, the working tree and every other ref are unchanged.
- Resume reconciles privileged steps first. An onboarding that is active with a start and no end takes the lease for that alone and opens one permission decision; two kill points (after the start, after the write) prove nothing is written and the stage does not run again.

## Task Commits

1. **Task 1 (tracer): copy through the approval gate** - RED `a9829a2` (`RED_EVIDENCE_OK`, 2 of 3 failing on assertions), GREEN `93169ca`. Tracer gate: the `<verify>` re-ran green before expansion.
2. **Task 2: copy never overwrites, commit is create-only, a deny refuses** - tests `c6124b2` (RED `RED_EVIDENCE_OK`, 1 of 12 failing), GREEN `5e3c3b8`
3. **Task 3: an interrupted promotion is not replayed** - `1bd66cb`
4. **Documentation of the new values** - `cee701a`

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

- Task 1: `test(04-21)` `a9829a2` before `feat(04-21)` `93169ca`. RED failed on `assert.equal(result.code, 0)` (64 where 0 was planned) against the real CLI; typecheck clean, so no import or fixture fault.
- Task 2: `test(04-21)` `c6124b2` before `feat(04-21)` `5e3c3b8`. The Task 1 implementation already carried the copy rule, the commit path and the deny handling (the tracer could not be green without the stage), so 11 of 12 Task 2 cases passed on first run (unexpected green). One case was red for a real reason: `commitPromotion` accepted the user repository as the staging clone (it would have built the commit and parked a ref there); the guard is the feat commit. The other cases were shown to discriminate by breaking the committed sources in five ways (overwrite, no existing-branch check, no path confinement, deny ignored, no decision for left-over files): 6 of 12 failed. Recorded in `04-21-red-task2.json` (with `mutationEvidence`).
- Task 3 is `type="auto"` and has no RED record. A mutation (the active-onboarding branch of resume disabled) made both kill-point cases fail.

## Decisions Made

See `key-decisions` and the list below for the ones that need the owner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] A staging path that is the user repository was accepted for a commit promotion**
- **Found during:** Task 2 (RED run)
- **Issue:** `commitPromotion` checked only that the staging path has its own `.git`; the user's own repository passes that check, and the build step would then have written the park ref and objects there.
- **Fix:** compare the staging git directory with the user repository's and refuse a match.
- **Files modified:** src/adapters/git/promotion.ts
- **Committed in:** 5e3c3b8

**2. [Rule 3 - Blocking] A decision of an onboarding had nowhere to live**
- **Found during:** Task 1
- **Issue:** The plan says a conflict "opens a decision" and resume opens a permission decision, but the decisions of a run are reached through `lockRun`, which treats the carrier run of an onboarding as not found.
- **Fix:** `Ledger.openOnboardingDecision` (a decisions row keyed by the carrier run, on the contract's latest version) and `openOnboardingPermissionDecision`; `reconcilePrivilegedSteps` uses it for an onboarding scope. Not in the plan's file list: src/ports/ledger.ts, src/adapters/sqlite/ledger.ts, src/app/onboarding-decision.ts.
- **Committed in:** 93169ca

**3. [Rule 3 - Blocking] A stage after activation, and two kill points**
- **Found during:** Tasks 1 and 3
- **Issue:** `active` is a stop state, so the stage loop has no stage for it; and a kill between a privileged action's start and end has no generic kill point.
- **Fix:** `promoteStage` is called at the end of the `planning_ready` stage; `StageContext.fault` exposes the named kill points `after-action-start:<action>` and `after-action-work:<action>` (test-only, inert unless `AVARICE_FAULT` names them).
- **Committed in:** 93169ca, 1bd66cb

**4. [Rule 3 - Blocking] Existing tests encoded the refusal of `copy` and `commit`**
- **Fix:** test/unit/domain-contracts.test.ts, test/unit/preflight.test.ts, test/integration/skeleton.test.ts and test/integration/preflight.test.ts now refuse `push` and `branch` and assert the allowed values; the two spy `StagingWorkspace` objects in skeleton.test.ts gained the two new methods.
- **Committed in:** 93169ca

**5. [CLAUDE.md] docs/system edited in this plan**
- **Issue:** CLAUDE.md requires `docs/system/` to change in the same change as behavior or a flag; the plan defers the writing to 04-38.
- **Fix:** the four places that said only `none` exists were corrected and a Promotion section added to cli-reference.md. Other stale statements in those files (for example adoption "deferred") are not this plan's and are left for 04-38.
- **Committed in:** cee701a

**Total deviations:** 5 (1 Rule 2, 3 Rule 3, 1 CLAUDE.md). **Impact:** none on scope.

## Decisions needing owner review

The plan left these open and I chose a policy.

1. **What an onboarding owner is asked (the open item from 04-16, decision 6).** Both cases open one `permission` decision (withdraw only) on the onboarding's carrier run: a copy that left files untouched, and an interrupted promotion on resume. Those rows are filtered out of `avarice inbox`, and `avarice decide` cannot answer or withdraw them (it resolves the run, and the carrier is invisible to run methods). The owner learns of them from the `onboard` / `resume` output line and from `listDecisions`. If they should be visible and withdrawable, the inbox and `decide` need to resolve onboarding decisions.
2. **Promotion that does not happen never fails the onboarding.** A deny, an approval-gate error, a failed copy and an existing branch all leave the onboarding `active`, record step `promote` (refused or failed) and put the reason in the output line, exit 0. The alternative is a non-zero exit when the owner asked for a promotion that did not occur.
3. **A kill between activation and the start of promotion leaves nothing promoted and resume does not run it.** Resume only reconciles starts that have no end; a promotion that never started is not retried (the onboarding is active, a stop state). A retry would need a new command or a resume path for `active`.
4. **An existing branch `avarice/onboard-<id>` is a conflict, not idempotent success.** The commit is not deterministic, so a second attempt cannot be recognised as the same. Onboarding IDs are unique, so this arises only after a failure between the fetch and the recorded end.
5. **The commit holds only the accepted map files**, on top of the pinned revision (not the user's current HEAD), and replaces a same-named path that is already committed at the pin on that branch. It carries no `.planning/config.json`, intel, graphs or knowledge files.
6. **A policy `deny` outranks the contract, including the repository's own `.avarice/policy.json` at the pin**, so a repository can refuse promotion into itself. `require-approval` for these actions is satisfied by the contract, not by the owner's `avarice approve`, because the contract names the action and the onboarding ID.
7. **The project record's `promotion` field stays `none`** whatever was asked: the record is built at activation, before promotion, and is immutable. What was promoted is in step `promote` and in the action events.
8. **docs/system was edited in this plan** against the plan's note that 04-38 owns it (deviation 5).

## Documentation surfaces (for plan 04-38)

- **Flag:** `avarice onboard --promote none|copy|commit` (default `none`). An unknown value exits 64 at preflight with `request.promote: promotion "<v>" is not accepted: the allowed values are none, copy, commit`. Already documented in cli-reference.md (Promotion section), config-reference.md, onboarding.md and data-model.md; the rest of those files is not regrounded.
- **Stage:** `promote`, run at the end of the `planning_ready` stage after activation, in the same lease. Skips when `delivery.promote` is `none`, or when step `promote` or an `action.started` of the action already exists.
- **Actions:** `onboarding.promote.copy`, `onboarding.promote.commit`, both privileged; authorization params `{ onboardingId }`, scope the onboarding ID, source `contract` (events `action.started` and `action.finished` with status `succeeded` or `failed`). A denied promotion records no start.
- **Step `promote`** (table `onboarding_steps`): status `completed`, `refused` or `failed`; result carries `mode`, and `written`, `present`, `conflicts`, `decisionId` (copy), `branch`, `commit`, `files` (commit), or `rule` and `detail` (refused, failed).
- **Branch:** `refs/heads/avarice/onboard-<onboarding id>`, created by a create-only, fsck-checked fetch of `refs/avarice/promote` from the staging clone; commit message `docs(planning): adopt GSD codebase map from AVARICE onboarding <id>` plus a list of the files; identity `AVARICE <avarice@localhost>`; parent the pinned revision.
- **Copy rule:** targets are `.planning/codebase/<file>` of the checkout; written at mode 0644 by link of a same-directory temporary; absent: write, identical: present, anything else: conflict.
- **Decisions of an onboarding:** `decisions` rows with `run_id` the contract's carrier run, class `permission`, option `withdraw`; evidence references `path:<file>` (copy conflicts) or `event:<seq>` (interrupted start). Not listed by inbox, not answerable by `decide`.
- **Resume:** an `active` onboarding with an `action.started` that has no end takes the lease and reconciles it: one decision, one `action.interrupted` event, output line `<action> was started and never finished; it was not repeated (decision <id>)`.
- **Kill points (test-only):** `after-action-start:<action>`, `after-action-work:<action>`.
- **Ports:** `StagingWorkspace.copyIntoCheckout`, `StagingWorkspace.commitPromotion`; `Ledger.openOnboardingDecision`.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: persistence | src/adapters/sqlite/ledger.ts | decisions rows now exist for the carrier run of an onboarding; no run method reads them and the inbox filters them out, so an open one is easy to miss |

T-04-56 (overwrite): absent-or-identical rule, link-into-place, symlink and path confinement, five mutations killed. T-04-57 (no authority): `authorizeAction` with the contract source, enterprise deny tested for commit, and not for copy. T-04-58 (moving refs or HEAD): one create-only fetch, exactly-one-ref and unchanged-checkout assertions. No package was installed (T-04-SC).

## Verification

- `node --test test/integration/promotion.test.ts test/fault/privileged-no-replay.test.ts test/integration/approvals.test.ts test/fault/approval-consume.test.ts`: 50 of 50. `promotion.test.ts` alone: 15 of 15.
- `npm run typecheck` clean; `npm run check:boundaries` ok (119 files); `npm run test:unit`: 2687 of 2687.
- Related suites: resume-reap, lease, staging-adapters, onboard-adopt, checkout-unchanged, decision-ledger, skeleton, preflight, index-stage, killpoints, full-map-resume-stamp, migrations, extra-map-files, completeness, gsd-adapter, profile-selection, status-queries: all pass. The full `npm test` is the orchestrator's.
- Acceptance: `04-21-red-task1.json` (exit 1, `RED_EVIDENCE_OK`) exists; `grep -n "allows only" src/domain/onboarding-contract.ts` prints nothing; the commit case compares the ref lists before and after and finds only the new ref; the S-28 case asserts the files' bytes; the interrupted cases assert the tree digest after resume equals the one at the kill.

## Next Phase Readiness

Ready for 04-22.

## Self-Check: PASSED

- Files: src/adapters/git/promotion.ts, src/app/stages/promote.ts, src/app/onboarding-decision.ts, test/integration/promotion.test.ts and both red records exist.
- Commits: a9829a2, 93169ca, c6124b2, 5e3c3b8, 1bd66cb, cee701a are ancestors of HEAD.
