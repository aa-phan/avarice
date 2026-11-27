---
phase: 02-contained-unattended-run-of-one-work-item
plan: 11
subsystem: containment-hook
tags: [hook, read-before-edit, digest, loop-limits, escalation, fail-closed, con-7, con-14, nfr-5]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-03 hook_reads table (migration 0002), 02-08 computeRunScope and the run hook policy fields, 02-09 the run unit's tool use (the model reads before it edits)"
provides:
  - "src/domain/hook-decision.ts: decideReadBeforeEdit (rules edit-without-read, file-changed-since-read), loopLimitOf, rule ineffective-search, HookPolicy fields readBeforeEdit and loopLimits, HookDecision.reason"
  - "src/hook/pre-tool-use.ts: digest recording at PostToolUse (hook_reads upsert inside BEGIN IMMEDIATE), read-before-edit and loop limits at PreToolUse, `continue: false` with stopReason, event loop.limit"
  - "ROUTINE_PRESET.escalation.consecutiveSearches = 25; scope fields readBeforeEdit and escalation; policy fields readBeforeEdit and loopLimits"
  - "scripts/hook-bench.ts --policy run; evidence 02-11-red-evidence-task{1,2}.json"
affects: [02-12, 02-16, 02-17, 02-19]

actuals:
  tokens: 23000
  tasks: 2
  commits: 2
commits: 2
plan_head_before: 98327d560845932dc6bf63f39bcffbecd9347f6e
plan_head_after: 1867352ad36bfc92fddd3069d42cd6b15c3dc4a0

tech-stack:
  added: []
  patterns:
    - "The decision stays pure: the hook entry stats and hashes the file and reads the recorded digest, and passes both into decideReadBeforeEdit; the domain reads no file"
    - "Loop counts are read from this invocation's hook.decision events ordered by seq inside the transaction that appends the deny, so the count and the stop are one step"
    - "New run controls are policy-gated (readBeforeEdit, loopLimits present only on run policies), so an onboarding policy file and its decisions are byte-identical to Phase 1's"

key-files:
  created:
    - test/integration/hook-read-digest.test.ts
    - test/integration/run-loops.test.ts
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-11-red-evidence-task1.json
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-11-red-evidence-task2.json
  modified:
    - src/domain/hook-decision.ts
    - src/hook/pre-tool-use.ts
    - src/adapters/host-claude/hook-policy.ts
    - src/domain/invocation-scope.ts
    - src/domain/run-contract.ts
    - scripts/hook-bench.ts
    - test/unit/hook-decision.test.ts
    - test/unit/run-scope.test.ts
    - test/unit/run-contract.test.ts
    - test/integration/hook.test.ts
    - test/helpers/hook-fixture.ts
    - docs/containment.md
    - docs/contracts-and-state.md

key-decisions:
  - "Read-before-edit and loop limits are added only as denials behind policy fields that computeRunScope sets for the run purpose: the onboarding purposes' hook decisions are unchanged (the full suite, including the Phase 1 hook suites, passes untouched except one run-purpose test that now reads first)"
  - "Digests are stored as `sha256:<hex>`, or `size:<n>:mtime:<ms>` above 8 MiB; PostToolUse records only paths under the clone or a write root (scratch), never a failed call, a missing file or a path outside, so an unrecorded path is refused at the next edit rather than allowed"
  - "A search counts toward the run of searches whatever its decision; a shell call or skill neither adds to nor ends the run; an allowed Read, Edit, Write, MultiEdit or NotebookEdit ends it. The refused search is itself a denial, so it also feeds the denial count"
  - "A stop is recorded at every call that reaches a limit (the 3rd denial and any later one), so the supervisor finds the loop.limit event whichever call it looks at; the 3rd-denial scenario writes exactly one"
  - "A contract stored before consecutiveSearches existed leaves the search limit at the preset value (computeRunScope falls back per field)"

requirements-completed: [CON-7, CON-14, CON-13, NFR-5]

coverage:
  - id: D1
    description: "PostToolUse of Read, Edit, Write, MultiEdit and NotebookEdit records the file's SHA-256 into hook_reads keyed by invocation, agent and canonical path, inside BEGIN IMMEDIATE"
    requirement: "CON-7"
    verification:
      - kind: integration
        ref: "test/integration/hook-read-digest.test.ts#records the SHA-256 of the file as read from disk at PostToolUse of a Read, keyed by invocation, agent and canonical path"
        status: pass
    human_judgment: false
  - id: D2
    description: "An edit with no read by the same agent is denied edit-without-read, a changed file file-changed-since-read, with a reason telling the model to read the file again; a new-file Write needs no read; a subagent read counts for no one else; every error path exits 2"
    requirement: "CON-7"
    verification:
      - kind: integration
        ref: "test/integration/hook-read-digest.test.ts (14 tests through the real hook entry) and test/unit/hook-decision.test.ts#decideReadBeforeEdit"
        status: pass
    human_judgment: false
  - id: D3
    description: "The 3rd consecutive denial stops the invocation (continue false, stopReason, loop.limit event); the 26th search after 25 is denied ineffective-search with the same stop; boundary, adjacency, empty, ordering and precision edges"
    requirement: "CON-14"
    verification:
      - kind: integration
        ref: "test/integration/run-loops.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two hook processes recording reads for one invocation at once both commit with the digests each read (6 pairs)"
    requirement: "NFR-5"
    verification:
      - kind: integration
        ref: "test/integration/run-loops.test.ts#commits both rows with the digest each process read, over repeated pairs"
        status: pass
    human_judgment: false
  - id: D5
    description: "The hook stays inside the Phase 1 latency budget with read recording on"
    requirement: "NFR-5"
    verification:
      - kind: other
        ref: "node scripts/hook-bench.ts --policy run (post Read p95 93.7 ms, pre Edit p95 94.4 ms, limit 150 ms)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Behavior against the live host (the model actually reading before it edits under the new rule) is not exercised here; plan 02-17 and the Phase 2 live cases do"
    requirement: "CON-7"
    verification: []
    human_judgment: true
    rationale: "The live model's read-then-edit habit is only observable in a real run, and live spend is gated by D-15; this plan ran no live case"

duration: 23 min
completed: 2026-11-05
---

# Phase 2 Plan 11: Read-before-edit and loop limits in the run hook Summary

**The run hook now refuses an edit of a file the same agent has not read in this invocation or that changed since (SHA-256 recorded at PostToolUse in `hook_reads`), and stops an invocation after 3 consecutive denials or 25 searches with no read, with `continue: false` and a `loop.limit` event, all fail closed and under 100 ms.**

## Performance

- **Duration:** 23 min
- **Tasks:** 2 (a tracer, then loop limits)
- **Files:** 17 (6 source and script, 7 test, 2 docs, 2 RED evidence)

## Accomplishments

- Read-before-edit (CON-7): `decideReadBeforeEdit` is pure; the hook entry stats and hashes the canonical target before opening the ledger, reads the recorded digest for (invocation, agent or `''`, canonical path) inside `BEGIN IMMEDIATE`, and denies before the budget is charged. The deny reason reads `avarice: <rule>: read <clone-relative path> again before editing it`. PostToolUse of Read, Edit, Write, MultiEdit and NotebookEdit upserts the digest with the seq of the `tool.completed` event appended in the same transaction, so a successful Edit refreshes its own record and a second Edit needs no new Read.
- Loop limits (CON-14): after `escalation.consecutiveDenials` denials in a row (by `hook.decision` seq, counted in the transaction that appends the deny) the deny output also carries `continue: false` and `stopReason: "AVARICE: 3 consecutive denials; the run is stopped for escalation"`, and a `loop.limit` event with runId, invocationId, reason, count and limit is appended. After `escalation.consecutiveSearches` (25, new in `ROUTINE_PRESET`, so `policyRevision` changes) Grep or Glob calls with no Read, Edit or Write between them the next search is denied `ineffective-search` with the same stop.
- Plumbing: `computeRunScope` sets `readBeforeEdit` and carries the contract's limits (preset fallback for older stored contracts); `buildHookPolicy` writes `readBeforeEdit` and `loopLimits`; `parseHookPolicy` validates both.
- Latency: `node scripts/hook-bench.ts --policy run` times 30 rounds of a post Read and a pre Edit: p95 93.7 ms and 94.4 ms (limit 150 ms); the default mode is unchanged at 94.0 ms.

## Task Commits

1. **Task 1 (tracer): read-before-edit** - `fe5444a` (feat). RED recorded in `02-11-red-evidence-task1.json`.
2. **Task 2: loop limits, concurrency and latency checks** - `1867352` (feat). RED recorded in `02-11-red-evidence-task2.json`.

Tracer gate: the end-to-end `<verify>` (`hook-decision`, `hook-read-digest`, `hook` suites) was re-run green before the expansion task; auto mode is not active (`_auto_chain_active` false) and `human_verify_mode` is the default, and the tracer carries only an automated verify.

## Verification

- `node --test` on `hook-decision`, `hook-read-digest`, `run-loops`, `hook`, `run-contract` and `containment/failclosed`: 315 pass, 0 fail.
- `node scripts/hook-bench.ts --policy run`: p95 93.7 ms (post Read) and 94.4 ms (pre Edit).
- `npx tsc -p .` and `node scripts/check-boundaries.ts`: clean (70 files).
- Full suite: 1969 tests, 1941 pass, 25 skipped, 3 failed under load (`claude-host.test.ts` "follows SIGTERM with SIGKILL after the grace", and the two `fail-closed` WR-07 / FC-10 probe-retry tests, the known load-sensitive flake from the brief). `test/mutation/fail-closed.test.ts` (35/35) and `test/integration/claude-host.test.ts` (39/39) pass alone; no file was edited to make them pass.
- Acceptance: `grep -c "readFileSync\|statSync" src/domain/hook-decision.ts` is 0; `grep -c "loop.limit" src/hook/pre-tool-use.ts` is 3; `hook-read-digest.test.ts` has 14 tests through the real hook entry; the concurrency test runs two hook processes in parallel and asserts both rows (6 pairs).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] An existing run-purpose test edited a file it never read**
- **Found during:** Task 1
- **Issue:** `test/integration/hook.test.ts` "allows an Edit on a file in the write set" sends an Edit with no prior Read; with `readBeforeEdit` now on for the run scope it is correctly denied `edit-without-read`.
- **Fix:** the test records a Read through the real PostToolUse first, as a model would; its intent (the write-set rule and one toolCalls charge) is unchanged. The same test file also asserts `readBeforeEdit` and `loopLimits` on the written policy.
- **Files modified:** `test/integration/hook.test.ts`
- **Commit:** fe5444a

**2. [Rule 3 - Blocking] The hook test fixture's ledger had no `hook_reads` table**
- **Found during:** Task 1
- **Issue:** `makeHookFixture` migrated only 0001, so the run hook's SQL had no table.
- **Fix:** the fixture migrates 0001 and 0002 (the real ledger's shape); all Phase 1 hook suites still pass.
- **Files modified:** `test/helpers/hook-fixture.ts`
- **Commit:** fe5444a

### Plan interpretation notes

- `loopLimitOf` and the policy validation for `loopLimits` were committed with Task 1 (they sit in the same domain file and test file as `decideReadBeforeEdit`); the hook entry wiring, preset change and `loop.limit` event belong to Task 2.
- The plan's `src/domain/run-contract.ts` fixture note ("update the run-contract test fixture value") needed no fixture change: no fixture hard-coded the escalation block; the contract test gained an assertion for the new field instead.
- Docs: the Stale-edits row of `docs/containment.md` and the escalation example of `docs/contracts-and-state.md` were brought in line with the code.

**Total deviations:** 2 auto-fixed (1 bug in an existing test's setup, 1 blocking fixture gap). **Impact:** none on scope; onboarding hook decisions are unchanged.

## Known Stubs

None.

## Threat Flags

None. The plan adds no endpoint, auth path or schema; `hook_reads` is Phase 02-03's table and is written only by the hook with its own SQL.

## Issues Encountered

- A write between the tool call and the hook's own digest read could be recorded as the agent's read (flagged assumption A6, accepted: the window is the hook's own latency).
- T-02-37 stays accepted by design: a Bash write bypasses read-before-edit; the sandbox confines where it lands and a later Edit sees the changed digest.
- The live model's behavior under the new rule is not exercised in this plan (no live case was run, no spend); plans 02-17 and the Phase 2 live cases cover it.

## Next Phase Readiness

Ready for the plans that run a unit end to end: a stopped invocation shows up as `continue: false` from the host and a `loop.limit` event in the ledger for the supervisor to read and escalate (plan 02-16/02-17 decide what the run does with it).

## Self-Check: PASSED

- Files: `src/domain/hook-decision.ts`, `src/hook/pre-tool-use.ts`, `test/integration/hook-read-digest.test.ts`, `test/integration/run-loops.test.ts`, `scripts/hook-bench.ts`, both RED evidence files exist.
- Commits `fe5444a` and `1867352` are ancestors of HEAD; `git rev-list --count 98327d5..HEAD` measured 2 before this summary.
