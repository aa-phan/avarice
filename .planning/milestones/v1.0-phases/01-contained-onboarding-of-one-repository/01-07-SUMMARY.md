---
phase: 01-contained-onboarding-of-one-repository
plan: 07
subsystem: first-run-and-containment
tags: [init, roots, local-mount, sqlite-gate, ac-1, offline, sandbox-exec, node-matrix]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-03 composition root, profile paths, openDb and migrate; 01-05 onboarding stage loop, fake host and test CLI; 01-06 resume, leases and kill points"
provides:
  - "avarice init [--profile personal-local]: creates the profile config (0600), data root and work root (0700), migrates the ledger, prints profile, config path, roots, schema version and the node:sqlite note; idempotent; any other profile name exits 64 before anything is created"
  - "checkRoots (src/domain/root-rules.ts): pure refusal of a root under any ~/.claude* directory, under or around realpath(CLAUDE_CONFIG_DIR), containing the home directory, or nested either way"
  - "resolveProfile(env) now returns Result: realpath of the nearest existing ancestor, checkRoots, then the local-mount check, and only then directories and config.json; every command that resolves the profile is covered"
  - "parseMountOutput, mountFor, isLocalMount (src/adapters/fs/local-mount.ts): longest mount-point prefix from `mount` output, `local` flag required; fails closed when the mount table cannot be read"
  - "checkSqliteVersion (src/domain/runtime-support.ts) and the gate inside openDb: refuses a bundled SQLite without the WAL-reset fix (below 3.51.3 / 3.50.7 / 3.44.6 on those lines, and 3.45 to 3.49), exit 70 with an actionable message; the store file is created 0600"
  - "scripts/ac1-timing.sh (AC-1), scripts/test-matrix.sh (Node 22.22.3 and dev Node), runOffline helper, offline and footprint tests"
affects: [01-08, 01-09, 01-10, 01-14, 01-15, 01-16, 01-19, phase-02]

actuals:
  tokens: 17300
  tasks: 2
  commits: 3
plan_head_before: 56b626ce0b7f36caa325726f87a47d99727a5b5e
plan_head_after: 6753fb33c61204679f64fb6fca41c40a29a7de1f

tech-stack:
  added: []
  patterns:
    - "Placement checks run on realpath'd inputs in a pure domain function; the adapter realpaths the nearest existing ancestor (so a root that does not exist yet is judged by where it will land), and nothing is created until every check passed"
    - "A command module may export usage(args) so a usage error is reported before the profile is resolved and leaves nothing on disk"
    - "Test seams are options on functions, never environment variables: openDb({ sqliteVersionProbe }), resolveProfile(env, { isLocalMount }); production passes neither"
    - "Offline proof = run the command under sandbox-exec (deny network*) plus a control that a curl to a local server succeeds outside the wrapper and fails inside it"

key-files:
  created:
    - src/cli/commands/init.ts
    - src/domain/root-rules.ts
    - src/domain/runtime-support.ts
    - src/adapters/fs/local-mount.ts
    - scripts/ac1-timing.sh
    - scripts/test-matrix.sh
    - test/helpers/offline.ts
    - test/unit/root-rules.test.ts
    - test/unit/localfs.test.ts
    - test/unit/runtime-support.test.ts
    - test/unit/footprint.test.ts
    - test/integration/init.test.ts
    - test/integration/offline.test.ts
  modified:
    - src/adapters/fs/profile-paths.ts
    - src/adapters/sqlite/db.ts
    - src/cli/composition.ts
    - src/cli/main.ts
    - src/cli/args.ts
    - src/domain/result.ts

key-decisions:
  - "resolveProfile returns the configured (resolved, not realpath'd) paths so they match what the user set and what earlier plans compare against; realpath is used only for the checks, and creation goes through the same path, so a symlinked root is judged by its target"
  - "A root that equals or contains the home directory or the Claude config directory is also refused (the plan listed only roots under them); config home is not subject to the rules, only the data and work roots"
  - "PortError unsupported gains an optional detail string, so openDb can carry the full 'Node {v} bundles SQLite {v} without the WAL-reset fix; install Node 22.22.3 or newer' text through describeError to the existing exit-70 path"
  - "openDb creates a new store file with mode 0600 before SQLite opens it (SQLite copies the mode to the -wal and -shm files), because T-01-13 needs 0600 store files and node:sqlite creates 0644 by default"
  - "A mount table that cannot be read, or has no entry for the path, refuses the data root (fail closed); Linux `mount` output is parsed too and treated as local unless the type is a known network type"
  - "init reads the schema version through a read-only openDb of state.db instead of widening the Ledger port"

patterns-established:
  - "Run every acceptance command with HOME and the AVARICE_* roots in a temp dir; the refusal tests assert that nothing at all was created before the refusal"
  - "Mutation checks on the new rules: each of eight mutants (skip checkRoots, skip the local check, .claude* prefix to exact match, 3.50.7 to 3.50.6, drop the SQLite gate, store file 0644, drop mkdir mode, shortest-prefix mount match) is killed by at least one test"

requirements-completed: [NFR-1, NFR-2, NFR-5]

coverage:
  - id: D1
    description: "avarice init in a temp profile creates config.json (schema 1, profile, dataRoot, workRoot), data and work roots with mode 0700, state.db at schema version 1 with mode 0600, prints the resolved paths and the node:sqlite note, and a second init changes nothing"
    requirement: NFR-5
    verification:
      - kind: integration
        ref: "test/integration/init.test.ts#avarice init"
        status: pass
    human_judgment: false
  - id: D2
    description: "Roots under ~/.claude*, under or around realpath(CLAUDE_CONFIG_DIR), reached through a symlink, nested either way, or on a mount without the local flag are refused by init and by status before any directory is created"
    requirement: NFR-5
    verification:
      - kind: unit
        ref: "test/unit/root-rules.test.ts"
        status: pass
      - kind: unit
        ref: "test/unit/localfs.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/init.test.ts#root placement refusals (T-01-11), #local storage requirement (T-01-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Startup refuses a bundled SQLite without the WAL-reset fix (3.47.2, 3.51.2, 3.50.6, 3.44.5 and the unparseable) and accepts 3.51.3, 3.53.4, 3.50.7, 3.44.6; the suite passes on Node 22.22.3 (SQLite 3.51.3) and Node 26.9.0 (3.53.4)"
    requirement: NFR-5
    verification:
      - kind: unit
        ref: "test/unit/runtime-support.test.ts"
        status: pass
      - kind: other
        ref: "AVARICE_NODE22=<node 22.22.3> bash scripts/test-matrix.sh (281 of 281 on each leg)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AC-1: bash scripts/ac1-timing.sh clones the repository into a scratch HOME, runs bin/avarice init then status without admin rights or installs and reports 'AC-1 elapsed 1s (target 600s)'"
    requirement: NFR-1
    verification:
      - kind: other
        ref: "bash scripts/ac1-timing.sh"
        status: pass
      - kind: unit
        ref: "test/unit/footprint.test.ts#scripts/ac1-timing.sh"
        status: pass
    human_judgment: false
  - id: D5
    description: "Onboarding with the fake host, status, init, and kill-then-resume at after-transition:mapping, :validating and :planning_ready run to completion under sandbox-exec with network denied; a control shows the wrapper blocks curl to a local server that is reachable outside it"
    requirement: NFR-2
    verification:
      - kind: integration
        ref: "test/integration/offline.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "package.json has no runtime dependencies and no install scripts; no source file imports a network module, calls fetch, listens or detaches a child; no command leaves a process or an open file under its roots after exit; status and a 1.5 s onboard never hold a TCP listener (controls prove the detectors fire)"
    requirement: NFR-1
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "The home-directory heuristic for network mounts (the `local` flag) is only as good as `mount` output; a FUSE or synced-folder mount that reports local passes. No real network volume was available to try."
    verification: []
    human_judgment: true
    rationale: "Research assumption A6: the check cannot be proven against a real smbfs or nfs mount on this machine, only against fixture text of those lines"

duration: 9min
completed: 2026-11-02
---

# Phase 01 Plan 07: First-Run Path, Root Rules and Offline Proof Summary

**`avarice init` now creates a local-storage profile only outside every `~/.claude*` and `CLAUDE_CONFIG_DIR` location, `openDb` refuses a SQLite without the WAL-reset fix, AC-1 measures clone to first `status` in 1 s, and the onboarding slice (including kill-then-resume) runs under `sandbox-exec` with the network denied and leaves no process behind.**

## Performance

- **Duration:** about 9 min (start time was not captured by the harness; estimated from the first command at 20:01Z and the last commit at 20:09Z)
- **Completed:** 2026-11-02T20:10Z
- **Tasks:** 2 of 2 (Task 1 TDD, Task 2 plain)
- **Files created:** 13, modified: 6

## Accomplishments

- Root placement is enforced where the profile is resolved, so `init`, `status`, `onboard` and `resume` all refuse a bad root before a single directory exists (tested with a symlink into `~/.claude-edu`, a custom `CLAUDE_CONFIG_DIR`, both nesting directions and a mount probe returning non-local).
- Runtime gate inside `openDb` (composition untouched for it): a probe of `:memory:` runs before any store is opened, read-only or read-write; the real probe passes on 22.22.3 (SQLite 3.51.3) and 26.9.0 (3.53.4).
- Store files are 0600 and directories 0700, asserted on the config, `state.db`, `-wal` and `-shm`, with a warning from `init` when an existing root is open to other users.
- AC-1 script, Node matrix script, an offline suite with a wrapper control, and a footprint suite whose detectors are each shown to fire on a control and on a mutant of the source.
- Full suite 281 of 281 (was 191), identical on Node 22.22.3 and 26.9.0; `tsc -p .` and `check-boundaries` (28 files) green.

## Task Commits

1. **Task 1: init, root rules, local mount, SQLite gate** (TDD)
   - RED `d425a4c` test(01-07): 71 tests, 18 pass, 53 fail on assertions (stubs for `checkRoots`, `checkSqliteVersion`, `parseMountOutput`; `resolveProfile` already returning `Result` but with no checks; no `init` command)
   - GREEN `5d1230b` feat(01-07): all 71 pass, then 73 with two tests added for the early usage refusal and the loose-mode warning
   - REFACTOR: none
2. **Task 2: AC-1 script, offline suite, footprint test, matrix** - `6753fb3` feat(01-07)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

Task 1 is `tdd="true"`: RED (`d425a4c`) precedes GREEN (`5d1230b`). RED command `node --test --test-reporter=tap <four files>` gave 71 tests, 18 pass (the accept-side cases that a permissive stub also satisfies), 53 fail, every failure an assertion on the planned behavior (a refusal not returned, an empty parse, a missing command), none a load or syntax fault. `gsd_run check tdd-red-evidence` was not run. Task 2 is not TDD-marked.

Mutation checks on the GREEN code (each restored from a copy): skipping `checkRoots`, skipping the local-mount verdict, `startsWith('.claude')` to `=== '.claude'`, `50: 7` to `50: 6`, removing the gate in `openDb`, creating the store `0o644`, dropping the mkdir mode, and picking the shortest mount prefix each fail at least one test (7, 1, 10, 1, 1, 1, 1, 1 failures). Footprint detectors: a status command that spawns a detached child holding the data root as its cwd fails the lingering-process test, and an added `import 'node:http'` fails the import scan (the first version of the scan missed a bare side-effect import; fixed).

## Decisions Made

See `key-decisions` in the frontmatter. The ones later plans are most likely to trip on:

- `resolveProfile(env, probes?)` returns `Result<ResolvedProfile>` and creates directories only after the checks pass; `composition.ts` maps its error through `describeError` to exit 70 (its only edit, three lines).
- A command module can export `usage(args)`; `main` calls it before `createDeps`. Use it for any refusal that must leave the profile untouched.
- Any new code that creates a store-adjacent file inside the data root should use mode 0600 itself (the VACUUM INTO backups from 01-06 are written with the default mode, inside the 0700 data root).
- `config.json` is written once and never read back; the roots come from the environment or the defaults on every run. If a later plan wants the config to be authoritative, `resolveProfile` is the one place to do it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Store file created with mode 0600**
- **Found during:** Task 1 (T-01-13 asserts store files 0600; a profile created by status in the real default location was 0644)
- **Issue:** `node:sqlite` creates `state.db` with the process umask (0644); only the 0700 directory protected it.
- **Fix:** `openDb` creates a new store with `open(path, 'wx', 0o600)` before SQLite opens it; SQLite copies the mode to `-wal` and `-shm`.
- **Files modified:** src/adapters/sqlite/db.ts
- **Verification:** init.test.ts asserts 0600 on every `state.db*` file; mutating to 0644 fails it.
- **Committed in:** 5d1230b

**2. [Rule 3 - Blocking] `PortError.unsupported` gets an optional `detail`**
- **Found during:** Task 1
- **Issue:** the plan wants the gate's message to read "Node {version} bundles SQLite {v} without the WAL-reset fix; install Node 22.22.3 or newer", but `unsupported` carried no text and `describeError` printed only `unsupported`.
- **Fix:** optional `detail?: string` on the variant in `src/domain/result.ts`; `describeError` prints it. No existing caller is affected.
- **Files modified:** src/domain/result.ts, src/adapters/sqlite/db.ts
- **Verification:** runtime-support.test.ts matches the full message; `tsc` green.
- **Committed in:** d425a4c (type) and 5d1230b

**3. [Rule 3 - Blocking] `usage()` hook so `init --profile team` creates nothing**
- **Found during:** Task 1 (`createDeps` runs before `run`, so a usage error in `run` would already have created the default profile)
- **Fix:** optional `usage(args)` on `CommandModule`, called in `main` before composition; `parseArgs` moved ahead of `createDeps`.
- **Files modified:** src/cli/args.ts, src/cli/main.ts, src/cli/commands/init.ts
- **Verification:** init.test.ts "refuses another profile name before anything is created".
- **Committed in:** 5d1230b

**4. [Rule 2 - Missing critical] Roots that contain the home directory or the Claude config directory are refused**
- A data root of `~` would contain `~/.claude*`; the plan's rules did not cover it. Added as rule 3 of `checkRoots`, tested.
- **Committed in:** 5d1230b

### Plan adaptations (not code deviations)

- **Acceptance command adapted to a temp HOME.** `AVARICE_DATA_ROOT=$HOME/.claude-edu/avarice-test node test/helpers/test-cli.ts init` was run as `HOME=$tmp CLAUDE_CONFIG_DIR=$tmp/.claude AVARICE_CONFIG_HOME= AVARICE_WORK_ROOT= AVARICE_DATA_ROOT=$tmp/.claude-edu/avarice-test node test/helpers/test-cli.ts init`: exit 70, stderr names `~/.claude*`, nothing created in `$tmp`. The real-home form was not run, per the instruction not to touch the user's profile locations.
- **`AVARICE_NODE22` precondition.** The variable was unset in the executor environment; the binary the precondition names as the research copy exists (v22.22.3), so it was exported to that path for the matrix run. The matrix script exits 2 with a message when it is unset (checked).
- **Test files beyond the plan list:** none outside it except `test/helpers/offline.ts`, which the plan lists. `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/composition.ts` and `src/domain/result.ts` are edited although not in `files_modified` (items 2 and 3 above).

---

**Total deviations:** 4 auto-fixed (2 missing critical, 2 blocking). **Impact on plan:** none on scope; the Phase 1 CLI surface gained one optional command-module hook.

## Issues Encountered

- Real default profile directories exist at `~/.config/avarice`, `~/.local/share/avarice/personal-local` (with `state.db`, mode 0644) and `~/.local/share/avarice-work/personal-local`, all stamped 14:00:20 local, about a minute before this executor's first command and unchanged through the end of this plan. This executor created none of them (every command used temp roots or a temp HOME; `ls` of the timestamps before and after the matrix, AC-1 and the full suite shows no change). They were left in place for the owner or orchestrator to remove. They are also what a 0644 `state.db` looks like under the old code.
- The plan start time was not captured at execution start; duration is an estimate.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None new. T-01-11 (root placement) mitigated and tested against `~/.claude*`, `CLAUDE_CONFIG_DIR`, symlinks and nesting; T-01-12 (network mount) mitigated with the stated heuristic limit (A6); T-01-13 (permissions) mitigated and asserted for directories, `config.json`, `state.db`, `-wal`, `-shm`; T-01-SC: no installs, AC-1 uses a clone, the script contains no admin-rights command and a test scans for installers.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 01-08, 01-09 and later plans can rely on `resolveProfile` refusing bad roots and on `init` as the first-run path; `scripts/ac1-timing.sh` clones `HEAD`, so run it only after committing.
- `scripts/test-matrix.sh` needs `AVARICE_NODE22` set; `npm test` stays the quick loop (281 tests, about 30 s).
- Open: A6 (the `local` flag heuristic) is unverified against a real network volume; the owner should try `AVARICE_DATA_ROOT` on an SMB or NFS share once and expect the refusal. The Node support statement (blockers list) can now cite the matrix: 22.22.3 and 26.9.0 pass; 24.x untested.

## Self-Check: PASSED

- Created files present on disk: src/cli/commands/init.ts, src/domain/root-rules.ts, src/domain/runtime-support.ts, src/adapters/fs/local-mount.ts, scripts/ac1-timing.sh, scripts/test-matrix.sh, test/helpers/offline.ts, test/unit/{root-rules,localfs,runtime-support,footprint}.test.ts, test/integration/{init,offline}.test.ts.
- Commits d425a4c, 5d1230b, 6753fb3 are ancestors of HEAD; `git rev-list --count 56b626c..HEAD` = 3.
- Acceptance criteria re-run: the four Task 1 test files 71 of 71 (73 with the two later tests); `grep -c CLAUDE_CONFIG_DIR src/adapters/fs/profile-paths.ts` = 2; `grep -rn "/Users/aphan" src | wc -l` = 0; the adapted init refusal exits 70 naming `~/.claude*`; `node --test offline.test.ts footprint.test.ts` 16 of 16; `bash scripts/ac1-timing.sh` prints `AC-1 elapsed 1s (target 600s)`, exit 0; `grep -c sudo scripts/ac1-timing.sh` = 0; `AVARICE_NODE22=... bash scripts/test-matrix.sh` exit 0 with two summaries (281 of 281 each).
- Plan verification re-run: all six test files green; `npm test` 281 of 281; `node scripts/check-boundaries.ts` ok (28 files); `npx tsc -p .` exit 0.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
