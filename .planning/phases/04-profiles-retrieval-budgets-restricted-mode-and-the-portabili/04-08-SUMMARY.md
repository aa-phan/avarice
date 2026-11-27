---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 08
subsystem: profiles
tags: [profiles, config, migration, sqlite, approvals, policy, sec-1, sec-4, ops-5, fr-12, typescript]

requires:
  - phase: 04-04
    provides: "Profile grammar and class, selection, the binding registry (writeBinding, findBinding), the profile config read discipline"
  - phase: 04-05
    provides: "PolicyFile, policySources, readOrganizationPolicy, readRepositoryPolicy"
provides:
  - "The whole profile config.json parsed over a closed key set and read back on every command (parseProfileConfig, readProfileConfig)"
  - "config.json roots authoritative for their profile; the three root variables override only the selected profile"
  - "Migration 0004: run and project indexes, an approvals match index, and approvals triggers that make an approval append-only except consumed_at and revoked_at"
  - "Composition refuses a store whose meta.profile_id is another profile before any migration"
  - "Binding backfill: every project of a store is bound to the store's profile on the first non-read-only command"
  - "AppDeps.profile.class and .config, and AppDeps.policy(repo?) returning the four policy sources"
affects: [04-09, 04-12, 04-16, 04-19, 04-21, 04-37, 04-38]

actuals:
  tokens: 20300
  tasks: 3
  commits: 6
plan_head_before: 993a56005705bdf81bc08efa9700d7387664b535
plan_head_after: e7515864c9e97964d1f453f8e3a98910f55c2de7
commits: 6

tech-stack:
  added: []
  patterns:
    - "Config sections stay raw on ProfileConfig.sections; each consumer parses its own section in its own module"
    - "A store is checked against its profile on open, before the migration and its backup, so a foreign store is never changed"
    - "Policy sources are read lazily once per createDeps and kept; a repository policy is kept by (path, pin)"

key-files:
  created:
    - src/adapters/sqlite/migrations/0004-profiles.ts
    - test/unit/profile-config.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-08-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-08-red-task2.json
  modified:
    - src/domain/profile.ts
    - src/adapters/fs/profile-config.ts
    - src/adapters/fs/profile-paths.ts
    - src/adapters/fs/profile-bindings.ts
    - src/app/deps.ts
    - src/cli/composition.ts
    - test/fault/migrations.test.ts
    - test/integration/profile-selection.test.ts
    - test/integration/init.test.ts
    - test/integration/ledger-status.test.ts

key-decisions:
  - "schema and profile may be left out of config.json (a hand-written file and the org-acme fixture have neither); when present, schema must be 1 and profile must name the selected profile"
  - "A config that does not parse is a composition failure, exit 70, like every other failure in createDeps"
  - "meta.profile_id is asserted right after the store opens and before the migration, not after it, so a foreign store is neither migrated nor backed up"
  - "No profile column is added by migration 0004; the per-store meta.profile_id is the D-18 scoping"
  - "A project whose repository path is gone is skipped by the backfill; a project bound to another profile fails composition with exit 70"
  - "deps.policy() passes organization 'absent' for a personal profile and for an enterprise profile that names no file or whose file is missing; only an enterprise profile reads policy.organizationFile"
  - "The user policy source is the profile's policy section minus organizationFile, parsed by parsePolicyFile as the user source"

patterns-established:
  - "Skeleton-first RED: the planned exports exist with no behavior, so a RED test fails on its assertion and not on a missing import"

requirements-completed: [SEC-1, SEC-4, OPS-5, FR-12]

coverage:
  - id: D1
    description: "The profile config is read back on every command: both profile forms, the roots and the raw sections; an unknown top-level key, a schema other than 1 and another profile's id are refused naming the key"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile-config.test.ts#parseProfileConfig (SEC-1)"
        status: pass
      - kind: unit
        ref: "test/unit/profile-config.test.ts#readProfileConfig (SEC-1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "config.json roots are authoritative for their profile and the three root variables override only the selected profile (finding profile-paths.ts:90 closed)"
    requirement: OPS-5
    verification:
      - kind: unit
        ref: "test/unit/profile-config.test.ts#resolveProfile roots (OPS-5; the config is authoritative for its profile)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A composed AppDeps carries the profile class and the parsed config, with the config's sections reaching later plans raw"
    requirement: SEC-1
    verification:
      - kind: unit
        ref: "test/unit/profile-config.test.ts#tracer: a profile config with limits and policy sections is parsed, authoritative for roots, and reaches AppDeps"
        status: pass
    human_judgment: false
  - id: D4
    description: "Migration 0004 adds the five indexes and the two approvals triggers, is forward-only, taken after a VACUUM INTO backup, keeps every row and is atomic under a kill"
    requirement: FR-12
    verification:
      - kind: integration
        ref: "test/fault/migrations.test.ts#migration 0004: profile scoping, status indexes and approval guards (D-18, FR-12)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A store whose meta.profile_id is another profile is refused with 'store at <path> belongs to profile <id>' (exit 70) before any migration; an existing personal-local store migrates to schema 4 intact"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/fault/migrations.test.ts#the store belongs to its profile (D-18, T-04-19)"
        status: pass
    human_judgment: false
  - id: D6
    description: "On the first non-read-only command every project of a store gets a binding for the store's profile; a read-only command writes none; the project is then refused under another profile with exit 3"
    requirement: SEC-1
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#binding backfill for projects already in a store (D-18)"
        status: pass
    human_judgment: false
  - id: D7
    description: "AppDeps.policy() returns the organization file only for an enterprise profile, the profile's own policy section as the user source, and the repository policy read at the pin; sources are read once per command"
    requirement: SEC-4
    verification:
      - kind: integration
        ref: "test/integration/profile-selection.test.ts#AppDeps.policy: the policy sources of a profile (SEC-4, D-17)"
        status: pass
    human_judgment: false

duration: 36min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 08: Profile config read back, migration 0004 and store scoping Summary

**The profile config.json is parsed whole and authoritative for its roots, schema 4 adds the run, project and approval indexes plus append-only guards on approvals, a store of another profile is refused before it is migrated, existing projects are bound to their store's profile, and AppDeps carries the class, the parsed config and the policy sources**

## Performance

- **Duration:** 36 min
- **Started:** 2026-11-16T20:10:30Z
- **Completed:** 2026-11-16T20:46:41Z
- **Tasks:** 3
- **Files modified:** 14 (4 created, 10 modified, excluding this summary)

## Accomplishments

- `parseProfileConfig` accepts the written form (`profile: "personal-local"`) and `{ id, class }`, checks the roots for shape, and keeps `notify`, `limits`, `retrieval`, `credentials`, `adapters`, `retention`, `policy`, `remotePatterns`, `workspaceRoots` and `freshnessWindowHours` raw for their owners. An unknown top-level key, a schema other than 1, a profile id other than the selected one and a class that is not the id's class are refused naming the key. `readProfileNotify` now reads through it with the same results.
- `resolveProfile` takes each root from its variable, else the config, else the default, so the owner's edit of `dataRoot` or `workRoot` takes effect, a leading `~/` is expanded against HOME and a relative root is refused. It returns the class and the parsed config, which `createDeps` hands to `AppDeps.profile`.
- Migration 0004 (checksummed, forward-only) creates `decisions_run`, `gate_results_run`, `notifications_run`, `runs_project` and `approvals_match`, and the triggers `approvals_no_delete` and `approvals_update_guard`. A kill inside the migration (SIGKILL from a SQL function) leaves schema 3 or 4 with a clean integrity check, and a re-run finishes it.
- `createDeps` reads `meta.profile_id` as soon as the store opens and refuses a mismatch with `store at <path> belongs to profile <id>` (exit 70), before the migration, the backup or any write.
- `backfillBindings` binds each project of the store to the store's profile on the first command that may write. After it, `status --profile personal-extended` inside such a repository exits 3 with `repository bound to personal-local`. `status` writes no bindings file.
- `AppDeps.policy(repo?)` builds `policySources` from the profile class, the organization file (enterprise profiles only, resolved against the profile config directory), the user section and `.avarice/policy.json` at the pin.

## Task Commits

1. **Task 1: tracer, a profile config with limits and policy sections is parsed, authoritative for roots, and reaches AppDeps** (RED 17 of 20 failing, `RED_EVIDENCE_OK`)
   - `0fa8884` test: failing config tests, skeleton exports, `04-08-red-task1.json`
   - `b481d31` feat: parser, reader, root authority, class and config on AppDeps
2. **Task 2: migration 0004 and the store profile assertion** (RED 7 of 29 failing, `RED_EVIDENCE_OK`)
   - `9295242` test: failing migration and profile-refusal tests, `MIGRATION_0004` skeleton, `04-08-red-task2.json`
   - `950db45` feat: migration 0004, composition assertion, schema-version assertions moved to 4
3. **Task 3: binding backfill for existing projects and the policy loader on AppDeps** (RED 11 of 45 failing)
   - `de7e0f7` test: failing backfill and policy tests, `AppDeps.policy` skeleton
   - `e751586` feat: `backfillBindings`, `policyLoader`

**Plan metadata:** the commit that adds this summary, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Task 1 and Task 2 RED records were classified `RED_EVIDENCE_OK` (`target_test_failed`, TAP). Each ran against skeleton exports that carry the planned names and no behavior, so the targets failed on assertions (`deps.profile.class` undefined against `personal`; `status` exit 0 against 70), not on a missing import. The tests that passed in RED assert behavior that already held (the `readProfileNotify` results, an unselected profile's config being ignored, 0001 to 0003 unchanged). Task 3 had no record file in the plan; its RED run (11 of 45 failing, all assertion failures on the bindings file, the policy result and the exit code) is in the `test(04-08)` commit `de7e0f7`.

Tracer gate: the tracer `<verify>` passed on the proven slice before Task 2 (122 of 122 across `profile-config`, `notify-policy` and `profile-selection`).

## Files Created/Modified

- `src/domain/profile.ts` - `PROFILE_CONFIG_KEYS`, `SectionKey`, `ProfileConfig`, `parseProfileConfig`
- `src/adapters/fs/profile-config.ts` - `configPathFor` (moved here), `readProfileConfig`, `readProfileNotify` through it
- `src/adapters/fs/profile-paths.ts` - roots from variable, config or default; class and config on `ResolvedProfile`; re-exports `configPathFor`
- `src/adapters/fs/profile-bindings.ts` - `backfillBindings`
- `src/adapters/sqlite/migrations/0004-profiles.ts` - `MIGRATION_0004`
- `src/app/deps.ts` - `ProfilePaths.class`, `ProfilePaths.config`, `AppDeps.policy`
- `src/cli/composition.ts` - `MIGRATIONS` with 0004, `refuseForeignStore`, the backfill call, `policyLoader`
- `test/unit/profile-config.test.ts` - parser, reader, root and composition cases
- `test/fault/migrations.test.ts`, `test/integration/profile-selection.test.ts` - migration, kill, refusal, backfill and policy cases
- `test/integration/init.test.ts`, `test/integration/ledger-status.test.ts` - schema-version expectations 3 to 4

## Decisions Made

See key-decisions above. The `Decisions needing owner review` section lists the ones that set policy or security semantics beyond the plan.

## Decisions needing owner review

1. **Foreign store refused before migration, not after.** The plan said to assert after migrate; the check runs right after the store opens, so a store of another profile is not migrated and no pre-migration backup is written into it. The message is the planned text plus `, not <selected>; run it under that profile (--profile <id>) or point the roots at a store of <selected>`.
2. **A store holding a project already bound to another profile fails composition (exit 70) for every non-read-only command.** The plan said "report a binding to another profile as a composition failure"; the consequence is that a repository registered in two profile stores locks the second store until the stray project is dealt with. Read-only commands still work.
3. **A project whose repository path no longer exists is skipped by the backfill** (no git root to key a binding on). It stays unbound and can be opened under any profile until its path returns.
4. **An invalid config.json is exit 70** (composition failure), where plan 04-04 made an untrusted bindings file or enterprise config exit 3. Both refuse; they differ in code.
5. **Enterprise profile with no `policy.organizationFile`, or whose file is missing, yields `organization: 'absent'`**, which the evaluator treats as a broken rank 1 (every privileged action denied, D-17). A personal profile ignores `organizationFile` even when set.
6. **`schema` and `profile` are optional in config.json** (the org-acme fixture and the existing notify tests have neither); when given they must be 1 and the selected profile. A file that names another profile is refused.
7. **The user policy source is the whole `policy` section minus `organizationFile`**, so `policy: { schema: 1, rules: [...] }` is the user policy and any other key in it is refused by `parsePolicyFile`.
8. **Concurrent backfills.** `writeBinding` is read, modify, rename with no lock. Two processes that backfill at once can drop one entry; the next non-read-only command adds it again.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing tests that assert schema version 3**
- **Found during:** Task 2
- **Issue:** `init.test.ts`, `ledger-status.test.ts` (three assertions, the harness migration list, and a "newer build" case that recorded version 4) and `migrations.test.ts` encoded the shipped version as 3. Adding migration 0004 makes them fail by design.
- **Fix:** Expectations moved to 4; the "newer build" case records version 5; the v2-to-v3 migration case keeps its own list (`V3_SHIPPED`).
- **Files modified:** test/integration/init.test.ts, test/integration/ledger-status.test.ts, test/fault/migrations.test.ts
- **Verification:** all three files pass; full suite below
- **Committed in:** 950db45 (Task 2 commit)

**2. [Rule 2 - Missing critical] Foreign-store check placed before the migration**
- **Found during:** Task 2
- **Issue:** Asserting after `migrate` would already have migrated and backed up a store belonging to another profile, writing into it.
- **Fix:** Check on open, in both the read-only and writable paths (see owner review item 1).
- **Files modified:** src/cli/composition.ts
- **Committed in:** 950db45

**3. [Rule 3 - Blocking] `configPathFor` moved to profile-config.ts**
- **Found during:** Task 1
- **Issue:** `profile-paths.ts` now imports `readProfileConfig`, which imports `configPathFor` from `profile-paths.ts`: a cycle.
- **Fix:** `configPathFor` lives in `profile-config.ts` and is re-exported from `profile-paths.ts`, so every existing import still resolves.
- **Files modified:** src/adapters/fs/profile-config.ts, src/adapters/fs/profile-paths.ts
- **Committed in:** b481d31

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical). **Impact on plan:** None on scope; 0001 to 0003 are unchanged (`git diff` against the plan base lists only 0004 as added).

## Issues Encountered

- The kill test needed a SQL function that SIGKILLs the process inside the migration transaction (`db.function`, Node 26); it runs in a child process started from the test.
- No flaky test hit: the full run showed no `ENOTEMPTY` and no `database is locked`.

## User Setup Required

None - no external service configuration required.

## Documentation surfaces (for plans 04-37 and 04-38)

- Config keys of `<configHome>/profiles/<profile>/config.json`: the closed set `schema`, `profile`, `dataRoot`, `workRoot`, `notify`, `limits`, `retrieval`, `credentials`, `adapters`, `retention`, `policy`, `remotePatterns`, `workspaceRoots`, `freshnessWindowHours`. `schema` is 1 or left out. `profile` is the id string or `{ id, class }` and must name the selected profile. An unknown key is refused naming it. The file is opened without following a link, at most 64 KiB.
- Root precedence for `dataRoot` and `workRoot`: the variable (`AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`) for the selected profile, then config.json (absolute, or `~/...`; a relative root is refused), then `~/.local/share/avarice[-work]/<profile>`. config.json is created once, with the roots in use, and never rewritten. This closes `docs/system/findings.md` entries for `profile-paths.ts:90` (config written once, never read) and changes the config reference page.
- `policy` section: `organizationFile` (enterprise profiles only; resolved against the profile's config directory; missing file means every privileged action denied) and, beside it, `schema` and `rules` as the user policy.
- Schema 4 (`MIGRATION_0004`): indexes `decisions_run`, `gate_results_run`, `notifications_run`, `runs_project`, `approvals_match`; triggers `approvals_no_delete` (message `approvals rows are never deleted`) and `approvals_update_guard` (message `approvals rows change only by setting consumed_at or revoked_at once`). No per-row profile column: scoping is `meta.profile_id`. Update the schema version in `docs/system/data-model.md` and the init output (`schema version: 4`).
- Composition refusals (exit 70): `store at <path> belongs to profile <id>, not <selected>; ...`; a store project bound to another profile (`repository <git root> is bound to <profile>`); an invalid config.json naming the key.
- Binding registry: written on the first non-read-only command for every project of the store that has none (`bindings.json`, mode 0600); `status` and other read-only commands write none.
- `AppDeps` members: `profile.class`, `profile.config`, `policy(repo?)`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-19 (wrong-profile store; refusal tested before migration), T-04-20 (approvals edited or deleted; both triggers tested), T-04-21 (hostile config keys; closed key set, hostile key printed without control characters, link and size refused), T-04-22 (interrupted migration; one transaction, backup first, SIGKILL test) are mitigated and tested. No package was installed (T-04-SC).

## Next Phase Readiness

Later plans read `deps.profile.config.sections.<name>` for their own section and call `deps.policy({ path, pin })` for the sources; plan 04-12 can rely on the composition refusal for a store of another profile. The approval gate can insert approvals and set `consumed_at` and `revoked_at` once each, and nothing else.

## Self-Check: PASSED

- Files present: `src/adapters/sqlite/migrations/0004-profiles.ts`, `test/unit/profile-config.test.ts`, `04-08-red-task1.json`, `04-08-red-task2.json`
- Commits present on this branch: 0fa8884, b481d31, 9295242, 950db45, de7e0f7, e751586
- Acceptance: 0001 to 0003 unchanged against the plan base; 4 files in `src/adapters/sqlite/migrations`; `readProfileConfig` in `profile-paths.ts`; `policy(` in `src/app/deps.ts`; `readOrganizationPolicy` in `composition.ts`
- Plan verification: `profile-config`, `migrations` and `profile-selection` tests 94 of 94, `npm run typecheck` clean, `npm run check:boundaries` ok (106 files); full suite 4311 tests, 4240 pass, 0 fail, 71 skipped

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
