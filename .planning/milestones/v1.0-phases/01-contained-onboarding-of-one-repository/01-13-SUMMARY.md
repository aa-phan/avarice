---
phase: 01-contained-onboarding-of-one-repository
plan: 13
subsystem: sandboxed-executor-and-graph-tool
tags: [sandbox-exec, seatbelt, command-executor, gsd-verbs, graphify, code-graph, containment, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-09 runGsd, gsdPath, GSD_ENV_PASSTHROUGH, staging-only configure/stamp; 01-07 sandbox-exec offline wrapper used in tests; 01-11 invocation scope and env allowlist"
provides:
  - "CommandExecutor port (CommandSpec with argv, cwd, env, timeoutMs, outputLimitBytes, invocationId, writePaths, denyReadPaths; CommandResult with exitCode, signal, status, durationMs, stdout, stderr, truncated)"
  - "SandboxedExecutor (descriptor executor/local-sandbox-exec, offline true, attributes.enforcement from a once-per-process probe): /usr/bin/sandbox-exec -p {profile} argv, detached process group, SIGTERM then SIGKILL 5 s later, 5 MiB per stream with marker, AbortSignal; probe failure returns unavailable and spawns nothing"
  - "buildSeatbeltProfile: realpath of every path, refuses quote, newline, CR, NUL and backslash, deny network and file-write, temp areas, protected cwd, declared write paths, per-path read denial"
  - "runGsd(executor, gsdCoreDir, args, options) with per-verb writePaths ([staging/.planning] for init onboard, config-set, stamp-codebase-map; none for read verbs) and denyRead (data root, ~/.ssh, ~/.aws, ~/.config/gh); GsdOnboardingAdapter(located, { executor, dataRoot, home })"
  - "GraphTool port and GraphifyTool (locate, extractCode, cluster, readGraph, install); env AVARICE_GRAPHIFY_BIN"
  - "AppDeps.executor and AppDeps.graph; adapter_configs rows `executor` and `graph`; DepsOverrides.executor (test entries only)"
affects: [01-14, 01-15, 01-16, 01-18, 01-19]

actuals:
  tokens: 31800
  tasks: 2
  commits: 5
plan_head_before: cf115848fba1fef89698dfc8d042d8b4125fddcb
plan_head_after: 6b18f911a638406b06c57ebf83f92d80fdec262b

tech-stack:
  added: []
  patterns:
    - "Seatbelt rules are last-match-wins: deny all writes, allow temp areas, deny writes below the command's cwd, then re-allow the declared write paths. A staging tree that lives under a temp area is therefore still read-only except for what the caller names"
    - "A command that must not write the staging tree runs with cwd = staging and one writable path outside it (graphify outDir) or inside it (staging .planning for GSD state verbs)"
    - "A process that already runs inside a sandbox (the offline test wrapper) gets a test-only InheritedSandboxExecutor through test-cli.ts, because sandbox-exec cannot nest; production composition never reads that switch"

key-files:
  created:
    - src/ports/command-executor.ts
    - src/ports/graph-tool.ts
    - src/adapters/exec/seatbelt-profile.ts
    - src/adapters/exec/sandboxed-executor.ts
    - src/adapters/graph/graphify.ts
    - test/helpers/sandbox.ts
    - test/helpers/inherited-sandbox-executor.ts
    - test/containment/executor.test.ts
    - test/integration/graphify-tool.test.ts
  modified:
    - src/adapters/gsd/gsd-tools.ts
    - src/adapters/gsd/gsd-onboarding.ts
    - src/app/deps.ts
    - src/cli/composition.ts
    - test/helpers/offline.ts
    - test/helpers/test-cli.ts
    - test/integration/gsd-adapter.test.ts
    - test/integration/gsd-configure.test.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "The profile protects the command's cwd after the temp-area allowance and re-allows the declared write paths, so a tree under /private/var/folders or /private/tmp (every test staging tree) is not writable by accident; real staging lives in the work root, outside both"
  - "No sandbox means no run: SandboxedExecutor returns unavailable when the probe of /usr/bin/sandbox-exec fails, and a sandbox-exec exit 65/71 with a `sandbox-exec:` stderr line is also unavailable, not a failed command"
  - "The executor probes lazily (first descriptor read or run), so read-only commands such as status never pay for it and never record the executor"
  - "graphify runs with cwd = staging and writes only outDir; outDir inside the staging tree (or the reverse) is refused before anything runs, so the staging tree gains no graphify-out/"
  - "install refuses a .planning or .planning/graphs that is a symlink or resolves outside staging, removes an existing target and copies with COPYFILE_EXCL, so a repository-committed symlink cannot redirect the write"
  - "locate() of GSD (locate.ts, runtime-identity at composition) stays a direct spawn: it runs against the gsd-core directory, not staging, and needs no writes"

patterns-established:
  - "Adding an AVARICE-side subprocess: build a CommandSpec, name writePaths and denyReadPaths, run through deps.executor; never execFile/spawn directly against staging"

requirements-completed: []

coverage:
  - id: D1
    description: "sed -i, python3 open().write, node -e fs.writeFileSync, a repository script and a write through a symlink out of the writable path each leave every staging file byte-identical; .planning/ok.txt is writable"
    requirement: ONB-3
    verification:
      - kind: unit
        ref: "test/containment/executor.test.ts#SandboxedExecutor (sed -i; python3 open().write; node -e fs.writeFileSync; a repository script; a write through a symlink; lets the command write the declared path)"
        status: pass
    human_judgment: false
  - id: D2
    description: "curl cannot reach a local server (network denied); a denyRead directory cannot be read; the command sees only the environment it was given"
    requirement: CON-2
    verification:
      - kind: unit
        ref: "test/containment/executor.test.ts#curl cannot reach the network; #a read of a denyRead directory fails; #gives the command only the environment it was given"
        status: pass
    human_judgment: false
  - id: D3
    description: "A command over its timeout ends timed_out and its process group is gone; an aborted command ends cancelled; output over the limit is cut with a marker"
    requirement: CON-5
    verification:
      - kind: unit
        ref: "test/containment/executor.test.ts#a command over its timeout ends timed_out and its process group is gone; #an aborted command ends cancelled; #cuts a stream at the output limit"
        status: pass
    human_judgment: false
  - id: D4
    description: "With the probe replaced by /usr/bin/false, run returns unavailable and nothing is spawned; a GSD verb is then not run at all (logging shim never called, no config.json)"
    requirement: ONB-4
    verification:
      - kind: unit
        ref: "test/containment/executor.test.ts#without a working sandbox (returns unavailable and spawns nothing; a GSD verb is not run unsandboxed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GSD config-set through the executor succeeds in staging and writes only .planning; the spec carries writePaths [staging/.planning], cwd staging and denyRead of the data root and credential stores; a read verb has no writable path"
    requirement: ONB-3
    verification:
      - kind: integration
        ref: "test/containment/executor.test.ts#GSD verbs through the executor; test/integration/gsd-configure.test.ts (all 11 against the real GSD through the sandbox)"
        status: pass
    human_judgment: false
  - id: D6
    description: "GraphifyTool.extractCode runs `extract {staging} --code-only --out {outDir} --max-workers 1` with only outDir writable (300 s budget); graph.json built_at_commit equals the staging HEAD, no document nodes, and the staging tree (digest, HEAD, status) is unchanged with no graphify-out/"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/graphify-tool.test.ts#extracts a code-only graph into outDir at the staging HEAD and adds nothing to the staging tree"
        status: pass
    human_judgment: false
  - id: D7
    description: "cluster runs `cluster-only {outDir} --no-label --no-viz`, writes GRAPH_REPORT.md, keeps built_at_commit; install puts graph.json, code-graph.json and GRAPH_REPORT.md in .planning/graphs and nothing else, and refuses a symlinked target"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/graphify-tool.test.ts#clusters the extraction; #install copies graph.json twice...; #install refuses a .planning/graphs that is a symlink"
        status: pass
    human_judgment: false
  - id: D8
    description: "A missing graphify (AVARICE_GRAPHIFY_BIN=/nonexistent or not on PATH) is reported by locate() as unavailable with cause graphify-missing; graphify.ts uses code-only and max-workers and never `update` or merge-graphs"
    requirement: ONB-4
    verification:
      - kind: integration
        ref: "test/integration/graphify-tool.test.ts#reports a missing binary as unavailable with reason graphify-missing; #declares the code-graph commands and never graphify update or merge-graphs"
        status: pass
    human_judgment: false
  - id: D9
    description: "The whole offline suite still runs the CLI with the network denied (NFR-2) now that AVARICE's own GSD calls go through the executor"
    requirement: NFR-2
    verification:
      - kind: integration
        ref: "test/integration/offline.test.ts (8 tests, with the inherited-sandbox executor for the nested wrapper); npm test 678 of 678"
        status: pass
    human_judgment: false

duration: 25 min
completed: 2026-11-02
---

# Phase 01 Plan 13: Sandboxed Executor, GSD Verbs Through It, and the Graph Tool Summary

**AVARICE's own subprocesses against staging now run under `sandbox-exec` (network denied, writes only where the caller names, no run when the sandbox is unavailable), every GSD verb goes through that executor, and a graphify adapter builds a code-only graph into a directory outside the staging tree.**

## Performance

- **Duration:** about 25 min (started about 2026-11-02T23:28Z, finished 2026-11-02T23:53Z)
- **Tasks:** 2 of 2, both TDD (RED then GREEN; no REFACTOR commit needed)
- **Files:** 9 created and 9 modified under src and test, plus 2 RED evidence records

## Accomplishments

- Executor (T-01-36): hostile commands (sed -i, python3, node -e, a repository script, a write through a symlink pointing at `src/`) all fail and leave a scratch staging tree byte-identical; `.planning/ok.txt` is writable; curl to a local server never reaches it; a read of a denyRead fixture fails; a timed-out command ends `timed_out` with its process group gone.
- No sandbox, no run: with the launcher replaced by `/usr/bin/false`, `run` returns `unavailable`, nothing is spawned, and a GSD `config-set` leaves no `config.json` and never starts gsd-tools.
- GSD (T-01-19/T-01-36): `runGsd` takes the executor. `init onboard`, `config-set` and `stamp-codebase-map` may write staging `.planning`, nothing else; read verbs write nothing. The real GSD 1.17 verbs, including the full onboarding flow, still pass through the sandbox (gsd-configure 11 of 11, gsd-adapter all green).
- Graph (T-01-37): `GraphifyTool` locates graphify from `AVARICE_GRAPHIFY_BIN` or PATH (`graphify-missing` otherwise), extracts code only with one worker, clusters without labels or viz, and installs exactly three files. With the real graphify 0.9.53 on a scratch repository, `built_at_commit` equals the staging HEAD, no document nodes appear, and the staging digest, HEAD and status are unchanged.
- Composition: one `SandboxedExecutor` and one `GraphifyTool` in `AppDeps`; `adapter_configs` rows `executor` and `graph`.

## Task Commits

1. **Task 1** (TDD): RED `d53ae12` test(01-13) (21 tests, 0 pass, 21 fail; `RED_EVIDENCE_OK`, record `01-13-red-evidence-task1.json`); GREEN `f828062` feat(01-13) (21 of 21; full suite 666 of 666)
2. **Task 2** (TDD): RED `1d6e9b5` test(01-13) (11 tests, 0 pass, 11 fail; `RED_EVIDENCE_OK`, record `01-13-red-evidence-task2.json`); GREEN `aa86b3a` feat(01-13) (12 of 12 with the added composition test; full suite 677 of 678, see below)
3. **Follow-up** `6b18f91` test(01-13): the timeout test's 500 ms limit could fire before the sandboxed shell printed its pid under a full parallel run (one failure seen once in the run that preceded the commit of `aa86b3a`; three further full runs and six isolated runs passed with the old value); the limit is now 2500 ms and the suite is 678 of 678.

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN in order for both tasks; no REFACTOR. RED used stubs (profile builder returning an empty profile, an executor returning `unavailable`, a graph tool returning `unavailable` for every method), so each failure is an assertion on planned behaviour. Task 2 RED: three of the eleven failures cascade from the extract test (the cluster test reads a `graph.json` that was never written, ENOENT); the target test failed on `assert.ok(built.ok)`. Two Task 2 tests (symlinked install target, unavailable sandbox) were green on arrival against the stub and were tightened before the RED commit to assert `invalid` and a sandbox cause.

Mutation checks, each restored from a saved copy: `(deny network*)` -> `(allow network*)` gave 2 failures; protected-cwd rule removed gave 5; sandbox probe check removed gave 2; read denial removed gave 2; `--code-only` removed gave 3; `staging` added to the extract write paths gave 1; outDir-inside-staging check removed gave 1. Removing the symlink check in `install` alone gave 0, because the later realpath containment check still refuses the write (two layers, either suffices).

## Decisions Made

See `key-decisions`. For later plans:

- **01-14 (index stage):** call `deps.graph.extractCode(staging, outDir)` with an `outDir` under the work root or a temp directory (never under staging), then `cluster(outDir)`, then `install(staging, { graph, report })`; read the full commit with `readGraph(file).value.builtAtCommit`. `locate()` caches its result per tool instance and returns the version for the record. `gsd_run graphify build snapshot` is a GSD verb that writes `.planning/graphs/`: run it through `runGsd` with the default `[staging/.planning]` write path (add it to the adapter first).
- **01-15 (host):** the executor is for AVARICE's own commands; the host keeps its own sandbox. `GSD_ENV_PASSTHROUGH` and `gsdPath` are unchanged.
- **Any new AVARICE-side command:** go through `deps.executor`; `sandbox-exec` cannot nest, so a test that wraps the CLI in `sandbox-exec` must use the `AVARICE_TEST_OUTER_SANDBOX` switch of `test/helpers/test-cli.ts` (already set by `runOffline`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `sandbox-exec` cannot nest, so the offline suite (NFR-2) failed once the executor existed**
- **Found during:** Task 1 (full run: 4 offline tests failed)
- **Issue:** `test/integration/offline.test.ts` runs the whole CLI under `sandbox-exec (deny network*)`; inside it the executor's probe fails (`sandbox_apply: Operation not permitted`), so every GSD verb returned `unavailable` and onboarding could not run.
- **Fix:** `DepsOverrides.executor` (test entries only) plus `test/helpers/inherited-sandbox-executor.ts`, which runs commands directly and relies on the outer wrapper; `test-cli.ts` uses it only when `AVARICE_TEST_OUTER_SANDBOX=1` (set by `runOffline`). `bin/avarice.ts` never imports either, so production always runs `SandboxedExecutor`. The offline tests still prove the process tree has no network; they do not prove the executor's own confinement (executor.test.ts does).
- **Files modified:** src/cli/composition.ts, test/helpers/{inherited-sandbox-executor,test-cli,offline}.ts
- **Committed in:** f828062

**2. [Rule 3 - Blocking] The footprint scan banned `detached: true` everywhere in src**
- **Found during:** Task 1 (test/unit/footprint.test.ts failed)
- **Issue:** the executor needs `detached: true` to give the command its own process group so a timeout can kill all of it (the contract: process group killed).
- **Fix:** the scan exempts `src/adapters/exec/sandboxed-executor.ts` only, and asserts that file kills the group (`process.kill(-pid, signal)`, `killGroup(child.pid, 'SIGKILL')` when the command ends) and never calls `.unref()`. The existing "no command leaves a process running" test still passes.
- **Files modified:** test/unit/footprint.test.ts
- **Committed in:** f828062

**3. [Rule 3 - Blocking] Existing tests and the adapter constructor used the old `runGsd` / `GsdOnboardingAdapter` signatures**
- `gsd-adapter.test.ts` and `gsd-configure.test.ts` (the latter is in the plan's verify command) now pass a `SandboxedExecutor`; `GsdOnboardingAdapter` takes `{ executor, dataRoot, home }`. Neither file was in the plan's `files_modified`.
- **Committed in:** f828062

**4. [Rule 1 - Bug in my own test] Timeout test flaky under load, and the graphify recorder counted `--version`**
- The timeout test limit went from 500 to 2500 ms (6b18f91). In the graphify test the recording executor skips the `--version` call that `locate()` makes, so the tests count the extract and cluster commands only (fixed before the Task 2 GREEN commit).

**5. Smaller departures**
- `buildSeatbeltProfile` returns `Result<string>` (a bad path is an `invalid` result, not a throw) and takes an optional `protectedPaths`; the plan's signature had `writePaths` and `denyReadPaths` only. It also refuses backslash and NUL besides double quote and newline.
- `locate()` reports a missing graphify as `{ kind: 'unavailable', cause: 'graphify-missing: ...' }` (the port error type has `cause`, not `reason`).
- `GraphTool.install` returns the three installed paths; `cluster` and `extractCode` return a `GraphBuild` with `graphFile` and `reportFile`.
- The graph descriptor carries only the resolved binary path (nothing is executed at composition); the graphify version is read by `locate()`.
- The `graph` composition test was added to graphify-tool.test.ts (executor and graph rows in `adapter_configs`).

---

**Total deviations:** 4 auto-fixed (3 Rule 3, 1 Rule 1) plus the smaller departures. **Impact:** all in service of keeping the existing offline, footprint and GSD suites meaningful once commands run in the sandbox; no scope creep.

## Issues Encountered

- BSD `sed -i` needs an explicit empty suffix; a one-line edit and a later in-place edit were redone with Python.
- A `&&` chain after `npm test | grep` let a commit through while one test had failed once (the timeout test above). Caught from the output immediately and fixed in a follow-up commit; no later commit relied on it.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None new. T-01-36 mitigated (profile with writes limited to declared paths and network denied; unavailable sandbox means no run; executor containment suite). T-01-37 mitigated (extract `--out` outside staging, install copies only three files and refuses symlinked targets, staging digest, HEAD and status asserted unchanged after extract). T-01-SC: no installs; graphify is only located and run.

Limits: the profile allows writes to `/private/var/folders` and `/private/tmp` (tools need temp files), so a command can write other processes' temp files there; the staging tree is protected even when it lives there. Reads are denied only for the data root and three credential directories, not the whole home. `sandbox-exec` is deprecated by Apple and stays behind the port. The user's real graphify install and a scratch repository were the only inputs; no real model or repository was touched.

## User Setup Required

None - no external service configuration required. `AVARICE_GRAPHIFY_BIN` is optional (PATH is searched when absent).

## Next Phase Readiness

- `npm test` (678), `npx tsc -p .` and `node scripts/check-boundaries.ts` (39 files) are green.
- 01-14 can build the code-graph step on `deps.graph` and `deps.executor`; 01-18 adds knowledge-pass methods to `GraphTool`.

## Self-Check: PASSED

- Created files present: src/ports/{command-executor,graph-tool}.ts, src/adapters/exec/{seatbelt-profile,sandboxed-executor}.ts, src/adapters/graph/graphify.ts, test/helpers/{sandbox,inherited-sandbox-executor}.ts, test/containment/executor.test.ts, test/integration/graphify-tool.test.ts.
- Commits d53ae12, f828062, 1d6e9b5, aa86b3a, 6b18f91 are ancestors of HEAD; `git rev-list --count cf11584..HEAD` = 5.
- Acceptance criteria re-run: executor.test.ts 21 tests (needs at least 9) and gsd-configure 11, all pass; `grep -c "deny network" src/adapters/exec/seatbelt-profile.ts` = 2; `grep -c executor src/adapters/gsd/gsd-tools.ts` = 4; graphify-tool.test.ts 12 pass (needs at least 4); `grep -c code-only` = 3, `grep -c max-workers` = 3, `grep -cE "'update'|merge-graphs"` = 0 in graphify.ts.
- Plan verification re-run: the three named test files green (44 tests); boundaries ok; `tsc -p .` exit 0; `npm test` 678 of 678.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
