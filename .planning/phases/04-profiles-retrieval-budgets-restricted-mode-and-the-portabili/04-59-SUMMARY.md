---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 59
subsystem: profiles
tags: [bindings-lock, pid-reuse, ps-etime, deny-list, corrupt-config, race-test, gap-closure, G-04-2-GWR-05, G-04-2-GWR-06, G-04-2-GWR-07, SEC-1]

requires:
  - phase: 04
    provides: "the bindings registry and its lock (04-43), knownProfileRoots (04-12, 04-54)"
provides:
  - "lockIsStale (pure), BINDINGS_STALE_AGE_MS, parseEtimeSeconds and readProcessStartMs: a bindings lock whose process ID now belongs to a process that started after the lock was written is taken over"
  - "knownProfileRoots denies the whole root (profile directory, default data root, default work root) of another profile whose config is corrupt"
  - "a bindings race test that records every call's timings, proves the writers overlapped (retrying up to 5 attempts), and a discriminating unlocked-writer variant that must lose a binding"
affects: [04-67, 04-68]

actuals:
  tokens: 10200
  tasks: 3
  commits: 6
plan_head_before: a24ed5e6b4eb32dca41c5f9b513fb159354a34b6
plan_head_after: 6633b13b3f77d09916e5ed2b9e1b99fbab4da5e7

tech-stack:
  added: []
  patterns:
    - "A staleness rule is a pure function over gathered evidence (holder, liveness, process start, file age); the impure reads (kill 0, ps) stay in inspectLock so the edges are unit-tested without planting processes"
    - "A race test retries only the evidence of a race and keeps every exactness assertion on every attempt; a discriminating variant through an unlocked writer that lives only in the test helper shows the test can tell a lock from no lock"

key-files:
  created:
    - test/unit/profile-bindings-lock.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-59-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-59-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-59-red-task3.json
  modified:
    - src/adapters/fs/profile-bindings.ts
    - src/adapters/fs/profile-registry.ts
    - test/unit/profile-registry.test.ts
    - test/fault/bindings-race.test.ts
    - test/helpers/bindings-race-child.ts

key-decisions:
  - "A live holder is stale when the process now holding its ID started more than 2 seconds after the lock's startedAt; the start is read as now minus `ps -o etime=` (no locale or time zone), run from /bin/ps or /usr/bin/ps with env PATH=/usr/bin:/bin and LC_ALL=C and a 1 second timeout"
  - "When the start (or startedAt) cannot be read, a live holder's lock is stale only when its file is older than 60 seconds; the unreadable-holder path (older than the 2 second wait) is unchanged"
  - "A corrupt config (kind invalid) of another profile gets its whole root denied exactly as a permission refusal does; non-profile directories and the selected profile's own entry still add nothing"
  - "The race tests retry only the overlap evidence; the unlocked writer is in test/helpers/bindings-race-child.ts and nowhere in src"

patterns-established:
  - "Pure rule plus impure evidence readers for liveness decisions"

requirements-completed: [SEC-1]

coverage:
  - id: D1
    description: "A bindings lock naming a live PID whose process started after the lock's startedAt (planted one hour ago) is taken over within the wait; a lock planted by a live holder after it started is still held and reported with the holder named"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/fault/bindings-race.test.ts#takes over a lock whose process ID is held by a live process that started after the lock was written, within the wait"
        status: pass
      - kind: integration
        ref: "test/fault/bindings-race.test.ts#returns unavailable naming the holder when a live process holds the lock for longer than 2 seconds, and writes nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pure staleness rule and the etime parser, at the 2 second margin, the 60 second age bound and the unreadable cases"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile-bindings-lock.test.ts#lockIsStale (GWR-05)"
        status: pass
      - kind: unit
        ref: "test/unit/profile-bindings-lock.test.ts#parseEtimeSeconds (the elapsed time ps prints)"
        status: pass
    human_judgment: false
  - id: D3
    description: "knownProfileRoots denies the whole root of another profile whose config is invalid JSON, holds a refused key, is a symbolic link or is oversize, and the computation succeeds"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile-registry.test.ts#a corrupt profile config is denied whole (GWR-06)"
        status: pass
      - kind: integration
        ref: "test/integration/profile-isolation.test.ts and test/integration/run-sandbox-other-profiles.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The bindings race test records per-call timings, asserts an overlap with up to 5 attempts, keeps the 40-binding exactness checks on every attempt, and the unlocked variant loses a binding"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/fault/bindings-race.test.ts#two processes binding different repositories at the same moment keep every binding (WR-15, T-04-117, GWR-07)"
        status: pass
      - kind: integration
        ref: "test/fault/bindings-race.test.ts#the same race through a writer with no lock loses a binding (GWR-07)"
        status: pass
    human_judgment: false

duration: 77min
completed: 2026-11-24
status: complete
---

# Phase 04 Plan 59: Bindings lock PID reuse, corrupt-config deny list and the race test Summary

**A bindings lock whose process ID was reused is taken over through a ps-etime start-time comparison, a corrupt profile config now has its whole root denied instead of being skipped, and the bindings race test proves the two writers overlapped and fails an unlocked writer.**

## Performance

- **Duration:** about 77 min (the start was not recorded at launch; derived from the first RED run)
- **Started:** about 2026-11-24T20:00:00Z
- **Completed:** 2026-11-24T21:20:00Z
- **Tasks:** 3 (each RED then GREEN, 6 commits)
- **Files modified:** 9 (5 source and test files changed, 1 new unit test, 3 RED records)

## Accomplishments

- GWR-05: `inspectLock` gathers the holder, whether its PID is alive, when the process now holding that PID started (`readProcessStartMs`) and the lock file's age, and decides through the pure `lockIsStale`. A planted lock naming a live process with an hour-old `startedAt` is taken over in milliseconds; a lock a live holder wrote after it started is still held and still reports `unavailable` naming the holder after about 2 seconds.
- GWR-06: `knownProfileRoots` treats a config that fails with `invalid` (bad JSON, a refused key, a link, oversize) like a permission refusal: the profile directory and the default data and work roots of its name are denied, minus the selected profile's own roots. The skip stays only for a directory that is not a profile and the selected profile's own entry.
- GWR-07: the race child records `calledAt`/`returnedAt` for every call and has an `unlocked` mode (helper only). The locked test retries up to 5 attempts for an overlap, fails with "the race was not exercised" when none happens, and asserts all 40 bindings, once each, no lock and no temporary file on every attempt. The unlocked variant needs a lost binding in an overlapped attempt, else fails with "the unlocked writer never lost a binding". Both passed on the first attempt in four consecutive runs.

## Task Commits

1. **Task 1: Tracer - a lock whose PID was reused is taken over (GWR-05)** - `d0dcd67` (test, RED), `9a96983` (fix)
2. **Task 2: A corrupt profile config gets its whole root denied (GWR-06)** - `17f366c` (test, RED), `3158918` (fix)
3. **Task 3: The race test proves the overlap, an unlocked writer loses a binding (GWR-07)** - `2d21aa2` (test, RED), `6633b13` (test, helper GREEN)

**Plan metadata:** the docs commit that carries this file.

The tracer gate: the Task 1 `<verify>` (the unit and fault files plus typecheck) was re-run end to end after the commit and passed before Tasks 2 and 3 started (auto-mode style gate; no `blocking-human` gate on the task).

## Files Created/Modified

- `src/adapters/fs/profile-bindings.ts` - `lockIsStale`, `BINDINGS_STALE_AGE_MS`, `parseEtimeSeconds`, `readProcessStartMs`, `LockHolder`/`LockEvidence` types; `inspectLock` uses them; comments say how a reused PID is detected
- `src/adapters/fs/profile-registry.ts` - whole-root denial for an `invalid` config; header comment corrected
- `test/unit/profile-bindings-lock.test.ts` - new: the pure rule, the etime parser and the live read of this process's start
- `test/unit/profile-registry.test.ts` - the two skip cases and the corrupt-next-to-it case rewritten to whole-root denial; a describe with the four corrupt forms and the own-profile and non-profile exceptions
- `test/fault/bindings-race.test.ts` - reused-PID fault case, overlap helper, retry loop, unlocked describe
- `test/helpers/bindings-race-child.ts` - per-call timings and the `unlocked` mode
- `04-59-red-task{1,2,3}.json` - RED evidence (command, exit code, output) for each task

## Decisions Made

See `key-decisions`. One implementation choice beyond the plan text: in `knownProfileRoots` the branch for a config error that is neither a permission refusal, `invalid` nor `unavailable` now returns `unavailable` instead of skipping. `readProfileConfig` produces only `invalid` and `unavailable`, so the branch is unreachable today, but a skip there would reopen the GWR-06 hole.

## Deviations from Plan

None - plan executed exactly as written (the unreachable fail-closed branch above is a hardening of the same change, not a change of behavior).

## Issues Encountered

- The race test's first attempt overlapped in every run, so the retry path of the new test was exercised only by the RED run (where the unmodified child printed no timings and all 5 attempts failed with "the race was not exercised").
- No lint configuration exists in the repository (ESLint finds no config), so only `tsc` and the tests were run.
- A full `npm test` run was cut short: I stopped it with `pkill` while it was still running, which cancelled 146 test files ("Promise resolution is still pending") and made `restricted-onboarding` fail its temp-directory cleanup (ENOTEMPTY). `restricted-onboarding` passes 14 of 14 on its own. The 1617 tests that completed had no real failure. The plan's verification set (125 tests across the six files in its `<verification>`), `boundaries`, `footprint`, `enforcement-map`, `containment-matrix` (84 tests) and `tsc -p .` all pass. A complete clean `npm test` was not obtained in this run.

## Residuals

- **Age fallback (GWR-05).** When `ps` is unavailable or its output cannot be parsed, a lock naming a live PID is taken over only once its file is more than 60 seconds old. A live but hung original holder is therefore taken over after 60 seconds in that situation; a registry rewrite takes milliseconds, so a healthy holder is never taken over.
- **Take-over gap.** The existing note on `takeOver` still stands: a third writer that creates a lock between the rename aside and the put-back shares the lock until the first releases.
- **Start-time resolution.** `etime` has whole-second resolution; the 2 second margin means a process that reuses the ID within 2 seconds of the lock being written is judged to be the holder. That window is shorter than the 2 second wait of every other writer.
- **A corrupt config's moved roots (GWR-06).** A corrupt config cannot say where its profile moved its data and work roots, so only the profile directory and the default roots of its name are denied. This is the same residual as for a refused config.

## Documentation surfaces

For plans 04-67 and 04-68, the `docs/system/` documents to update (nothing under `docs/system/` was edited here, per the plan):

1. **When a bindings lock counts as stale** (`docs/system/data-model.md` line 13 describes `bindings.json.lock` as holding the writer's process ID and start time; its `startedAt` is the time the lock was written, not the process start): a lock is taken over when it names a process that no longer exists, or a live process that started more than 2 seconds after the lock was written (a reused ID, read through `ps` elapsed time), or a holder that cannot be read and is older than the 2 second wait.
2. **The 60-second fallback and its residual:** when the process start cannot be read (no `ps`, a parse failure, a non-zero exit), a live holder's lock is stale only when its file is older than 60 seconds; a live but hung holder is taken over after 60 seconds in that case.
3. **A corrupt config's whole root denied:** another profile's config that is invalid JSON, holds a refused key, is a symbolic link or exceeds the size cap gets its profile directory and default data and work roots added to the run sandbox's deny list, as an unreadable (permission) config does; only a directory that is not a profile name and the selected profile's own entry add nothing. Residual: roots the corrupt config moved cannot be listed.
4. **Test notes, if the race test is documented:** the race test records per-call timings, retries up to 5 attempts for an overlap, and has an unlocked-writer variant (in the test helper only) that must lose a binding.

## Next Phase Readiness

GWR-05, GWR-06 and GWR-07 are closed with tests that failed before the fix. Plans 04-67 and 04-68 (the documentation plans) carry the surfaces listed above.

## Self-Check

Self-Check: PASSED

- All 9 files in `key-files` exist on disk.
- All 6 task commits (`d0dcd67`, `9a96983`, `17f366c`, `3158918`, `2d21aa2`, `6633b13`) are ancestors of HEAD; `git rev-list --count a24ed5e..HEAD` is 6 before this commit.
- Acceptance criteria: the three RED files exist with exit code 1 and show the failing evidence; `grep -c "export function lockIsStale"` prints 1; "the race was not exercised" appears 3 times and "the unlocked writer never lost a binding" once in the race test; the src unlocked-writer grep prints 0.
- No stubs or placeholders in the changed files.
- No new network, auth or file-access surface beyond the plan's threat model: `ps` is run by absolute path with a fixed environment and an argv array.
