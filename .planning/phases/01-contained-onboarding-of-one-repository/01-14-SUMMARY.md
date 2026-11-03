---
phase: 01-contained-onboarding-of-one-repository
plan: 14
subsystem: index-stage-and-code-graph
tags: [index-registry, code-graph, graphify, project-record, containment, resume, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-10 validation write sets (writeSetsFor, AVARICE_WRITE_SET), complete project record, containment.finding event; 01-13 SandboxedExecutor, GraphTool port and GraphifyTool (extractCode, cluster, readGraph, install), runGsd through the executor; 01-06 kill points and stage checkpoints"
provides:
  - "INDEX_STEPS registry (code-graph, intel, knowledge) with `IndexStep { name, run(deps, ctx) }`, `IndexStepContext { stage, row, staging, head, contract }`, `indexStepKey`, `loadIndexResults`; the stage loop and activation know only the registry"
  - "index-stage: checkpoint `index:{name}` before each step, stored result `index:{name}` after, resume skips a stored step, a step that errors or throws becomes an absent index (`step-error`), `index.absent` event for every absent index"
  - "IndexStepResult (`present` | `absent` | `disabled`), foldIndexResults, record fields indexes.graph, indexes.intel, indexes.absent; knowledge present folds into indexes.graph.digest and indexes.graph.knowledge, so 01-17 and 01-18 never edit activate.ts"
  - "code-graph step: extract and cluster in {workRoot}/{onb}/graph-build/code, validate, install graph.json, code-graph.json, GRAPH_REPORT.md into staging .planning/graphs, GSD snapshot, GSD status must be present and not stale; builtAtCommit is git: plus the staging HEAD"
  - "validateCodeGraph(graph, stagingHead) and summarizeGraph(graph) in src/domain/graph-validation.ts"
  - "GsdOnboarding.graphifySnapshot (writes only .planning/graphs) and graphifyStatus (read-only), GsdGraphSnapshot and GsdGraphStatus"
  - "Final scope check before activation: the whole staging diff against every agent and AVARICE write set; a stray write is a containment.finding (check activation-scope) and the onboarding blocks with enforcement_failure"
  - "Counted fault points `name#N` in faultPoint; kill points for index:code-graph, index:code-graph#2, index:intel, index:knowledge; planning_ready now names `index:code-graph` as its first action"
  - "status prints absent indexes: `graph absent (graphify-missing)`"
affects: [01-15, 01-17, 01-18, 01-19]

actuals:
  tokens: 21400
  tasks: 2
  commits: 4
plan_head_before: a9f7b820ddaa51d95d057f80bf214bf39e62c80a
plan_head_after: 8cb06c3da9082edf7324e56482ada5cf57dbceb6

tech-stack:
  added: []
  patterns:
    - "An index step reports a missing or failed index as `absent` with a reason, never as an error; the stage turns even an error or a throw into absent (ONB-13). Only ledger failures of the stage itself propagate"
    - "Activation folds stored step results (foldIndexResults) instead of knowing each index, so a plan fills a step without touching the stage loop or activate.ts"
    - "The final scope check reuses the validation rule (scopeViolationsOf) over the same write sets, plus AVARICE_TRACKED_WRITABLE for files AVARICE itself regenerates"
    - "Fault points that fire in two places (a transition and a stage commit the same checkpoint) are told apart with the counted form name#N"

key-files:
  created:
    - src/app/stages/index-steps.ts
    - src/app/stages/index-code-graph.ts
    - src/app/stages/index-intel.ts
    - src/app/stages/index-knowledge.ts
    - src/domain/graph-validation.ts
    - test/unit/graph-validation.test.ts
    - test/integration/index-stage.test.ts
    - test/helpers/fake-graphify.ts
  modified:
    - src/app/stages/index-stage.ts
    - src/app/stages/activate.ts
    - src/app/stages/validate.ts
    - src/app/onboarding-service.ts
    - src/app/status.ts
    - src/domain/project-record.ts
    - src/domain/validation.ts
    - src/ports/gsd-onboarding.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - src/adapters/graph/graphify.ts
    - test/unit/record.test.ts
    - test/integration/skeleton.test.ts
    - test/fault/killpoints.test.ts
    - test/helpers/fault-run.ts
    - test/helpers/scratch-repo.ts
    - test/integration/gsd-configure.test.ts

key-decisions:
  - "An activation scope violation blocks the onboarding with reason enforcement_failure (a write escaped the declared sets) after a containment.finding event; no artifact is stored and no record is built. The plan said only that activation fails"
  - "Index step names in the ledger are `index:code-graph`, `index:intel`, `index:knowledge`; the record calls the code graph `graph`. A disabled step (contract flag off) is stored as `disabled` and the record says nothing about it; it is not listed as absent"
  - "Failure reasons: locate, extract, cluster or install failures are `extract-failed` (a missing binary is `graphify-missing`, an executor timeout anywhere is `timeout`); graph.json that fails validation is `invalid-graph`; GSD snapshot or status failing, or GSD reporting the graph missing, disabled or stale, is `stale-after-install`"
  - "The record's graph digest is the sha256 of graph.json as installed in staging (read back through the staging port), so a later reader can verify the file. `nodes` always lists `document: 0` next to the counts by file_type; `edges` counts by confidence"
  - "The check before activation allows a tracked `.planning/graphs/**` file to change (AVARICE_TRACKED_WRITABLE): a repository that committed a GSD graph gets it regenerated in staging instead of being blocked. Map validation still refuses that change from an invocation"
  - "extractCode clears {outDir}/graphify-out before it runs, so a build cut short by a kill and resumed starts clean"

patterns-established:
  - "Filling an index step: replace the body of runIntelStep or runKnowledgeStep and return `{ index, status: 'present', result }`; add nothing to index-stage.ts or activate.ts"
  - "Testing a stage that calls an external tool: a fake executable written by test/helpers/fake-graphify.ts for every failure mode, the real tool in one skippable test, the real GSD verbs in both"

requirements-completed: [ONB-13, ONB-3, NFR-2]

coverage:
  - id: D1
    description: "The index stage runs code-graph, intel, knowledge in order with checkpoint index:{name} before each and a stored result after; a resumed onboarding does not re-run a step with a stored result"
    requirement: ONB-13
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#runs code-graph, intel and knowledge in order, one stored result each; #walks discovered, ... with one event per checkpoint"
        status: pass
      - kind: integration
        ref: "test/fault/killpoints.test.ts#index steps resume from their stored results; #kill, then resume (index:code-graph, index:code-graph#2, index:intel, index:knowledge)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The code-graph step builds outside staging, validates, installs the three files, runs the GSD snapshot and requires status present and not stale; the record lists indexes.graph with path, digest of the installed file, builtAtCommit git:HEAD, tool graphify@version, freshness fresh and node counts with zero document nodes"
    requirement: ONB-13
    verification:
      - kind: integration
        ref: "test/integration/index-stage.test.ts#the code-graph step with a graphify that works (fake graphify, real GSD verbs)"
        status: pass
      - kind: integration
        ref: "test/integration/index-stage.test.ts#with the real graphify on a scratch repository"
        status: pass
    human_judgment: false
  - id: D3
    description: "Missing, failing, invalid, document-bearing, wrong-commit, timing-out or GSD-stale graphify leaves the index absent with the right reason, installs nothing, and the onboarding still activates; status prints `graph absent (graphify-missing)`"
    requirement: ONB-13
    verification:
      - kind: integration
        ref: "test/integration/index-stage.test.ts#a graphify that is missing or fails never blocks activation (S-40, ONB-13)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Before activation the whole staging diff is re-checked against every agent and AVARICE write set: an added, modified or deleted path outside them (including one written by an index step) blocks with a containment.finding and no record; paths under .planning/graphs, .planning/config.json, graphify-out and .avarice-knowledge pass"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/integration/skeleton.test.ts#activation re-checks the whole staging diff against every write set"
        status: pass
      - kind: integration
        ref: "test/integration/index-stage.test.ts#the final scope check covers writes by an index step (T-01-67)"
        status: pass
    human_judgment: false
  - id: D5
    description: "validateCodeGraph rejects non-objects, missing nodes or links, a build commit that is missing, not 40 hex or not the staging HEAD, document nodes and non-object entries; summarizeGraph counts by file_type and confidence"
    requirement: ONB-13
    verification:
      - kind: unit
        ref: "test/unit/graph-validation.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "foldIndexResults and buildProjectRecord state graph, intel and absent exactly as the stored results say; knowledge present replaces the graph digest, malformed results count as absent"
    requirement: ONB-13
    verification:
      - kind: unit
        ref: "test/unit/record.test.ts#foldIndexResults; #buildProjectRecord: indexes"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every command AVARICE runs for the graph (graphify extract and cluster-only, GSD graphify build snapshot and status) goes through the sandboxed executor with only the write path it needs; the offline suite and the full suite still pass with the network denied"
    requirement: NFR-2
    verification:
      - kind: integration
        ref: "test/integration/index-stage.test.ts#runs every command through the executor, in order; test/integration/offline.test.ts; npm test 739 of 739"
        status: pass
    human_judgment: false

duration: 22 min
completed: 2026-11-03
---

# Phase 01 Plan 14: Index Step Registry, Code-Only Graph and the Final Scope Check Summary

**The index stage now runs an ordered, resumable registry whose first real step builds a validated code-only graph outside staging, installs it with GSD's snapshot, and records it with its build commit; any missing or failing index is recorded absent and never blocks, and activation re-checks the whole staging diff against every write set.**

## Performance

- **Duration:** about 22 min (2026-11-03T00:39Z to 01:01Z)
- **Tasks:** 2 of 2, both TDD (RED then GREEN, no REFACTOR commit)
- **Files:** 8 created and 16 modified under src and test (27 files in the plan's four commits, including 3 RED evidence records)

## Accomplishments

- Registry: `INDEX_STEPS` runs `code-graph`, `intel`, `knowledge`. The stage commits `index:{name}` before each step and stores `index:{name}` after it; a killed onboarding resumes at the first step without a stored result (tested by killing after the intel checkpoint and counting `index.absent` events). Intel and knowledge return `absent` (`not-built-in-this-build`), or `disabled` when the contract flag is off.
- Code graph (ONB-13, S-39 code part): extract and cluster in `{workRoot}/{onb}/graph-build/code`, read back and validate (shape, a full build commit equal to the staging HEAD, no document node), install three files into staging `.planning/graphs/`, run `gsd_run graphify build snapshot` (write path `.planning/graphs` only), and require `gsd_run graphify status` to report it present and not stale. Verified against a fake graphify (all failure modes) and the real graphify 0.9.53 with the real GSD verbs.
- Record: `indexes.graph` carries path, codeGraphPath, the sha256 of the installed file, `builtAtCommit` `git:` plus the staging HEAD (equal to `revisions.onboardedAt`), `graphify@0.9.53`, freshness `fresh`, node counts by file type with `document: 0` and edge counts by confidence; the ledger's `graph_commit` follows. `indexes.absent` lists every index that was not built, with its reason, and `status` prints it.
- Never blocks (S-40): a missing binary (`graphify-missing`), a failed extract or cluster (`extract-failed`), an invalid graph (`invalid-graph`), a run past the executor timeout (`timeout`) and a graph GSD reports stale (`stale-after-install`) each leave an absent index and an active project.
- Final scope check (T-01-67): activation re-reads the staging diff and judges it with the same rule as validation over the union of the write sets of every invocation that ran and AVARICE's own. An added, modified or deleted path outside it, including a file an index step wrote while installing, emits `containment.finding` (check `activation-scope`) and blocks with `enforcement_failure`; nothing is stored for the map.

## Task Commits

1. **Task 1** (TDD): RED `fbdb9cb` test(01-14) (record unit file 31 tests, 8 fail; skeleton 20 of 54 failures across the two files; killpoints 6 fail; `RED_EVIDENCE_OK`, record `01-14-red-evidence-task1.json`); GREEN `04c5449` feat(01-14) (full suite 704 of 704 before the counted-point test, 705 after)
2. **Task 2** (TDD): RED `97e53f8` test(01-14) (graph-validation 13 tests, 10 fail; index-stage 19 tests, all but the guards fail; `RED_EVIDENCE_OK` for both, records `01-14-red-evidence-task2-unit.json` and `01-14-red-evidence-task2.json`); GREEN `8cb06c3` feat(01-14) (full suite 739 of 739)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN in order for both tasks; no REFACTOR. RED used stubs (a fold returning `{}`, a validator accepting everything, a placeholder code-graph step, GSD graphify methods returning internal errors), so each failure is an assertion on planned behaviour; the onboardings in RED still reached `active`, so the index-stage failures are on the record, the installed files, the executor calls and the events, not on a crash. Tests that passed on arrival are guards (empty fold, empty summary, an unchanged flow).

Mutation checks, each restored from a saved copy and all killed: scope check that never blocks (5 failures), resume that re-runs stored steps (1), counted fault point firing on the first hit (1, after adding a test that tells the first and second checkpoint rows apart; the first version of the kill-point test could not distinguish them and the mutant survived), no stale check on the GSD status (1), validation skipped (3), document nodes accepted (3), snapshot allowed to write all of `.planning` (1), build commit not the HEAD (3), timeout mapped to `extract-failed` (1), previous `graphify-out` not cleared (1).

## Decisions Made

See `key-decisions`. For later plans:

- **01-17 (intel):** replace the body of `runIntelStep` in `src/app/stages/index-intel.ts`. Run the host invocation as step `launch:intel` (its write set then enters the final scope check automatically) and return `{ index: 'intel', status: 'present', result: { path, digest, refreshedAtCommit, freshness, files } }`; a failure is `{ status: 'absent', reason }`. Do not edit `index-stage.ts` or `activate.ts`. `IndexStepContext.stage` gives the checkpoint, note and transition helpers.
- **01-18 (knowledge):** replace `runKnowledgeStep`; present result is `{ graphDigest, knowledge: { corpus, documentsCommit, documentNodes } }`. Activation folds it into `indexes.graph.digest` and `indexes.graph.knowledge`; without a present code graph it records `knowledge` absent with `graph-absent`. The code graph is already installed in staging when this step runs (`.planning/graphs/graph.json`, `code-graph.json`); `GraphTool` gains the merge methods there.
- **01-15 / 01-19:** the kill-point catalog now has the four index points; the `#2` form is available for any checkpoint that two places commit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `planning_ready` named `activate` as its first action, so the registry could not be the first thing the stage checkpoints**
- **Found during:** Task 1 design (SKELETON.md "Kill points" lists `index:code-graph` first; lifecycle NEXT_ACTIONS already did)
- **Fix:** the validation transition now commits `index:code-graph`. The skeleton test's expected checkpoint sequence changed accordingly (`index:code-graph` twice, `index:intel`, `index:knowledge`, `activate`, `none`); the killpoints table changed for `after-transition:planning_ready`.
- **Files modified:** src/app/stages/validate.ts, test/integration/skeleton.test.ts, test/fault/killpoints.test.ts
- **Committed in:** 04c5449

**2. [Rule 3 - Blocking] The checkpoint `index:code-graph` is committed twice (by the transition and by the stage), so one fault point could not reach the gap before the step runs**
- **Fix:** `faultPoint` accepts `name#N` (the Nth time the point is reached in this process); `after-checkpoint:index:code-graph#2` is the stage's own checkpoint. `onboarding-service.ts` is not in the plan's file list.
- **Files modified:** src/app/onboarding-service.ts, test/helpers/fault-run.ts, test/fault/killpoints.test.ts
- **Committed in:** 04c5449

**3. [Rule 2 - Missing critical] A repository that committed a GSD graph would have been blocked at activation**
- **Found during:** Task 1 (the final check applies the validation rule, which refuses a tracked change under `.planning/graphs/**`)
- **Fix:** `AVARICE_TRACKED_WRITABLE = ['.planning/graphs/**']` is added to the tracked-writable set at the check before activation only; the map validation still refuses it from an invocation. `scopeViolationsOf` was extracted from `validateMapArtifacts` so both checks judge a diff the same way (no behaviour change there).
- **Files modified:** src/domain/validation.ts, src/app/stages/activate.ts
- **Committed in:** 04c5449

**4. [Rule 2 - Missing critical] A resumed build could reuse a killed build's output**
- **Fix:** `GraphifyTool.extractCode` removes `{outDir}/graphify-out` before extracting (outDir is already checked to be outside staging); tested with a left-over file.
- **Files modified:** src/adapters/graph/graphify.ts, test/integration/index-stage.test.ts
- **Committed in:** 8cb06c3

**5. [Rule 3 - Blocking] Two existing tests assumed no GSD call after the host and an equal staging tree across runs**
- `gsd-configure.test.ts` asserted that every GSD call precedes the host; the index stage now runs `graphify build snapshot` and `graphify status` after it. The assertion now allows only `graphify` verbs after the host and checks they run in staging.
- `killpoints.test.ts` compares the staging tree digest across runs; GSD's `.last-build-snapshot.json` carries a timestamp. `treeDigest` gained an optional skip predicate; the snapshot is compared on its own without its timestamp. The record itself (including the graph digest) is equal across profiles and across kill-and-resume.
- **Files modified:** test/integration/gsd-configure.test.ts, test/fault/killpoints.test.ts, test/helpers/scratch-repo.ts
- **Committed in:** 8cb06c3

**6. Smaller departures**
- `IndexStepResult` is a loose interface (`index`, `status`, `reason?`, `detail?`, `result?`) with a third status `disabled`; the plan named two statuses and a separate `disabled` return for the contract flag.
- The stage stores any step `err` or thrown exception as an absent index with reason `step-error` and the error text in the event only.
- Not in the plan's file list: `src/app/status.ts` (prints absent indexes, keeps `indexes: graph, intel` when nothing is absent), `test/helpers/fake-graphify.ts` (a fake graphify executable), `test/helpers/fault-run.ts`, `test/helpers/scratch-repo.ts`, `test/integration/gsd-configure.test.ts`.
- The plan's Task 1 action says `index-code-graph.ts` comes from Task 2; Task 1's GREEN commit carried a placeholder step (reason `not-built-yet`) that Task 2 replaced.

---

**Total deviations:** 5 auto-fixed (1 Rule 2 twice over, 3 Rule 3) plus the smaller departures. **Impact:** all needed to keep the existing kill-point, GSD-order and reproducibility tests meaningful and to avoid blocking repositories that already commit a graph; no scope creep.

## Issues Encountered

- With the real graphify now in every onboarding, the suite grew from 678 to 739 tests and about 53 s to about 72 s of wall time (the kill-point file takes about 44 s on its own).
- A first version of the counted-point test passed against a mutant (the plain and the `#2` points leave the same state); a test on the number of `index:code-graph` checkpoint rows was added.

## Authentication Gates

None.

## Known Stubs

- `src/app/stages/index-intel.ts` and `src/app/stages/index-knowledge.ts` report the index absent (`not-built-in-this-build`). Intentional per the plan: 01-17 builds intel and 01-18 the knowledge pass. Neither stub prevents this plan's goal (a code graph at the onboarded revision). Recorded in `.planning/WINDOWS.md` as `stub` entries for phase 01.

## Threat Flags

None new. T-01-38 mitigated (graph shape, full build commit equal to the staging HEAD and absence of document nodes are checked before install; the digest of the installed file is recorded; the graph is data only). T-01-39 accepted as planned (300 s extract budget; a failure records the index absent). T-01-67 mitigated (whole staging diff re-checked before activation; `containment.finding` and no record). T-01-SC: no installs.

Limits: a graph that was installed and then judged stale by GSD (`stale-after-install`) is recorded absent but its files stay in the staging `.planning/graphs/` (inside the AVARICE write set, never promoted). The stale path was exercised by wrapping the GSD status result, because a real fresh install cannot be made stale in a test. `docs/repository-onboarding.md` still describes the graph build as `graphify update .`; the code uses `graphify extract --code-only` (01-13, research Pitfall 3), so that doc row is out of date. All checks used temp roots, scratch repositories and the locally installed graphify; the user's profile locations and real repositories were not touched.

## User Setup Required

None - no external service configuration required. graphify is optional: without it the graph is recorded absent.

## Next Phase Readiness

- `npm test` (739), `npx tsc -p .` and `node scripts/check-boundaries.ts` (44 files) are green; the index-stage, skeleton, kill-point, offline and GSD-configure files also pass with graphify off the PATH.
- 01-17 and 01-18 can fill their steps without editing the stage loop or activation; the contract for each is in Decisions Made.

## Self-Check: PASSED

- Created files present: src/app/stages/{index-steps,index-code-graph,index-intel,index-knowledge}.ts, src/domain/graph-validation.ts, test/unit/graph-validation.test.ts, test/integration/index-stage.test.ts, test/helpers/fake-graphify.ts.
- Commits fbdb9cb, 04c5449, 97e53f8, 8cb06c3 are ancestors of HEAD; `git rev-list --count a9f7b82..HEAD` = 4.
- Acceptance criteria re-run: `grep -c INDEX_STEPS src/app/stages/index-stage.ts` = 3; `grep -c not-built-in-this-build` = 1 in index-intel.ts and 1 in index-knowledge.ts; `grep -c containment.finding src/app/stages/activate.ts` = 2; `grep -c graphify-missing src/app/stages/index-code-graph.ts` = 2; `grep -c graphifySnapshot src/adapters/gsd/gsd-onboarding.ts` = 1; the named test files pass (107 tests across graph-validation, index-stage, skeleton, killpoints, record).
- Plan verification re-run: `tsc -p .` exit 0; boundaries ok (44 files); `npm test` 739 of 739.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-03*
