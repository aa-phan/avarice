---
phase: 01-contained-onboarding-of-one-repository
plan: 03
subsystem: persistence
tags: [sqlite, node-sqlite, wal, ledger, cli, migrations, hash-chain, tracer]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-01 domain contracts: Result/PortError, ids, canonical digests, onboarding lifecycle, project record"
provides:
  - "bin/avarice (and bin/avarice.ts): production CLI entry; main(argv, overrides?) with the COMMANDS allowlist; parseArgs; createDeps composition root"
  - "avarice status [--json]: read-only, offline, no lease"
  - "Schema version 1 (MIGRATION_0001) with projects, onboarding_steps and immutability and append-only triggers; checksummed forward-only migrate()"
  - "Ledger port (onboarding methods) and SqliteLedger: every state change is one BEGIN IMMEDIATE transaction with version and fence checks"
  - "AppDeps { ledger, clock, ids, profile }, getStatus/renderStatus, resolveProfile, runCli test helper"
affects: [01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-12, 01-14, phase-02]

actuals:
  tokens: 26000
  tasks: 2
  commits: 3
plan_head_before: 58e9209621d3b0ac0faa09778d769edf680c30ff
plan_head_after: 414084b064cb775a5c1847321b0a3869aeeb563e

tech-stack:
  added: []
  patterns:
    - "tx(db, fn) returns Result: BEGIN IMMEDIATE, rollback on any throw, LedgerAbort carries a PortError out of the transaction, errcode & 0xff 5/6 -> unavailable and 19 -> conflict"
    - "Commands are files under src/cli/commands exporting run(), optional readOnly and booleanFlags; main imports only COMMANDS names and treats a missing command module as exit 64"
    - "createDeps returns { ok: false, code, message } instead of exiting, so main owns stderr and the exit code"
    - "Tests seed through the ledger API and observe or tamper with raw node:sqlite handles; atomicity is proven by injecting a failing trigger on events"

key-files:
  created:
    - bin/avarice.ts
    - bin/avarice
    - src/ports/ledger.ts
    - src/adapters/sqlite/db.ts
    - src/adapters/sqlite/migrate.ts
    - src/adapters/sqlite/migrations/0001-initial.ts
    - src/adapters/sqlite/ledger.ts
    - src/adapters/fs/profile-paths.ts
    - src/app/deps.ts
    - src/app/status.ts
    - src/cli/main.ts
    - src/cli/args.ts
    - src/cli/composition.ts
    - src/cli/commands/status.ts
    - test/helpers/run-cli.ts
    - test/integration/ledger-status.test.ts
  modified: []

key-decisions:
  - "Ledger methods take epoch milliseconds from the caller (nowMs) and the adapter reads no clock; SqliteLedger takes an id function for checkpoint, attempt IDs"
  - "The blocked reason is not a column: it rides in the data of the onboarding.transition event, and OnboardingRow.reason reads the latest one. blocked requires a reason, incompatible may carry one, every other target refuses one"
  - "Checkpoint seq is continuous across the onboarding ID and its contract run ID (next = max over both + 1), so latestCheckpoint is the highest seq and UNIQUE (run_id, seq) holds after storeContract moves the run ID"
  - "acquireLease grants only a free (holder NULL) lease and increments the fence; expiry takeover is left to 01-06 so its RED tests stay red. releaseLease clears the holder and keeps the fence"
  - "Command modules export readOnly; createDeps then migrates through a read-write handle if needed, closes it and reopens the store read-only, so status holds a read-only handle and takes no lease"
  - "Event data is limited to strings of 1024 characters and 8192 characters in total; stored record, contract and step bodies are limited to 1 MiB; both are refusals (invalid) that enforce the no-document-text prohibition"
  - "insertRecordAndActivate requires body.recordVersion, when present, to equal max+1, and requires revisions.onboardedAt and gsd.version (NOT NULL columns) rather than defaulting them"

patterns-established:
  - "A stage reads the row, writes a checkpoint (recordCheckpoint, fence only), performs its side effect, then commits the transition with the version it read"
  - "An onboarding event is { type: 'onboarding.transition' | 'onboarding.checkpoint' | 'contract.stored', run_id: contract run ID or onboarding ID, data_json includes onboardingId }"

requirements-completed: [ONB-1, ONB-2, NFR-2, NFR-9]

coverage:
  - id: D1
    description: "bin/avarice status on a fresh profile creates the roots with mode 0700, opens and migrates state.db to schema version 1 in WAL mode, prints the empty list and [] with --json, works through the shebang entry and with network denied under sandbox-exec"
    requirement: NFR-2
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#status on a fresh profile (tracer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Any openDb or migrate error (not a database, checksum mismatch, store from a newer build) prints to stderr and exits 70; an unknown or unbuilt command exits 64 and never imports outside COMMANDS"
    requirement: NFR-9
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#store failures exit 70 with the reason on stderr, #CLI dispatch"
        status: pass
    human_judgment: false
  - id: D3
    description: "transitionOnboarding updates state and version and writes one checkpoint and one event in one transaction; a wrong version, stale fence, illegal edge or injected mid-transaction failure leaves every table unchanged"
    requirement: ONB-1
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#transitionOnboarding"
        status: pass
    human_judgment: false
  - id: D4
    description: "insertRecordAndActivate inserts max+1 as active with the derived columns (NULL for absent indexes), supersedes the previous active version and commits planning_ready to active in one transaction; body and digest are immutable, superseded_at is not"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#insertRecordAndActivate"
        status: pass
    human_judgment: false
  - id: D5
    description: "Event rows form a SHA-256 chain that recomputes independently from the genesis of 64 zeros; events are append-only; event data and stored bodies are bounded so no document text is stored"
    requirement: NFR-9
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#events, #insertRecordAndActivate (does not store document text)"
        status: pass
    human_judgment: false
  - id: D6
    description: "status --json over seeded rows returns the documented shape per project with the blocked reason and every index key, and a second connection confirms status wrote nothing"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/ledger-status.test.ts#status over seeded ledger rows"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-11-02
---

# Phase 01 Plan 03: Status Tracer and Onboarding Ledger Summary

**`bin/avarice status` runs type-stripped against a checksummed, WAL-mode SQLite ledger (schema version 1, immutability and append-only triggers), and `SqliteLedger` provides every onboarding operation as one `BEGIN IMMEDIATE` transaction with version and fence checks, immutable record versions and a verifiable event hash chain.**

## Performance

- **Duration:** about 11 min (start time was not recorded; estimated from the previous plan's last commit at 13:06 local and this plan's last commit at 13:17)
- **Completed:** 2026-11-02T19:17Z
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 TDD)
- **Files created:** 16

## Accomplishments

- Tracer path proven end to end: `bin/avarice` (shebang, executable, plus a `bin/avarice` symlink) -> `main` with the `COMMANDS` allowlist -> `createDeps` (profile roots, `openDb`, `migrate`) -> `getStatus` -> `Ledger` port -> `SqliteLedger` -> migrated SQLite, offline, including under `sandbox-exec` with `(deny network*)`.
- Schema version 1: the verbatim DDL of the spec's Persisted entities, Budget accounting and Decision records, plus `projects` and `onboarding_steps`, plus triggers that refuse an UPDATE of `project_records.body_json`/`digest` and `contracts.body_json`/`digest`, and any UPDATE or DELETE of `events`.
- 24 Ledger-writer and status tests (36 in the file, 100 across the repository): atomicity proven by injecting a failing `BEFORE INSERT` trigger on `events` and by a mutation (replacing `ROLLBACK` with `COMMIT` in `tx` fails exactly that test).
- Activation derives `onboarded_revision`, `gsd_version`, `mapping_*`, `completeness`, `graph_commit`, `intel_commit` and `knowledge_commit` inside `insertRecordAndActivate`, so later plans never edit it.

## Task Commits

1. **Task 1: Tracer, `bin/avarice status` end to end** - `e7a1e50` feat(01-03). Tracer feedback gate: auto mode off, `HUMAN_VERIFY_MODE` default (`end-of-phase`), `<verify>` is automated-only, so it was re-run end to end (12 of 12, full suite 76 of 76) and passed before expanding.
2. **Task 2: Complete the onboarding Ledger** (TDD)
   - RED `68c356f` test(01-03): 36 tests, 12 pass (the Task 1 tests), 24 fail
   - GREEN `414084b` feat(01-03): `SqliteLedger` writers
   - REFACTOR: none needed

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED and GREEN present in order (`68c356f` then `414084b`); REFACTOR optional and not needed.

- **RED:** `node --test --test-reporter=tap "test/integration/ledger-status.test.ts"`, exit 1, 36 tests, 12 pass, 24 fail. Target test "moves state, bumps the version, writes one checkpoint and one event". `gsd_run check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`); the record is `01-03-red-evidence.json` in this directory. Semantic assessment: the Task 1 stubs return `internal: "SqliteLedger.<method> is not implemented yet"`, so every failing test fails an assertion on `Result.ok` for the planned behavior (never a load, syntax or fixture fault); the 12 passing tests are the Task 1 tracer tests against real code. One test was tightened before the RED commit (a `must({ok:true, ...})` wrapper around a plain string was replaced by the string).
- **GREEN:** same command, 36 of 36 pass; `npm test` 100 of 100; `npx tsc -p .` and `node scripts/check-boundaries.ts` exit 0.

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans are most likely to trip on:

- Time arrives as `nowMs` on every writer and `SqliteLedger` is constructed with `(db, newId)`.
- `reason` for a blocked or incompatible onboarding lives in the transition event, not a column; read it from `OnboardingRow.reason`.
- `acquireLease` takes only a free lease. 01-06 changes the `WHERE` to include expiry and adds its tests; nothing else in this plan needs editing for that.
- A command file exports `run(args, deps, io)`, and optionally `readOnly` and `booleanFlags`; `createDeps` is called for every command (01-07's `init` may need a no-deps path, which belongs in `composition.ts`/`main.ts`).
- `storeContract` takes the carrier `runId` (the compiler already generates it) and links `onboardings.contract_run_id` in the same transaction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `bin/avarice` symlink next to `bin/avarice.ts`**
- **Found during:** Task 1
- **Issue:** The plan files list `bin/avarice.ts` and `package.json` points `bin.avarice` at it, but the acceptance criteria and SKELETON run `bin/avarice status`, which would not exist.
- **Fix:** `bin/avarice` is a symlink to `avarice.ts` (type stripping runs it because the real path is outside `node_modules`, research Pitfall 8). Verified `bin/avarice status --json` prints `[]`.
- **Files modified:** bin/avarice
- **Committed in:** e7a1e50

**2. [Rule 2 - Missing critical] Bounds that make the "no document text in the ledger" prohibition testable**
- **Found during:** Task 2
- **Issue:** The prohibition is `verification: test`, but a ledger that accepts any JSON can store anything; the contract says events hold IDs, counts, digests and exit codes only.
- **Fix:** `appendEvent` and every internal event refuse strings over 1024 characters or data over 8192 characters; record, contract and step bodies over 1 MiB are refused (`invalid`). Tested, together with a schema scan that no table has a content-like column.
- **Files modified:** src/adapters/sqlite/ledger.ts, test/integration/ledger-status.test.ts
- **Committed in:** 414084b
- **Watch for:** a later plan that appends an event with a long string (a command line, a question) will get `invalid`; 01-12 should truncate or digest it instead of raising the limit.

### Design choices the plan left open

- Task 1 wrote the Task 1 methods plus `not implemented` stubs for the rest (the plan staging; the Task 2 RED depends on them). Task 2 removed every stub; none remain.
- `getStatus` already rendered reasons and record fields in Task 1 (the tracer needed the JSON shape), so Task 2 made no change to `src/app/status.ts`.
- `Migration` lives in `migrate.ts` (the plan only named `MIGRATION_0001`); `pendingMigrations` is exported so the read-only open path can check without writing.
- `migrate` also refuses a recorded migration this build does not ship ("newer build") and non-contiguous versions; 01-06 adds backups and the interrupted-migration test.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact on plan:** none on scope.

## Issues Encountered

- The plan start time was not captured at execution start (`record_start_time` skipped); duration above is an estimate.
- Test child processes must not inherit `NODE_TEST_CONTEXT`; `runCli` deletes it.

## Authentication Gates

None.

## Known Stubs

None. `getStatus(ledger, _nowMs)` ignores `nowMs` deliberately (reserved for 01-06's lease-aware rendering); it affects no output today.

## Threat Flags

None new. T-01-03 (tampering with ledger writes) mitigated and tested: one `BEGIN IMMEDIATE` transaction per transition with version and fence checks, immutability triggers on `project_records` and `contracts`, an append-only trigger on `events`. T-01-61 (dynamic command import) mitigated and tested: only `COMMANDS` names are imported from the fixed `./commands/` directory, `../main` exits 64. T-01-62 accepted, and tightened by the event bounds above. T-01-SC: no installs.

Limits worth knowing: the profile directories are created with mode 0700 but existing directories are not chmod-ed (01-07 owns the root rules); the immutability triggers do not stop a writer that drops them (the store is local and single-user; the hash chain makes event tampering detectable, not impossible).

## User Setup Required

None.

## Next Phase Readiness

- 01-05 can build `onboarding-service.ts` and the stages on the Ledger port as listed in SKELETON.md; `registerProject`, `createOnboarding`, `acquireLease`, `recordCheckpoint`, `transitionOnboarding`, `storeContract`, `recordStepResult`, `recordAttempt`, `insertRecordAndActivate`, `getActiveRecord` and `appendEvent` all behave as the tests document.
- 01-04 (staging, artifact store) is independent; 01-06 extends `acquireLease` and `status` (`ledger.ts`, `status.ts`); 01-12 adds the budget methods to the port and `SqliteLedger` and may reuse `insertEvent`.
- `npm test` (100), `npx tsc -p .` and `node scripts/check-boundaries.ts` are green.

## Self-Check: PASSED

- Created files present on disk: bin/avarice.ts, bin/avarice, src/ports/ledger.ts, src/adapters/sqlite/{db,migrate,ledger}.ts, src/adapters/sqlite/migrations/0001-initial.ts, src/adapters/fs/profile-paths.ts, src/app/{deps,status}.ts, src/cli/{main,args,composition}.ts, src/cli/commands/status.ts, test/helpers/run-cli.ts, test/integration/ledger-status.test.ts.
- Commits e7a1e50, 68c356f, 414084b are ancestors of HEAD; `git rev-list --count 58e9209..HEAD` = 3.
- Acceptance criteria re-run: `node --test "test/integration/ledger-status.test.ts"` 36 pass; `bin/avarice status --json` prints `[]`; `CREATE TABLE onboarding_steps` 1, `CREATE TABLE projects` 1, `BEGIN IMMEDIATE` in db.ts 3, `test -x bin/avarice.ts` ok; `lease_fence` in ledger.ts 8, `superseded_at` 4; boundaries ok; tsc exit 0.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
