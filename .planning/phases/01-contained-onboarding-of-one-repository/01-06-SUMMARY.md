---
phase: 01-contained-onboarding-of-one-repository
plan: 06
subsystem: recovery
tags: [lease, resume, kill-points, fault-injection, migrations, sqlite, fixture]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-03 SqliteLedger (lease columns, fence), migrate, composition; 01-04 staging reuse and artifact store; 01-05 stage loop, generic kill points, fake host, test CLI"
provides:
  - "acquireLease takes a free lease or one whose expiry instant has passed in a single UPDATE and bumps lease_fence; the previous holder's transitions, renewals and release fail with conflict"
  - "runOnboarding renews the lease every ttl/3 on a timer while a stage waits on the host, accepts a prelude run under the lease, and releases on exit"
  - "avarice resume {onboardingId} (resumeOnboarding): lease takeover, reconcile of an in-flight map invocation through paused, then the normal stage loop; exit 0 active, 3 blocked/incompatible or lease held, 64 unknown ID"
  - "status shows interrupted { state, nextAction, resumeCommand } (text and --json) for a resumable state with an expired or absent lease; never for a live lease, a stop state or an active record"
  - "test/fault/killpoints.test.ts: the 11-point SKELETON.md catalog, each followed by resume and compared with an uninterrupted run in a second profile"
  - "migrate(db, migrations, { backupDir }): checksum refusal message, one transaction per migration, VACUUM INTO pre-migration backup (default backups/ beside the store)"
  - "scripts/make-fixture-db.ts and the committed test/fixtures/db/schema-v1.sqlite"
affects: [01-07, 01-08, 01-09, 01-10, 01-11, 01-12, 01-14, 01-15, 01-16, 01-19]

actuals:
  tokens: 17300
  tasks: 3
  commits: 6
plan_head_before: 13a45adbeec811485a7801692efb9000c606f00f
plan_head_after: 417a7c22cedc6c6f8d8d3c6ee0042168977639cd

tech-stack:
  added: []
  patterns:
    - "Recovery is a stage-loop prelude, not a second loop: resumeOnboarding calls runOnboarding with a prelude that runs under the new lease, so the lease renewal, fencing and release are shared with `onboard`"
    - "A mapping round is one launch:map row followed by one validate row; launches > validations means this round's invocation exists, and the files in staging say whether it finished"
    - "Fault tests compare a killed-then-resumed profile with an uninterrupted profile of the SAME scratch repository after normalizing ULIDs, ISO timestamps and temp-dir prefixes"
    - "Migration tests copy the committed fixture to a temp dir for every case; the committed file is never opened read-write"

key-files:
  created:
    - src/app/resume.ts
    - src/cli/commands/resume.ts
    - scripts/make-fixture-db.ts
    - test/fixtures/db/schema-v1.sqlite
    - test/helpers/fault-run.ts
    - test/unit/transitions.test.ts
    - test/integration/lease.test.ts
    - test/fault/killpoints.test.ts
    - test/fault/migrations.test.ts
  modified:
    - src/adapters/sqlite/ledger.ts
    - src/adapters/sqlite/migrate.ts
    - src/app/onboarding-service.ts
    - src/app/status.ts
    - src/domain/onboarding-lifecycle.ts

key-decisions:
  - "A lease is expired only when its expiry instant is strictly before now (lease_expires_at < now); at the expiry instant the holder still owns it. Renewal checks holder and fence, not expiry, so a holder whose lease lapsed while a git call blocked the event loop keeps it unless someone took over"
  - "resume on a stop state reports the state without taking the lease, so resume on an active onboarding changes nothing"
  - "Reconcile of an interrupted mapping: mapping -> paused (checkpoint reconcile-invocation), mark a started launch row interrupted (files incomplete) or reconciled (every file the mode requires is present), then paused -> mapping (the map stage relaunches), or, when finished, paused -> mapping -> validating with an invocation.reconciled event and no second launch"
  - "The reconcile test for 'this round has an invocation' is launch:map rows > validate rows, so a retry round (validation_failed -> mapping) whose old map files are still on disk is relaunched, not wrongly treated as finished"
  - "status treats the pre-activation states (isResumable) as interruptible; stale, active and the other stop states never render as interrupted"
  - "A migration checksum mismatch is reported in the conflict `actual` text: 'store schema v{n} checksum mismatch: refusing to start (recorded X; shipped Y)'; the 01-03 composition already prints it and exits 70, so composition.ts was not edited"
  - "Pre-migration backup defaults to backups/ beside the database file (db.location()) so the control is on in production without touching composition; a store with no history and an in-memory store get no backup; a backup that cannot be written stops the migration"

requirements-completed: [ONB-1, NFR-6, NFR-9, NFR-2]

coverage:
  - id: D1
    description: "For each of the 11 catalog kill points, SIGKILL then `avarice resume {onboardingId}` reaches active with a project record body, map-document digests, snapshot manifest and staging tree equal to an uninterrupted run in a second profile, and the user checkout byte-identical"
    requirement: ONB-1
    verification:
      - kind: fault
        ref: "test/fault/killpoints.test.ts#kill, then resume, reaches the record of an uninterrupted run (11 subtests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "After any kill, status shows interrupted in the last state with the next action and the exact `avarice resume {onboardingId}`, never active, and the store passes integrity_check with no project_records row"
    requirement: NFR-6
    verification:
      - kind: fault
        ref: "test/fault/killpoints.test.ts (status and integrity assertions in each subtest); test/integration/lease.test.ts#status after an interrupted run"
        status: pass
    human_judgment: false
  - id: D3
    description: "A second process cannot advance an onboarding while another holds an unexpired lease (two simultaneous resumes plus a late third: one exits 0, two exit 3); after expiry the taker gets fence 2 and the old holder's transition, renewal and release fail with conflict"
    requirement: NFR-6
    verification:
      - kind: integration
        ref: "test/integration/lease.test.ts#lease expiry and takeover (ledger); #two processes race for an expired lease"
        status: pass
    human_judgment: false
  - id: D4
    description: "Resume reconciles an interrupted mapping through paused: incomplete files relaunch (killed launch marked interrupted, second launch recorded); all files present goes to validating with invocation.reconciled and no second launch"
    requirement: ONB-1
    verification:
      - kind: integration
        ref: "test/integration/lease.test.ts#avarice resume"
        status: pass
    human_judgment: false
  - id: D5
    description: "Opening a store whose applied checksum differs from the shipped migration refuses to start (exit 70 from status and onboard) with a message naming v1 and both checksums; a migration that throws midway leaves no partial table, schema_migrations unchanged and integrity ok; a pending migration is preceded by a VACUUM INTO backup"
    requirement: NFR-9
    verification:
      - kind: fault
        ref: "test/fault/migrations.test.ts (15 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The committed v1 fixture database opens, migrates as a no-op, keeps its row counts and is read by status as an active record v1"
    requirement: NFR-9
    verification:
      - kind: fault
        ref: "test/fault/migrations.test.ts#the committed v1 fixture database"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every ordered pair of the 14 lifecycle states is accepted or rejected (invalid) exactly as the independently written expected table says"
    requirement: NFR-2
    verification:
      - kind: unit
        ref: "test/unit/transitions.test.ts"
        status: pass
    human_judgment: false

duration: 19min
completed: 2026-11-02
---

# Phase 01 Plan 06: Recovery Half of the Walking Skeleton Summary

**Killing an onboarding at any of the 11 catalog points and running `avarice resume {onboardingId}` now reaches an active project record equal to an uninterrupted run: leases expire and fence out the old holder, `status` shows the interrupted state with the exact resume command, and migrations are checksummed, transactional per step and backed up first.**

## Performance

- **Duration:** about 19 min (start 19:38Z, from the previous plan's last commit; end 19:57Z)
- **Tasks:** 3 of 3 (Task 1 and Task 3 TDD, Task 2 test-only)
- **Files created:** 9, modified: 5 (14 changed in total, 1428 insertions, 23 deletions)
- **Suite:** 191 of 191 passing (137 before), `npx tsc -p .` and `node scripts/check-boundaries.ts` clean

## Accomplishments

- Lease takeover: `acquireLease` is one `UPDATE ... WHERE lease_holder IS NULL OR lease_expires_at < now` with `lease_fence = lease_fence + 1`; zero changed rows is `conflict`. A timer in `runOnboarding` renews every ttl/3 while a stage is awaiting the host, so a long invocation keeps its lease; `AVARICE_LEASE_TTL_MS` (default 180000) is read in one place.
- `avarice resume`: refuses (exit 3) while a live lease is held, takes over an expired or absent one, reconciles an in-flight map invocation, then runs the existing idempotent stages from the committed state. An unknown ID exits 64; a stop state is reported without taking the lease.
- Interrupted status: text `interrupted in mapping (next: launch:map)` plus `continue with: avarice resume {id}`, and `interrupted: { state, nextAction, resumeCommand }` in `--json`.
- Kill-point suite: all 11 catalog points, each checked for SIGKILL, store integrity, no activated record, expected interrupted state and next action, resume to active, and equality with an uninterrupted run (normalized record body, seven map digests, snapshot manifest, staging tree digest, user checkout snapshot). The mid-invocation case leaves a visible `started` launch row and three of seven map files, which resume marks `interrupted` and relaunches as attempt 2.
- Migration safety: checksum refusal with an actionable message (also for a store written by a newer build), one transaction per migration, `VACUUM INTO backups/pre-migration-{ts}.db` (mode 0600) before the first pending migration on a store with history, and a committed v1 fixture built through the real onboarding path.

## Task Commits

1. **Task 1 (TDD)** - RED `17a055c` test(01-06); GREEN `5c10e15` feat(01-06); cleanup `417a7c2` refactor(01-06) (two exports made private again)
2. **Task 2** - `ba78a11` test(01-06) kill-point suite
3. **Task 3 (TDD)** - RED `78691b9` test(01-06) (fixture, script, failing tests); GREEN `db8a36c` feat(01-06)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

Task 1 and Task 3 each have a `test(01-06)` commit before the `feat(01-06)` commit. RED evidence, with the semantic assessment:

- **Task 1 RED (`17a055c`):** `node --test test/integration/lease.test.ts` gave 6 pass, 12 fail. The failing targets are the lease takeover, fencing, status, resume and race tests, each failing on its planned assertion: no second acquire after expiry (`0 !== 1` winners), `resume` answered "not available in this build" (exit 64 where 0 or 3 was expected), and status had no `interrupted` entry. The 6 passes are the pre-existing free-lease, conflict-before-expiry, release/re-acquire and renewal behaviours plus `resume` with no ID (exit 64 both before and after, for different reasons). `test/unit/transitions.test.ts` was green on arrival because the table already exists in the domain module (01-01); the test pins it against an independently written edge list rather than driving a change, so there is no RED for that file. No `tdd-red-evidence` record was produced for either task; `gsd_run check tdd-red-evidence` was not run (flag for the end-of-phase TDD review, as in 01-05).
- **Task 3 RED (`78691b9`):** 8 of 15 fail and `tsc` rejects the unknown `backupDir` option. The failures are the checksum message, per-migration transaction (earlier migration stays applied), backup written, default backup dir, and backup-failure refusal cases. The fixture-open and no-op tests pass already, as intended (they guard the fixture, not new behaviour).
- No REFACTOR commit for Task 3. Task 1's `417a7c2` is a refactor commit made after the GREEN (visibility only; tests unchanged and green).

Mutation checks (each applied to a copy and restored): removing the `OR lease_expires_at < ?` takeover (RED); disabling the renewal timer (the staggered third resume then takes the lease and the race test fails); `finished` forced true in the reconcile (the mid-invocation kill-point subtest fails); `invoked` forced false (the all-files-present test fails); running a migration's SQL outside its transaction (three midway-failure tests fail); skipping the checksum comparison (four refusal tests fail).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `isResumable` added to the lifecycle module**
- **Found during:** Task 1
- **Issue:** `status` must call only pre-activation states interrupted (a `stale` or `active` onboarding has no stage and no resume), and `PRE_ACTIVATION` was private to `src/domain/onboarding-lifecycle.ts`, which the plan's file list does not include.
- **Fix:** exported `isResumable(state)` from that module (5 lines) and used it in `status.ts`.
- **Files modified:** src/domain/onboarding-lifecycle.ts, src/app/status.ts
- **Commit:** 5c10e15

**2. [Rule 2 - Missing critical functionality] Backup directory defaults beside the store instead of being passed by composition**
- **Found during:** Task 3
- **Issue:** the plan says `composition.ts` is not edited, but then nothing would pass `backupDir`, and the backup control would never run in production.
- **Fix:** `migrate` derives `backups/` from `db.location()` when `backupDir` is not given; tests pass it explicitly or rely on the default. A future migration 0002 therefore backs up with no composition change.
- **Files modified:** src/adapters/sqlite/migrate.ts
- **Commit:** db8a36c

**3. [Behaviour change, no rule] A migration that fails now reports `internal` with "migration {n} failed and was rolled back"**
- **Found during:** Task 3. Previously the raw tx error (often `internal` already) was returned; the message now names the migration. A busy store still returns `unavailable`.

### Notes on the plan's acceptance commands

- `node test/helpers/test-cli.ts resume onb_unknown` (Task 1 criterion) run exactly as written uses the DEFAULT profile, so it created `~/.local/share/avarice/personal-local/state.db`, `~/.local/share/avarice-work/personal-local` and `~/.config/avarice`, all empty or schema-only and created seconds earlier. I removed those (the files and the now-empty directories). The same behaviour is tested against temp roots in `lease.test.ts` (`exits 64 for an unknown onboarding ID`). Later plans should give that criterion `AVARICE_*` temp roots.

**Total deviations:** 2 Rule 2 additions, 1 minor behaviour change. **Impact on plan:** none on scope.

## Findings Carried Forward

- **Two catalog points coincide with their neighbours.** A transition writes the checkpoint of the action that follows it, and `faultPoint('after-checkpoint:' + nextAction)` fires inside `ctx.transition`. So `after-checkpoint:validate` fires at the same instant as `after-transition:validating`, and `after-checkpoint:activate` at the same instant as `after-transition:planning_ready` (the index stage's own `activate` checkpoint comes later and is not a distinct kill target, because the env fault fires at the first match and then the process is gone). Both are in the suite and pass, but they do not exercise "killed between the validate checkpoint and the validation result" or "killed after the index stage checkpoint, before activation". A counted fault (`name#2`) would reach them; 01-14 (index steps) is the natural place.
- **Always-retry mutant still has no test.** The 01-05 gap (`count <= retry` replaced by `true` loops forever in `retryOrBlockStage`) is not closed by this plan's lease or loop work. A test with a fake host that always omits a file and a short wall-clock cap on the child process would catch it.
- **Backups accumulate.** `backups/pre-migration-*.db` has no retention rule; retention belongs with the uninstall and restore work (operations doc), not a migration.
- **Status of a dead holder with a live lease.** Until the lease TTL elapses (180 s by default), `status` shows the state normally and `resume` refuses with exit 3. This is by design (T-01-10 accepted), but a user who just killed a run waits up to three minutes; `AVARICE_LEASE_TTL_MS` shortens it.
- **Fixture content.** The committed fixture holds temp-dir paths (`/private/var/folders/.../avarice-fixture-*`) and ULIDs from the machine that generated it, and no user paths or secrets. Regenerate with `node scripts/make-fixture-db.ts <out>` only for a new schema version; the v1 file should stay as is.

## Known Stubs

None. (The GSD version in the record is `unknown` until 01-09 and the index list is empty until 01-14; both predate this plan.)

## Threat Flags

None. `resume` accepts only an onboarding ID that is looked up in the ledger; it opens no new path, network or credential surface. T-01-08 (lease race) and T-01-09 (migration tampering) are mitigated and tested as planned.

## Self-Check: PASSED

- Files: scripts/make-fixture-db.ts, src/app/resume.ts, src/cli/commands/resume.ts, test/fixtures/db/schema-v1.sqlite, test/helpers/fault-run.ts, test/unit/transitions.test.ts, test/integration/lease.test.ts, test/fault/killpoints.test.ts, test/fault/migrations.test.ts all present.
- Commits 17a055c, 5c10e15, ba78a11, 78691b9, db8a36c, 417a7c2 are ancestors of HEAD; `commits: 6` is `git rev-list --count 13a45ad..417a7c2`.
- Acceptance: `grep -c "lease_fence = lease_fence + 1"` ledger.ts = 1; `grep -c resumeCommand` status.ts = 3; `grep -c "VACUUM INTO"` migrate.ts = 3; `grep -c mid-invocation` killpoints.test.ts = 3; `grep -c normalizeRecord` fault-run.ts = 1; fixture non-empty.
- Plan verification: `node --test` over the four plan test files green (transitions 6, lease 18, killpoints 14, migrations 15), full `npm test` 191 of 191, `node scripts/check-boundaries.ts` and `npx tsc -p .` clean.
