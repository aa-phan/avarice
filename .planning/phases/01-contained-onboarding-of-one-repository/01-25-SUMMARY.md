---
phase: 01-contained-onboarding-of-one-repository
plan: 25
subsystem: knowledge-pass
tags: [knowledge-graph, coverage, validation, chunk-plan, prompt, tdd, gap-closure]
gap_ids: [G-01-154]

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: knowledge pass split into AVARICE-side chunking and one contained invocation (plan 01-19 decision B), graph merge and validation (plan 01-18), read confinement of the knowledge invocation (plans 01-23, 01-24)
provides:
  - "documentCoverage(merged, manifest) and KNOWLEDGE_LIMITS.documentShare: per-document coverage of the merged graph, and the at-least-half rule that makes a pass below half validation-failed"
  - "The record's knowledge section states documentsExpected and dropped.unread, and its corpus names only documents that have a document node"
  - "planExtractionChunks(manifest, sizes, corpusRoot, limits): .chunks.json carries an absolute readPath per file and writePath per chunk"
  - "A prompt that has the model use readPath and writePath verbatim, retry a denied or failed read once, then leave the file out"
  - "FakeKnowledgeHost perDocument mode and reads: reproduces the live slip of UAT 154 offline"
affects: [01-26 assert-exit live gate, 01-26 docs/repository-onboarding.md contract change, 01-26 production-path proof against the hook policy]

plan_head_before: 6ec856fe9bf15780b7026d723af28ed478afaa1c
plan_head_after: 0178ee1795bb5408c0049bcfb508dc9819183755

actuals:
  tokens: 14860
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Judge coverage on the merged graph (what the record will claim), never on chunk-file shape"
    - "Hand the model absolute paths as data in the plan file and name only field names in the fixed prompt"
    - "Reproduce a live model slip in a fake host by applying the production hook's first read rule to each read"

key-files:
  created:
    - .planning/phases/01-contained-onboarding-of-one-repository/01-25-red-evidence-task1.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-25-red-evidence-task2.json
  modified:
    - src/domain/knowledge-validation.ts
    - src/app/stages/index-knowledge.ts
    - src/domain/knowledge-extraction.ts
    - test/helpers/fake-knowledge-host.ts
    - test/integration/knowledge-pass.test.ts
    - test/unit/graph-merge.test.ts
    - test/unit/knowledge-extraction.test.ts
    - test/unit/knowledge-corpus.test.ts
    - test/fault/killpoints.test.ts

key-decisions:
  - "Coverage is measured on the merged graph per manifest document (a node of the pass, file_type document, source_file equal to the source path); a concept node, a code-graph node, a node citing a file outside the corpus and a node that lost an ID collision cover nothing"
  - "The record's corpus, documentsExpected and dropped.unread come from the coverage of the clustered graph that gets installed (rechecked), not from the pre-cluster merge"
  - "At least half the manifest's documents must be covered (KNOWLEDGE_LIMITS.documentShare 0.5, exactly half accepted); the rule for chunk files that do not parse stays the early exit"
  - "AssembledExtraction.usedFiles is removed so coverage cannot be derived from chunk shape again"
  - "The kill-point suite compares the knowledge chunk plan on its own, normalized, instead of inside the staging digest, because the plan now holds the run's absolute paths"

requirements-completed: [ONB-14, ONB-13]

coverage:
  - id: D1
    description: "A knowledge pass that reads the staging originals instead of the corpus copies and covers fewer than half the documents ends with the knowledge index absent validation-failed, the record without a knowledge section, graph.json byte-identical to code-graph.json, and an index.absent detail stating the shortfall in counts (8 of 25)"
    requirement: ONB-13
    verification:
      - kind: integration
        ref: "test/integration/knowledge-pass.test.ts#records validation-failed when the agent reads the staging originals and fewer than half the documents get a node (UAT 154 slip)"
        status: pass
    human_judgment: false
  - id: D2
    description: "At least half covered: the record states documentsExpected and dropped.unread, and corpus names only directories of documents that have a node; a run whose chunks parse but hold one document node is now validation-failed (contract change)"
    requirement: ONB-14
    verification:
      - kind: integration
        ref: "test/integration/knowledge-pass.test.ts#counts a document as covered only when a document node cites it, and states the unread ones (contract change, plan 01-25)"
        status: pass
      - kind: integration
        ref: "test/integration/knowledge-pass.test.ts#records the knowledge index absent when no chunk file was written (no-output), when none is usable or fewer than half are (validation-failed)"
        status: pass
      - kind: integration
        ref: "test/integration/knowledge-pass.test.ts#lists document nodes for every map file, PROJECT.md and both ADRs, built at the onboarded revision, with the knowledge fields"
        status: pass
    human_judgment: false
  - id: D3
    description: "documentCoverage and the coverage rule: exactly half accepted and one fewer refused (2 of 4, 1 of 3 vs 2 of 3), and concept, code-graph, outside-corpus and collided nodes cover no document"
    requirement: ONB-14
    verification:
      - kind: unit
        ref: "test/unit/graph-merge.test.ts#documentCoverage and the coverage rule (G-01-154, plan 01-25)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The chunk plan carries an absolute readPath and writePath, the prompt uses them verbatim with a one-retry recovery, and the prompt is identical across corpus roots and carries no root or repository text"
    requirement: ONB-14
    verification:
      - kind: unit
        ref: "test/unit/knowledge-extraction.test.ts#gives each file an absolute readPath and each chunk an absolute writePath under the corpus root, and keeps path, stem and output as they were (G-01-154, plan 01-25)"
        status: pass
      - kind: unit
        ref: "test/unit/knowledge-extraction.test.ts#names readPath and writePath, says they are absolute and are passed to Read and Write exactly as the plan gives them, and says never to build a path (G-01-154)"
        status: pass
      - kind: unit
        ref: "test/unit/knowledge-extraction.test.ts#is the same text for plans with the same chunk count whatever the corpus root, and includes no root (T-01-88)"
        status: pass
      - kind: unit
        ref: "test/unit/knowledge-corpus.test.ts#writes the plan as `.avarice-knowledge/.chunks.json` (readable JSON, no manifest data) and an empty `.extraction` directory"
        status: pass
    human_judgment: false
  - id: D5
    description: "Verbatim absolute paths reduce how often claude-haiku-5-5 drops the .avarice-knowledge/ segment in a live run"
    requirement: ONB-14
    verification: []
    human_judgment: true
    rationale: "Offline tests cannot measure how often the live model still copies a path wrongly; the next live rehearsal measures it, and the assert-exit gate of plan 01-26 fails on any unread document"

duration: 45min
completed: 2026-11-05
status: complete
---

# Phase 1 Plan 25: Per-document knowledge coverage and verbatim chunk paths Summary

**The knowledge pass now accounts per document on the merged graph (below half is validation-failed, otherwise the record states documentsExpected and dropped.unread), and the chunk plan hands the model absolute readPath and writePath it must use verbatim, with a one-retry recovery rule.**

## Performance

- **Duration:** about 45 min (the start time was not captured at spawn; estimated from tool timings)
- **Completed:** 2026-11-05T01:40Z
- **Tasks:** 2 (a tracer and an auto task, both TDD)
- **Files modified:** 9 source and test files, plus 2 RED evidence files

## Accomplishments

- Closes UAT gap G-01-154 in the knowledge pass: a pass that reads the staging originals (denied `outside-read-set`) and writes shape-valid empty chunks can no longer end as `active` with `dropped` 0 and a corpus it never read. Below half the documents it is `validation-failed` with the code graph unchanged; at or above half the record says how many documents were expected and how many got no node.
- `documentCoverage` judges the merged graph against the manifest; `KNOWLEDGE_LIMITS.documentShare` (0.5) replaces "one document node is enough".
- `.chunks.json` carries `readPath` per file and `writePath` per chunk (computed by AVARICE from the invocation's cwd), the prompt tells the model to pass them exactly as given, retry a denied or failed read once and then leave the file out. The prompt still carries no repository text and no corpus root.
- `FakeKnowledgeHost` `perDocument` mode reproduces the live slip offline using the hook's first read rule, and records every read.

## Task Commits

1. **Task 1 (tracer): per-document coverage** - RED `1f82604` (test), GREEN `8054cb8` (fix)
2. **Task 2: verbatim readPath and writePath, prompt, usedFiles removed** - RED `e981f2b` (test), GREEN `5f69a3d` (fix)
3. **Deviation fix: kill-point suite compares the chunk plan normalized** - `0178ee1` (fix)

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Both tasks followed RED then GREEN; no REFACTOR commits were needed.

- **Task 1 RED:** target test "records validation-failed when the agent reads the staging originals and fewer than half the documents get a node (UAT 154 slip)". `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`01-25-red-evidence-task1.json`). Semantic assessment: the test ran through the real onboarding with the fake host in `perDocument` mode and failed on the first planned assertion (the knowledge index was recorded present, not `validation-failed`); 3 sibling cases failed for the same missing behavior (above-half accounting, contract flip, `documentsExpected` and `unread` in the deepEqual). `test/unit/graph-merge.test.ts` failed at module link (`documentCoverage` not exported yet), so it is not the evidence target.
- **Task 2 RED:** target test "names readPath and writePath, says they are absolute ... never to build a path (G-01-154)". `RED_EVIDENCE_OK` (`01-25-red-evidence-task2.json`). Semantic assessment: a pure unit test over `knowledgePrompt` failed on its first planned assertion because the old prompt has no readPath or writePath wording. Some other failures in that run come from the new fourth `limits` argument position (calls with limits after the corpus root get the root as limits until the signature changes); this is part of the same missing behavior, not a fixture fault.
- **GREEN:** `8054cb8` and `5f69a3d` each followed their `test(01-25)` commit and make the new tests pass.

## Contract change

| Aspect | Old (plans 01-18, 01-19) | New (plan 01-25) |
|---|---|---|
| What makes a document covered | A usable chunk (its file parses) covers its documents | A document node of the pass cites the document (checked on the merged graph) |
| Admission of the pass | One document node is enough | At least half of the manifest's documents have a document node (`KNOWLEDGE_LIMITS.documentShare` 0.5; exactly half passes) |
| `knowledge.dropped` | `{ dangling, astDocument }` | `{ dangling, astDocument, unread }`, plus `knowledge.documentsExpected` |
| `knowledge.corpus` | Directories of documents in usable chunks | Directories of documents that have a document node |
| Read and write paths | The model composes them from the working directory and `path` or `output` | Verbatim absolute `readPath` and `writePath` in `.chunks.json` |
| An unreadable file | Skip it and go on | Retry once with the `readPath`, then leave it out; the document counts unread |

A run whose chunk files parse but hold one document node, which plans 01-18 and 01-19 recorded `active` with `documentNodes` 1, now ends with the knowledge index absent `validation-failed`. Plan 01-26 writes this contract into docs/repository-onboarding.md; until then that file still states the old contract (no test reads its text).

## Mechanism choice (chosen and rejected)

Chosen:
- **A. Per-document accounting.** After the merge, each manifest entry is checked for a document node of the pass; the record gets `documentsExpected` and `dropped.unread`, and `corpus` comes from covered documents. `AssembledExtraction.usedFiles` is removed.
- **B. Coverage rule in validation.** Fewer than half the manifest's documents covered is `validation-failed` and the graph stays code-only; the early exit for chunk files that do not parse stays.
- **C. Verbatim paths in the plan.** Absolute `readPath` per file and `writePath` per chunk as data in `.chunks.json`; `path` stays as the `source_file` citation.
- **D. Recovery rule in the prompt.** Retry a denied or failed read once with the `readPath`, then leave the file out.
- **E. Live gate (plan 01-26).** assert-exit fails on any unread document, checked at zero unread.
- **Fake-host reproduction.** `perDocument` mode judges each read with the hook's first read rule.

Rejected:
- Chunk usable only when its files yield document nodes (judges chunk files, not documents; the merge unions by ID).
- A hook deny reason naming the allowed corpus root (the root is already the prefix of every `readPath`; the hook is shared and fail-closed).
- Counting the invocation's hook denies in the step result, or reordering `classifyOutcome` (neither necessary nor sufficient for coverage; would change map and intel).
- The absolute `.chunks.json` path in the prompt (the prompt is fixed text and a test pins it identical across plans).
- Dropping the relative `path` from the plan (`source_file` would become an absolute machine path in graph.json).
- Recording the merge's `malformed` counter (a malformed node leaves its document without a node, so `unread` already counts it).
- Out of scope: the map invocation's 2 Bash `outside-read-set` denials.

## Names plan 01-26 relies on

- `.chunks.json` fields: `readPath` (per file) and `writePath` (per chunk), both absolute.
- Record fields: `indexes.graph.knowledge.documentsExpected` and `indexes.graph.knowledge.dropped.unread`.
- Domain: `documentCoverage`, `DocumentCoverage`, `KNOWLEDGE_LIMITS.documentShare`, and `coverage` on a valid `validateKnowledgeGraph` result (`src/domain/knowledge-validation.ts`); `planExtractionChunks(manifest, sizes, corpusRoot, limits)` where the stage passes `join(staging, KNOWLEDGE_DIR)`, the knowledge invocation's cwd.
- Test helper: `FakeKnowledgeHost` option `perDocument: { originalsFromChunk }` and `reads`.

## Files Created/Modified

- `src/domain/knowledge-validation.ts` - `documentCoverage`, `DocumentCoverage`, `documentShare`, the coverage rule, `coverage` on a valid result
- `src/app/stages/index-knowledge.ts` - record knowledge section from the clustered graph's coverage; plan built with the corpus root
- `src/domain/knowledge-extraction.ts` - `readPath`, `writePath`, root check, revised prompt, `usedFiles` removed
- `test/helpers/fake-knowledge-host.ts` - `perDocument` mode and `reads`
- `test/integration/knowledge-pass.test.ts` - UAT 154 slip, above-half and contract-flip cases, updated deepEqual and `RecordBody`
- `test/unit/graph-merge.test.ts` - `documentCoverage` and coverage-rule units
- `test/unit/knowledge-extraction.test.ts`, `test/unit/knowledge-corpus.test.ts` - plan, prompt and key-set tests; corpus root parameter
- `test/fault/killpoints.test.ts` - chunk plan compared normalized
- `.planning/phases/01-contained-onboarding-of-one-repository/01-25-red-evidence-task1.json`, `01-25-red-evidence-task2.json` - RED runs

## Decisions Made

See `key-decisions` above. The coverage share is one constant (`KNOWLEDGE_LIMITS.documentShare`) for the owner to tune; the live gate of plan 01-26 is stricter (zero unread) because it checks UAT 154, not admission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kill-point suite failed on the staging tree digest after the plan gained absolute paths**
- **Found during:** Task 2 (full offline suite after the GREEN commit)
- **Issue:** `test/fault/killpoints.test.ts` compares the staging tree digest of two profiles. `.avarice-knowledge/.chunks.json` now holds the run's absolute `readPath` and `writePath`, so the digest differs between profiles by design (18 failures: the reproducibility test and every kill point).
- **Fix:** The staging digest skips the chunk plan file, and the plan is compared on its own with `normalizeText` (temp root and ULIDs replaced), in both assertions.
- **Files modified:** `test/fault/killpoints.test.ts`
- **Verification:** `node --test test/fault/killpoints.test.ts` 22 of 22 pass; full suite passes
- **Committed in:** `0178ee1`

---

**Total deviations:** 1 auto-fixed (1 bug, in a test whose expectation the planned change invalidated)
**Impact on plan:** None on scope; the plan's `files_modified` list did not name `test/fault/killpoints.test.ts`, which the path change required.

## Issues Encountered

None beyond the deviation above. `test/unit/graph-merge.test.ts` fails at module link in the Task 1 RED commit (the named import of the not-yet-existing `documentCoverage`), so its RED evidence is the integration file; both files pass in the GREEN commit.

## Verification Results

- `env -u AVARICE_LIVE npm test` (full offline suite): 1287 tests, 1265 pass, 0 fail, 22 skipped (the skips predate this plan, they are the live and graphify-less suites)
- `env -u AVARICE_LIVE node --test --test-reporter=tap test/integration/knowledge-pass.test.ts test/unit/graph-merge.test.ts`: 51 of 51 pass, with "ok" lines naming "UAT 154 slip" and "contract change, plan 01-25"
- `env -u AVARICE_LIVE node --test --test-reporter=tap test/unit/knowledge-extraction.test.ts test/unit/knowledge-corpus.test.ts test/integration/knowledge-pass.test.ts`: 64 of 64 pass, with "ok" lines naming "readPath"
- `env -u AVARICE_LIVE node --test test/integration/claude-host.test.ts test/unit/knowledge-extraction.test.ts`: 56 of 56 pass (the fake claude writes a node per file)
- `npx tsc -p . && node scripts/check-boundaries.ts`: clean, `check-boundaries: ok (53 file(s))`
- Acceptance greps: `documentShare` 3, `coverage.covered` 1, `perDocument` 6, `readPath` 7, `writePath` 5, `KNOWLEDGE_DIR` 2
- No live (paid) run was started; every suite ran with `AVARICE_LIVE` unset.

## Known Stubs

None.

## Threat Flags

None. The absolute paths in `.chunks.json` (T-01-87) and the prompt (T-01-88) were already in the plan's threat model; the prompt-identity unit test pins T-01-88, and `planExtractionChunks` refuses an unsafe root.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 01-26 (wave 2) can add the assert-exit live gate on `knowledge.documentsExpected` and `knowledge.dropped.unread`, the production-path proof that every `readPath` lies under the generated hook policy's read confine, and the docs/repository-onboarding.md contract change.
- Open risk: offline tests cannot measure how often the live model still copies a path wrongly; the next `scripts/exit-run.sh --rehearsal` after plan 01-26 measures it.

## Self-Check: PASSED

- Created and modified files exist on disk (checked with `[ -f ]`).
- Commits `1f82604`, `8054cb8`, `e981f2b`, `5f69a3d` and `0178ee1` are ancestors of HEAD; `git rev-list --count` from the ledger base gives 5.
- `gsd_run check evaluation-scope --plan 01-25 --commits-only` resolved the plan unit.
- Both RED evidence records returned `RED_EVIDENCE_OK`.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-05*
