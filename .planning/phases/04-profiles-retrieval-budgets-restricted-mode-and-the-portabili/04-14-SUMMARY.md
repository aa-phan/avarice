---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 14
subsystem: onboarding
tags: [onboarding, refresh, drift, path-scoped-map, incremental, onb-11, s-34, typescript]

requires:
  - phase: 04
    provides: "plan 04-10: adopt and paths mapping modes, GSD drift in staging, isScopePath, the interim refreshScope rule this plan replaces"
  - phase: 01
    provides: "the stage loop, the staging port, the contract compiler, record versions kept on activation"
provides:
  - "planRefresh, FULL_REMAP_DRIFT_THRESHOLD (3), REFRESH_MANIFEST_NAMES, touchesManifest, newTopLevelDirsOf (src/domain/refresh-plan.ts)"
  - "refreshFacts, driftOf, refreshOfPreflight (src/app/refresh.ts)"
  - "StagingWorkspace.changedBetween(path, from, to): the paths that differ between two commits"
  - "PreflightRequest.refresh and the preflight finding refreshOf { recordVersion, onboardedRevision }; `onboard` of an active project plans a refresh, `repo add` still refuses it"
  - "the mapping:plan step key `refresh` (mode, scope, reason, fromRecordVersion, fromRevision, toRevision, threshold, drift, newTopLevelDirs, changedPaths, changedPathCount, manifestChanged)"
  - "a path-scoped map's mapper reads only its scope and .planning (InvocationScope.readConfine for the map purpose)"
  - "test/helpers/fake-gsd-core.ts writeDriftOverrideGsdCore"
affects: [04-17, 04-21, 04-37, 04-38, 04-39]

actuals:
  tokens: 16000
  tasks: 3
  commits: 4
plan_head_before: aaa80de9b88761823ecd955269076ce35ad8957e
plan_head_after: 0b99a62307d3ba0dbbeda0dd6dc5784381e264ec
commits: 4

tech-stack:
  added: []
  patterns:
    - "The refresh plan is a pure function of facts (stamp, GSD's drift verdict and affected paths, changed paths, new top-level directory names, manifest flag) and an integer threshold; rows are ordered so every route to `full` names its reason"
    - "A count threshold is compared with >= over a set of directory names; a non-integer threshold throws instead of rounding"
    - "The stored contract is not amended for a path-scoped map: the invocation is held to an effective contract whose read scope is narrowed, and the scope turns it into the hook's read confinement"

key-files:
  created:
    - src/domain/refresh-plan.ts
    - src/app/refresh.ts
    - test/unit/refresh-plan.test.ts
    - test/integration/refresh-scoped.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-14-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/deferred-items.md
  modified:
    - src/domain/preflight.ts
    - src/domain/mapping.ts
    - src/domain/invocation-scope.ts
    - src/app/stages/workspace.ts
    - src/app/stages/register.ts
    - src/app/onboarding-service.ts
    - src/app/invocation.ts
    - src/ports/staging-workspace.ts
    - src/adapters/git/staging-base.ts
    - test/helpers/fake-gsd-core.ts
    - test/unit/preflight.test.ts
    - test/unit/mapping.test.ts
    - test/unit/invocation-scope.test.ts
    - test/integration/preflight.test.ts
    - test/integration/onboard-adopt.test.ts
    - test/integration/staging-adapters.test.ts
    - test/integration/skeleton.test.ts

key-decisions:
  - "Plan 04-10's interim refresh-scope rule is REPLACED, not confirmed: refreshScope is removed and every refresh, active-project or first-onboarding, is planned by planRefresh. The threshold now counts new top-level directories from git and sends the plan to full at >= 3 (04-10 allowed up to 3 top-level entries of GSD's affected paths and went full above)"
  - "An incremental refresh is mapping mode `adopt` (no mapper, completeness from the seven files present, provenance `adopted`) until plan 04-17 updates indexes from the changed paths; the index steps run whole"
  - "The threshold is AVARICE's own constant (3, GSD's default for workflow.drift_threshold reused as a directory count), not the threshold GSD reports"
  - "`repo add` still refuses a project with an active record; only `onboard` asks for a refresh (PreflightRequest.refresh)"

requirements-completed: [ONB-11]

coverage:
  - id: D1
    description: "`onboard` on a project with an active record plans a refresh instead of refusing; with commits only under apps/api it records a paths plan over apps/api, runs the mapper with --paths apps/api confined to apps/api and .planning, adds record version 2 and keeps version 1, and leaves the checkout byte-identical (S-34)"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/refresh-scoped.test.ts#tracer: onboarding an active project with commits only under apps/api runs a paths refresh scoped to apps/api (S-34, ONB-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The planner's decision table: incremental on drift pass, paths over scopable affected paths on a block, full for a manifest change, unreadable drift, no stamp, or at least the threshold of new top-level directories; exactly 3 plans full and 2 plans paths; counts are integers compared with >=; a non-integer threshold is refused"
    requirement: ONB-11
    verification:
      - kind: unit
        ref: "test/unit/refresh-plan.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A package.json change plans and runs a full map (one mapper run, completeness complete, files.delete holds .planning/codebase/**); one source file changed with no drift plans incremental with no mapper run and the index steps run; 2 and 3 new top-level directories plan paths and full end to end"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/refresh-scoped.test.ts#a full refresh (ONB-11)"
        status: pass
      - kind: integration
        ref: "test/integration/refresh-scoped.test.ts#an incremental refresh (ONB-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A path-scoped map reads the directories of its scope and .planning only (T-04-35); a whole-repository read scope confines nothing"
    requirement: ONB-11
    verification:
      - kind: unit
        ref: "test/unit/invocation-scope.test.ts#computeInvocationScope: a path-scoped map reads its scope only (T-04-35, ONB-11)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A refresh with nothing to measure from (the map is not committed in the repository, so GSD has no stamp in staging) plans a full map"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/refresh-scoped.test.ts#a refresh with nothing to measure from plans a full map (ONB-11)"
        status: pass
    human_judgment: true
    rationale: "Whether an AVARICE-held map should be restored into staging so that drift can be measured is an owner decision (decision 3); the test only pins today's conservative behavior"

duration: 65min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 14: Refresh of an active project Summary

**`avarice onboard` on a project with an active record plans a refresh from the record's revision, the new HEAD, GSD's own drift verdict and the git-changed paths: incremental (no mapper), a `--paths` map confined to the affected area, or a full map at manifest changes, unreadable drift, no stamp, or three new top-level directories; the previous record version is kept and the checkout is never written**

## Performance

- **Duration:** about 65 min
- **Completed:** 2026-11-16
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 23 (6 created, 17 modified), 891 insertions, 125 deletions

## Accomplishments

- `planRefresh(facts, { threshold })` is pure. Rows in order: no stamp, drift unreadable, manifest or workspace file changed, new top-level directories at least the threshold: `full`; drift pass: `incremental` (`no-change` when nothing changed); drift block over affected paths that are plain, non-manifest and at most 50: `paths`; otherwise `full`. `FULL_REMAP_DRIFT_THRESHOLD` is 3. A threshold that is not a positive integer throws; directories are counted as distinct names.
- `refreshFacts` takes GSD's drift verdict (`verify codebase-drift` in staging), asks the new `StagingWorkspace.changedBetween` for the paths between the two commits, drops `.planning/`, and derives the new top-level directories from the earlier revision's tree. A git failure plans `full` with the reason `changed-paths-unavailable`.
- `onboard` asks for a refresh (`PreflightRequest.refresh`); preflight records `refreshOf { recordVersion, onboardedRevision }` instead of refusing. `repo add` is still refused for an active project.
- The workspace stage plans the refresh for any complete stamped map (from the map's stamp) and for any map of an active project (from the record's revision), records it under `mapping:plan.refresh`, and `chooseMappingMode` takes it: incremental is `adopt`, paths is the scope, full is full; `--mode fast` still wins.
- A `paths` map's mapper invocation is held to a contract read scope narrowed to its scope plus `.planning/**`; `computeInvocationScope` turns that into `readConfine` (scope directories, `.planning`, the GSD read roots), which the hook's read rule enforces (T-04-35). The stored contract is unchanged.
- A refresh adds record version N+1 and supersedes N without removing it (S-34 asserts both rows).

## Task Commits

1. **Task 1 (tracer): onboarding an active project with commits only under apps/api runs a paths refresh scoped to apps/api** (RED `RED_EVIDENCE_OK`, failed on the second onboard being refused by preflight)
   - `5c9b754` test: tracer, `writeDriftOverrideGsdCore`, `04-14-red-task1.json`
   - `2703b34` feat: planner, facts, `changedBetween`, refresh wiring in the workspace stage, read confinement, replacement of `refreshScope`
2. **Task 2: the planner's decision table, boundary and precision cases**
   - `90c1699` test: `refresh-plan.test.ts` (20 cases), the read-confinement unit cases, the `changedBetween` adapter case
3. **Task 3: full and incremental refresh end to end, and the gates**
   - `0b99a62` feat: `PreflightRequest.refresh` (repo add keeps refusing), full, incremental, threshold boundary and no-stamp integration cases, `deferred-items.md`

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

- Task 1 RED: the tracer ran against the real gsd-core, the production composition and the fake host; the first onboarding reached active and the second `onboard` failed on `assert.ok(started.ok)` with the preflight refusal the plan removes. `RED_EVIDENCE_OK`, no import, syntax or fixture fault.
- Task 2 has no separate RED: `planRefresh` was written complete in the Task 1 commit because the tracer needed every row of it, so the table tests pass on the first run and are guards. Mutation checks stand in: `>=` changed to `>` fails 3 cases, removing the manifest row fails 1 case; both were restored.
- Tracer gate: the tracer `<verify>` passed on the proven slice, and the 04-10 adopt suite, the preflight, skeleton, completeness, extra-map-files and checkout-unchanged suites stayed green before expansion.

## Decisions needing owner review

The plan left these open; each is small to change.

1. **The 04-10 interim rule is replaced** (asked for in the dispatch). `refreshScope` (affected paths spanning at most the threshold of top-level entries) is gone. Every refresh is planned by `planRefresh`, so a real GSD block with exactly three new top-level directories now maps in full where 04-10 mapped `--paths alpha,beta,gamma`. The 04-10 integration case with three one-file directories was changed to three files in one directory (paths) and a new case pins three directories (full). This also applies to a first onboarding of a repository that commits a stamped map: it is planned from the map's stamp, and if git cannot read the changed paths it maps in full where 04-10 would have adopted.
2. **An incremental refresh is mapping mode `adopt`**, so the new record says `mapping.provenance: "adopted"` and `existingState.outcome: "adopt"` even though the map is AVARICE's own earlier one. A separate mode or provenance (`refreshed`) needs a record-schema decision.
3. **A previous map held only in the artifact store is not restored into staging.** GSD measures drift from `.planning/codebase/STRUCTURE.md` in staging, which exists only when the map is committed in the repository. For a map AVARICE produced and the owner did not commit, the refresh finds no stamp and plans `full` (pinned by a test). Incremental and path-scoped refresh therefore work only for committed maps until a port method restores the record's map documents into staging. This is the largest gap against the goal "the whole repository is never rescanned when a narrower refresh is supported".
4. **The threshold is AVARICE's constant 3**, passed explicitly, not the threshold GSD reports for the project. Recorded for plan 04-38's config reference.
5. **`repo add` still refuses an active project**; `onboard` refreshes. The plan names only `onboard`. Letting `repo add` create a pending refresh was the alternative.
6. **Changes under `.planning/` are not counted** as changed paths or as a new top-level directory, so a committed map does not look like drift.
7. **Read confinement is the hook and the Read allow rules.** The OS sandbox's `allowRead` still lists the whole staging tree, as for every map invocation; the confinement of T-04-35 is the hook's `readConfine` rule. The scope paths come from GSD's affected paths and pass `isScopePath` where chosen and again in the map stage; git output (changed paths) is used for counts and the manifest test only and never reaches `--paths`.
8. **Wiring location.** The plan's key link names `onboarding-service.ts`; the plan is recorded in the workspace stage, where `mapping:plan` has always been written. `onboarding-service.ts` only passes `refresh: true`.
9. **Documentation not updated in this change.** CLAUDE.md asks `docs/system/` to change with behavior; every earlier plan of this phase left that to the phase's documentation plans, and the plan's output asks for a surfaces list, so the list below is for 04-38 and 04-39.

## Files Created/Modified

- `src/domain/refresh-plan.ts` - the planner, the threshold, the manifest list, `touchesManifest`, `newTopLevelDirsOf`
- `src/app/refresh.ts` - `refreshFacts`, `driftOf` (moved from the workspace stage), `refreshOfPreflight`
- `src/app/stages/workspace.ts` - plans the refresh, outcome rule, records `mapping:plan.refresh`
- `src/domain/mapping.ts` - `chooseMappingMode` takes `refresh`; `refreshScope` removed; `MANIFEST_NAMES` exported
- `src/domain/preflight.ts`, `src/app/stages/register.ts`, `src/app/onboarding-service.ts` - `refreshOf`, `PreflightRequest.refresh`
- `src/domain/invocation-scope.ts`, `src/app/invocation.ts` - read confinement for a path-scoped map
- `src/ports/staging-workspace.ts`, `src/adapters/git/staging-base.ts` - `changedBetween`
- Tests: `refresh-plan.test.ts`, `refresh-scoped.test.ts` (7 cases), changes to the preflight, mapping, invocation-scope, onboard-adopt, staging-adapters and skeleton tests, `writeDriftOverrideGsdCore`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A new port method was needed to read changed paths**
- **Found during:** Task 1
- **Issue:** the app layer cannot import the git adapter, and no staging port method named the paths between two commits.
- **Fix:** `StagingWorkspace.changedBetween` (`git diff --name-only -z`, SHA-checked, bounded at 20000 paths); the two test doubles of the port in `skeleton.test.ts` forward it.
- **Files modified:** src/ports/staging-workspace.ts, src/adapters/git/staging-base.ts, test/integration/skeleton.test.ts
- **Committed in:** 2703b34

**2. [Rule 1 - Bug] Plan 04-10's rule and tests conflicted with the planner's boundary**
- **Found during:** Task 1
- **Issue:** `refreshScope` mapped three new directories with `--paths`; the plan's boundary says exactly three plan full.
- **Fix:** see decision 1; `mapping.test.ts` refreshScope cases moved into `refresh-plan.test.ts`.
- **Files modified:** src/domain/mapping.ts, test/unit/mapping.test.ts, test/integration/onboard-adopt.test.ts
- **Committed in:** 2703b34

**3. [Rule 1 - Bug] `repo add` would have started refreshing**
- **Found during:** Task 3 (the CLI preflight test)
- **Issue:** removing the preflight refusal let `repo add` create a refresh onboarding in `discovered`.
- **Fix:** `PreflightRequest.refresh`; only `onboard` sets it.
- **Files modified:** src/domain/preflight.ts, src/app/stages/register.ts, src/app/onboarding-service.ts, test/unit/preflight.test.ts, test/integration/preflight.test.ts
- **Committed in:** 0b99a62

**4. [Rule 2 - Missing critical] A path-scoped map's reads were not confined (T-04-35)**
- **Fix:** read confinement in `computeInvocationScope` for the map purpose, fed by the narrowed contract read scope in `prepareInvocation`.
- **Files modified:** src/domain/invocation-scope.ts, src/app/invocation.ts
- **Committed in:** 2703b34

**5. [Process] Commit-time branch check**
- The `agent-*` allow-list of the pre-commit branch assertion was not applied: the run was dispatched to the phase branch `worktree-phase-04`, which every earlier plan of the phase committed on. HEAD was a named, non-protected branch for every commit.

---

**Total deviations:** 4 auto-fixed (1 blocking, 2 bugs, 1 missing critical) and 1 process note. **Impact on plan:** no change of scope; decision 1 changes one 04-10 behavior the dispatch asked to reconcile. `gsd-onboarding.ts` needed no change: `GsdDriftResult.affectedPaths` already carries GSD's `affected_paths`, which the real-GSD case in `onboard-adopt.test.ts` asserts.

## Issues Encountered

- `test/integration/exit-parity.test.ts` fails 10 of 15 cases from plan 04-12 (`deps.profile.otherRoots is not iterable` in `scripts/exit-parity.ts`); logged in `deferred-items.md`, not fixed here.
- A combined run of 23 integration files under load timed out four cases (two killpoints, the S-29 adopt kill case, an index-stage status case); each passed when its file was run alone (`killpoints.test.ts` 22 of 22, `onboard-adopt.test.ts` and `index-stage.test.ts` 32 of 32).

## Documentation surfaces (for plans 04-38 and 04-39)

- Refresh modes and the table: incremental (no mapper, adopt), paths (`--paths <scope>`, reads confined to scope and `.planning`), full; rows in order and the reason strings (`no-stamp`, `drift-unreadable`, `manifest-change`, `new-top-level-dirs`, `no-change`, `no-structural-change`, `drift-block`, `changed-paths-unavailable`).
- Threshold: 3 new top-level directories, integers compared with `>=`, GSD's default reused as a directory count; the manifest basenames (`REFRESH_MANIFEST_NAMES`, 29 names); the 50-path cap on a scope. For `config-reference.md`.
- Changed behavior: `avarice onboard` of an active project refreshes (exit 0 when active); `repo add` still refuses. `cli-reference.md` lines 121 and 158 (the `onboard` registration refusals), `onboarding.md:64` (refused as a conflict) and `onboarding.md:199` (a record is always version 1 in practice), `findings.md:52` (versions above 1 cannot occur) are stale for `onboard`.
- `mapping:plan` step key `refresh`; preflight key `refreshOf`; `StagingWorkspace.changedBetween`; a path-scoped map's `readConfine`.
- Stale text elsewhere: `src/domain/run-preflight.ts` says re-onboarding "(adoption and refresh arrive in a later phase)"; its unit test asserts that text, so it was left.
- New finding candidates: an AVARICE-held map is not restored into staging (decision 3); the OS sandbox `allowRead` still lists all of staging for a scoped map (decision 7).

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-35 (a paths refresh reading outside its scope) is mitigated by `readConfine` and asserted in S-34 against the invocation request. T-04-36 (crafted path names) is mitigated: the scope is GSD's affected paths, checked by `isScopePath` in the planner and again in the map stage; changed paths come from git through `runGit` with `-z` and are used for counts and the manifest test only. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-17 can read `mapping:plan.refresh.changedPaths` to update the indexes of an incremental refresh instead of rebuilding them whole. Plans 04-38 and 04-39 document the surfaces above. Decision 3 should be settled before the refresh is described as avoiding a rescan for every project.

## Self-Check: PASSED

- Files present: `src/domain/refresh-plan.ts`, `src/app/refresh.ts`, `test/unit/refresh-plan.test.ts`, `test/integration/refresh-scoped.test.ts`, `04-14-red-task1.json`, `deferred-items.md`
- Commits present on this branch: 5c9b754, 2703b34, 90c1699, 0b99a62
- Acceptance: `04-14-red-task1.json` has exit code 1 and classifies `RED_EVIDENCE_OK`; `grep -n "arrive in a later phase" src/domain/preflight.ts` prints nothing; the boundary pair (2 and 3 new directories) is asserted in the unit and the integration test; `REFRESH_MANIFEST_NAMES` is exported and tested; the full case asserts one mapper invocation and the incremental case asserts none
- Plan verification: `node --test test/unit/refresh-plan.test.ts test/integration/refresh-scoped.test.ts` green (20 and 7 cases); `npm run typecheck` clean; `npm run check:boundaries` ok (110 files); full unit suite 2635 of 2635; integration, fault and mutation files run: refresh-scoped, onboard-adopt, preflight, skeleton, extra-map-files, completeness, gsd-configure, checkout-unchanged, init, index-stage, contract-amend, no-repo-exec, cli-terminal-text, ledger-status, hook, staging-adapters, intel-step, context, killpoints, full-map-resume-stamp and the three mutation files, all green (four cases timed out in the combined run under load and passed alone). exit-parity is red from plan 04-12 (deferred). The full `npm test` was not run.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
