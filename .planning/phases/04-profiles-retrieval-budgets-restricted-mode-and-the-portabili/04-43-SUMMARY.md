---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 43
subsystem: profiles-and-credentials
tags: [profile-registry, bindings, file-lock, fsync, credential-broker, sandbox-deny-list, gap-closure]

requires:
  - phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
    provides: profile registry (04-12), bindings registry, cmd: credential provider, SandboxedExecutor truncation contract
provides:
  - fail-closed other-profile deny list (an unreadable config stops composition)
  - locked, re-read, fsynced read-modify-write of bindings.json
  - stdout-only size check for cmd: credential helpers
affects: [04-53 documentation plan, profiles-and-credentials documentation]

plan_head_before: 4f5eaf964a0ec25cc821d53fc1eeaedc240bad52
plan_head_after: fcf9e91e2b0c78044574495b9ed184c59ac2a8e3

actuals:
  tokens: 22000
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Lock file beside a registry: exclusive create, holder pid and start time, bounded wait, dead-holder takeover by rename, release only when the file still names this process"
    - "Two-process barrier race test (test/fault) with a helper child printing one JSON line per call"

key-files:
  created:
    - test/fault/bindings-race.test.ts
    - test/helpers/bindings-race-child.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-43-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-43-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-43-red-task3.json
  modified:
    - src/adapters/fs/profile-registry.ts
    - src/adapters/fs/profile-bindings.ts
    - src/adapters/credential/cmd.ts
    - test/unit/profile-registry.test.ts
    - test/integration/profile-selection.test.ts
    - test/integration/credential-broker.test.ts

key-decisions:
  - "An other-profile config that cannot be read is unavailable and names the profile; only a corrupt (invalid) config is still skipped"
  - "The bindings lock file holds JSON {pid, startedAt}; a lock naming this very process, or one whose holder is gone, is stale; a lock with unreadable content is stale only after 2 seconds"
  - "backfillBindings holds the lock once for the whole loop and calls an unlocked addBinding, so it does not deadlock against itself"
  - "cmd: oversize is decided from stdout ending in TRUNCATION_MARKER, not from the combined truncated flag"

requirements-completed: [SEC-1, SEC-2]

coverage:
  - id: D1
    description: "An unreadable other-profile config makes knownProfileRoots return unavailable naming the profile, and the composition refuses without opening a store; a corrupt config is still skipped (WR-17)"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile-registry.test.ts#is an unavailable error naming the profile, not a shorter list"
        status: pass
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#refuses the command naming the unreadable config and creates no store for the selected profile"
        status: pass
    human_judgment: false
  - id: D2
    description: "Concurrent binding writers keep every binding: two processes each adding 20 leave 40, three repetitions; dead-holder lock taken over; live-holder lock fails unavailable after 2 seconds naming the holder; backfillBindings takes the same lock; the file is fsynced before the rename (WR-15)"
    requirement: SEC-1
    verification:
      - kind: e2e
        ref: "test/fault/bindings-race.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "A cmd: helper with a short stdout and more than 16 KiB on stderr resolves; more than 16 KiB on stdout is invalid naming the limit (WR-16)"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#the size of the credential is judged from stdout alone (WR-16, T-04-118)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-22
status: complete
---

# Phase 04 Plan 43: Profile isolation and credential gap closure Summary

**Fail-closed other-profile deny list, a lock file plus fsync around every bindings.json write, and a stdout-only size check for cmd: credential helpers (WR-15, WR-16, WR-17).**

## Performance

- **Duration:** 7 min
- **Started:** 2026-11-22T21:22:15Z
- **Completed:** 2026-11-22T21:28:51Z
- **Tasks:** 3
- **Files modified:** 11 (6 source/test files modified or created, 3 RED records, plus this summary and the helper)

## Accomplishments

- WR-17: `knownProfileRoots` returns `unavailable` naming the profile when another profile's `config.json` exists but cannot be read; the composition already turned that error into a refusal before any store opens. A corrupt config is still skipped.
- WR-15: `writeBinding` and `backfillBindings` serialize on `bindings.json.lock` (holder pid and start time, 2-second bounded wait, dead-holder takeover), re-read the registry under the lock, and write the temporary file through a 0600 descriptor, fsync it, then rename. Two processes each binding 20 repositories now keep all 40, where before they kept 20 to 22.
- WR-16: the `cmd:` provider refuses a helper as oversized only when stdout ends with `TRUNCATION_MARKER`; a helper that floods stderr resolves.

## TDD

- **Task 1 RED** (`486e92c`): `knownProfileRoots` returned ok for a mode-000 other-profile config and the CLI exited 0 instead of refusing. RED record `04-43-red-task1.json` returned `RED_EVIDENCE_OK`. Semantic assessment: the target failed on `assert.equal(result.ok, false)` for the intended reason; the corrupt-config sibling passes. **GREEN** `58cce13`.
- **Task 2 RED** (`65b0175`): the race test found 22, 20 and 21 of 40 bindings in the three repetitions; the three lock cases failed because no lock existed. RED record `04-43-red-task2.json` returned `RED_EVIDENCE_OK`. **GREEN** `c13eebe`; the race test then passed in 4 consecutive runs (3 repetitions each).
- **Task 3 RED** (`6a0cc76`): the noisy-stderr helper was refused as invalid ("more than 16384 bytes") in the fake-executor and real-sandbox cases. RED record `04-43-red-task3.json` returned `RED_EVIDENCE_OK`. The stdout-flood sibling passes before and after. **GREEN** `fcf9e91`.
- No REFACTOR commits.

## Task Commits

1. **Task 1: unreadable profile config stops the composition (WR-17)** - `486e92c` (test), `58cce13` (fix)
2. **Task 2: concurrent binding writes keep every binding (WR-15)** - `65b0175` (test), `c13eebe` (fix)
3. **Task 3: cmd: size judged from stdout only (WR-16)** - `6a0cc76` (test), `fcf9e91` (fix)

**Plan metadata:** recorded by the docs commit that follows this summary.

## Verification

- `node --test test/unit/profile-registry.test.ts test/integration/profile-selection.test.ts test/integration/run-sandbox-other-profiles.test.ts test/fault/bindings-race.test.ts test/integration/credential-broker.test.ts`: 119 tests, 119 pass, 0 fail, 0 skipped.
- `test/unit/credential-ref.test.ts` passes with the credential-broker file (35 of 35 in that run).
- `npm run typecheck`: clean. `npm run check:boundaries`: ok (132 files).
- `grep -c fsyncSync src/adapters/fs/profile-bindings.ts`: 2. `grep -c TRUNCATION_MARKER src/adapters/credential/cmd.ts`: 2.
- The full `npm test` suite was not run (over an hour here, per the dispatch instructions).

## Decisions Made

- The integration case for WR-17 uses a personal profile (`personal-extended`) as the other profile. An enterprise-named config is read earlier by `readEnterprisePatterns` in the command dispatcher, which refuses on its own; a personal name isolates the composition path the plan targets. The unit case uses an enterprise-named profile built from parts.
- Lock takeover renames the stale lock aside (one contender wins), checks that it is the lock that was judged stale, and puts a different lock back with a no-clobber link. A third writer creating a lock inside that gap is a documented residual in the code comment.
- A lock that names the current process is treated as stale: this process holds the lock only inside one synchronous call, so such a lock is left over from an earlier process whose ID was reused.

## Deviations from Plan

None - plan executed exactly as written. The plan's "40-character token" check was built from parts (the existing 21-character `HELPER_VALUE` plus 19 characters) so no secret pattern matches it; a first count error in the fixture was corrected before the RED record was taken.

**Total deviations:** 0.

## Issues Encountered

- The worktree sandbox refused compound shell commands that contain `git` or heredocs, so the pin guard, `git` calls and the RED-record builder were run as separate plain commands. No effect on the result.

## Known Stubs

None.

## Threat Flags

None. The new lock file `bindings.json.lock` sits beside the existing registry in the same 0700 config home and is covered by T-04-117.

## Documentation surfaces

For plan 04-53 (`docs/system/` was not edited here, per the plan):

- **Registry refusal** (`docs/system/profiles-and-credentials.md`): an other-profile `config.json` that exists but cannot be read stops composition with `cannot read the other profiles of this machine`, naming the profile and the cause; a corrupt config is still skipped. The deny list is never shorter because of an unreadable config.
- **Bindings lock file and its wait** (`docs/system/profiles-and-credentials.md` binding registry paragraph, and the line that says two processes that backfill bindings at once can drop one entry, which is no longer true and must be removed; `docs/system/data-model.md` config-home row): `bindings.json.lock` beside the registry holds `{pid, startedAt}`; writers wait at most 2 seconds; a lock whose holder is gone is taken over; a live holder after 2 seconds makes the write fail as unavailable naming the process; the registry is re-read under the lock and written through a 0600 descriptor, fsynced, then renamed.
- **cmd: size rule** (`docs/system/profiles-and-credentials.md` credential section): a helper's output is judged too large only when stdout is cut at 16 KiB (ends with the truncation marker); stderr volume no longer matters and stderr stays unread.
- `docs/system/findings.md`: none added; WR-15, WR-16 and WR-17 are closed in code.

## Next Phase Readiness

Ready for the next gap-closure plan. Plan 04-53 should carry the three documentation surfaces above.

## Self-Check: PASSED

- Files: `src/adapters/fs/profile-registry.ts`, `src/adapters/fs/profile-bindings.ts`, `src/adapters/credential/cmd.ts`, `test/fault/bindings-race.test.ts`, `test/helpers/bindings-race-child.ts`, the three `04-43-red-task*.json` records all present.
- Commits `486e92c`, `58cce13`, `65b0175`, `c13eebe`, `6a0cc76`, `fcf9e91` are ancestors of HEAD; `git rev-list --count` from the recorded base gives 6.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-22*
