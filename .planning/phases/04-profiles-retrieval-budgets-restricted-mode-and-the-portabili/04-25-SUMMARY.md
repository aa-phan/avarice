---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 25
subsystem: operations
tags: [doctor, diagnostics, host-admission, enforcement, record-compatibility, offline, read-only, ops-1, ops-6, d-20, s-38, s-49, typescript]

requires:
  - phase: 04
    provides: "plan 04-08: readProfileConfig, the profile config sections, MIGRATIONS (schema 4)"
  - phase: 04
    provides: "plan 04-11: admitHostVersion, REQUIRED_HELP_FLAGS, the admission rule and the label `admitted (unverified patch)`"
  - phase: 04
    provides: "plan 04-15: parseCredentialRef and the provider allow-list per profile class"
  - phase: 04
    provides: "plans 04-16, 04-19, 04-20: the attended hook entry and its marker, the delegated provider, the run read model"
  - phase: 04
    provides: "plans 04-23 and 04-24: the restricted launch flags (RESTRICTED_HELP_FLAGS), the restricted record and its start refusal"
provides:
  - "`avarice doctor [--json] [--online] [--repair] [--extensions]`: profile, runtime, store, host, gsd, graphify, adapters, runs and records sections with a finding and a fix for everything wrong; exit 0 when no finding is an error, 3 otherwise, 64 usage, 70 internal"
  - "src/ports/diagnostics.ts `Diagnostics` and src/adapters/diagnostics/probes.ts `ProcessDiagnostics`: bounded (1 s) probes, store opened read-only and never migrated"
  - "src/cli/doctor-deps.ts `createDoctorDeps`: the read-only composition main() uses instead of createDeps for a module that exports `composeDoctor`"
  - "src/app/doctor.ts `runDoctor`, `DoctorReport`, `DoctorFinding`, `recordCompatibility`, `nodeSatisfies`"
  - "`start` refuses (exit 3, `record-incompatible`) a project whose active record was built under a GSD the installed one cannot be used with, before anything is created"
  - "`identifyGsdCore` (locate.ts), `helpListsFlag` (host-admission.ts), `gsdVersionAdmitted` and `gsdMinorOf` (src/domain/gsd-version.ts): shared by the locator, the launch preflight, doctor and start"
  - "test/fixtures/json-shapes/doctor.json and the shared test helper test/helpers/doctor-fixtures.ts"
affects: [04-34, 04-37, 04-38, 04-39]

actuals:
  tokens: 58000
  tasks: 3
  commits: 6
plan_head_before: 45de30d72df95b1168e06857693449841dbc8ecb
plan_head_after: 846e96391dfce5628e9a435c79b304be328a0d5a
commits: 6

tech-stack:
  added: []
  patterns:
    - "A command module that exports `composeDoctor` is composed by it instead of createDeps (main.ts); only `doctor` does, so a diagnosis never needs a migrated store, a GSD or a host"
    - "Probes return raw facts and the application read model judges them (admission, enforcement, compatibility, findings); the port never throws and every process it starts has its own timeout and a SIGKILL"
    - "Incompatibility of a stored record is derived (recordCompatibility) and never written; `doctor` and `start` call the same function"
    - "Every string of the report passes the process redactor (mapStrings) before it leaves the app layer, and the text renderer strips control characters once more"

key-files:
  created:
    - src/ports/diagnostics.ts
    - src/adapters/diagnostics/probes.ts
    - src/app/doctor.ts
    - src/cli/doctor-deps.ts
    - src/cli/commands/doctor.ts
    - src/domain/gsd-version.ts
    - test/integration/doctor.test.ts
    - test/integration/doctor-versions.test.ts
    - test/helpers/doctor-fixtures.ts
    - test/fixtures/json-shapes/doctor.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-25-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-25-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-25-red-task3.json
  modified:
    - src/cli/main.ts
    - src/cli/composition.ts
    - src/app/run-start.ts
    - src/adapters/gsd/locate.ts
    - src/adapters/host-claude/launch-preflight.ts
    - src/domain/host-admission.ts
    - test/unit/json-shapes.test.ts

key-decisions:
  - "doctor does not use createDeps: `composeDoctor` in the command module builds a read-only set (resolveProfile, the bounded probes, a lazily opened read-only ledger), and main.ts calls it instead of createDeps. The profile config is read raw, so an `env:` reference is a finding and not a composition failure"
  - "Severity: an absent or refused host, an unavailable sandbox, an unreadable hook entry, an absent GSD, an older store and every `--online` or `--extensions` finding are warnings (exit 0); an incompatible or unidentifiable GSD, a store written by a newer AVARICE, a foreign or unreadable store, a failed integrity check, an `env:` or malformed credential reference, a Node below the engines rule and an incompatible active record are errors (exit 3)"
  - "Enforcement is judged the way checkHostReady does (admitted version, sandbox probe, readable hook entry), and is `restricted` when the host is not enforced but lists every flag of the restricted line, else `none`"
  - "An empty or unparseable `claude --version` is reported as version `unknown` and refused with the launch rule `host-version-unreadable`, never admitted"
  - "S-38 is derived: a record is incompatible when no admitted gsd-core is located, the located one is outside 1.17.x, or its minor differs from the minor the record was built under; start applies the same rule and the record row is never touched"
  - "--online prints only the outcome of `<cli> auth status` (ok, exit code, timed out, not found), never its output, and does not pass an environment token to it"
  - "A credential value that does not have the shape `scheme:name` is shown as `(not a credential reference)`, so a secret typed where a reference belongs is not echoed back"

patterns-established:
  - "test/helpers/doctor-fixtures.ts: a profile, a temp HOME and CLAUDE_CONFIG_DIR, and a fake gsd-core 1.17.0 for a doctor test; the owner's environment never leaks in"

requirements-completed: [OPS-1, OPS-6]

coverage:
  - id: D1
    description: "`avarice doctor --json` reports profile, runtime, store, host, gsd, graphify, adapters, runs, records and findings from its own read-only composition, and still does when GSD is incompatible, the store is newer or missing, or the host is absent; it creates no store and changes none"
    requirement: "OPS-1"
    verification:
      - kind: integration
        ref: "test/integration/doctor.test.ts#prints profile, runtime, store, host, gsd, graphify, adapters, runs and findings, and exits 0 when nothing is an error"
        status: pass
      - kind: integration
        ref: "test/integration/doctor.test.ts#with a gsd-core 1.18.0 it still fills every other section and exits 3 with a gsd finding that has a fix"
        status: pass
      - kind: integration
        ref: "test/integration/doctor.test.ts#with a store of schema 9 it says `written by a newer AVARICE`, exits 3, and changes nothing in the store"
        status: pass
    human_judgment: false
  - id: D2
    description: "doctor finishes in under 2,000 ms under the network-denied sandbox wrapper, each probe bounded at 1 s"
    requirement: "OPS-1"
    verification:
      - kind: integration
        ref: "test/integration/doctor.test.ts#finishes in under 2,000 ms under the network-denied wrapper"
        status: pass
    human_judgment: true
    rationale: "The test measures a profile with no claude and a small store (about 330 ms). A real `claude`, a slow graphify or a large store make the bound depend on the machine; the 1 s per-probe timeouts are the guarantee, and only the owner's own run shows the total"
  - id: D3
    description: "doctor prints no secret: references are shown as references, a secret pasted in the config or seeded in the store appears in neither text nor JSON, with every flag on"
    requirement: "OPS-1"
    verification:
      - kind: integration
        ref: "test/integration/doctor.test.ts#shows references as references, never resolves one, and a secret seeded in the store and one pasted into the config appear in neither the text nor the JSON"
        status: pass
      - kind: integration
        ref: "test/integration/doctor.test.ts#runs the CLI's own auth status for a delegated:gh reference and reports ok without printing the token"
        status: pass
    human_judgment: false
  - id: D4
    description: "The host section gives the admission (verified, `admitted (unverified patch)`, refused, absent), the enforcement level (enforced, restricted, none), the restricted launch availability, and the attended hook (none, or enforced for privileged approvals only after install-host)"
    requirement: "OPS-6"
    verification:
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#labels an unverified 2.1 patch `admitted (unverified patch)` and its enforcement enforced once the sandbox and the hook entry check out"
        status: pass
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#refuses 2.2.0, reports enforcement restricted because the restricted launch is available, and the fix names --restricted"
        status: pass
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#is none until install-host writes the entry, then enforced for privileged approvals only"
        status: pass
    human_judgment: false
  - id: D5
    description: "A host whose `claude --version` is empty or unparseable is reported `unknown` and refused, never admitted"
    requirement: "OPS-6"
    verification:
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#reports a version that is empty as `unknown` and refuses it, never admits it (empty edge)"
        status: pass
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#reports a version that is not a version as `unknown` and refuses it"
        status: pass
    human_judgment: false
  - id: D6
    description: "A profile credential reference that is `env:` is an error finding naming the reference, with the fix `use delegated:, keychain: or cmd:`; the normal composition stops on the same config and doctor explains it"
    requirement: "OPS-1"
    verification:
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#names env:GITHUB_TOKEN, says to use delegated:, keychain: or cmd:, exits 3, and the other sections are still filled"
        status: pass
    human_judgment: false
  - id: D7
    description: "With the installed GSD outside the adapter range, doctor lists each active record incompatible with its recorded revision, GSD version and fix, and `start` exits 3 naming `incompatible`; the record rows and every run table are byte-identical afterwards"
    requirement: "OPS-6"
    verification:
      - kind: integration
        ref: "test/integration/doctor-versions.test.ts#lists the record incompatible with its fix, ties it to its revision and GSD version, and `start` exits 3 naming `incompatible`; the store is byte-identical before and after both"
        status: pass
      - kind: integration
        ref: "test/integration/run-start.test.ts"
        status: pass
    human_judgment: false
  - id: D8
    description: "--online adds a reachability section through the delegated provider with no network call without the flag; --repair deletes only `.tmp-*` artifact files older than 1 hour; --extensions reports config directories, duplicate hook and skill registrations and push or pull-request instructions without approval as warnings"
    requirement: "OPS-1"
    verification:
      - kind: integration
        ref: "test/integration/doctor.test.ts#removes the old one, keeps the newer one and every real artifact, and leaves every ledger row (counts unchanged)"
        status: pass
      - kind: integration
        ref: "test/integration/doctor.test.ts#warns about an attended hook in two directories, a skill of the same name in both, and a CLAUDE.md that pushes without approval"
        status: pass
      - kind: integration
        ref: "test/integration/doctor.test.ts#without --online no network call is attempted: the report has no online section and the CLI is never run, under the network-denied wrapper"
        status: pass
    human_judgment: true
    rationale: "The tests run a fake `gh`. Whether the real `gh auth status` behaves the same under the stripped environment (no token variable, only HOME and the config directory variables) needs a run on a machine with a real gh login"
  - id: D9
    description: "The doctor --json shape is frozen in a snapshot and no earlier fixture changed"
    requirement: "OPS-1"
    verification:
      - kind: unit
        ref: "test/unit/json-shapes.test.ts#doctor --json on an initialized profile with an admitted gsd-core, no host and no graphify"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 25: `avarice doctor` Summary

**`avarice doctor` diagnoses the profile, runtime, store, host, GSD, graphify, adapters, runs and active records offline in about 0.3 s on its own read-only composition, gives every finding a fix, prints no secret, and `start` now refuses a record the installed GSD cannot be used with (S-38).**

## Performance

- **Duration:** about 21 min
- **Started:** 2026-11-17T09:52:49Z
- **Completed:** 2026-11-17T10:14:00Z
- **Tasks:** 3 of 3
- **Files:** 20 touched by the plan's commits (13 created, 7 modified, counting the three RED records)

## Accomplishments

- A new command module `doctor` that main() composes through its own `composeDoctor` export: no migration, no backup, no lease, no GSD requirement and no host composed. The profile config is read raw, so a bad credential reference becomes a finding and not an exit 70.
- Probes behind a `Diagnostics` port, each bounded at 1 s with SIGKILL: Node and SQLite versions, the store (read-only; schema version, profile, journal mode, `quick_check`, adapter descriptors, newest pre-migration backup), `claude --version` and `--help`, the gsd-core identity (even when its version is outside the admitted line), graphify, the OS sandbox, hook entry readability, the attended hook entry, configuration directories.
- The host section judges admission with `admitHostVersion` (labels `verified`, `admitted (unverified patch)`, `refused`, `absent`), checks the required flags of an unverified patch in `--help`, probes the sandbox only for an admitted version, and derives enforcement `enforced`, `restricted` (the restricted line's flags are listed) or `none`. The `admitted (unverified patch)` label that plan 04-11 could only document now has a place in the output.
- Findings with level, area, message and fix: a Node below `engines`, an unreadable or foreign or newer store (`written by a newer AVARICE`), an `env:` credential reference, an incompatible GSD, an incompatible active record, an absent or refused host (the fix names `--restricted` when the restricted launch is available).
- `recordCompatibility` (S-38) is shared with `start`: with the installed gsd-core outside 1.17.x, `start` exits 3 with `record-incompatible` and the fix `reinstall GSD 1.17.x or re-onboard after the adapter supports the new version`, and nothing is created; the project record row is byte-identical.
- `--online`, `--repair` and `--extensions`, and a frozen `doctor --json` snapshot.

## Task Commits

Each task followed RED, GREEN:

1. **Task 1: Tracer** - RED `41cfa4e` (test), GREEN `10ddc46` (feat)
2. **Task 2: Findings and S-38** - RED `c2723cd` (test), GREEN `19c4b2c` (feat)
3. **Task 3: --online, --repair, --extensions, snapshot** - RED `85e26b5` (test), GREEN `846e963` (feat)

**Plan metadata:** the docs commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

| Task | RED evidence | Verdict |
|------|--------------|---------|
| 1 | `04-25-red-task1.json`: five of six tests failed with exit 64 `unknown command 'doctor'` where the planned exit was 0 or 3 | RED_EVIDENCE_OK |
| 2 | `04-25-red-task2.json`: the S-38 test failed on the `start` message (the generic `gsd-not-admitted` text, no `incompatible`, no fix) | RED_EVIDENCE_OK |
| 3 | `04-25-red-task3.json`: the online, repair and extensions tests failed because the report had no such section | RED_EVIDENCE_OK |

The RED step of each task was run against a tree without the code of that task: for task 1 the whole implementation was set aside (copied out of the repository, files reverted one by one, never with a blanket reset) and put back for GREEN; tasks 2 and 3 held back `run-start.ts` and the three option lines of `runDoctor`. Because doctor's read model is one module that task 1 had to build, most cases of tasks 2 and 3 (admission labels, empty version, env reference, attended hook, `recordCompatibility`, the no-secret scan, the no-flag cases) passed before any code of their own task. Each RED record names the one target that was really failing, and the early-green tests stay in the suite as the plan's behavior cases.

## Files Created/Modified

- `src/app/doctor.ts` - `runDoctor`, `recordCompatibility`, `nodeSatisfies`, the report types and every finding builder
- `src/ports/diagnostics.ts` - the `Diagnostics` port and its fact types
- `src/adapters/diagnostics/probes.ts` - `ProcessDiagnostics`: bounded probes, read-only store open, `removeOrphanTemps`
- `src/cli/doctor-deps.ts` - `createDoctorDeps`: profile, claude and hook entry rules shared with the composition, lazy read-only ledger
- `src/cli/commands/doctor.ts` - usage, `composeDoctor`, the text renderer and the exit codes
- `src/cli/main.ts` - `doctor` in COMMANDS; a module that exports `composeDoctor` is composed by it
- `src/cli/composition.ts` - `locateOnPath` exported
- `src/app/run-start.ts` - `recordCompatibility` before anything is created, in the missing-GSD branch and after the record is read
- `src/adapters/gsd/locate.ts` - `identifyGsdCore` (found, absent or unreadable, with a timeout); `locateGsdCore` is built on it with its messages unchanged
- `src/domain/gsd-version.ts` - `gsdVersionAdmitted`, `gsdMinorOf`
- `src/domain/host-admission.ts`, `src/adapters/host-claude/launch-preflight.ts` - `helpListsFlag` shared by the preflight and doctor
- `test/integration/doctor.test.ts`, `test/integration/doctor-versions.test.ts`, `test/helpers/doctor-fixtures.ts`, `test/unit/json-shapes.test.ts`, `test/fixtures/json-shapes/doctor.json`

## Decisions Made

See key-decisions. The ones that are owner policy are listed next.

## Decisions needing owner review

1. **Which findings are errors (exit 3) and which are warnings (exit 0).** The plan fixed the exit codes and "each error carries a fix line" but not the classification. I made the things that stop AVARICE from working on what it already has errors (incompatible or unidentifiable GSD, newer or foreign or unreadable store, failed integrity check, `env:` or malformed credential reference, Node below the rule, incompatible active record) and the things that are merely not set up yet warnings (no `claude`, a refused or unprobed host, no sandbox, no GSD installed, an older store, `--online` failures, `--extensions` findings). A script that wants "healthy" to include an installed, admitted host cannot use the exit code alone; it can read `host.enforcement` from `--json`. Say if an absent host or an absent GSD should be an error.
2. **Instruction-conflict heuristic of `--extensions`.** A line of `CLAUDE.md` is reported when it matches `git push`, `gh pr create` or "create/open/raise/submit a pull request" and carries none of: approve/approval, ask, confirm, permission, consent, never, do not, don't, must not, without asking. The docs call for "a fixed pattern list"; the words and the line-by-line rule are mine. Only the line number is reported, never the text.
3. **`quick_check` instead of `integrity_check`.** The store check is `PRAGMA quick_check(1)` so the 2 s bound holds on a store of any size; the report field is still called `integrity`. `docs/operations-and-testing.md` shows `integrity_check`.
4. **`--online` prints no output of the vendor CLI at all**, only ok, `auth status failed (exit N)`, timed out or not found, and runs the CLI with a stripped environment (HOME, USER, LOGNAME, LANG, TMPDIR, XDG_CONFIG_HOME, GH_CONFIG_DIR, and PATH filtered to absolute directories). A token in AVARICE's own environment is deliberately not passed (S-49). The plan said "reports ok or the CLI's failure without printing any token"; carrying the CLI's own message was judged riskier than the exit code.
5. **A credential string that is not shaped `scheme:name` is shown as `(not a credential reference)`.** The plan did not say what to print for a value that is not a reference at all; echoing it could print a secret that was pasted in its place.
6. **Doctor honours profile selection like every command** (`--profile`, `AVARICE_PROFILE`, a repository binding, an enterprise remote), so run from inside a repository bound to another profile it refuses with the profile exit code before it diagnoses anything. The plan did not exempt it.
7. **The attended hook is looked for only in the effective configuration directory** (`CLAUDE_CONFIG_DIR`, else `~/.claude`), the one `install-host` writes to; the other directory is looked at only under `--extensions`.
8. **`start` reports an incompatible record before it reports an unreadable brief**, and the message of the missing-GSD refusal changes for a project that has an active record (`record-incompatible` instead of `gsd-not-admitted`, still exit 3, with the old facts inside it). A start for a repository that is not registered keeps the old text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The doctor composition needs a way into main() that the plan's module-export idea alone did not cover**
- **Found during:** Task 1
- **Issue:** `CommandModule` has no composition hook, and `main()` types the module's deps as `AppDeps`.
- **Fix:** main.ts reads an optional `composeDoctor` export and calls it instead of createDeps, as the plan's key link says; the deps are typed through one cast confined to that branch (the doctor `run` takes `DoctorDeps`). `CommandModule` in args.ts is unchanged.
- **Files modified:** src/cli/main.ts
- **Committed in:** `10ddc46`

**2. [Rule 3 - Blocking] `locateGsdCore` could not report a version outside the admitted line, and its timeout could not be bounded**
- **Found during:** Task 1
- **Issue:** doctor must name an incompatible gsd-core's version and needs a 1 s bound; the locator folds every non-admitted case into one `unsupported` message with a fixed 5 s timeout.
- **Fix:** `identifyGsdCore(env, timeoutMs)` returns what the directory holds; `locateGsdCore` is rebuilt on it with the same results and messages (`gsd-adapter` tests pass). The version regex moved to `src/domain/gsd-version.ts`.
- **Files modified:** src/adapters/gsd/locate.ts, src/domain/gsd-version.ts
- **Committed in:** `10ddc46`

**3. [Rule 1 - Bug] The text view called a configured but missing `claude` "did not answer"**
- **Found during:** Task 2 (test with the default test `AVARICE_CLAUDE_BIN` of a path that does not exist)
- **Fix:** an absent host prints `claude not found (<path>)`.
- **Files modified:** src/cli/commands/doctor.ts
- **Committed in:** `19c4b2c`

**4. [Rule 2 - Missing critical] The snapshot and the shared fixture leaked the owner's environment**
- **Found during:** Task 3 (the first written snapshot held the owner's real `CLAUDE_CONFIG_DIR`)
- **Fix:** the doctor fixture and the snapshot test set `CLAUDE_CONFIG_DIR` to a temp directory, the snapshot normalizes the store's byte size, and the host keys have a fixed order.
- **Files modified:** test/helpers/doctor-fixtures.ts, test/unit/json-shapes.test.ts, src/app/doctor.ts
- **Committed in:** `846e963`

---

**Total deviations:** 4 auto-fixed (1 bug, 1 missing critical, 2 blocking), plus the owner-review decisions above.
**Impact on plan:** none changes what the plan delivers.

## Issues Encountered

- A tool restriction of this session refused shell commands that name git inside a compound or heredoc form, so the RED/GREEN set-aside and the test appends were done with plain commands and the edit tools.
- No test spends on a model: every launch of `claude` is the fake, and `gh` is a fake script.

## Documentation surfaces

For plans 04-37, 04-38 and 04-39 (`docs/system/` was not edited here; the phase documentation plans own it):

- **Command:** `avarice doctor [--json] [--online] [--repair] [--extensions] [--profile <name>]`. Exit 0 when no finding has level error, 3 when at least one does, 64 for a usage error (an argument or an unknown option), 70 for an internal failure. Add to `docs/system/cli-reference.md`.
- **Composition:** its own read-only dependency set (`createDoctorDeps`), not `createDeps`: no migration, no backup, no lease, no GSD requirement, no host composed; it creates only what resolveProfile creates (the profile directories and config file). Every probe is bounded at 1 s (SIGKILL); the `--online` auth check at 8 s.
- **Report sections (JSON key order):** `profile` (name, class, roots, local, credentials as name and reference), `runtime` (node version, engines rule, ok; sqlite version, ok), `store` (path, state `absent | ok | older | newer | foreign | unreadable | unchecked`, schema, expectedSchema, journalMode, integrity, sizeBytes, lastBackup, profileId), `host` (claudeBin, claudeVersion, admission `verified | admitted (unverified patch) | refused | absent`, refusal rule, restricted, enforcement `enforced | restricted | none`, sandbox `ok | unavailable | not probed`, hookEntry, attended `none | enforced (privileged approvals only)`, configDir), `gsd` (state `ok | incompatible | absent`, version, location, admitted, detail), `graphify`, `adapters` (name, port, adapter), `runs` (read, total, byState, interrupted with resume command), `records` (projectId, repoPath, version, onboardedRevision, gsdVersion, compatibility, reason), `findings` (level, area, message, fix). Appended only when asked: `online`, `repair`, `extensions`.
- **Findings:** the areas are `profile`, `runtime`, `store`, `host`, `gsd`, `records`, `runs`, `online`, `extensions`; the error and warning classification is decision 1 above.
- **S-38:** `start` refuses a project whose active record is incompatible with the installed GSD (`record-incompatible`, exit 3, nothing created); the rule is `recordCompatibility` in `src/app/doctor.ts`. Findings line for `docs/system/findings.md`: the incompatibility is derived and never written, as the plan's flagged assumption says; `docs/operations-and-testing.md` "Version compatibility" also lists a `state.json` contract check and `gsd-file-manifest.json` hashes, which doctor does not do.
- **`--repair`:** deletes `.tmp-*` files directly under `artifacts/<shard>/` last modified an hour or more ago; never opens the store for writing.
- **Findings for `docs/system/findings.md`:** `docs/operations-and-testing.md` shows `integrity_check` and `data root: local APFS, 41 MiB` and `events 0 write failures` lines; the built doctor runs `quick_check`, reports the data root as `local` only (resolveProfile already refuses a non-local root) and has no events line. The shipped doctor has no `tasks=` or `changes=` adapter entries because no such adapters exist yet.
- **Counts for `coverage.md`:** one new command (`doctor`, so COMMANDS is 17), one new port (`Diagnostics`), one new frozen JSON snapshot (`doctor.json`).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: file-read | src/adapters/diagnostics/probes.ts | `--extensions` and the attended-hook check read `settings.json`, `skills/` names and `CLAUDE.md` in the Claude configuration directories (read-only, regular files only, no symbolic link followed, at most 256 KiB, only line numbers of `CLAUDE.md` reported) |
| threat_flag: process-spawn | src/adapters/diagnostics/probes.ts | doctor starts `claude --version`, `claude --help`, `graphify --version`, the sandbox probe and, only under `--online`, `<cli> auth status`, each bounded and with a reduced environment; none starts a model |

T-04-67 (no secret in output: references only, redactor and strip on every line, scan test over text and JSON with every flag), T-04-68 (read-only composition, `--repair` limited to old temp files, row counts and store file digest asserted), T-04-69 (1 s per probe, under 2 s asserted under the network-denied wrapper) and T-04-70 (derived incompatibility refuses start, record row byte-identical) are mitigated and tested. T-04-SC: no package was installed.

## Known Stubs

None.

## Next Phase Readiness

Plan 04-34's live run can use `doctor` to record the host admission label. The full suite is the orchestrator's. Not covered here and left to a live machine: the real `gh auth status` under the stripped environment, and the real `claude --help` flag lists (the fake lists what the test says).

## Self-Check: PASSED

- Created files exist: `src/ports/diagnostics.ts`, `src/adapters/diagnostics/probes.ts`, `src/app/doctor.ts`, `src/cli/doctor-deps.ts`, `src/cli/commands/doctor.ts`, `src/domain/gsd-version.ts`, `test/integration/doctor.test.ts`, `test/integration/doctor-versions.test.ts`, `test/helpers/doctor-fixtures.ts`, `test/fixtures/json-shapes/doctor.json` and the three RED records.
- Commits exist on the branch: `41cfa4e`, `10ddc46`, `c2723cd`, `19c4b2c`, `85e26b5`, `846e963` (six commits since `45de30d`).
- Verification run: `test/integration/doctor.test.ts` 16 of 16, `doctor-versions.test.ts` and `json-shapes.test.ts` (45 of 45 together with doctor), `run-start.test.ts` 45 of 45 with the doctor files; unit suite 2688 of 2688; 247 related integration, fault and containment tests (claude-host, install-host, status-queries, restricted-mode, restricted-onboarding, exit-parity, gsd-adapter, profile-selection, skeleton, cli-terminal-text, killpoints, failclosed) green; `npm run typecheck` and `npm run check:boundaries` clean. The status snapshots `status-active.json` and `status-runs.json` are untouched. The full suite is the orchestrator's.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
