---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 10
subsystem: onboarding
tags: [onboarding, existing-map, adoption, path-scoped-map, drift, onb-6, d-10, typescript]

requires:
  - phase: 04
    provides: "plan 04-06: requireCapabilities and the step table, which the onboarding.map.adopt and onboarding.map.paths steps read"
  - phase: 01
    provides: "classifyExistingMap, the workspace/map/validate/activate stages, the GSD onboarding adapter with checkDrift"
provides:
  - "existingMapOutcome(class, drift) and the DriftVerdict and ExistingMapOutcome types (src/domain/preflight.ts); EXISTING_MAP_OUTCOME and adoptionDeferred are gone"
  - "userOwnedPaths and the preflight findings existingState.{outcome, drift, userOwned}"
  - "chooseMappingMode with adopt and paths modes, refreshScope, readScopePaths, isScopePath (src/domain/mapping.ts)"
  - "the workspace stage runs GSD's drift check in staging for a complete stamped map and records outcome, drift and paths in mapping:plan"
  - "files.delete rule (filesDeleteFor) in the onboarding contract"
  - "provenance `adopted` on the project record; completeness of an adopted map from the files present"
  - "GSD adapter capabilities map-paths and adopt-map true"
  - "test/helpers/stamped-map-fixture.ts"
affects: [04-14, 04-21, 04-37, 04-38, 04-39]

actuals:
  tokens: 15000
  tasks: 3
  commits: 5
plan_head_before: 09e76213281c0497adb47a708b0143959d4a34b6
plan_head_after: 4f50aab7ed184702acb5b23c90553019d3de6a3f
commits: 5

tech-stack:
  added: []
  patterns:
    - "The outcome for an existing map is a pure function of the class and GSD's drift verdict; the stage supplies the verdict from `verify codebase-drift` run in staging, and any answer that is not a clean pass (skipped, unreadable, a failed run) is `unreadable`, so a stamp alone never adopts"
    - "chooseMappingMode takes the outcome as an input instead of computing it, which keeps mapping.ts free of a runtime import of preflight.ts (the two import each other's types and values)"
    - "A value that becomes part of the mapper prompt (`--paths`) is validated where it is chosen (isScopePath, refreshScope) and again where it is used (map stage), and travels as one comma-separated word"

key-files:
  created:
    - test/helpers/stamped-map-fixture.ts
    - test/integration/onboard-adopt.test.ts
    - test/unit/onboarding-contract-delete.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-10-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-10-red-task2.json
  modified:
    - src/domain/preflight.ts
    - src/domain/mapping.ts
    - src/domain/onboarding-contract.ts
    - src/domain/validation.ts
    - src/domain/project-record.ts
    - src/app/stages/workspace.ts
    - src/app/stages/map.ts
    - src/app/stages/shared.ts
    - src/app/stages/validate.ts
    - src/app/stages/activate.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - src/cli/commands/repo.ts
    - test/unit/preflight.test.ts
    - test/unit/mapping.test.ts
    - test/unit/capability-requirements.test.ts
    - test/integration/preflight.test.ts

key-decisions:
  - "Preflight reads the checkout only and its stored findings are immutable, so existingState holds the class, the outcome without a drift verdict (`full-in-staging` for a complete stamped map) and `drift: null`; the final outcome and the drift result live in the mapping:plan step and are copied into the project record's existingState"
  - "A drift verdict that is skipped, unreadable (exit 69) or a failed run is `unreadable` and maps in full in staging; adoption needs GSD's own drift pass"
  - "files.delete is the map directory when the existing-map answer is Refresh and a map exists; the preset answer is always Refresh, so the literal rule would put the glob in every contract"
  - "An adopted map is validated on the stamp's presence in every file, not on equality with the staging HEAD; GSD's drift pass in staging is the freshness evidence"

requirements-completed: [ONB-6]

coverage:
  - id: D1
    description: "A committed, stamped, drift-free GSD map is adopted: no mapper invocation, mode adopt, provenance adopted, completeness complete from the files present, checkout byte-identical"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#tracer: a committed, stamped, drift-free GSD map is adopted (ONB-6, D-10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each existing-map class has its own outcome: stamped-complete adopt on drift pass, refresh on block, full-in-staging on unreadable; stamped-partial and unstamped full-in-staging; unknown-format and user-edited isolated regeneration; none maps"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/preflight.test.ts#existingMapOutcome (ONB-6, D-10)"
        status: pass
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#user-owned map files are never overwritten (S-28, ONB-6)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The blanket EXISTING_MAP_OUTCOME and adoptionDeferred are removed; preflight records the class, the outcome and userOwned, and mapping:plan records the outcome and the drift result"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/preflight.test.ts#classifyPreflight findings"
        status: pass
      - kind: integration
        ref: "test/integration/preflight.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mapping modes adopt and paths run: adopt invokes no mapper; paths invokes the mapper with --paths and records completeness partial with the scope list; neither is unsupported"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/mapping.test.ts#chooseMappingMode: adopt and path-scoped maps (ONB-6, D-10)"
        status: pass
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#a stamped map whose drift check blocks is refreshed in staging"
        status: pass
    human_judgment: false
  - id: D5
    description: "files.delete holds .planning/codebase/** only for the Refresh answer with an existing map"
    requirement: ONB-6
    verification:
      - kind: unit
        ref: "test/unit/onboarding-contract-delete.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "No outcome writes to the user's checkout: edited and unknown-format files, uncommitted changes and untracked files stay byte-identical; uncommitted source changes are recorded as not mapped"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#user-owned map files are never overwritten (S-28, ONB-6)"
        status: pass
    human_judgment: false
  - id: D7
    description: "An onboarding killed after classification and resumed reaches the same outcome and leaves the checkout byte-identical (S-29)"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#an onboarding killed after classification and resumed reaches the same outcome (S-29, ONB-6)"
        status: pass
    human_judgment: false
  - id: D8
    description: "A forged or stale stamp never makes a map adoptable (T-04-26); a --paths value cannot change meaning (T-04-27)"
    requirement: ONB-6
    verification:
      - kind: integration
        ref: "test/integration/onboard-adopt.test.ts#a stamp alone never makes a map adoptable (T-04-26)"
        status: pass
      - kind: unit
        ref: "test/unit/mapping.test.ts#refreshScope"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 10: Adoption of existing GSD maps Summary

**A committed, stamped GSD map whose own `verify codebase-drift` passes in staging is adopted with no mapper run and provenance `adopted`; a drift block is refreshed in staging as a `--paths` map or a full map; every other class is mapped in staging; and no outcome writes to the user's checkout**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-11-16
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 21 (5 created, 16 modified), 1013 insertions, 78 deletions

## Accomplishments

- `existingMapOutcome(class, drift)` replaces the blanket `EXISTING_MAP_OUTCOME`: none maps; a stamped-complete map is adopted on a drift pass, refreshed on a block and mapped in full in staging on anything else (including no drift check); stamped-partial and unstamped map in full in staging; unknown-format and user-edited regenerate in isolation. The `adoptionDeferred` finding is gone.
- The workspace stage runs the adapter's `checkDrift` in staging, once, for a stamped-complete map. Only a clean GSD answer is a `pass`: a skipped verdict, an exit 69 (an unresolvable stamp) or a failed run is `unreadable`. The real gsd-core is used in the integration tests, so a stale map (new directories) really blocks and a forged stamp really is unreadable.
- `chooseMappingMode` no longer returns `unsupported` for `adopt` and `paths`: adopt takes the map (completeness from the seven files present), paths maps the directories of a contract read scope narrower than the repository, and a drift block maps GSD's affected paths (`refreshScope`: plain paths, no manifest at any depth, at most the drift threshold of top-level entries, default 3, passed in) or the whole repository.
- The map stage invokes nothing for `adopt` (and reserves no budget); for `paths` it runs `/gsd-map-codebase --paths a,b` with the list validated again where it enters the prompt. AVARICE stamps a `paths` map as it does a full one.
- Validation accepts an adopted map's own stamp (every file must carry one, equality with the staging HEAD is not asked); the project record carries `mapping.provenance: "adopted"` and an adopted map's completeness comes from the files present (finding `project-record.ts:198`). The record's `existingState` carries the final outcome and drift verdict.
- `files.delete` is `[".planning/codebase/**"]` for the Refresh answer when a map exists, else empty.
- Preflight lists `existingState.userOwned`: the map files edited after their stamp commit and every changed file under `.planning/` for an edited map, every file of a map of another format. `repo add` prints it.
- The GSD adapter declares `map-paths` and `adopt-map` true (the `adopt-map` key is the one `onboarding.map.adopt` has required since plan 04-06 and no adapter declared); `ingest-docs` stays false.

## Task Commits

1. **Task 1 (tracer): a committed, stamped, drift-free GSD map is adopted** (RED `RED_EVIDENCE_OK`, failed on the planned assertion: one mapper invocation ran where none was expected)
   - `3ecd9b4` test: fixture, tracer, `04-10-red-task1.json`
   - `d73b51f` feat: outcome rule, drift in staging, adopt and paths modes, validation, record provenance, adapter capabilities
2. **Task 2: paths mode, refresh with files.delete, the drift-block route** (RED `RED_EVIDENCE_OK`, 2 of 25 failing: the files.delete cases)
   - `cd46dcc` test: `filesDeleteFor` cases (skeleton), decision-table cases, `04-10-red-task2.json`
   - `3e68e5d` feat: `filesDeleteFor`, `refreshScope` over the affected paths GSD reports, drift-block integration cases
3. **Task 3: user-owned files survive (S-28, S-29)**
   - `4f50aab` test: outcome table, `userOwnedPaths`, S-28, unknown-format, partial and unstamped, T-04-26, S-29 at two kill points

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

Every TDD task has a `test(04-10)` commit before its `feat(04-10)` commit.

- Task 1 RED: the tracer ran against the real gsd-core and the production composition and failed on `mapCalls.length` (0 expected, 1 actual); no import, syntax or fixture fault.
- Task 2 RED: only the two `filesDeleteFor` cases fail, against a skeleton returning `[]`. The path-scoped pieces of this task (`chooseMappingMode` over a read scope, `refreshScope`, the `--paths` prompt, `map-paths: true`) were written with the Task 1 commit, because the adopt slice needed `chooseMappingMode` to stop refusing and the map stage to branch on the mode; their tests pass on the first run and are guards, not drivers. The `refreshScope` change that accepts a top-level directory name without a slash (what GSD really reports) was made after the RED commit and is in the Task 2 feat commit.
- Task 3 has no RED record (the plan lists none): its behavior was in the Task 1 and 2 commits. Mutation checks stand in: making an unreadable or missing drift adopt fails 4 unit cases and the forged-stamp case; emptying `userOwned` fails 2 unit and 2 integration cases.

Tracer gate: the tracer `<verify>` passed on the proven slice and the preflight, gsd-configure, completeness, extra-map-files, checkout-unchanged suites stayed green before expansion.

## Decisions needing owner review

The plan left these semantics open; each is small to change.

1. **Preflight cannot record the final outcome.** `preflight_json` is written before staging exists and is immutable, so it cannot hold GSD's drift verdict. `existingState` holds `codebaseMap`, `outcome` as `existingMapOutcome(class, null)` (so `full-in-staging` for a complete stamped map, not `adopt`), `drift: null` and `userOwned`; the real outcome and drift result are in the `mapping:plan` step and in the project record's `existingState`. The plan's behavior line "preflight_json existingState holds ... outcome adopt, drift pass" is therefore met by the record, not by `preflight_json`. A mutable preflight would need a new ledger write.
2. **Unreadable drift never fails an onboarding.** Skipped, exit 69 and any adapter error (a timeout, a failed spawn) all become `unreadable`, which maps in full in staging. The alternative, failing the onboarding on a drift error, was not chosen.
3. **files.delete** is the map directory when the answer is Refresh and a map exists. The preset's answer is always Refresh (the mapper is always asked to answer Refresh, even for an empty `.planning/codebase`), so "exactly when the answer is Refresh" read literally puts the glob in every contract, including a repository with no map. The contract describes staging; the user's checkout is never written.
4. **Path-scoped refresh policy** (the plan defers the threshold rule to 04-14): GSD's affected paths are used as the scope when each is a plain path, none has a manifest basename (package.json, lockfiles, Cargo.toml, go.mod, pyproject.toml, pom.xml and others, at any depth), there are at most 50, and they span at most `threshold` top-level entries (GSD's reported threshold, default 3). A root-level file that is not a manifest is allowed because GSD reports new directories as bare names and a bare name cannot be told from a root file. Completeness of a `paths` map is `partial` with the scope list; the decision table says "previous completeness kept" for a drift refresh, which this does not do.
5. **Explicit requests.** `--mode` offers only full and fast, so `adopt` and `paths` arrive from the outcome and the contract read scope, not from the CLI. A requested `adopt` for a map that is not adoptable is `unsupported` (reduced mode `full`); a requested `paths` over the whole-repository read scope is `invalid`. The contract's `files.read` is `["**"]` today, so a read-scope `paths` map cannot occur yet.
6. **Adopted map validation.** The stamp check for `adopt` only asks that every file carry a stamp; for every other mode it still asks for equality with the staging HEAD. An adopted map that fails the path-reference check (stale paths) goes to retry-or-block and ends `blocked` for a decision; it does not fall back to a full map.
7. **Provenance** is `mapping.provenance: "adopted"` on the record, present only when the map was adopted, with `mode: "adopt"`. The documentation says "mode `unknown`" for an adopted map; the code states the mode `adopt`.
8. **userOwned** for an edited map is the files edited after their stamp commit plus every changed file under `.planning/`; for a map of another format it is every file of that map.
9. `onboarding.map.adopt` is satisfied by declaring `adopt-map: true` on the GSD adapter, as asked. Adoption is not a GSD workflow, so the capability describes what AVARICE does with a map GSD vouches for; say if it should live on a different descriptor.

## Files Created/Modified

- `src/domain/preflight.ts` - `existingMapOutcome`, `userOwnedPaths`, the new `existingState` findings
- `src/domain/mapping.ts` - adopt and paths decisions, `refreshScope`, `readScopePaths`, `isScopePath`, `DEFAULT_DRIFT_THRESHOLD`
- `src/domain/onboarding-contract.ts` - `filesDeleteFor` and its use
- `src/domain/validation.ts`, `src/domain/project-record.ts` - the adopted stamp rule; provenance and completeness from the files present
- `src/app/stages/workspace.ts` - drift in staging, outcome, the plan record; `map.ts` - no invocation for adopt, `--paths`; `shared.ts`, `validate.ts`, `activate.ts` - plan paths and outcome carried through
- `src/adapters/gsd/gsd-onboarding.ts` - `map-paths` and `adopt-map` true
- `src/cli/commands/repo.ts` - the outcome note and the `userOwned` line replace "adoption deferred"
- Tests: `test/integration/onboard-adopt.test.ts` (10 cases), `test/unit/onboarding-contract-delete.test.ts`, the preflight, mapping and capability-requirements unit tests, `test/helpers/stamped-map-fixture.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] An adopted map's completeness ignored the files present**
- **Found during:** Task 1
- **Issue:** `buildProjectRecord` called `completenessFor(mode)` without files, so an adopted seven-file map would be labelled `partial` (the open finding at `project-record.ts:198`).
- **Fix:** the codebase paths are passed to `completenessFor`.
- **Files modified:** src/domain/project-record.ts
- **Committed in:** d73b51f

**2. [Rule 3 - Blocking] Validation refused an adopted map**
- **Found during:** Task 1
- **Issue:** the stamp check requires `last_mapped_commit` to equal the staging HEAD, which an existing map cannot satisfy (its stamp is the commit it was mapped at).
- **Fix:** for `adopt` every file must carry a stamp; the freshness evidence is GSD's drift pass in staging (decision 6).
- **Files modified:** src/domain/validation.ts
- **Committed in:** d73b51f

**3. [Rule 3 - Blocking] Paths and adopt needed the plan carried to validation, activation and the stamp step**
- **Found during:** Task 1
- **Fix:** `mapping:plan` carries `outcome`, `drift` and `paths`; `effectiveMappingPlan` hands the scope to validation; `paths` joins the modes AVARICE stamps; activation overlays the outcome and drift on the record's `existingState`.
- **Files modified:** src/app/stages/shared.ts, validate.ts, activate.ts, map.ts
- **Committed in:** d73b51f

**4. [Rule 1 - Bug] The first `refreshScope` required a slash in every path**
- **Found during:** Task 2, probing the real gsd-core
- **Issue:** GSD names new directories as bare names (`alpha`, `beta`), so the draft sent every real block to a full map.
- **Fix:** a bare name is allowed; the manifest, plain-path and top-level-count rules stay.
- **Files modified:** src/domain/mapping.ts
- **Committed in:** 3e68e5d

**5. [Rule 3 - Blocking] Existing tests encoded the deferred behavior**
- **Fix:** the `EXISTING_MAP_OUTCOME` and `adoptionDeferred` expectations in the preflight unit and integration tests, the "unsupported for paths and adopt (Phase 4)" cases in the mapping tests, and the "map-paths is false" case in the capability tests were rewritten for the new behavior.
- **Files modified:** test/unit/preflight.test.ts, test/integration/preflight.test.ts, test/unit/mapping.test.ts, test/unit/capability-requirements.test.ts
- **Committed in:** d73b51f

**6. [Rule 2 - Missing critical] The `--paths` value is validated twice**
- **Found during:** Task 2 (threat T-04-27)
- **Fix:** `isScopePath` where the scope is chosen and again in the map stage where it enters the prompt, because the stored plan is ledger data.
- **Files modified:** src/domain/mapping.ts, src/app/stages/map.ts
- **Committed in:** d73b51f

**7. [Process] Commit-time branch check**
- The pre-commit branch assertion's `agent-*` allow-list was not applied: this run was dispatched by the orchestrator to the phase branch `worktree-phase-04`, which is the branch every earlier plan of the phase committed on. HEAD was a named, non-protected branch for every commit.

---

**Total deviations:** 6 auto-fixed (2 bugs, 3 blocking, 1 missing critical) and 1 process note. **Impact on plan:** no change of scope; item 2 changes one validation rule for one mode.

## Issues Encountered

- `docs/system/` documents the old behavior in several places (listed below); the phase's documentation plans update them, as for plan 04-06.

## Documentation surfaces (for plans 04-38 and 04-39)

- Outcome per class: none maps; stamped-complete adopt (drift pass) / refresh (drift block) / full-in-staging (unreadable or no check); stamped-partial and unstamped full-in-staging; unknown-format and user-edited isolated regeneration. Drift is GSD's own `verify codebase-drift` run in staging, only for stamped-complete; only a clean pass adopts.
- Mapping modes `adopt` (no mapper, no budget, provenance `adopted`, completeness from the seven files present, own stamp accepted) and `paths` (`/gsd-map-codebase --paths a,b`, completeness `partial`, scope list recorded, AVARICE stamps it). The decision order and the refresh scope rule (decision 4). `--mode` still accepts only full and fast.
- Preflight keys: `existingState.{planningExists, codebaseMap, outcome, drift, userOwned}`; `adoptionDeferred` removed; `outcome` in preflight is the no-drift-verdict outcome and `drift` is null; `mapping:plan` step keys `mode, completeness, existingMap, outcome, drift{verdict, affectedPaths, threshold, reason}, paths, existingMapAnswer`; record `existingState.outcome` and `.drift` (the verdict string) and `mapping.provenance`.
- `files.delete` rule; `userOwned` rule; GSD adapter capabilities `map-paths` and `adopt-map` true; `repo add` output lines.
- Closed findings (docs/system/findings.md, lines 45, 46, 47 and the `project-record.ts:198` completeness line): `onboarding-contract.ts:128`, `preflight.ts:50`, `mapping.ts:56`, `project-record.ts:198`.
- Stale text in docs/system to update: `onboarding.md` (lines 75 "The class never changes the outcome", 125 and 128 on adopt and paths blocking, 225), `cli-reference.md:132` (adoption note), `data-model.md:304` (completeness derived from the mode alone), `integrations.md` (GSD capability list).
- New finding candidates for `findings.md`: `docs/repository-onboarding.md` says adopted provenance has mode `unknown`, the record says `adopt`; the drift-refresh row says "previous completeness kept", the code records `partial`; the contract `files.read` is always `["**"]`, so the contract-scope `paths` row cannot occur.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-25 (user edits overwritten) is mitigated: every regeneration is in staging, the checkout digest is compared in every integration case, and `userOwned` is recorded. T-04-26 (forged stamp) is mitigated: adoption needs GSD's drift pass in staging, tested with a stamp that names no commit. T-04-27 (`--paths` injection) is mitigated: `isScopePath`, one comma-separated value, validated twice, tested with commas, spaces, dashes, `..`, absolute paths and shell metacharacters. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-14 can replace the drift threshold parameter's default; plan 04-21 (promotion) reads `userOwned` and the `adopted` provenance to know which files it may copy. Plans 04-38 and 04-39 document the surfaces above.

## Self-Check: PASSED

- Files present: the five created files and the sixteen modified files
- Commits present on this branch: 3ecd9b4, d73b51f, cd46dcc, 3e68e5d, 4f50aab
- Acceptance: both RED records classify `RED_EVIDENCE_OK` with non-zero exit codes; `grep -n "EXISTING_MAP_OUTCOME\|adoptionDeferred" src/domain/preflight.ts` prints nothing; `grep -n "'map-paths': true" src/adapters/gsd/gsd-onboarding.ts` prints one line; the S-29 cases compare `checkoutSnapshot` (HEAD, branch, status and tree digest) before onboarding and after resume; the S-28 case asserts the edited files in `userOwned`
- Plan verification: `node --test test/unit/preflight.test.ts test/unit/mapping.test.ts test/integration/onboard-adopt.test.ts` green; `npm run typecheck` clean; `npm run check:boundaries` ok (107 files); full unit suite 2538 of 2538 before the last test additions, the three unit files above green after; integration and fault suites green: killpoints, full-map-resume-stamp, gsd-configure, preflight, completeness, extra-map-files, checkout-unchanged, index-stage, intel-step, knowledge-pass, ledger-status, init, gsd-adapter, context, context-handle-first, run-start, cli-terminal-text, exit-parity, and the mutation suites (313 cases). The full `npm test` was not run.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
