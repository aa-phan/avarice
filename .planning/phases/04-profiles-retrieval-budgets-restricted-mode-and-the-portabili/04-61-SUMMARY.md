---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 61
subsystem: evaluation-harness
tags: [eval-retrieval, brief-coverage, success-amendment, rejudge, spend-ledger, gap-closure, G-04-2-GIN-04, G-04-3]

requires:
  - phase: 04
    provides: "the AC-8 harness and ADR-016 re-judge (04-31, 04-50), the Phase 4 spend ledger and stepSpendUsd (04-46), launch step rows of runs and onboardings"
provides:
  - "Coverage-aware re-judgement of recorded runs from recorded data: briefBullets, judgeWithCoverage, rejudgeWithCoverage, loadCoverage, loadAmendment (G-04-3 harness side; read-only, no spend, no model)"
  - "editedPaths: the clone files a run's host transcript edited, for the person who records coverage"
  - "briefFor scope text that no longer forbids work the brief asks for: an end-to-end or browser test the brief names is still part of the change, written and not run"
  - "stepSpendUsd that records 0 for a step that exited with a code before any host launched, and the cap otherwise whenever a launch may have run (GIN-04)"
affects: [04-64, 04-65, 04-67, 04-69]

actuals:
  tokens: 22000
  tasks: 3
  commits: 6
plan_head_before: 94d802d069f8200bd6bc109cda148cdee6485d79
plan_head_after: ba323bea2cd15b57eeaada367fa680d0a76b6ae9

tech-stack:
  added: []
  patterns:
    - "A judgement of recorded runs is a pure function over parsed records plus a read-only file wrapper that pins every input by sha256 and refuses on any mismatch"
    - "An amended rule lives in its own approved file pinned to the digest of the approved task list; the approved file is never edited"
    - "A spend amount that cannot be known is the cap; 0 is recorded only when the store proves no host launched"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-61-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-61-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-61-red-task3.json
  modified:
    - scripts/eval-retrieval.ts
    - test/unit/eval-retrieval.test.ts

key-decisions:
  - "A recorded success counts as success only when every bullet of its brief is delivered; any partly or skipped bullet makes it partial; a recorded failure stays a failure whatever its coverage; the verdict and the D-08 rule are computed by the existing functions over the success counts"
  - "loadCoverage takes the approved tasks and the recorded runs (not only a tasks digest) because the refusals it owes (missing or doubled run, bullets differing from briefBullets) need them"
  - "launched undefined (launch rows not countable, or no store file) records the cap whatever finished; this is stricter than the plan action's 'undefined and finished 0' and follows the truth 'launches that cannot be counted record the cap' and T-04-162"
  - "rejudge and rejudgeResultsFile are unchanged; eval-verdict-adr016.json still equals rejudgeResultsFile's output"

patterns-established:
  - "Pinned-input read-only re-judgement: results, tasks, coverage and amendment digests are all reported in the output"

requirements-completed: [FR-3, FR-22]

coverage:
  - id: D1
    description: "briefBullets gives 2, 3, 3, 3, 3 and 1 bullets for the six recorded portfolio tasks, T03's wrapped bullet joined"
    requirement: FR-3
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#reads the bullets of the six recorded portfolio briefs"
        status: pass
    human_judgment: false
  - id: D2
    description: "judgeWithCoverage and rejudgeWithCoverage count a success with every bullet delivered as success, any partly or skipped bullet as partial, a recorded failure as failure; verdict and knowledge outcome use the success counts; read-only"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#re-judging recorded runs with brief coverage"
        status: pass
    human_judgment: false
  - id: D3
    description: "The coverage and amendment loaders refuse an unapproved, half-approved, non-RFC-3339 or mis-pinned amendment, and mis-pinned, incomplete, doubled, reordered, unknown-status or evidence-less coverage"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#refuses an amendment / a coverage record / a coverage entry / a status"
        status: pass
    human_judgment: false
  - id: D4
    description: "ADR-016 re-judgement is unchanged: rejudgeResultsFile equals the committed eval-verdict-adr016.json; no file under test/benchmark/phase4 changed"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#keeps the committed re-judgement equal to what the harness computes from the recorded runs"
        status: pass
      - kind: other
        ref: "git diff --quiet ed9e123..HEAD -- test/benchmark/phase4/ test/containment/live-spend-phase4.jsonl"
        status: pass
    human_judgment: false
  - id: D5
    description: "editedPaths lists the clone-relative paths of Edit, Write, MultiEdit and NotebookEdit calls once each in first-seen order and skips non-JSON lines"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#reads the clone-relative paths of the files a transcript edited"
        status: pass
    human_judgment: false
  - id: D6
    description: "briefFor keeps the required-checks line and the commit message whole and says an end-to-end or browser test the brief asks for is still part of the change; it holds no 'out of scope' and no clause forbidding the test"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#states, for every task alike, that only the required checks run here"
        status: pass
    human_judgment: false
  - id: D7
    description: "GIN-04: stepSpendUsd and spendStep record the cap for a null exit code, uncounted launches and launches without a finish, the charge when every launch finished, and 0 (with a log line) for a step that exited with a code and launched nothing"
    requirement: FR-22
    verification:
      - kind: unit
        ref: "test/unit/eval-retrieval.test.ts#the evaluation records every model step at no less than it may have cost"
        status: pass
      - kind: unit
        ref: "node --test test/unit/live-spend-ceiling.test.ts test/unit/exit-run-phase4-tools.test.ts"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-24
status: complete
---

# Phase 4 Plan 61: Brief coverage re-judgement and step spend Summary

**The evaluation harness can judge recorded runs again against the bullets of their briefs (a recorded success that skipped a bullet is partial) from four pinned files without spending, the brief no longer forbids its own end-to-end bullet, and a step that never launched a host records no spend.**

## Performance

- **Duration:** 7 min (first commit 15:41 to last 15:47, 2026-11-24, UTC-6; reading and planning before that not counted)
- **Started:** 2026-11-24T21:35:00Z (approximate)
- **Completed:** 2026-11-24T21:48:00Z
- **Tasks:** 3 (all TDD: RED recorded, then GREEN)
- **Files modified:** 2 source files and 3 RED records

## Accomplishments

- G-04-3 harness side: `rejudgeWithCoverage` reads results, the approved task list, a coverage record and an approved amendment, refuses on any pin or consistency mismatch, and returns the arms (runs, success, partial, tokens, shareOfA), the per-run outcomes with their skipped and partly bullet texts, the verdict and the knowledge outcome, plus the four source digests and the amendment's success rule.
- `briefFor` now tells a run that an end-to-end or browser test its brief asks for is still part of the change, to be written and not run here and not asked about; the earlier "out of scope" wording that made the 18 recorded runs skip that bullet is gone (affects future runs only).
- GIN-04: `costsOf` counts `launch:` step rows; `stepSpendUsd` records the cap unless the store proves every launch finished or none happened; `spendStep` logs "no host started" and writes no ledger entry for 0.
- 155 tests pass across the plan's verification set; typecheck and boundaries are clean; ADR-016 output and `test/benchmark/phase4/` are unchanged.

## Exported signatures (for plans 04-64 and 04-65)

From `scripts/eval-retrieval.ts`:

```ts
briefBullets(task: { brief: string }): string[]
loadCoverage(file: string, resultsSha256: string, tasks: ApprovedTasks, runs: readonly RecordedRun[]): LoadedCoverage   // BriefCoverage & { digest }
loadAmendment(file: string, tasksSha256: string): LoadedAmendment                                                       // SuccessAmendment & { digest }
readCoverageRuns(file: string): { runs: RecordedRun[]; sha256: string }
judgeWithCoverage(runs: readonly RecordedRun[], coverage: Pick<BriefCoverage, 'runs'>): CoverageJudgement
rejudgeWithCoverage(files: { resultsFile; tasksFile; coverageFile; amendmentFile }): CoverageRejudgement
editedPaths(transcriptText: string): string[]
costsOf(dataRoot: string, onboarding: boolean): LedgerCosts   // now exported; LedgerCosts.launched?: number
```

Record shapes: coverage `{ schema: 1, kind: 'avarice-eval-brief-coverage', decision: 'ADR-017', resultsSha256, tasksSha256, judgedBy, judgedAt, method, runs: [{ task, arm, runId, bullets: [{ text, status: delivered|partly|skipped, evidence }] }] }`; amendment `{ schema: 1, kind: 'avarice-eval-success-amendment', decision: 'ADR-017', amends: { file: 'test/benchmark/phase4/eval-tasks.json', sha256, field: 'successRule' }, successRule, partialRule, approvedBy, approvedAt }` (both approval fields null in a draft). The re-judgement output is `{ schema: 1, kind: 'avarice-ac8-rejudgement', decision: 'ADR-017', boundPercent, resultsSha256, tasksSha256, coverageSha256, amendmentSha256, successRule, arms, runs, verdict, knowledge }`.

## Task Commits

1. **Task 1: Tracer - recorded runs re-judged with brief coverage** - `093c170` (test, RED), `8879f03` (feat, GREEN)
2. **Task 2: Loader refusals, edit list, brief scope text** - `3f4cf44` (test, RED), `f3d4a7b` (fix, GREEN)
3. **Task 3: A step that never started a host records no spend (GIN-04)** - `3df584b` (test, RED), `ba323be` (fix, GREEN)

**Plan metadata:** recorded by the docs commit that adds this file.

## Files Created/Modified

- `scripts/eval-retrieval.ts` - coverage and amendment types and loaders, briefBullets, judgeWithCoverage, rejudgeWithCoverage, editedPaths, new briefFor scope text, LedgerCosts.launched, exported costsOf, stepSpendUsd and spendStep rules
- `test/unit/eval-retrieval.test.ts` - tests for all of the above; the stepSpendUsd and briefFor scope tests rewritten
- `.planning/phases/04-.../04-61-red-task{1,2,3}.json` - the recorded RED runs

## Decisions Made

See `key-decisions`. In short: partial counts for nothing in the verdict; `loadCoverage` takes the approved tasks and recorded runs; an uncountable launch count records the cap; the ADR-016 path is untouched.

## Deviations from Plan

### Interpretations recorded (no rule triggered)

**1. loadCoverage signature.** The plan prose gives `loadCoverage(file, results digest, tasks digest)`, but the required refusals (a run with no entry or two, bullets that differ from `briefBullets`) need the recorded runs and the task briefs. It takes `(file, resultsSha256, tasks: ApprovedTasks, runs)`; `rejudgeWithCoverage` is the caller and its signature is as planned. Plans 04-64 and 04-65 that call `loadCoverage` directly must pass the approved tasks and `readCoverageRuns(...).runs`.

**2. `readCoverageRuns` is a new export.** `readRecordedRuns` already exists in the file (the `--merge` reader, different shape), so the read-only reader of the results file with task and runId has another name. `rejudgeResultsFile` is unchanged.

**3. Uncountable launches record the cap whatever finished.** The task action says "launched is undefined and finished is 0"; the plan truth and T-04-162 say launches that cannot be counted record the cap. The stricter reading is implemented (under-recording is the failure the ledger exists to prevent). A store file that does not exist leaves `launched` undefined, so such a step records the cap, as it did before.

**4. Extra refusals in `loadCoverage`.** A coverage entry whose `runId` differs from the recorded one, an entry for a run that was not recorded, and an entry for a task not on the approved list are refused. All are inconsistencies of the kind the plan's pins exist to catch.

**5. `editedPaths` also reads `notebook_path`.** Claude's NotebookEdit tool names its file `notebook_path`; `file_path` is read first and `notebook_path` only for NotebookEdit.

**6. `spendStep`'s context type gains an optional `log`.** `Pick<LiveContext, 'plan' | 'claudeVersion'> & Partial<Pick<LiveContext, 'log'>>`, so existing callers and tests that pass no logger still type-check; `LiveContext` callers log.

**Total deviations:** 0 auto-fixed; 6 interpretations above. **Impact on plan:** none on scope; every item is inside the plan's files and tests.

## Issues Encountered

- A new export name collided with the existing `readRecordedRuns` (TypeScript duplicate-declaration error at the first typecheck); renamed to `readCoverageRuns` before the Task 1 commit.
- `editedPaths` takes the part after the LAST `/clone/` as the plan specifies. A repository path that itself contains a `clone/` directory would be cut short; the recorded transcripts do not have one.
- `npm run lint` does not exist in this repository; the verification set is the plan's (unit tests, typecheck, boundaries). A full `npm test` was not run.

## Known Stubs

None.

## Threat Flags

None. The plan adds no network, auth or file-write surface; the new functions read files only.

## Documentation surfaces (for plan 04-69; findings.md's harness line)

- **New harness exports, no mode and no flag:** `briefBullets`, `judgeWithCoverage`, `rejudgeWithCoverage`, `loadCoverage`, `loadAmendment`, `readCoverageRuns`, `editedPaths`, and `costsOf` (now exported) in `scripts/eval-retrieval.ts`. They are pure or read-only: no model, no spend, no file written. `rejudge` and `rejudgeResultsFile` (ADR-016) are unchanged and `eval-verdict-adr016.json` still equals their output.
- **Two new record kinds the harness reads:** `avarice-eval-brief-coverage` and `avarice-eval-success-amendment` (decision ADR-017), each pinned by sha256 (results and tasks digests; the amendment to `eval-tasks.json`), the amendment needing both `approvedBy` and `approvedAt`. `eval-tasks.json` is never edited. A re-judgement output has kind `avarice-ac8-rejudgement` with decision ADR-017.
- **briefFor scope text (affects future runs only):** the line naming the required checks is kept; "out of scope ... do not write it" is replaced by "an end-to-end or browser test the brief asks for cannot be run here, and it is still part of the change: write it as the brief asks, do not try to run it, and do not stop to ask about running it". The 18 recorded runs were given the old text; ADR-017 (plan 04-65) states this.
- **stepSpendUsd rule (GIN-04):** records the cap when the exit code is null, when launch rows cannot be counted, or when launches exceed finished invocations; the charge when every launch finished; 0 (no ledger entry, a log line "no host started") for a step that exited with a code and recorded no `launch:` step row. A launch row is a `launch:` step of `run_steps` (run) or `onboarding_steps` (onboarding).
- **findings.md line:** `scripts/eval-retrieval.ts` (briefFor scope text, `costsOf`/`stepSpendUsd`): the brief text and the spend rule changed after the 18 recorded runs; the proposal text in `docs/operations-and-testing.md` still says success is "the accepted change in reviewer judgment" and needs the owner to decide which side moves (the amendment file is the planned route).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 04-64 (record coverage, owner re-approval) and 04-65 (verdict, ADR-017) can call `rejudgeWithCoverage` and `loadCoverage`/`loadAmendment` as listed above; the coverage and amendment files themselves do not exist yet.
- No blockers.

## Self-Check

## Self-Check: PASSED

All five created or modified files exist; the six task commits (093c170, 8879f03, 3f4cf44, f3d4a7b, 3df584b, ba323be) are on the branch history of HEAD.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-24*
