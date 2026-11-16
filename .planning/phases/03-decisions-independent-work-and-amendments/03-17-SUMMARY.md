---
phase: 03-decisions-independent-work-and-amendments
plan: 17
subsystem: run-start
tags: [spec-derivation, index-facts, start-summary, model-per-item, graph, intel]

requires:
  - phase: 03-decisions-independent-work-and-amendments
    provides: "deriveItemSpec, IndexFacts and RunCompileInput.indexFacts (03-03); the multi-item kernel with the item's model on each invocation (03-14)"
provides:
  - "collectIndexFacts: the files and symbols the items name, read from the graph and intel indexes before the start transaction"
  - "itemCandidateTerms: the terms start asks the indexes about, from the same token rule deriveItemSpec uses"
  - "The start summary: an index line and one line per work item with size, model, dependencies, files and symbols, each derived field marked"
  - "model on the launch:run step result and on the invocation.finished event data"
affects: [03-20, 03-22, 03-31]

requirements-completed: []

actuals:
  tokens: 21000
  tasks: 2
  commits: 4
plan_head_before: ae70efb0f39dcd548a98298c74e89e46b4ec3667
plan_head_after: d942aa299f7b7de61cb7b3e2eff57ffe03ddf317
commits: 4

tech-stack:
  added: []
  patterns:
    - "Derivation reads and never writes: start queries the indexes (await collectIndexFacts) before startRun, and createRunWithContract stays the one transaction"
    - "An index that is absent, stale or unreadable gives no facts and a one-line note; it never blocks a start"
    - "An index answer is used only when its index is fresh, or stale with the cited path still at HEAD; the compiler then keeps a derived file only inside the write set"

key-files:
  created:
    - src/app/derive-spec.ts
    - test/integration/run-spec-derivation.test.ts
    - test/integration/run-models.test.ts
    - .planning/phases/03-decisions-independent-work-and-amendments/03-17-red-evidence-task1.json
    - .planning/phases/03-decisions-independent-work-and-amendments/03-17-red-evidence-task2.json
  modified:
    - src/domain/run-contract.ts
    - src/app/run-start.ts
    - src/cli/commands/start.ts
    - src/app/invocation.ts
    - test/unit/run-contract.test.ts
    - test/integration/run-invocation.test.ts

key-decisions:
  - "The single `model:` line of the start output is replaced by one `item <id>:` line per work item; a derived size is marked (derived) and a model that follows from the size is marked (from size)"
  - "An index answer counts when it is fresh, or stale and its cited path is still at HEAD (the start always runs after the conventions commit, so a fresh-only rule would never use a graph built at the pin)"
  - "Only graph code nodes (not documents or concepts) and intel file-roles and api-map entries are read; index text is never used beyond a repository path and an identifier"
  - "At most 24 terms are asked, each with a 400-token budget, so a 20-item brief cannot start dozens of GSD reads"
  - "The start command computes the terms itself (startTerms re-reads the brief the way startRun does) so run-start.ts keeps its one synchronous transaction and no async step"

patterns-established:
  - "itemCandidateTerms and deriveItemSpec share candidateTokens, so the terms asked of the index and the tokens derived from cannot drift"

coverage:
  - id: D1
    description: "A three-item brief with no sizes or files, on an onboarded repo whose graph names src/slug.ts and slugify, stores A with files [src/slug.ts] and symbols [slugify], B with the write set, every size medium, and names the derived fields in spec.derived"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-spec-derivation.test.ts#stores A with the file and symbol the graph knows, B with the write set, every size medium, and names the derived fields"
        status: pass
    human_judgment: false
  - id: D2
    description: "The start output has an index line and one line per item (size, model, dependencies, files, symbols) with derived fields marked and an explicit spec shown unmarked"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-spec-derivation.test.ts#prints one line per item, with size, model, dependencies and spec files, each derived field marked; #shows an explicit spec without the derived marker"
        status: pass
    human_judgment: true
    rationale: "Whether the one-screen summary reads well to a person is a judgment; the exact lines are pinned by tests"
  - id: D3
    description: "An absent, stale or unreadable index never blocks a start: the specs derive from the brief and the write set and the summary says index: not used (absent|stale|unreadable)"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-spec-derivation.test.ts#starts, derives from the brief and the write set, and says the index was not used; #a graph node whose file is not at HEAD gives no facts; #a graph file the reader cannot parse is not used and never throws"
        status: pass
    human_judgment: false
  - id: D4
    description: "RC-7 concurrency: collectIndexFacts writes nothing (no run, contract, item, event or step row changes)"
    requirement: "RC-7"
    verification:
      - kind: integration
        ref: "test/integration/run-spec-derivation.test.ts#collectIndexFacts returns the files and symbols the item terms match and writes nothing to the ledger"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each run invocation is launched with its item's model (small haiku, large opus, an explicit model wins) and the model is recorded on the launch:run step result and on every invocation.finished event; a crashed unit and its CON-16 retry both use the item's model"
    requirement: "RC-8"
    verification:
      - kind: integration
        ref: "test/integration/run-models.test.ts"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-11-09
status: complete
---

# Phase 3 Plan 17: Spec derivation at start and the model per item Summary

**`avarice start` now reads the graph and intel indexes before the start transaction, derives each item's files and symbols from what they name, prints one marked line per work item with its size, model, dependencies and spec files, and every run invocation records its item's model on the launch:run step and the invocation.finished event.**

## Performance

- **Duration:** about 50 min
- **Tasks:** 2 (task 1 is a tracer)
- **Commits:** 4 before this summary (2 RED, 2 GREEN)
- **Files:** 5 created (one source, two test files, two RED records), 6 modified

## Accomplishments

- `collectIndexFacts(deps, projectId, terms)` asks each term of `queryContext` (the reader `context` uses) with a 400-token budget, at most 24 terms, and collects the repository file each graph code node or intel file-roles or api-map entry cites and the identifier that names it. Answers are used when fresh, or stale with the cited path still at HEAD; sorted and de-duplicated. It never throws and writes nothing.
- `itemCandidateTerms(brief)` in `src/domain/run-contract.ts` gives per item the path candidates and the backtick identifiers of its title and acceptance text. It and `deriveItemSpec` read one `candidateTokens` helper, so they cannot drift (the unit tests pin that a brief without items is the single item A).
- `startTerms` reads the brief and the project the way `startRun` does; the start command awaits `collectIndexFacts`, passes `indexFacts` into `startRun`, which forwards it to `compileRunContract`. A brief that cannot be read gives no facts and `startRun` refuses with the real reason.
- The start output loses the single `model:` line. It prints `index: used (1 file, 1 symbol)` (or `index: not used (absent|stale|unreadable)`, `index: used, but nothing in it names these files or symbols`, `index: not queried (no item names a file or a symbol)`) and one line per item, for example `item A: medium (derived), sonnet (from size); files src/slug.ts (derived); symbols slugify (derived)` and `item C: medium (derived), sonnet (from size); depends on B; files src/**, test/** (derived)`.
- `invocation.ts` adds `model` to the launch:run started record, to the completed and failed step results (through `stepExtras`) and to the `invocation.finished` event data (through `eventOwner`), for run invocations only; onboarding records are unchanged.

## Task Commits

1. **Task 1 (tracer): a three-item brief with no sizes or files** - RED `c832e51` (test), GREEN `4e46661` (feat)
2. **Task 2: the model per invocation, recorded** - RED `5cc204a` (test), GREEN `d942aa2` (feat)

## TDD Gate Compliance

`03-17-red-evidence-task1.json` and `03-17-red-evidence-task2.json` both return `RED_EVIDENCE_OK`. Task 1: 6 of 6 failed on assertions (a stub `collectIndexFacts` that returns no facts made the file load). Task 2: 4 of 5 failed; the first test, which asserts what the host receives (haiku, then opus), already held because `prepareRunInvocation` takes `item.model`; only the recording was missing. The tracer gate (task 1 `<verify>` re-run end to end, 33 of 33) passed before task 2 started.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A pin outside the plan's file list**
- **Found during:** Task 2
- **Issue:** `test/integration/run-invocation.test.ts` pinned the exact result of the launch:run started step; it now carries `model`.
- **Fix:** the expectation gained `model: 'sonnet'`.
- **Files modified:** test/integration/run-invocation.test.ts
- **Commit:** d942aa2

**2. [Plan wording] `findProject` and `readBriefFile` exported from run-start.ts; `startTerms` added**
- The plan names `collectIndexFacts` and the start wiring only. The start command needs the project and the parsed brief before `startRun`, so those two helpers are exported and `startTerms` (in `src/app/derive-spec.ts`) reuses them.

**3. [Plan wording] A stale index is used when the cited path is at HEAD**
- The flagged assumption says a stale index leaves the facts empty. `start` runs after the conventions commit, so every index built at the pin is stale by commit identity; treating that as unusable would mean no index could ever be used. A stale answer is used when its cited path still exists at HEAD (the reader's `confirmed` flag); one whose file is gone is dropped and the summary says `index: not used (stale)`.

**4. [Plan wording] Test and unit additions beyond the two named files**
- Two unit tests for `itemCandidateTerms` were added to `test/unit/run-contract.test.ts`.

**Total deviations:** 4 (1 Rule 3, 3 plan-wording). **Impact:** none on scope.

## Issues Encountered

- The full suite (3194 tests, 3132 pass, 60 skipped) had two failures, `follows SIGTERM with SIGKILL after the grace when the host ignores SIGTERM` and `install-host ... never writes outside its temp directory`; both are in suites this plan does not touch, are timing and home-directory sensitive under full-suite load, and `test/integration/install-host.test.ts` and `test/integration/claude-host.test.ts` pass alone (60 of 60).
- A detached supervisor that `start` spawns can still be writing its data root when a test removes it; the new derivation test removes its directories with retries.
- `test/mutation/` and the live containment suites were not run.

## Verification

- `node --test test/integration/run-spec-derivation.test.ts test/integration/run-start.test.ts`: 33 of 33
- `node --test test/integration/run-models.test.ts test/integration/run-invocation.test.ts test/integration/run-scheduler.test.ts test/integration/run-events.test.ts`: 35 of 35
- `test/unit/run-contract.test.ts`: 101 of 101
- `npx tsc -p .` clean; `node scripts/check-boundaries.ts`: ok (90 files); `grep -n "workItems\[0\]" src/cli/commands/start.ts` prints nothing

## Known Stubs

None. The RED stub of `collectIndexFacts` was replaced in `4e46661`.

## Documentation surfaces (for plan 03-31)

`docs/system/` was not edited in this plan; the documentation plan writes these from the code:

- **Start summary lines:** `index: <note>` then one `item <id>: <size>[ (derived)], <model>[ (from size)][; depends on <ids>]; files <list>[ (derived)][; symbols <list>[ (derived)]]` per work item, replacing the single `model:` line; a list shows four entries and `and N more`. Index notes: `used (N files, M symbols)`, `used, but nothing in it names these files or symbols`, `not used (absent)`, `not used (stale)`, `not used (unreadable)`, `not queried (no item names a file or a symbol)`. `start` has no `--json`, so no frozen JSON shape changed.
- **Event field:** `invocation.finished` data for a run invocation carries `model` (the item's model token).
- **Step field:** the `launch:run` step result (started, completed and failed) carries `model`.
- **Derivation sources:** terms are the path candidates and backtick identifiers of an item's title and acceptance text (at most 24 per start, 400 tokens each); graph code nodes (file = the node's source file, symbol = its label without `()`), intel file-roles entries (file = the key) and intel api-map entries (file = the entry's `file`, symbol = its key); an answer is used when fresh, or stale with its cited path at HEAD; derived files are kept only inside the write set (T-03-32); an absent, stale or unreadable index never blocks a start.

## Threat Flags

None. T-03-32 holds: derived files are kept only inside the write set by the plan 03-03 rule (a node whose file is gone is dropped; `src/gone.ts` gave the write set), derivation can narrow and never widen, and the summary shows every derived field before the run starts. T-03-SC: no package installs.

## Next Phase Readiness

Plans 03-20 and 03-22 can rely on the per-item model in the ledger and on item specs that carry the files and symbols the indexes know. Owner checks: the exact wording of the summary lines and of the index notes is new and may be revised without a contract change.

## Self-Check: PASSED

Created files exist (`src/app/derive-spec.ts`, the two test files, the two RED records, this summary); commits c832e51, 4e46661, 5cc204a and d942aa2 are on the branch; both RED records return `RED_EVIDENCE_OK`; typecheck and boundaries clean; no requirement was marked complete (`requirements.ready-ids` reported 0 of 2 ready, other plans also declare RC-7 and RC-8).
