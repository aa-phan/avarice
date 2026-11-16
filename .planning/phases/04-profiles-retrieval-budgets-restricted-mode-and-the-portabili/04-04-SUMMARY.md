---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 04
subsystem: cli
tags: [profiles, repository-binding, profile-selection, sec-1, typescript]

requires:
  - phase: 01
    provides: "resolveProfile, the profile config reader discipline (O_NOFOLLOW, regular file, 64 KiB), safe git, the CommandModule contract"
provides:
  - "Profile name grammar, class, selection precedence and remote pattern match as pure domain rules (src/domain/profile.ts)"
  - "Global --profile flag and AVARICE_PROFILE, decided in main() before any directory or store exists"
  - "Repository binding registry <configHome>/bindings.json, written by repo add --profile"
  - "Exit 3 refusals: repository bound to <profile>; an enterprise remote under a personal profile"
affects: [04-12, 04-05, 04-38]

actuals:
  tokens: 16000
  tasks: 3
  commits: 6
plan_head_before: ff510ac485d6e5056175f92114e5d1f103d24a3c
plan_head_after: bb93b186ff07d8bbff3079773c6cf906809ecaf5
commits: 6

tech-stack:
  added: []
  patterns:
    - "Profile chosen from files in the config home and git facts before createDeps, so a refusal has opened no store"
    - "Registry files read with O_NOFOLLOW, regular-file check and a 64 KiB cap; an untrusted file is a refusal, never skipped"

key-files:
  created:
    - src/domain/profile.ts
    - src/adapters/fs/profile-bindings.ts
    - src/adapters/git/repo-identity.ts
    - src/cli/profile-gate.ts
    - test/unit/profile.test.ts
    - test/integration/profile-selection.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-04-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-04-red-task2.json
  modified:
    - src/adapters/fs/profile-paths.ts
    - src/cli/main.ts
    - src/cli/args.ts
    - src/cli/composition.ts
    - src/cli/commands/repo.ts
    - src/cli/commands/onboard.ts
    - src/cli/commands/init.ts
    - test/integration/init.test.ts

key-decisions:
  - "A binding matches a repository only when both the realpath git root and the root commit equal the recorded pair; a clone of a bound repository at another path is not bound (the enterprise remote scan covers the enterprise case)"
  - "repo add binds only when --profile is given explicitly; without it nothing is bound"
  - "An untrusted bindings file or enterprise config (symbolic link, not regular, over 64 KiB, bad JSON, bad entry) is a refusal (exit 3 for invalid, 70 for unreadable), never skipped"
  - "Git is not run at all while no binding and no enterprise remotePatterns exist, so a user who uses no profile feature pays nothing"
  - "The three root environment variables apply to whichever profile was selected"

requirements-completed: []

coverage:
  - id: D1
    description: "--profile and AVARICE_PROFILE select the profile whose own roots and store open; no flag and no binding means personal-local"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#opens the store of the profile named by --profile and creates nothing under personal-local"
        status: pass
    human_judgment: false
  - id: D2
    description: "A name outside personal-local, personal-extended and enterprise-<org> exits 64 before any directory or store is created"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile.test.ts#parseProfileName (D-17)"
        status: pass
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#exits 64 for the profile name \"../x\" and creates no directory"
        status: pass
    human_judgment: false
  - id: D3
    description: "repo add --profile writes a create-only 0600 binding of the realpath git root and root commit"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#writes a create-only binding for the realpath git root and root commit, mode 0600, and refuses a second profile"
        status: pass
    human_judgment: false
  - id: D4
    description: "A bound repository run under another profile exits 3 and opens neither profile's store; AVARICE_PROFILE never overrides the binding (S-9)"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#creates neither profile's store when a binding that no store knows about refuses the command"
        status: pass
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#refuses another profile for onboard and status in a bound repository and opens neither store"
        status: pass
    human_judgment: false
  - id: D5
    description: "A repository whose remote matches an enterprise profile's remotePatterns, run under a personal profile, exits 3 naming that profile and is never re-bound"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#refuses a repository whose remote matches an enterprise profile when run under a personal profile, and never binds it"
        status: pass
    human_judgment: false
  - id: D6
    description: "An existing personal-local store and its records open unchanged with no flag (D-18); init accepts every valid profile"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#opens an existing personal-local store with its records unchanged, with no flag"
        status: pass
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#initializes every valid profile in its own roots"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 04: Profile selection and repository binding Summary

**A profile is now a selected identity: main() chooses it from the repository binding, `--profile`, `AVARICE_PROFILE` and the default before any store exists, and a bound repository run under another profile, or an enterprise repository run under a personal one, exits 3 with nothing opened**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-11-16
- **Tasks:** 3
- **Files modified:** 16 (8 created, 8 modified)

## Accomplishments

- `src/domain/profile.ts` holds the name grammar (`personal-local`, `personal-extended`, `enterprise-<org>` with org `^[a-z0-9][a-z0-9-]{0,30}$`), `profileClass`, `selectProfile` (binding, then flag, then `AVARICE_PROFILE`, then the default) and `matchesRemotePattern`, a `host/path` glob where `*` stays inside one path segment, over a credential-free, lower-cased remote that reads the same in `https`, `ssh://` and scp form.
- `main()` decides the profile after `usage()` and before `createDeps`. A bad or valueless `--profile`, or a bad `AVARICE_PROFILE` that would be chosen, exits 64 with no directory created. `resolveProfile` takes the selected name, derives the default data and work roots from it, and re-checks the grammar.
- `repo add --profile <name> <path>` writes a create-only binding to `<configHome>/bindings.json` (mode 0600, temp file then rename). A second binding of the same repository to another profile is a `conflict` that changes nothing.
- Before any store opens, `main()` reads the bindings file and every `enterprise-*` config's `remotePatterns` (config files only), then asks safe git for the repository's git root, root commit and `origin`. A mismatch exits 3 with `repository bound to <profile>`; an enterprise match under a personal profile exits 3 naming the enterprise profile. Git is not run while the registry and the patterns are both empty.
- `init` validates `--profile` against the grammar instead of refusing everything but `personal-local`. An existing Phase 1 store opens unchanged with no flag.

## Task Commits

1. **Task 1: tracer, `--profile personal-extended` opens that profile's store** (RED 11 of 13 failing, `RED_EVIDENCE_OK`)
   - `c910dda` test: failing selection tests and `04-04-red-task1.json`
   - `bcbad27` feat: grammar, selection precedence, threaded `resolveProfile` and `createDeps`
2. **Task 2: repository binding, the S-9 mismatch refusal and the enterprise remote refusal** (RED 11 of 28 failing, `RED_EVIDENCE_OK`)
   - `c7ce81a` test: failing binding and refusal tests and `04-04-red-task2.json`
   - `9778a54` feat: bindings adapter, repository identity, profile gate, `repo add --profile`
3. **Task 3: grammar unit tests, init accepts every valid profile, existing data opens unchanged**
   - `31dba4f` test: unit tests, init and existing-store cases
   - `bb93b18` feat: `init` validates against the grammar

## TDD Gate Compliance

Task 1 and Task 2 RED records were classified `RED_EVIDENCE_OK` (`target_test_failed`, TAP). The failing cases are assertion failures on the absent binding file, the missing exit 64 and the missing exit 3, with the file loading and the tracer cases passing. Task 3 wrote tests first (`31dba4f`): the unit tests for the grammar already passed because the domain module existed from Task 1, and the failing cases were the `init` ones (`init --profile enterprise-acme` refused as "only personal-local in Phase 1"); no record file was planned for it.

Tracer gate: the `<verify>` command passed on the proven slice before Task 2 (13 of 13).

## Files Created/Modified

- `src/domain/profile.ts` - grammar, class, selection, remote normalization and pattern match
- `src/adapters/fs/profile-bindings.ts` - `readBindings`, `findBinding`, `writeBinding`, `readEnterprisePatterns`
- `src/adapters/git/repo-identity.ts` - `readRepositoryFacts` (git root, root commit, credential-free origin)
- `src/cli/profile-gate.ts` - `readRepositoryContext`: the binding and the enterprise match of the repository at hand
- `src/adapters/fs/profile-paths.ts` - `resolveProfile(env, probes, profileName)`, `resolveConfigHome(env)`
- `src/cli/main.ts`, `src/cli/args.ts`, `src/cli/composition.ts` - selection before `createDeps`, `CommandModule.repository?`, `CreateDepsOptions.profile`
- `src/cli/commands/repo.ts`, `onboard.ts`, `init.ts` - `repository()` on the first two, binding after registration, grammar check in `init`
- `test/unit/profile.test.ts`, `test/integration/profile-selection.test.ts`, `test/integration/init.test.ts` - 64 new cases and one updated message

## Decisions Made

- Binding identity is the pair (git root, root commit). A clone of a bound repository at another path is not recognised by the binding; an enterprise repository is still caught by its remote patterns.
- `repo add` without `--profile` binds nothing, so an unflagged add never locks a repository to a profile.
- A registry or enterprise config that cannot be trusted refuses the command rather than being skipped: a skipped entry would let a bound repository open under another profile.
- The three root variables (`AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`) apply to whichever profile is selected, which keeps every existing test and the owner's overrides working.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `onboard` needed a `repository()` export and `init`'s existing test a new message**
- **Found during:** Task 2 and Task 3
- **Issue:** The S-9 behavior names `onboard <repo> --profile personal-local`, but `onboard.ts` is not in the plan's file list and without `repository()` main() would judge it by the working directory. `test/integration/init.test.ts` asserted the removed "only personal-local in Phase 1" text.
- **Fix:** Added a one-line `repository()` to `onboard.ts`; the init test now expects "not a profile name".
- **Files modified:** src/cli/commands/onboard.ts, test/integration/init.test.ts
- **Verification:** 83 of 83 across `profile.test.ts`, `profile-selection.test.ts` and `init.test.ts`
- **Committed in:** 9778a54, 31dba4f

**2. [Rule 3 - Blocking] Two new modules for the work main.ts would otherwise carry**
- **Found during:** Task 2
- **Issue:** Computing repository identity and reading the registry inside `main.ts` would grow a dispatch file and put git calls in it.
- **Fix:** `src/adapters/git/repo-identity.ts` (git facts) and `src/cli/profile-gate.ts` (registry plus enterprise scan) hold it; `selectProfile` is still called from `main.ts`.
- **Committed in:** 9778a54

**Total deviations:** 2 auto-fixed (2 blocking). **Impact on plan:** None on scope; both are the plan's own behavior placed where it can be tested.

## Issues Encountered

- The shell, the supervisor and launchd paths still select the default profile. A detached supervisor started under `--profile personal-extended` carries the three root variables but not `AVARICE_PROFILE`, so it reads the config of `personal-local` for notification settings and prepares that profile's config directory. Plan 04-12 carries `AVARICE_PROFILE` beside the roots and refuses a store of another profile; until it lands, profiles other than `personal-local` are meant for commands, not for a started run.
- An owner who sets `AVARICE_DATA_ROOT` and then selects two profiles would point both at one store, because the override applies to the selected profile. The store records its `profile_id` but composition does not yet compare it; 04-12's composition refusal covers this.
- `SEC-1` stays open: sibling plans of this phase also declare it, so `requirements.ready-ids` marked none ready.

## Documentation surfaces (for plan 04-38)

- Global flag `--profile <name>` on every command: grammar, exit 64 for a bad or valueless name, precedence binding then flag then `AVARICE_PROFILE` then `personal-local`
- Environment variable `AVARICE_PROFILE`: ignored while a binding applies; an invalid value exits 64 only when it is the value that would be chosen
- `repo add --profile <name> <path>`: writes the binding; without `--profile` nothing is bound
- File `<configHome>/bindings.json` (mode 0600, schema 1, `bindings[]` of `gitRoot`, `rootCommit`, `profile`, `boundAt`; opened without following a link, at most 64 KiB, refused whole when any entry is invalid)
- Profile config key `remotePatterns` (list of `host/path` globs, at most 64 of at most 256 characters) in `<configHome>/profiles/enterprise-<org>/config.json`
- Exit 3 refusals: `repository bound to <profile>` and the enterprise remote refusal naming the enterprise profile; exit 3 for an untrusted registry or enterprise config, 70 when one cannot be read
- Default data and work roots now `~/.local/share/avarice/<profile>` and `~/.local/share/avarice-work/<profile>` for every profile; `init --profile` accepts any valid name
- `docs/system/cli-reference.md` "Order of checks and profile side effects" gains a profile-selection step between the usage check and profile preparation, and its init section no longer says only `personal-local`

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-04-07 (mismatch refuses before any store opens, covered by file-absence and unchanged-mtime assertions), T-04-08 (grammar rejects `../`; bindings and enterprise configs read with `O_NOFOLLOW`, regular-file and size checks, written 0600 by temp and rename) and T-04-09 (remote patterns scanned, refusal never re-binds) are mitigated and tested. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-12 can carry `AVARICE_PROFILE` through the supervisor and launchd and add the composition refusal for a store of another profile. Later plans can read the selected profile from `CreateDepsOptions.profile` and `deps.profile.profile`.

## Self-Check: PASSED

- Files present: all eight created files
- Commits present on this branch: c910dda, bcbad27, c7ce81a, 9778a54, 31dba4f, bb93b18
- Plan verification: `node --test test/unit/profile.test.ts test/integration/profile-selection.test.ts` green, `npm run typecheck` clean, `npm run check:boundaries` ok (100 files); full unit suite 2323 of 2323 and integration suite 1360 of 1360 passing

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
