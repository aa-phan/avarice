---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 33
subsystem: testing
tags: [portability-proof, fake-remote, contract-suite, seeded-faults, command-executor, artifact-store, nfr-4, ac-7]

requires:
  - phase: 04-32
    provides: "descriptors on every port and the DepsOverrides.artifacts seam beside DepsOverrides.executor"
provides:
  - "FakeRemoteExecutor and FakeRemoteArtifactStore: JSON-serialized, delayed, lossy (5% dropped, 2% duplicated) from a seeded random source"
  - "AVARICE_TEST_REMOTE, AVARICE_TEST_REMOTE_SEED, AVARICE_TEST_REMOTE_LOG and AVARICE_TEST_REMOTE_ROOT in the test CLI"
  - "test/contract: one case list per port (CommandExecutor, ArtifactStore) run against the local and the fake-remote adapters, and a README of what the proof does not show"
  - "test/integration/portability-proof.test.ts: onboarding with indexes, a run to ready_for_review, a discard and retry and a kill and resume reach equal end states over both adapter sets, with 0 lines changed under src/"
affects: [04-37, phase-07]

actuals:
  tokens: 21000
  tasks: 3
  commits: 4
plan_head_before: b1209b34a7f5747c29c81d506626877c3730a3cd
plan_head_after: e872c1d9563495f51c3bfa2ab4b42ff383a1e5a1

tech-stack:
  added: []
  patterns:
    - "A seeded fault source (mulberry32) whose events carry a per-call id, so a test asserts on calls, not on keys that can repeat"
    - "A contract-case module that only exports cases and a registration function, imported by one runner per adapter set"
    - "The fake is its own server: it stores a response under the invocation key until the client has it, so a retry after a dropped response never runs the command again"

key-files:
  created:
    - test/helpers/seeded-faults.ts
    - test/helpers/fake-remote-executor.ts
    - test/helpers/fake-remote-artifact-store.ts
    - test/contract/README.md
    - test/contract/command-executor.cases.ts
    - test/contract/artifact-store.cases.ts
    - test/contract/local.test.ts
    - test/contract/fake-remote.test.ts
    - test/integration/portability-proof.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-33-red-task1.json
  modified:
    - test/helpers/test-cli.ts

key-decisions:
  - "Tracer seed is 3, not 42: seed 42 drops three responses and duplicates none over the 11 commands of an onboarding; seed 3 is the first seed that does both"
  - "The workflow suite runs seeds 3 and 14, not 42: seed 42 shows no duplicate across the three run scenarios"
  - "The fake executor keys a response by invocation id plus a digest of the call, and forgets the key once the client has the response"
  - "AC-7 is measured over the commits whose subject names (04-33), with the plan base recorded, because plans after this one change src legitimately"
  - "The no-double-run assertion is per call, not per invocation key, because the domain reuses invocation ids across separate calls"
  - "The intel index digest is masked in the onboarding comparison because the intel files carry a write time"

requirements-completed: [NFR-4, FR-16]

coverage:
  - id: D1
    description: "Fake-remote CommandExecutor and ArtifactStore serialize every call through JSON, add latency, drop 5% and duplicate 2% of responses from a seeded source, reproducibly"
    requirement: NFR-4
    verification:
      - kind: unit
        ref: "test/contract/fake-remote.test.ts#SeededFaults drops about 5% and duplicates about 2% by default, and keeps latency within its range"
        status: pass
      - kind: unit
        ref: "test/contract/fake-remote.test.ts#SeededFaults draws the same sequence from the same seed and a different one from another"
        status: pass
    human_judgment: false
  - id: D2
    description: "One shared contract suite runs the same cases against the local and the fake-remote adapters (three seeds) and passes on both"
    requirement: NFR-4
    verification:
      - kind: integration
        ref: "node --test test/contract/local.test.ts test/contract/fake-remote.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The workflow suite (onboarding with indexes, a run to ready_for_review, a discard and retry, a kill and resume) reaches the same end states over local and fake-remote adapters"
    requirement: NFR-4
    verification:
      - kind: integration
        ref: "test/integration/portability-proof.test.ts#the workflow suite twice"
        status: pass
    human_judgment: false
  - id: D4
    description: "AC-7: this plan's commits change 0 lines under src/; the swap is configuration through DepsOverrides selected by AVARICE_TEST_REMOTE in the test CLI, which no file under src, bin or scripts names"
    requirement: NFR-4
    verification:
      - kind: integration
        ref: "test/integration/portability-proof.test.ts#AC-7: the swap is configuration, not a change to the source (T-04-91)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A command whose response was dropped is never run twice and a duplicated response is discarded"
    requirement: NFR-4
    verification:
      - kind: unit
        ref: "test/contract/fake-remote.test.ts#FakeRemoteExecutor faults (T-04-90)"
        status: pass
      - kind: integration
        ref: "test/integration/portability-proof.test.ts#no command ran twice under seed"
        status: pass
    human_judgment: false
  - id: D6
    description: "test/contract/README.md states what the proof shows and what only a real deployment shows (partitions beyond the retry bound, real latency distributions, remote authentication, filesystem semantics, worker differences)"
    verification: []
    human_judgment: true
    rationale: "The honesty of a prose statement about the limits of a proof is a reading judgment no test asserts"

duration: 40min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 33: The portability proof Summary

**Seeded fake-remote CommandExecutor and ArtifactStore (JSON-serialized, delayed, 5% dropped, 2% duplicated) selected by `AVARICE_TEST_REMOTE` in the test CLI, a shared contract suite run against local and fake adapters, and four workflows reaching equal end states over both, with 0 lines changed under `src/`.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-11-17T14:35:00Z (estimated; not recorded at start)
- **Completed:** 2026-11-17T15:16:00Z
- **Tasks:** 3
- **Files modified:** 11 (10 new, `test/helpers/test-cli.ts` changed)

## Accomplishments

- `FakeRemoteExecutor` wraps a real executor and behaves like a remote one: the call crosses as JSON text, takes a seeded 5 to 30 ms, and its response is dropped 5% and duplicated 2% of the time. The fake keeps the response under the invocation key until the client has it, so the retry after a dropped response is answered from the store and the command never runs again; after six lost responses in a row the call ends `timeout` with `sideEffect: 'unknown'`. A duplicate is delivered under a settled key and discarded.
- `FakeRemoteArtifactStore` keeps blobs in a `LocalArtifactStore` under a root of its own, serializes bytes as base64 JSON, waits with `Atomics.wait` (1 to 5 ms), retries a dropped response by digest (the put is a no-op the second time) up to three attempts, then reports `unavailable`.
- The test CLI composes both fakes through the existing `DepsOverrides` seam when `AVARICE_TEST_REMOTE=1` (`AVARICE_TEST_REMOTE_SEED`, `_LOG`, `_ROOT`). The production entry ignores it, a test proves it, and no file under `src`, `bin` or `scripts` names the variable (T-04-91).
- `test/contract` holds one case list per port: 11 executor cases (exit status and output, truncation, timeout, abort, a pre-aborted signal, scrubbed environment, network denied, writes confined, reads denied, invalid specs) and 10 artifact cases (digest and size, idempotent put, empty and distinct content, binary round trip, not_found, a tampered blob is `internal`, repair by put, has, malformed digests, descriptor). `local.test.ts` and `fake-remote.test.ts` (three seeds: 42, 7, 1337) import the same lists.
- `portability-proof.test.ts` runs, each locally and with fake-remote adapters (seeds 3 and 14): onboarding to active, onboarding with the intel index and code graph (in process), a run to `ready_for_review`, a discard and retry, and a kill during verification followed by a resume in a fresh process. Run state, item states and attempts, every evidence row, every gate and the tree of the handed-off commit are equal. The record, its indexes, its map digests and its snapshot manifest are equal.

## Task Commits

1. **Task 1 (tracer, TDD): one onboarding to active through the fakes** - RED `8c1dddf` (test), GREEN `aa28177` (feat)
2. **Task 2: the shared contract suite** - `fe90c03` (test)
3. **Task 3: the workflow suite twice and the zero-line measurement** - `e872c1d` (test)

**Plan metadata:** the docs commits that carry this SUMMARY and the state update.

## RED evidence (Task 1)

- Command: `node --test --test-reporter=tap test/integration/portability-proof.test.ts`, exit 1; `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`); record at `04-33-red-task1.json`.
- Target: "seed 3 dropped at least one response and duplicated at least one, and no command ran twice", failing on its own assertion (drops 0, expected at least 1) with the original `test-cli.ts` that ignores `AVARICE_TEST_REMOTE`.
- Semantic assessment: the target ran and failed for the planned missing behavior; the test that both onboardings reach active passed, so fixture and CLI setup are sound; the two other tracer tests failed for the same cause (the remote run recorded the local adapters). The first RED attempt failed inside the describe body (zero tests discovered, INVALID_RED); the fixture was changed to return what it could read, and the committed RED is the second run.
- Tracer gate: the `<verify>` was re-run after GREEN and again with the full plan verification before expansion was considered finished; it passed.

## AC-7 measurement

- Base commit recorded at plan start: `b1209b34a7f5747c29c81d506626877c3730a3cd`.
- `git log --name-only --format= b1209b34a7f5747c29c81d506626877c3730a3cd..HEAD -- src` after the last task commit (`e872c1d`): empty output, 0 lines.
- The suite asserts the same over the plan's commits found by subject (`git log -E --grep='^[a-z]+\(04-33\):' <base>..HEAD -- src`), at least three commits, nothing listed. It does not assert it over `<base>..HEAD` as a whole, because plans 04-34 to 04-39 change `src/`.

## Verification

- `node --test test/integration/portability-proof.test.ts test/contract/local.test.ts test/contract/fake-remote.test.ts`: 121 pass, 0 fail (about 87 s).
- `npm run typecheck`, `npm run check:boundaries`: clean.
- Unit tier (`test/unit`): 2765 pass, 0 fail. Related integration files (`run-baseline-workflow`, `onboard-adopt`, `skeleton`, plus the plan 04-22 gates `profile-isolation` and `redaction-suite`): 74 pass, 0 fail. The full suite is left to the orchestrator.
- Every new non-test file passes inert under bare `node --test` (`seeded-faults`, both fakes, both cases modules, `test-cli`).
- Mutation check: removing the fake's by-key answer makes the "never run twice" tests fail.

## Decisions needing owner review

1. **The domain reuses invocation ids across separate calls.** `src/adapters/gsd/gsd-tools.ts:91` names every GSD verb call `gsd:<verb>` and `src/adapters/graph/graphify.ts:122` builds `graphify:<id>`, so two separate calls of one verb with the same arguments carry one `invocationId` (seen: `gsd:graphify` twice in the discard scenario). A real remote adapter that deduplicates by `invocationId` alone would answer the second request with the first's response. I did not change `src/` (AC-7). The fake keys by id plus a digest of the call and forgets the key when the client has the response, and the test asserts one run per call. Whether the domain should mint a per-call nonce, or the remote contract should say that the deduplication window ends at the client's acknowledgement, is for the owner to settle before Phase 7.
2. **Seeds.** The plan named seed 42. Each CLI process draws from the start of its seed's sequence, so a short process sees few faults: seed 42 gives an onboarding three drops and no duplicate, and no duplicate across the three run scenarios. The tracer uses seed 3 and the workflow suite seeds 3 and 14 so that every seed shows both faults. The contract suite does run seed 42.
3. **Retry bounds and the shape of a lost call.** Executor: six attempts, then `timeout` with `sideEffect: 'unknown'`. Store: three attempts (as planned), then `unavailable`. The contract accepts either `status: timed_out | cancelled` on the result or an error `timeout | cancelled` that names the side effect, so a remote adapter may report either.
4. **Latency.** Executor 5 to 30 ms (as planned); store 1 to 5 ms, which the plan did not fix, to keep the many small store calls from dominating the run time.
5. **Call-site enforcement for `run.handoff`, `run.install` and `onboarding.stage` (plan 04-32 decision 2).** Not wired here: it needs `src/` changes and this plan's AC-7 forbids them. Still open for a later plan or the owner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Seed 42 cannot meet the plan's own acceptance criterion**
- **Found during:** Task 1
- **Issue:** the acceptance criterion needs at least one drop and one duplicate for the tracer's seed; seed 42 gives 3 drops and 0 duplicates for the onboarding (confirmed over seeds 0 to 59 through the CLI)
- **Fix:** tracer seed 3; workflow seeds 3 and 14 (see decision 2)
- **Files modified:** test/integration/portability-proof.test.ts
- **Committed in:** `8c1dddf`, `e872c1d`

**2. [Rule 1 - Bug] The "unique invocation keys" assertion fails on legitimate repeats**
- **Found during:** Task 3 (discard and retry scenario)
- **Issue:** `gsd:graphify` with the same arguments is called twice by the domain; both runs are right, and the key repeats (decision 1)
- **Fix:** events carry a per-call id and the assertion is that each call, and every call whose response was dropped, ran exactly once
- **Files modified:** test/helpers/seeded-faults.ts, test/helpers/fake-remote-executor.ts, test/helpers/fake-remote-artifact-store.ts, test/integration/portability-proof.test.ts
- **Committed in:** `e872c1d`

**3. [Rule 1 - Bug] Intel digests differ between two onboardings of one repository**
- **Found during:** Task 3 (onboarding with indexes)
- **Issue:** the intel files carry `updated_at`, so `indexes.intel.digest` differs local to local, not only local to remote
- **Fix:** the digest is masked in the comparison; the graph digest and everything else are compared as they are. The comparison reads one shared repository, since the record holds the commit it was built at
- **Files modified:** test/integration/portability-proof.test.ts
- **Committed in:** `e872c1d`

**4. [Rule 3 - Blocking] AC-7 cannot be asserted over `BASE..HEAD` for the whole branch**
- **Found during:** Task 3
- **Issue:** a test over `<base>..HEAD` would fail as soon as plan 04-34 changes `src/`
- **Fix:** the test selects this plan's commits by their `(04-33)` subject and checks `src/` over them; the plain `<base>..HEAD` measurement is recorded above
- **Files modified:** test/integration/portability-proof.test.ts
- **Committed in:** `e872c1d`

**5. [Rule 3 - Blocking] The tracer RED first failed inside the fixture**
- **Found during:** Task 1 (RED)
- **Issue:** the describe-level fixture asserted that the manifest was in the remote store, which threw before any test ran (zero tests, INVALID_RED)
- **Fix:** the fixture returns `null` for a manifest it cannot read and a test asserts it
- **Committed in:** `8c1dddf`

---

**Total deviations:** 5 auto-fixed (3 bug, 2 blocking)
**Impact on plan:** All needed for correctness of the proof; none touch `src/`. The onboarding-with-indexes workflow runs in process (as `onboardRunRepoWithIndexes` does) rather than through the CLI, since the fake intel host is injected in process; the CLI path covers the plain onboarding.

## Issues Encountered

None beyond the deviations above.

## Documentation surfaces

For plan 04-37 (docs/system), grounded in the code:

- **Fake-remote adapters (test support):** `FakeRemoteExecutor` (invocation key = id plus digest of the call, retention until the client has the response, six attempts, then `timeout` with unknown side effect) and `FakeRemoteArtifactStore` (base64 JSON, blocking latency, three attempts, then `unavailable`, content-addressed retry), and the seeded fault source with its event log (`drop`, `duplicate`, `inner-call`, call id).
- **Test environment variables:** `AVARICE_TEST_REMOTE`, `AVARICE_TEST_REMOTE_SEED` (default 42), `AVARICE_TEST_REMOTE_LOG`, `AVARICE_TEST_REMOTE_ROOT` (default `<AVARICE_DATA_ROOT>-remote`), read only by the test CLI.
- **Contract suite:** `test/contract` layout, the two case lists (11 executor, 10 artifact), the two runners, how a Phase 7 adapter joins, and the README list of what the proof does not show.
- **Portability proof:** the four workflows run twice, the end-state comparison (run, items, attempts, evidence, gates, handed-off tree), the seeds, and the AC-7 measurement method (plan commits by subject).
- **Findings line for `findings.md`:** `src/adapters/gsd/gsd-tools.ts:91` (`gsd:<verb>`) and `src/adapters/graph/graphify.ts:122` (`graphify:<id>`) give separate calls one `invocationId`, so an adapter that deduplicates by id alone would merge them (decision 1).
- **Findings line, carried from 04-32:** `src/app/capabilities.ts` lists the new descriptors but no stage calls `requireCapabilities` for `run.handoff`, `run.install` or `onboarding.stage`.
- **Counts for `coverage.md`:** test files under `test/contract`: 4 (2 cases modules, 2 runners) plus the README; one new integration test file.

## Next Phase Readiness

Phase 7 adapters can join the contract suite by passing a factory to `runExecutorContract` or `runArtifactContract`. Decision 1 should be settled before a remote executor is written. No blockers for the next plan.

## Known Stubs

None.

## Threat Flags

None. T-04-90 (a command run twice after a dropped response) is mitigated and tested at the fake and in every workflow; T-04-91 (the seam reachable in production) is mitigated and tested: no file under `src`, `bin` or `scripts` names `AVARICE_TEST_REMOTE`, and the production entry composes the local adapters when it is set.

## Self-Check: PASSED

Created files exist (the 10 new files and the RED record); commits `8c1dddf`, `aa28177`, `fe90c03` and `e872c1d` are on the branch; `commits: 4` is measured from the ledger base `b1209b3`.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
