---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 13
subsystem: status
tags: [status, ledger, sqlite, performance, ops-5, ac-2, sc2, t-04-33, t-04-34, typescript]

requires:
  - phase: 04-08
    provides: "migration 0004: the run_id indexes on decisions, gate_results and notifications, and runs_project"
provides:
  - "Ledger.loadRunStatusInputs and RunStatusInputs: every per-run table status reads, for any number of runs, in one bound IN query per table per 500 runs"
  - "getRunStatuses built on one batch read instead of nine to eleven reads per run"
  - "scripts/status-bench.ts: seeds N runs, times real status --json processes, prints p50Ms, p95Ms and emptyP50Ms, exits 1 at 300 ms p95"
  - "test/integration/status-queries.test.ts: the constant statement count guard and the batch-equals-per-run equivalence cases"
affects: [04-34, 04-38]

actuals:
  tokens: 21000
  tasks: 2
  commits: 3
plan_head_before: 605560df3391e581186ef25e1144eff06b0cde7c
plan_head_after: 16f86af6dfe0d6dbffc1f9d111ac1f680f40ed5a
commits: 3

tech-stack:
  added: []
  patterns:
    - "A batch read deals rows to runs from one ordered query per table, so each run's list is the list its per-run read returns"
    - "Statement counting by wrapping db.prepare around a call guards a query count without a timing assertion"

key-files:
  created:
    - scripts/status-bench.ts
    - test/integration/status-queries.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-13-red-task1.json
  modified:
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/app/run-status.ts

key-decisions:
  - "loadRunStatusInputs checks that every ID is a run (not an onboarding carrier) with one query per chunk and answers not_found otherwise, so the batch refuses what lockRun refused in the per-run reads"
  - "The latest contract of each run is chosen in SQL by a join on MAX(version), so the bodies of older contract versions are never read"
  - "The batch is not wrapped in a transaction: status stays read-only and takes no lock, as the per-run reads were, so a run changing while status reads shows what each statement saw"
  - "The bench seeds through the ledger's own write methods with synchronous=OFF for speed instead of cloning rows by SQL, so the store obeys every trigger and constraint a real one does"

patterns-established:
  - "Interrupted-run attempts are part of the batch for every run (RunStatusInputs.attempts), so the status path issues no per-run query even for an interrupted run"

requirements-completed: [OPS-5]

coverage:
  - id: D1
    description: "getRunStatuses prepares the same number of SQL statements over 10 runs and over 200 runs, and a small fixed number (at most 20 for 50 runs) rather than one set per run"
    requirement: OPS-5
    verification:
      - kind: integration
        ref: "test/integration/status-queries.test.ts#status issues a number of statements that does not grow with the runs (tracer; AC-2, T-04-33)"
        status: pass
    human_judgment: false
  - id: D2
    description: "loadRunStatusInputs returns, for every table of every run, the rows and order of the per-run read; keeps runs apart; handles an empty list, more IDs than one chunk and repeated IDs; refuses an unknown ID as not_found; binds hostile IDs as data"
    requirement: OPS-5
    verification:
      - kind: integration
        ref: "test/integration/status-queries.test.ts#loadRunStatusInputs returns what the per-run reads return"
        status: pass
    human_judgment: false
  - id: D3
    description: "Status entries for a store with active, blocked, interrupted and ready runs equal those built from the per-run reads, and the frozen status and inbox JSON snapshots pass with test/fixtures/json-shapes unchanged"
    requirement: OPS-5
    verification:
      - kind: integration
        ref: "test/integration/status-queries.test.ts#getRunStatuses over a store with active, blocked, interrupted and ready runs"
        status: pass
      - kind: integration
        ref: "test/integration/run-status.test.ts"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "status --json with 1,000 runs runs in under 300 ms at p95 over 30 timed process runs (measured 192 and 212 ms in two bench runs)"
    requirement: OPS-5
    verification:
      - kind: command
        ref: "node scripts/status-bench.ts --runs 1000 --samples 30"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 13: Status under 300 ms with 1,000 runs Summary

**`avarice status --json` over 1,000 runs now answers in a median of 171 to 182 ms and a p95 of 192 to 212 ms (limit 300), because the read model loads every per-run table in one batch of bound `IN` queries instead of nine or more queries per run, with output byte-identical to before**

## Performance

- **Duration:** 40 min (approximate; start time not recorded)
- **Tasks:** 2
- **Files modified:** 6 (3 source, 1 test, 1 script, 1 RED record)

## Measured result for plan 04-34 (AC-2)

Command: `caffeinate -i node scripts/status-bench.ts --runs 1000 --samples 30`, quiet machine, Node v26.9.0, process wall time including Node start.

| Run | runs | samples | p50Ms | p95Ms | emptyP50Ms |
| --- | ---- | ------- | ----- | ----- | ---------- |
| 1   | 1000 | 30      | 171   | 192   | 134        |
| 2   | 1000 | 30      | 182   | 212   | 137        |

Both exit 0 (p95 below 300). The empty-store floor is about 135 ms, so status over 1,000 runs costs about 40 to 50 ms above the floor. Before this plan RESEARCH measured a p50 of 924 ms (1,016 runs) and 360 ms with the indexes alone. The statement guard measured 159 statements for 10 runs and 3,201 for 200 runs before the change; after it the two counts are equal.

Note for 04-34: the bench seeds four run shapes in equal parts (ready, active, blocked with a decision and a banner, interrupted), each with a contract, two budgets, two work items, one attempt with evidence, one gate result and two steps. A store whose runs carry many more events or checkpoints per run is not what this measures.

## Accomplishments

- **Tracer (Task 1):** RED recorded first (`04-13-red-task1.json`, `RED_EVIDENCE_OK`): 159 statements for 10 runs against 3,201 for 200. `loadRunStatusInputs` reads checkpoints, evidence (through its attempt join), gate results, decisions, work items, notifications, budgets, the latest contract, steps and attempts with one query per table per chunk of at most 500 distinct IDs, every ID a bound parameter. `getRunStatuses` calls it once; `statusOf` and `interruptedOf` are now pure functions of the loaded rows and produce the same values as before.
- **Bench (Task 2):** `scripts/status-bench.ts` builds a store through the first real `status` call, seeds N runs through the ledger, checks that status lists exactly N runs, then times the real entry and exits 1 at a p95 of 300 ms or more.

## Task Commits

1. **Task 1 RED:** `7de5155` test(04-13): add failing tests for a constant statement count in status
2. **Task 1 GREEN:** `f2d7ea5` feat(04-13): read every per-run status table in one batch
3. **Task 2:** `16f86af` feat(04-13): add the status latency bench for AC-2

No REFACTOR commit: nothing to restructure after GREEN.

## Verification

- `node --test test/integration/status-queries.test.ts test/integration/run-status.test.ts test/unit/json-shapes.test.ts`: 52 tests, 0 fail.
- Related integration files that read status through `getRunStatuses` (ledger-status, run-resume, run-decision-resume, shell, resume-reap, run-cancel): 101 tests, 0 fail.
- `git diff --quiet -- test/fixtures/json-shapes` exits 0 (AVARICE_SNAPSHOT_WRITE was never set).
- `npm run typecheck` and `npm run check:boundaries` pass.
- The full `npm test` was not run (about 20 minutes); the orchestrator runs it at the end of the wave.

## Deviations from Plan

### Interpretation

- The plan says the bench builds the store by "cloning a template set of run rows with new IDs". The script seeds each run by calling the ledger's own write methods with the same row shapes in every run, rather than copying rows by SQL. This keeps every insert-only trigger and constraint in force and cannot drift from the schema; the cost is a few seconds of seeding with `PRAGMA synchronous = OFF` (not measured). No behavior of the plan changes.

None - otherwise the plan was executed as written. No Rule 1 to 4 deviations.

## Decisions needing owner review

None. No policy or security semantics were invented: the batch method is read-only, mirrors the not_found behavior of the per-run reads, and binds every ID as a parameter (T-04-34).

## Threat model

- T-04-33 (status unusable with many runs): mitigated by the batch read, migration 0004 indexes, the constant statement count guard and the bench gate.
- T-04-34 (IN-list SQL built from IDs): mitigated; the SQL text holds only `?` placeholders, and a test passes `run_1' OR '1'='1` and a `DROP TABLE` fragment as IDs and observes not_found with the runs table intact.
- No new network endpoint, auth path or trust-boundary file access: no threat flags.

## Known Stubs

None.

## Known limits

- The statement count is constant up to 500 runs and grows by one set of ten queries for each further 500 runs (1,000 runs prepare 2 chunks). That is the plan's chunk size; the guard compares 10 and 200 runs.
- `loadRunStatusInputs` loads attempts for every run although only an interrupted run uses them; at 1,000 runs this was not measurable against the 135 ms floor.

## Documentation surfaces (for plan 04-38)

- `docs/system/data-model.md`: the Ledger port gains `loadRunStatusInputs` and `RunStatusInputs`; the status read model builds each run from one batch (the nine per-run reads are no longer on the status path).
- `docs/system/cli-reference.md`: `status` and `status --json` output is unchanged; state the measured latency bound (p95 under 300 ms at 1,000 runs, from the bench) if the document records performance.
- `docs/system/coverage.md` and the proposals table in `docs/system/README.md`: update if a count or a counterpart row changes (a new bench script and a new integration test file).
- `docs/system/config-reference.md`: no change (no config key, flag, table, event or exit code was added).
- `scripts/status-bench.ts` takes `--runs <n>` (default 1000) and `--samples <n>` (default 30) and exits 1 when p95Ms is 300 or more; list it wherever the other bench scripts (`scripts/hook-bench.ts`) are listed.

## Self-Check: PASSED

- FOUND: scripts/status-bench.ts, test/integration/status-queries.test.ts, 04-13-red-task1.json, src/ports/ledger.ts, src/adapters/sqlite/ledger.ts, src/app/run-status.ts
- FOUND commits: 7de5155, f2d7ea5, 16f86af
