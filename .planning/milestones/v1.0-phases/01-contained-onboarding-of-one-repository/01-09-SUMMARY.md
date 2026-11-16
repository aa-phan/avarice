---
phase: 01-contained-onboarding-of-one-repository
plan: 09
subsystem: gsd-adapter
tags: [gsd, discovery, incompatible, configure, stamp, mapping-mode, staging, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-05 stage loop, configure-gsd checkpoint seam, fake host; 01-08 clone staging, safe git, preflight existingState"
provides:
  - "GsdOnboarding port (inspect, probeState, configure, stamp, checkDrift, initPlanning -> unsupported) and GSD_ADMITTED_PACKAGE / GSD_ADMITTED_RANGE"
  - "locateGsdCore: GSD_HOME, $CLAUDE_CONFIG_DIR/gsd-core, $HOME/.claude/gsd-core; admitted only as @opengsd/gsd-core 1.17.x; first candidate holding bin/gsd-tools.cjs is the one judged"
  - "runGsd (execFile, safe-git env plus HOME/LANG/TMPDIR/USER/LOGNAME/CLAUDE_CONFIG_DIR, PATH led by gsd-core/bin, @file: dereference, exit 69 -> unavailable, 15 s timeout); exported GSD_ENV_PASSTHROUGH and gsdPath for the host plan 01-11/01-15"
  - "GsdOnboardingAdapter 1.17 and adapter_configs row `gsd`; AppDeps.gsd and AppDeps.gsdProblem"
  - "Contract stage commits discovered -> incompatible (event data found/admitted) before any staging or invocation; records step gsd:inspect {version, packageName, gsdCoreDir, agentsDir, capabilities[]}"
  - "configure-gsd checkpoint: steps gsd:probe, mapping:plan, gsd:configure; all by AVARICE, cwd = staging, before the host"
  - "chooseMappingMode decision table; effective mode (mapping:plan) drives map, validate, resume and the record"
  - "Fast map stamped by AVARICE (stamp-codebase-map --files, step gsd:stamp), also on resume reconciliation; avarice onboard --mode full|fast"
  - "Project record gsd.version read from gsd:inspect (no longer 'unknown')"
affects: [01-10, 01-11, 01-12, 01-14, 01-15, 01-19]

actuals:
  tokens: 24000
  tasks: 2
  commits: 4
plan_head_before: b1b9ab8530d63745b12a5d4e7340086f77ef2d28
plan_head_after: e43b63d3021c99a8d1cc123e605321e60a27fd6d

tech-stack:
  added: []
  patterns:
    - "A GSD verb that can write is run by AVARICE with cwd = staging, awaited, one at a time, before the host; a logging gsd-core shim (test/helpers/fake-gsd-core.ts writeLoggingGsdCore) proves cwd and order against the real verbs"
    - "The mapping:plan step, not the contract, is the mapping mode in force after the probe (effectiveMappingMode); the contract keeps the user's request"
    - "A stamp that fails is recorded as step gsd:stamp failed and not raised; validation judges the unstamped files and owns retry/block"

key-files:
  created:
    - src/ports/gsd-onboarding.ts
    - src/adapters/gsd/locate.ts
    - src/adapters/gsd/gsd-tools.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - test/helpers/fake-gsd-core.ts
    - test/unit/mapping.test.ts
    - test/integration/gsd-adapter.test.ts
    - test/integration/gsd-configure.test.ts
  modified:
    - src/app/deps.ts
    - src/cli/composition.ts
    - src/cli/commands/onboard.ts
    - src/app/resume.ts
    - src/app/stages/contract.ts
    - src/app/stages/workspace.ts
    - src/app/stages/map.ts
    - src/app/stages/shared.ts
    - src/app/stages/validate.ts
    - src/app/stages/activate.ts
    - src/domain/mapping.ts
    - src/domain/project-record.ts
    - test/helpers/fake-agent-host.ts
    - test/integration/skeleton.test.ts
    - test/integration/preflight.test.ts

key-decisions:
  - "An explicit GSD_HOME (or the first candidate with bin/gsd-tools.cjs) is judged alone: a 1.18 there gives `unsupported`/incompatible and is never replaced by the 1.17 under $HOME"
  - "Read-only commands (status) do not locate GSD; every other command locates it at composition (about 100 ms) and records adapter_configs `gsd` with a descriptor whose attributes carry version, package and directory, so a different GSD changes the digest"
  - "Non-brownfield (GSD is_brownfield false: no code files and no package file) maps nothing: mode skip, completeness none, no invocation; validation, resume and the record use the mapping:plan mode so a skipped onboarding can activate"
  - "An existing map of any classification still gives mode full (or the requested fast); the contract's existing-map answer is appended to the prompt only when the probe or preflight shows a map in staging"
  - "A path-scoped request blocks with reason scope_unavailable (reduced mode fast named in the event); adoption is unsupported (reduced mode full); the CLI accepts only --mode full|fast"
  - "GSD probe/configure/stamp errors are returned (run fails, onboarding stays resumable), except a failed fast-map stamp, which is recorded and left to validation"

patterns-established:
  - "Adding a GSD verb: a port method, an adapter method that builds argv (validated names, no flags from callers), always run through runGsd with cwd = staging"

requirements-completed: [ONB-2, ONB-5, ONB-7, ONB-12]

coverage:
  - id: D1
    description: "gsd-core is located by probing GSD_HOME, $CLAUDE_CONFIG_DIR/gsd-core, $HOME/.claude/gsd-core in that order, accepted only as @opengsd/gsd-core 1.17.x; no Claude config path is hard-coded"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/gsd-adapter.test.ts#locateGsdCore (falls through to $HOME/.claude/gsd-core; probe order; unsupported for 1.18.0; identity rejected; not_found; no hard-coded directory)"
        status: pass
    human_judgment: false
  - id: D2
    description: "With GSD_HOME at a generated 1.18.0 gsd-core, onboarding ends incompatible, exit 3, no staging workspace, no onboarding_steps rows, no host invocation; the event names found version and admitted range (S-36)"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/gsd-adapter.test.ts#ends incompatible with a gsd-core that reports 1.18.0"
        status: pass
    human_judgment: false
  - id: D3
    description: "adapter_configs row `gsd` (port gsd-onboarding, descriptor 1.17) and step gsd:inspect with the snapshot shape 01-10 reads; record gsd.version equals the installed version"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/gsd-adapter.test.ts#records the located gsd-core in adapter_configs and the snapshot as step gsd:inspect; #inspect reports the identity"
        status: pass
    human_judgment: false
  - id: D4
    description: "AVARICE runs init onboard and four config-set calls in staging (commit_docs false, text_mode true, intel true, graphify true) before the host; query commit in staging reports skipped_commit_docs_false and makes no commit"
    requirement: ONB-5
    verification:
      - kind: integration
        ref: "test/integration/gsd-configure.test.ts#turns commit_docs off ...; #runs every GSD verb that writes with cwd = staging, in order, before the host is invoked"
        status: pass
    human_judgment: false
  - id: D5
    description: "The user's checkout, including a committed .planning/config.json, is byte-identical after onboarding; a checkout with no .planning gains none; the staged config keeps the repository's own keys"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/gsd-configure.test.ts#leaves the user checkout byte-identical, including a committed .planning/config.json; #creates no .planning directory"
        status: pass
    human_judgment: false
  - id: D6
    description: "A fast map is stamped by AVARICE with stamp-codebase-map --files for exactly the four fast-map files (cwd staging), each last_mapped_commit equals the staging HEAD, the record says mode fast, completeness partial; a full map is mode full, complete, with no AVARICE stamp"
    requirement: ONB-7
    verification:
      - kind: integration
        ref: "test/integration/gsd-configure.test.ts#stamps a fast map itself ...; #records a full map as mode full; #passes --mode fast through"
        status: pass
    human_judgment: false
  - id: D7
    description: "chooseMappingMode: not brownfield -> skip (none); fast -> fast; default -> full; paths -> unsupported reduced fast; any existing-map classification -> full; adopt unsupported; unknown name invalid. Non-brownfield onboarding invokes no host and activates with mode skip, completeness none"
    requirement: ONB-7
    verification:
      - kind: unit
        ref: "test/unit/mapping.test.ts#chooseMappingMode"
        status: pass
      - kind: integration
        ref: "test/integration/gsd-configure.test.ts#skips mapping for a repository that is not brownfield; #regenerates an existing committed map in staging"
        status: pass
    human_judgment: false
  - id: D8
    description: "AVARICE never edits .planning/codebase/*.md: map.ts has no write call (grep -cE 'writeFile|appendFile' = 0); the only staging .planning writes it causes are GSD verbs"
    requirement: ONB-2
    verification:
      - kind: other
        ref: "grep -cE \"writeFile|appendFile\" src/app/stages/map.ts returns 0; logging-shim test lists the verbs run"
        status: pass
    human_judgment: false

duration: 91min wall clock (about 40 min of work; the run was interrupted by an API rate limit)
completed: 2026-11-02
---

# Phase 01 Plan 09: GSD 1.17.x Behind the GsdOnboarding Port Summary

**AVARICE finds @opengsd/gsd-core 1.17.x wherever the config dir points (GSD_HOME, then CLAUDE_CONFIG_DIR, then HOME), stops `incompatible` before staging for any other version, probes and configures GSD in staging itself before the host runs (commits provably off), stamps fast maps itself, and records the mapping mode, skipping non-brownfield repositories.**

## Performance

- **Started:** 2026-11-02T20:36:24Z; **Completed:** 2026-11-02T22:08Z (wall clock 91 min including a rate-limit pause)
- **Tasks:** 2 of 2, both TDD (RED, GREEN each; no REFACTOR commit needed)
- **Files:** 8 created, 15 modified (23 changed under src and test, plus 2 RED evidence records)

## Accomplishments

- Discovery and identity (T-01-18): the first candidate holding `bin/gsd-tools.cjs` is judged by `runtime-identity --raw`; a 1.18.0 or another package name is `unsupported` (reduced mode and found version in the error), absence is `not_found`. The contract stage turns both into `discovered -> incompatible`, with a note and event data, before a contract, worktree or invocation exists.
- `runGsd` rebuilds the child environment (safe-git variables, USER/LOGNAME added per S0-C, PATH led by `gsd-core/bin`), dereferences `@file:` spills, maps exit 69 to `unavailable` and a hang to `timeout`.
- Staging-only GSD (T-01-19): at `configure-gsd` the workspace stage runs `init onboard --raw`, decides the mode, then four sequential `config-set` calls, all cwd = staging, all before `host.invoke`. A logging gsd-core shim that delegates to the real verbs proves cwd, order and that nothing ran in the user's checkout; a committed `.planning/config.json` stays byte-identical.
- ONB-7: fast maps are stamped by AVARICE (`stamp-codebase-map --files STACK.md,INTEGRATIONS.md,ARCHITECTURE.md,STRUCTURE.md`), including when a killed fast invocation is reconciled on resume; `mapping:plan` is the mode of record, so validation, resume and the project record agree with what was actually mapped.
- The project record now carries the real GSD version.

## Task Commits

1. **Task 1** (TDD): RED `5ac0497` test(01-09) (11 tests, 1 pass, 10 fail; `RED_EVIDENCE_OK`, record `01-09-red-evidence-task1.json`); GREEN `00197b3` feat(01-09) (11 of 11; full suite 363 after two skeleton assertions were narrowed)
2. **Task 2** (TDD): RED `8df6a21` test(01-09) (18 tests, 2 pass, 16 fail; `RED_EVIDENCE_OK`, record `01-09-red-evidence-task2.json`); GREEN `e43b63d` feat(01-09) (18 of 18; full suite 381 of 381)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN in order for both tasks; no REFACTOR. RED used stubs (locate, runGsd, adapter, `chooseMappingMode`) so each failure is an assertion on planned behaviour (one ENOENT reading the not-yet-configured staging config.json, which is the same planned output). Task 1 RED: the source scan for a hard-coded config dir passed on arrival (holds for the stubs; kept as a guard). Task 2 RED: two tests were green on arrival (full-map prompt and mode record, which existing behaviour already satisfied; no `.planning` created in a checkout with none).

Mutation checks, each restored from a saved copy: version check removed -> the 1.18.0 test fails; identity check removed -> the foreign-package test fails; incompatible stop removed -> the S-36 test fails; fast stamp disabled -> 2 failures; `commit_docs` set true -> 4 failures; non-brownfield skip removed -> 2 failures; mode read from the contract instead of the plan -> the skip test fails.

## Decisions Made

See `key-decisions`. For later plans:

- **01-10:** `gsd:inspect` shape is `{ version, packageName, gsdCoreDir, agentsDir, capabilities: string[] }`; `buildProjectRecord` takes optional `gsdVersion` and `activate.ts` already supplies it. Use `effectiveMappingMode` (shared.ts) and `readMapDocuments(staging, path, mode)`, not the contract mode.
- **01-11/01-15:** reuse `gsdPath(gsdCoreDir)` and `GSD_ENV_PASSTHROUGH` (HOME, LANG, TMPDIR, USER, LOGNAME, CLAUDE_CONFIG_DIR) for the host environment; `deps.gsd.inspect().value.gsdCoreDir` is where `gsd_run` lives.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Mapping mode had to flow beyond the files the plan lists**
- **Found during:** Task 2
- **Issue:** `skip` (non-brownfield) and `fast` are decided after the contract is stored; validation, resume reconciliation and the record builder all read the contract's mode (`full`), so a skipped onboarding could never validate and a fast one would demand seven files.
- **Fix:** `mapping:plan` step is the mode in force (`loadMappingPlan`, `effectiveMappingMode` in shared.ts); `validate.ts`, `activate.ts`, `resume.ts` use it; `readMapDocuments` takes a mode. `resume.ts` also stamps a reconciled fast map.
- **Files modified:** src/app/stages/{shared,validate,activate}.ts, src/app/resume.ts
- **Committed in:** e43b63d

**2. [Rule 3 - Blocking] Existing tests assumed things this plan changes**
- `skeleton.test.ts` listed all `onboarding_steps` rows as "invocation steps"; new `gsd:*` steps made two assertions fail. They now filter `launch:%` (00197b3).
- `preflight.test.ts` "mid-flight" used a README-only repository and a mid-invocation kill; such a repository is now skipped (no invocation), so it uses a repository with a package file (e43b63d).

**3. [Rule 2 - Missing critical] GSD version into the project record**
- Requested by the plan 01-05 hand-off (`gsd.version` was `'unknown'`): `ProjectRecordInput.gsdVersion` and `activate.ts` read it from `gsd:inspect` (00197b3, tested).

**4. Smaller departures**
- `GsdOnboarding.stamp` returns `GsdStampResult` (GSD's JSON) rather than `void`, per the plan text "store step gsd:stamp with GSD's JSON"; `probeState` etc. are async while `inspect` is sync, as the plan states.
- `FakeHostOptions.stamp` widened to `string | false`; `test/helpers/fake-gsd-core.ts` added (generated fake and logging shim, no committed fixture).
- I ran `gsd-tools init onboard --cwd /Users/aphan/avarice` once while exploring output keys; it is read-only for a repository that already has `.planning/` and `git status` showed no change.

---

**Total deviations:** 3 auto-fixed (2 Rule 3, 1 Rule 2) plus the smaller departures. **Impact:** the mode-in-force change is the substantive one and is covered by the skip, fast and resume paths; no scope creep beyond keeping the pipeline coherent.

## Issues Encountered

- `zsh` does not word-split unquoted variables, so an early probe loop of `config-set $kv` failed with a usage error; later probes used separate commands.
- TypeScript parameter properties are refused by Node's strip-only mode (`constructor(readonly x)`); the adapter assigns fields explicitly.
- The API rate limit interrupted the run between Task 2's GREEN edits and its commit; the work was resumed from the uncommitted diff, re-verified (381 of 381) and committed.

## Authentication Gates

None.

## Known Stubs

None. `initPlanning` returns `unsupported` by design (Phase 4); `checkDrift` is implemented and manually probed against the real verb, but no test exercises it and nothing calls it until the Phase 4 refresh.

## Threat Flags

None new. T-01-18 mitigated (identity, version, descriptor digest in adapter_configs); T-01-19 mitigated (cwd = staging proven by the logging shim, checkout config.json byte-compared); T-01-20 mitigated (safe-git env on every gsd-tools call; sandboxing is 01-13). T-01-SC: no installs.

Limits: a verb that fails (timeout, exit 69) fails the run and leaves the onboarding resumable rather than blocking it; the real Claude Code host has not mapped on a clone yet (01-15, 01-19); GSD's `stamp-codebase-map` only stamps files that exist, and a mapper that left some out is caught by validation, not by the stamp.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `npm test` (381), `npx tsc -p .` and `node scripts/check-boundaries.ts` (30 files) are green.
- 01-10 can replace validation and the record builder knowing `gsd:inspect`, `mapping:plan` and `effectiveMappingMode`; 01-11 builds the host settings from `describe()` and the GSD env helpers; 01-14 extends `index-stage.ts`.
- All checks ran against temp roots and scratch repositories; the user's profile locations and real repositories were not touched; the installed GSD was only read and executed.

## Self-Check: PASSED

- Created files present: src/ports/gsd-onboarding.ts, src/adapters/gsd/{locate,gsd-tools,gsd-onboarding}.ts, test/helpers/fake-gsd-core.ts, test/unit/mapping.test.ts, test/integration/{gsd-adapter,gsd-configure}.test.ts.
- Commits 5ac0497, 00197b3, 8df6a21, e43b63d are ancestors of HEAD; `git rev-list --count b1b9ab8..HEAD` = 4.
- Acceptance criteria re-run: gsd-adapter.test.ts 11 pass (needs at least 5); `grep -c "@opengsd/gsd-core" src/adapters/gsd/locate.ts` = 1; `grep -rn "\.claude-edu" src | wc -l` = 0; skeleton.test.ts 12 pass; `grep -c skipped_commit_docs_false` test = 1; `grep -c stamp-codebase-map src/adapters/gsd/gsd-onboarding.ts` = 2; `grep -cE "writeFile|appendFile" src/app/stages/map.ts` = 0.
- Plan verification re-run: the four named test files green; boundaries ok; `tsc -p .` exit 0; `npm test` 381 of 381.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
