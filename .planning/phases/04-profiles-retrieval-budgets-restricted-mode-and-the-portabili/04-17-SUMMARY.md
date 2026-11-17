---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 17
subsystem: onboarding
tags: [onboarding, refresh, incremental, code-graph, knowledge, graphify, onb-11, onb-15, d-11, s-47, typescript]

requires:
  - phase: 04
    provides: "plan 04-14: the refresh planner and mapping:plan.refresh (mode incremental with changedPaths)"
  - phase: 04
    provides: "plan 04-02, spike S4-B: node IDs are stable only with normalization; a path-subset extraction loses edges that leave the subset; whole-tree extraction is deterministic"
provides:
  - "mergeChangedPaths, retainedKnowledge (src/domain/graph-merge.ts)"
  - "changedDocuments, KNOWLEDGE_PLANNING_GLOBS, readGlobs on selectKnowledgeCorpus (src/domain/knowledge-corpus.ts)"
  - "subsetPlan (src/domain/knowledge-extraction.ts)"
  - "incrementalRefreshOf, previousIndexesOf (src/app/refresh.ts)"
  - "index:code-graph result.refresh and index:knowledge result.refresh; knowledge.manifestDigest in the record"
affects: [04-21, 04-37, 04-38, 04-39]

actuals:
  tokens: 100000
  tasks: 3
  commits: 4
plan_head_before: 404acb1ce5344ad533d01791ad09bff84775fc1a
plan_head_after: b69f3b26dad10898c5bf54362de0831c4902b3d7
commits: 4

tech-stack:
  added: []
  patterns:
    - "An incremental code graph is the whole-tree extraction applied against the previous graph: the node-level diff is the evidence the change stays inside the changed paths"
    - "A knowledge refresh keys cache hits on the content digest of the earlier corpus manifest, and keeps the earlier pass's nodes through retainedKnowledge so one skill graph still goes through the existing merge and per-document validation"
    - "Interrupted work is salvaged from the chunk files of the previous attempt of the same onboarding, matched by revision and the documents a chunk covers"

key-files:
  created:
    - test/integration/graph-incremental.test.ts
    - test/integration/knowledge-refresh.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-17-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-17-red-task2.json
  modified:
    - src/domain/graph-merge.ts
    - src/domain/knowledge-corpus.ts
    - src/domain/knowledge-extraction.ts
    - src/domain/knowledge-validation.ts
    - src/app/refresh.ts
    - src/app/stages/index-code-graph.ts
    - src/app/stages/index-knowledge.ts
    - test/helpers/stamped-map-fixture.ts
    - test/fixtures/knowledge.ts
    - test/integration/knowledge-pass.test.ts
    - test/unit/graph-merge.test.ts
    - test/unit/knowledge-corpus.test.ts
    - test/unit/knowledge-extraction.test.ts

key-decisions:
  - "Spike S4-B followed: the code graph of an incremental refresh is a whole-tree code-only extraction (the unchanged AVARICE invocation) diffed against the previous graph, not a path-subset extraction merged by node ID. graphify.ts is unchanged and never runs update"
  - "The merged code graph IS the extraction; mergeChangedPaths adds the proof (outside === 0) and the delta (nodes and edges added or removed, boundary edges, nodes kept). The previous graph can never decide what the new graph is, so an unusable previous graph only degrades the report to mode whole"
  - "A refresh's knowledge reuse is keyed on the active record's corpus manifest digest, which the knowledge block of the record now carries (manifestDigest)"
  - "Phase files (.planning/phases/**/*.md) and STATE.md are corpus documents; validation no longer refuses them for the pass's own nodes (the manifest check still does), while a code-graph node citing a planning document stays refused"

patterns-established:
  - "Pure planning functions in domain, ledger and file reads in app/refresh.ts, per the existing boundaries"

requirements-completed: [ONB-11, ONB-15]

coverage:
  - id: D1
    description: "An incremental refresh extracts with extract only (never update) and the installed code graph equals a full rebuild at the same commit; unchanged files' nodes are the previous graph's; no duplicate IDs; the edges that leave the changed file are present and counted"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/graph-incremental.test.ts#extracts with extract only (never update), reports the delta, keeps the other files' nodes and edges, and loses no edge across the boundary"
        status: pass
    human_judgment: false
  - id: D2
    description: "A deleted file's nodes and the edges that ended at them are removed, equal to a full rebuild"
    requirement: ONB-11
    verification:
      - kind: integration
        ref: "test/integration/graph-incremental.test.ts#removes the nodes of a deleted file and the edges that ended at them"
        status: pass
      - kind: unit
        ref: "test/unit/graph-merge.test.ts#mergeChangedPaths"
        status: pass
    human_judgment: false
  - id: D3
    description: "S-47: a changed ADR and a new phase plan are the only documents handed to the model; the rest are cache hits; the new plan is a document node citing its path and revision; a refresh with no changed document runs no invocation"
    requirement: ONB-15
    verification:
      - kind: integration
        ref: "test/integration/knowledge-refresh.test.ts#S-47"
        status: pass
      - kind: integration
        ref: "test/integration/knowledge-refresh.test.ts#a refresh that changes no document runs no knowledge invocation and keeps every document node"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phase files and STATE.md are corpus documents (inside files.read, outside secret globs)"
    requirement: ONB-15
    verification:
      - kind: unit
        ref: "test/unit/knowledge-corpus.test.ts#selectKnowledgeCorpus"
        status: pass
    human_judgment: false
  - id: D5
    description: "An interrupted knowledge refresh resumes with only the document not yet extracted and its merged graph equals an uninterrupted refresh's"
    requirement: ONB-15
    verification:
      - kind: integration
        ref: "test/integration/knowledge-refresh.test.ts#re-extracts only the document not yet extracted, and the merged graph equals an uninterrupted refresh's"
        status: pass
    human_judgment: true
    rationale: "The kill is simulated in process (the host wrote one chunk, then the step result could not be recorded), not a SIGKILL of a supervisor; a real kill with a real host is only proven by a live run"

duration: about 70min of work, across a rate-limit pause
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 17: Incremental index refresh Summary

**An incremental refresh now diffs a whole-tree code extraction against the previous graph (never `graphify update`, no subset merge, per spike S4-B) and runs the knowledge pass for changed documents only, with GSD phase files and STATE.md as corpus documents and an interrupted refresh resuming with just the chunks it had not written**

## Performance

- **Tasks:** 3 (one tracer, two auto; task 3's case is in the task 2 commit)
- **Files modified:** 17 (4 created, 13 modified), 1397 insertions, 86 deletions

## Accomplishments

- `mergeChangedPaths({ previous, extracted, changedPaths, deletedPaths })` returns the extraction and a delta: nodes and edges added and removed, boundary edges (touching a changed file with an end outside it, exactly what a subset extraction loses), nodes kept, and `outside`, the differences that lie outside the changed paths. `community` and `community_name` are treated as derived.
- The code-graph step of an incremental refresh reads the previous code graph from the active record's staging tree, validates it as any code graph, finds deleted paths with `fileSizes`, and records `refresh { mode, strategy: 'full-extraction-node-diff', changedPathCount, deletedPathCount, extractedFileCount, delta }`. Without a usable previous graph it records `mode: whole` with the reason and builds as before.
- The knowledge step of a refresh reads the earlier corpus manifest (artifact, by the digest the record now states) and the earlier merged graph (checked against the record's digest). Documents that are new, changed by SHA-256, or without a document node are extracted; the rest are cache hits whose nodes and edges `retainedKnowledge` carries into the merge. Nothing changed: no invocation and no unit reserved. The corpus the model reads holds only the documents to extract.
- Resume: before the corpus is rebuilt, usable chunk files of an interrupted attempt are read; chunks matching the new plan by revision and covered documents are kept and `subsetPlan` asks the model for the others only.
- `KNOWLEDGE_PLANNING_GLOBS` adds `.planning/phases/**/*.md` and `.planning/STATE.md` to the corpus (inside `files.read`, outside the secret globs); drop reasons `phase-file` and `state-file` became `outside-read`.

## Task Commits

1. **Task 1 (tracer): incremental code graph** - RED `9c33692` (test), GREEN `c508ae4` (feat)
2. **Task 2: knowledge refresh and the planning corpus** - RED `259e93c` (test), GREEN `b69f3b2` (feat)
3. **Task 3: interrupted refresh and the gates** - the case was written with Task 2's RED and passes in `b69f3b2`; no further commit

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

- Task 1 RED: `04-17-red-task1.json`, `RED_EVIDENCE_OK`; both integration cases failed on the missing `refresh` block of the code-graph step result, after two real onboardings.
- Task 2 RED: `04-17-red-task2.json`, `RED_EVIDENCE_OK`; S-47 failed on 13 documents handed to the model instead of 2.
- Task 3 has no separate RED: its case was in the Task 2 RED file and failed there on the planned assertion (2 chunks expected, 3 planned from the whole corpus). A mutation stands in: disabling the salvage read made it fail (2 documents asked instead of 1); restored.
- Tracer gate: the tracer `<verify>` passed on the proven slice before expansion.

## Decisions Made

See key-decisions. Both below are owner-reviewable.

## Decisions needing owner review

1. **Spike over plan text.** The plan's `mergeChangedPaths` was drafted as a subset merge; the S4-B evidence (4 of 1261 edges lost) and the plan's own flagged assumption send it to the whole-tree extraction plus node diff. The consequence is that ONB-11's saving in the code graph is the diff and the proof, not fewer files extracted (1.5 s on 157 files per the spike); the saving that matters is the model-paid knowledge pass. Test `graph-incremental.test.ts` asserts a boundary edge to an unchanged file is present and counted, and equality with a full rebuild.
2. **Phase files and STATE.md reach a model.** The plan asks for it (D-11, S-47). They are text a model reads, so they are prompt-injection surface (T-04-46); they are copied and extracted as any document, and their nodes are validated per manifest. Validation was loosened for nodes of the pass only; code-graph nodes citing them are still refused. If any phase file may hold secrets, the contract's secret globs are the only guard, plus the existing content scan.
3. **A record field was added.** `indexes.graph.knowledge.manifestDigest` (no schema change; the block is free-form) so a refresh can find the earlier manifest.
4. **Resume salvage is one attempt deep.** A second interruption re-extracts what the first attempt finished, because the salvaged chunks live only in memory between attempts (writing them back needs a port change). Correct, only redundant.
5. **Reuse applies to any refresh with a usable earlier pass** (incremental, paths or full), not only incremental; a full re-map changes the map documents' digests so they are re-extracted, others hit.

## Deviations from Plan

**1. [Rule 3 - Blocking] `src/adapters/graph/graphify.ts` not modified.** The plan listed it; per the spike no path-list form exists to add. `grep -n "'update'"` prints nothing.

**2. [Rule 1 - Bug] Existing tests encoded the S-45 rule that phase files and STATE.md are never in the corpus.** Updated `knowledge-corpus.test.ts`, `graph-merge.test.ts` (validation), `knowledge-pass.test.ts` and `test/fixtures/knowledge.ts` (corpus of 13 documents; fixture counts adjusted to keep 24 and 25 documents), and the exact-record assertion now allows `manifestDigest`. Committed in `b69f3b2`.

**3. [Rule 3 - Blocking] `StampedMapOptions.sourceFiles`** added to the test fixture so a committed-map repository can carry documents.

**4. Process:** an API rate limit interrupted the run once after the salvage mutation check; the mutation was confirmed restored by grep and diff before continuing. The run is on the phase branch `worktree-phase-04`, as the earlier plans of the phase.

**Total deviations:** 3 auto-fixed, 1 process note. **Impact:** no scope change.

## Issues Encountered

- The kill of Task 3 is simulated in process (see D5): the supervisor death cannot be reproduced without a child process and a knowledge-capable fake host (the test CLI host supports only the map purpose).
- Deleting a file the committed map names fails map validation (`path-references`), so the deletion test uses a file the map does not name.

## Documentation surfaces (for plans 04-38 and 04-39)

- Incremental refresh steps: code-graph `refresh` block (mode, strategy, counts, delta fields, `whole` reasons); knowledge `refresh` block (mode, changed, cacheHits, retainedNodes, retainedEdges, droppedEdges, salvagedChunks, `whole` reasons).
- Corpus additions: `.planning/phases/**/*.md` and `.planning/STATE.md`, the `outside-read` drop reason replacing `phase-file` and `state-file`, the record's `knowledge.manifestDigest`.
- D-11 deviation line for plans 04-38 and 04-39: D-11 says extraction runs on changed paths; built behavior is a whole-tree extraction diffed against the previous graph (spike S4-B), and the knowledge pass is the changed-only part. `docs/system/findings.md` should carry one line for the owner: the proposal says changed-path extraction, the code does whole-tree plus diff.
- Stale text: the docs that say the corpus never holds STATE.md or phase files (`docs/repository-onboarding.md`, `docs/system` knowledge document).

## Known Stubs

None.

## Threat Flags

None beyond the register. T-04-45: the merge takes the extraction, so no stale or orphaned node survives; equality with a full rebuild is tested for a change and a deletion. T-04-46: phase files are document nodes under the existing per-node validation and the INFERRED-only document edge rule; no policy source reads them. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 04-38 and 04-39 document the surfaces above. Decision 3 of plan 04-14 (an AVARICE-held map is not restored into staging) still limits when a refresh is incremental at all.

## Self-Check: PASSED

- Files present: both integration tests, both RED records, `src/domain/graph-merge.ts` (`mergeChangedPaths`, `retainedKnowledge`), `src/domain/knowledge-corpus.ts` (`changedDocuments`, `KNOWLEDGE_PLANNING_GLOBS`)
- Commits on this branch: 9c33692, c508ae4, 259e93c, b69f3b2
- Acceptance: both RED records `RED_EVIDENCE_OK` with exit code 1; `grep -n "'update'" src/adapters/graph/graphify.ts` prints nothing; the S-47 test asserts `handed.length === 2`; the interrupted case compares sorted node and edge lists of both graphs
- Verification: graph-incremental, knowledge-refresh, knowledge-pass, graph-merge, knowledge-corpus, knowledge-extraction green; full unit suite 2685 of 2685; refresh-scoped, index-stage, intel-step, no-competing-index, ledger-status, skeleton, graphify-tool, resume-reap, onboard-adopt, status-queries 154 of 154; killpoints 22 of 22; typecheck clean; boundaries ok. The full `npm test` was not run.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
