---
phase: 01-contained-onboarding-of-one-repository
plan: 15
subsystem: containment
tags: [claude-code, host-adapter, stream-json, outcome-classification, process-group, fail-closed, hook-self-test, orphan-reaping, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-08 clone staging (describe, head, read); 01-11 settings renderer, env allowlist, launch args and preflight, agents.json and plugin directory builders, InvocationScope; 01-12 the PreToolUse hook entry, hook-policy writer, budgets and reserveInvocation; 01-13 CommandExecutor (every AVARICE-side subprocess against staging goes through it); 01-14 index stage"
provides:
  - "src/domain/outcome.ts: classifyOutcome, OutcomeFacts (pure; kind from result fields, exit, HEAD and hook events, never model text)"
  - "src/adapters/host-claude/stream-json.ts: StreamJsonParser (incremental) and parseStreamJson"
  - "src/adapters/host-claude/claude-host.ts: ClaudeHostAdapter (invoke, reap, lazy `enforced` descriptor)"
  - "src/adapters/host-claude/invocation-files.ts: writeInvocationFiles (host-settings.json, hook-policy.json, agents.json, plugin/, mcp.json; 0600 files, 0700 directories)"
  - "src/adapters/host-claude/launch-preflight.ts: hookSelfTest, checkHostReady, and checkLaunchReady's policyFile self-test step"
  - "src/adapters/gsd/preamble.ts: fingerprintGsdPreamble (sha256 and byte length of GSD's own shim preamble line)"
  - "src/app/invocation.ts: prepareInvocation, completeInvocation (shared by map, intel and knowledge)"
  - "Port additions: InvocationRequest.scope, .extensions, .agentName, .expectedFiles, .sessionId; InvocationOutcome.details; AgentHost.reap; Ledger.countHookDenials; AppDeps.home"
  - "Composition: ClaudeHostAdapter by default when admitted (AVARICE_CLAUDE_BIN or PATH, AVARICE_HOOK_ENTRY or this checkout, {CLAUDE_CONFIG_DIR or ~/.claude}/skills); UnavailableAgentHost(reason) otherwise"
  - "Events invocation.finished, invocation.reaped, containment.finding (check staging-head-moved); artifact kind transcript; step launch:{purpose} with invocation and session IDs"
  - "test/helpers/fake-claude.ts and test/fixtures/claude-fake/claude-replay.mjs (fake claude binary), test/fixtures/stream-json.ts (success, apiError, maxBudget, hookBlock)"
affects: [01-16, 01-17, 01-18, 01-19, 01-20]

actuals:
  tokens: 33300
  tasks: 2
  commits: 4
plan_head_before: 42734a56a116f3230545774ec6c8ecaa3a0322f5
plan_head_after: 84a1378a3f58013781d9699ca72de651238d9b8a

tech-stack:
  added: []
  patterns:
    - "The host adapter never trusts its own earlier work: the launch inputs are written, then judged (settings keys, hook, hook self-test, sandbox, host version, argv) immediately before spawn, so a file removed or edited between write and launch still blocks"
    - "The caller picks the session ID and records it in the `launch:{purpose}` step before the host starts; a resume finds a surviving process by that ID, not by a PID that died with the supervisor"
    - "The wall clock is AVARICE's own timer (S0-F): SIGTERM to the process group, SIGKILL after the grace, and one more group SIGKILL when the host process exits, so nothing a background subagent left behind survives"
    - "Test entry points cannot launch a real claude: runCli defaults AVARICE_CLAUDE_BIN to a missing binary"

key-files:
  created:
    - src/domain/outcome.ts (stub in RED, real in GREEN)
    - src/adapters/host-claude/stream-json.ts
    - src/adapters/host-claude/claude-host.ts
    - src/adapters/host-claude/invocation-files.ts
    - src/adapters/gsd/preamble.ts
    - src/app/invocation.ts
    - test/fixtures/stream-json.ts
    - test/fixtures/claude-fake/claude-replay.mjs
    - test/helpers/fake-claude.ts
    - test/unit/outcome.test.ts
    - test/unit/stream-json.test.ts
    - test/integration/claude-host.test.ts
    - .planning/phases/01-contained-onboarding-of-one-repository/01-15-red-evidence-task1.json
    - .planning/phases/01-contained-onboarding-of-one-repository/01-15-red-evidence-task2.json
  modified:
    - src/ports/agent-host.ts
    - src/ports/ledger.ts
    - src/adapters/sqlite/ledger.ts
    - src/adapters/host-claude/launch-preflight.ts
    - src/adapters/host/unavailable-host.ts
    - src/adapters/gsd/plugin-dir.ts
    - src/domain/invocation-scope.ts
    - src/app/deps.ts
    - src/app/resume.ts
    - src/app/stages/map.ts
    - src/cli/composition.ts
    - test/helpers/fake-agent-host.ts
    - test/helpers/run-cli.ts
    - test/integration/staging-adapters.test.ts
    - test/unit/footprint.test.ts

key-decisions:
  - "classifyOutcome puts a moved staging HEAD first (failed, headMoved) ahead of every other rule, including no-result and budget: a host that moved the branch is a containment finding whatever else happened. The plan lists the other rules in order and is silent on this overlap"
  - "A result with no boolean is_error, a non-zero exit or a signal is `failed`, never a success: `subtype: success` alone proves nothing (Pitfall 10)"
  - "An `inconclusive` ending (wall clock, no result) goes to validation, so the retry rule applies once (docs/operations-and-testing.md); `denied`, `failed` and `no_progress` still block with a decision and are never retried"
  - "A host refusal `enforcement_failure:*` becomes blocked (enforcement_failure) in the map stage, with the rule recorded on the failed `launch:map` step"
  - "The adapter reads the GSD shim preamble from the located gsd-core (workflows/map-codebase.md first `_GSD_SHIM_NAME=` line) because GsdCapabilitySnapshot carries no fingerprint; it matches the S0-A recorded value (sha256 c71090e8..., 2573 bytes). Composition keeps the unavailable host when the line is not found"
  - "The invocation's readable roots are the gsd-core and agents directories from gsd:inspect plus the realpath of each allowed skill, which only the host adapter knows (skills root), so the adapter adds the skill roots to the scope before writing files"
  - "No env knob can replace the sandbox probe or the hook self-test; tests reach those seams only by constructing the adapter (sandboxProbe, onBeforeSpawn constructor options)"
  - "Hook denies are counted from the ledger (`Ledger.countHookDenials`), because a PreToolUse deny does not appear in the host's permission_denials; the larger per-tool count of the host's permission_denied events and its result entries is used so one denial is not counted twice"

patterns-established:
  - "Adding an invocation purpose: prepareInvocation(deps, row, purpose, prompt, { expectedFiles }) then deps.host.invoke then completeInvocation; the stage only decides the next state from the outcome"

requirements-completed: []

coverage:
  - id: D1
    description: "bin/avarice onboard selects the contained Claude Code adapter when an admitted claude, the sandbox and the hook entry are present, runs to active with the fake claude, and records it as the enforced agent-host; otherwise the unavailable host with its reason in adapter_configs"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#onboarding through the real ClaudeHostAdapter and a fake claude; #records why the production host is the unavailable one"
        status: pass
    human_judgment: false
  - id: D2
    description: "Before every launch the five inputs are written (0600 files, 0700 directories) and every layer is judged: settings missing or with sandbox off or bypass mode, hooks removed or not blocking, hook script gone, a hook that allows the synthetic write, sandbox probe failing, host version not admitted, hook entry missing; each blocks with enforcement_failure and the fake claude's started marker never appears (SC3, spend-free)"
    requirement: CON-3
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#fail closed before any process starts (SC3); #every containment layer is checked at launch, after the files are written (SC3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The launch is the generated argv only (never --bare, bypass flags, auto, --add-dir), in the staging copy, with the allowlisted environment and no parent credential; the session ID is a UUID recorded in the ledger before the host starts"
    requirement: CON-2
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#launches with the generated argv only; #starts the host with the allowlisted environment"
        status: pass
    human_judgment: false
  - id: D4
    description: "The host runs in its own process group; at the wall clock it gets SIGTERM, then SIGKILL after the grace when it ignores SIGTERM, nothing it started stays alive, the outcome is inconclusive, validation fails and the retry rule applies once"
    requirement: ONB-8
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#the wall clock, the process group and the outcome kinds (ends an overrunning host; judges an inconclusive ending; follows SIGTERM with SIGKILL)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Outcome kind comes from the result event, timeout, exit, permission denials, hook deny events and the staging HEAD: progressed, denied, budget_exhausted, failed, no_progress, inconclusive; an is_error result with subtype success is failed; a moved HEAD is a containment finding and failed; hook budget denies map to budget_exhausted; the maxBudget transcript ends blocked (budget_exhausted)"
    requirement: ONB-3
    verification:
      - kind: unit
        ref: "test/unit/outcome.test.ts (17 tests); test/unit/stream-json.test.ts (15 tests)"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts#what the host reports decides the next state; #calls a moved staging HEAD a containment finding; #maps hook budget_exhausted denials"
        status: pass
    human_judgment: false
  - id: D6
    description: "The transcript is stored as an artifact only after redactSecrets (a planted sk_live key is absent from the stored bytes); the invocation.finished event carries IDs, counts, cost and duration and no text"
    requirement: CON-6
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#stores the transcript as an artifact only after redaction"
        status: pass
    human_judgment: false
  - id: D7
    description: "A supervisor SIGKILLed while the host sleeps leaves the host alive; resume finds it by its --session-id, terminates it (and its group), reconciles the interrupted launch, and the onboarding completes"
    requirement: ONB-8
    verification:
      - kind: integration
        ref: "test/integration/claude-host.test.ts#a supervisor killed while the host runs (T-01-44); #ClaudeHostAdapter.reap"
        status: pass
    human_judgment: false
  - id: D8
    description: "Live behaviour the fake host cannot show: the real hook command+args form under the real claude 2.1.316, real stream-json event shapes (system/permission_denied is synthesized), a compound `cd X && cat` under Read denies, and GSD map on a real repository"
    requirement: ONB-12
    verification:
      - kind: other
        ref: "none in this plan: the live T3 suite and the live onboarding are plans 01-16 and 01-19"
        status: skipped
    human_judgment: true
    rationale: "This plan is spend-free by design. The recorded fixtures (S0 evidence) cover the init and result shapes; system/permission_denied and the hook-denial tool_result are synthesized in the documented shape."

duration: 25 min
completed: 2026-11-03
---

# Phase 01 Plan 15: Contained Claude Code host adapter Summary

**The production AgentHost is now the contained Claude Code adapter: generated launch inputs, a fail-closed preflight that includes a hook self-test, an own-process-group run under AVARICE's own SIGTERM/SIGKILL wall clock, stream-json outcome classification from facts (never model text), a redacted transcript artifact, and reaping of a surviving host by session ID on resume, all proven with a fake claude binary and no spend.**

## Performance

- **Duration:** about 25 min (2026-11-03T01:10:43Z to 01:35Z)
- **Tasks:** 2 of 2, both TDD (RED then GREEN each; no refactor commits)
- **Tests:** 67 new (739 to 806), `npm test`, `npx tsc -p .` and `node scripts/check-boundaries.ts` (46 files) green
- **Model calls made by the plan's tests:** none intended; see "Issues Encountered" for one incident

## Accomplishments

- **Parser and classifier (Task 1):** `StreamJsonParser` is incremental (any chunking, multi-byte characters split across chunks, a final line without a newline, a dropped over-long line) and keeps only the init event, permission denials by tool name and the last `result`; the result text, assistant text and tool inputs are never kept. `classifyOutcome` applies: HEAD moved, no result or timeout, budget, `is_error`/exit/signal, expected files, denies. 32 tests.
- **Adapter (Task 1):** `invoke` writes the five inputs, runs `checkLaunchReady` with the hook self-test, builds and judges the argv, builds the allowlisted env, spawns with `detached: true` and `cwd = req.scope.cwd`, parses stdout while buffering at most 20 MiB of raw transcript, terminates on its own wall clock (SIGTERM, then SIGKILL after 10 s by default) or on the AbortSignal, sweeps the group on exit, gathers facts (HEAD through `staging.head`, expected files through `staging.read`, hook denies from the ledger), classifies, redacts and stores the transcript, and returns the outcome. The descriptor says `enforced` only after the startup check (hook entry readable, sandbox runs, admitted version).
- **Hook self-test (Task 1):** `hookSelfTest` runs the hook exactly as the generated settings start it, against a scratch copy of the policy that names a scratch migrated ledger, with a synthetic Write outside the write roots, and refuses with `enforcement_failure:hook-self-test` unless the hook prints a deny. A hook that exits 0 silently, crashes, or prints an allow is refused.
- **Preparation and map stage (Task 2):** `prepareInvocation` creates the purpose directory, computes the scope from the stored contract, the staging layout and the GSD read roots recorded by `gsd:inspect`, reserves the budget, picks a UUID session ID and records step `launch:{purpose}` as `started` with it. `completeInvocation` settles the budget and records the step, the transcript artifact and `invocation.finished`. `map.ts` uses both, turns an `enforcement_failure` refusal into blocked (enforcement_failure), turns `inconclusive` into validation (so the retry rule applies), and records a `containment.finding` when HEAD moved.
- **Composition (Task 2):** `ClaudeHostAdapter` is the default when `claude` (from `AVARICE_CLAUDE_BIN` or PATH), the sandbox, the hook entry (`AVARICE_HOOK_ENTRY` or this checkout) and the GSD preamble are all present and admitted; otherwise `UnavailableAgentHost` records why in its descriptor.
- **Reaping (Task 2):** on resume, before reconciling, `deps.host.reap({sessionId})` runs `pgrep -f -- "--session-id {uuid}"`, ends each match (its group when it leads one) with SIGTERM then SIGKILL, and fails the resume if a process survives.
- **Fake claude:** a shell wrapper plus `claude-replay.mjs` answers `--version`, writes map documents, replays the four stream-json transcripts with the real session ID, and can sleep, ignore SIGTERM, start a background process in its group, commit (move HEAD), chunk its output and exit with a code.

## Task Commits

1. **Task 1** (TDD): RED `a55eb45` test(01-15) (32 tests, 25 fail on assertions, 7 pass against the stub; `RED_EVIDENCE_OK`, record `01-15-red-evidence-task1.json`); GREEN `c99cdf0` feat(01-15) (32 of 32). The rest of Task 1's file list (adapter, launch-preflight self-test, fake claude) landed in the Task 2 GREEN commit, see Deviations.
2. **Task 2** (TDD): RED `40298af` test(01-15) (12 production-entry tests, 9 fail on assertions, 3 SC3 refusals pass on arrival; `RED_EVIDENCE_OK`, record `01-15-red-evidence-task2.json`); GREEN `84a1378` feat(01-15) (32 of 32 in the file: the 12 RED tests plus 20 adapter-level tests added in the GREEN commit; full suite 806).

## TDD Gate Compliance

RED (`test(01-15)`) precedes GREEN (`feat(01-15)`) for both tasks, and both RED records passed `gsd_run check tdd-red-evidence` with `target_test_failed`. Two honest departures from strict order:

- Task 1's adapter, preflight self-test, invocation-files and fake claude have no test of their own in the Task 1 test files (the plan names only the parser and classifier tests there). They are exercised by Task 2's file, so they were written before their tests existed and then tested in the Task 2 GREEN commit (the 20 adapter-level tests, run in-process with the real adapter and the fake claude).
- The 20 adapter-level tests were added in the Task 2 GREEN commit, not the RED commit (the RED file holds the 12 tests that go through the production entry). Mutation checks confirmed they discriminate: removing `detached: true`, removing `redactSecrets`, removing the policy self-test argument, disabling the reap call, dropping the hook-budget rule from the classifier, and ignoring a moved HEAD each made the relevant test fail, and each file was restored from a copy.

RED evidence semantic assessment (Task 1): the target `calls a finished run that left the expected files progressed` ran and failed on its `deepEqual` against the stub's `inconclusive`; no load, syntax or fixture failure. Task 2: the target ran the real CLI and failed on `assert.equal(r.code, 0)` because composition still chose the unavailable host.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The adapter, preflight self-test and invocation files landed with Task 2**
- **Found during:** Task 1
- **Issue:** extending `InvocationRequest` with required `scope`, `extensions` and `expectedFiles` makes `map.ts` and a staging test fail to compile until `prepareInvocation` exists, and the adapter needs `writeInvocationFiles` (a Task 2 file). A tsc-green commit of the adapter alone was not possible.
- **Fix:** Task 1's GREEN commit holds the parser and classifier (the plan's Task 1 tests); the adapter and its dependencies go in with Task 2's GREEN commit, together with `prepareInvocation`.
- **Commit:** c99cdf0, 84a1378

**2. [Rule 2 - Missing critical functionality] The session ID is chosen by the caller, not the adapter**
- **Found during:** Task 2
- **Issue:** the plan has the adapter generate a fresh UUID, but then the ledger step `launch:map` holds no session ID and `resume` cannot find a surviving process by `--session-id`.
- **Fix:** `InvocationRequest.sessionId` (optional; the adapter generates one when absent), set by `prepareInvocation` and recorded in the `started` step before launch.
- **Files modified:** src/ports/agent-host.ts, src/app/invocation.ts
- **Commit:** 84a1378

**3. [Rule 2 - Missing critical functionality] GSD preamble fingerprint computed from the located gsd-core**
- **Found during:** Task 2
- **Issue:** 01-12 says to pass the preamble from `inspect`, but `GsdCapabilitySnapshot` carries none, and without it the hook denies every `gsd_run` line so a live map could not run.
- **Fix:** `src/adapters/gsd/preamble.ts` reads the first `_GSD_SHIM_NAME=` line of `workflows/map-codebase.md`; its fingerprint equals the S0-A recorded value; composition keeps the unavailable host if the line cannot be read.
- **Files modified:** src/adapters/gsd/preamble.ts (new), src/cli/composition.ts
- **Commit:** 84a1378

**4. [Rule 3 - Blocking] `inconclusive` goes to validation; `Ledger.countHookDenials`; `AppDeps.home`; `PURPOSE_EXTENSIONS` in the domain**
- **Found during:** Task 2
- **Issue:** the plan says an inconclusive timeout is followed by "validation fails and the retry rule applies", but `map.ts` blocked on it; the classifier needs a count of all hook denies, not only budget ones; the scope needs the home directory; `app` may not import the adapter that held `PURPOSE_EXTENSIONS`.
- **Fix:** map stage routes `inconclusive` to `validating`; new ledger method and AppDeps field; `PURPOSE_EXTENSIONS` moved to `src/domain/invocation-scope.ts` and re-exported from plugin-dir.ts.
- **Commit:** c99cdf0 (domain move), 84a1378

**5. [Rule 1 - Bug] Production-entry tests would have launched the real claude**
- **Found during:** Task 2, first full `npm test` after composition changed
- **Issue:** `skeleton.test.ts` ("the production path fails closed") and `lease.test.ts` ("reports a blocked onboarding") run `onboard` through `bin/avarice.ts`; with an admitted `claude` on PATH the production composition now selects the real adapter.
- **Fix:** `runCli` defaults `AVARICE_CLAUDE_BIN` to a missing binary; tests that exercise the contained host override it with the fake. `footprint.test.ts` now allows `detached: true` in `claude-host.ts` as well as the sandboxed executor and asserts the host kills its group, sweeps it on exit and never `unref()`s.
- **Commit:** 84a1378

**Total deviations:** 5 auto-fixed (1 bug, 2 missing critical, 2 blocking). **Impact:** none on the contract; the file ownership between tasks moved, and two port additions (`sessionId`, `countHookDenials`) support the plan's own reap and classification behaviours.

## Issues Encountered

- **Real `claude` was launched by existing tests during one full run.** The first `npm test` after the composition change ran three production-entry tests (2 in skeleton.test.ts, 1 in lease.test.ts) with a real `claude` 2.1.316 on PATH and the real `CLAUDE_CONFIG_DIR`, in temp profiles and on scratch repositories only, with the generated settings and `--max-budget-usd 3` per invocation on model `haiku`. Each of those three tests timed out at 60 s (the test's spawn timeout killed the CLI). After the run no `claude -p` or `--setting-sources` process was left, and no further runs happened. Actual spend is not known and cannot be read from here; the cap bounds it to at most $3 per launched invocation. The fix is in `runCli` (default `AVARICE_CLAUDE_BIN` to a missing binary), after which the full suite ran with no real model call. Worth a glance at the Anthropic usage page for 2026-11-03 around 01:20 to 01:30 UTC.
- A leftover fake claude (a 120 s sleep from a mutation check with reaping disabled) was found and killed; nothing else was left running.
- Sandbox profile and `pgrep`/`ps` use absolute macOS paths (`/usr/bin/pgrep`, `/bin/ps`, `/usr/bin/sandbox-exec`); Linux is not exercised (macOS is the Phase 1 platform).

## Known Stubs

None. `system/permission_denied` and the hook-denial tool_result in `test/fixtures/stream-json.ts` are synthesized in the documented shape, not recorded; that is a fixture, not a stub, and is noted under D8.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: process-spawn | src/adapters/host-claude/claude-host.ts | Spawns `claude` directly (not through the sandboxed executor, by design: the host has its own sandbox from the generated settings) and `pgrep`/`ps` in `reap`. The pgrep pattern is the validated UUID only; every spawn is argv-based with no shell. |
| threat_flag: scratch-fs | src/adapters/host-claude/launch-preflight.ts | `hookSelfTest` creates a 0700 temp directory with a scratch SQLite ledger and a policy copy under os.tmpdir() on every launch, and removes it afterwards. It never touches the real ledger. |

The plan's threat register (T-01-40 to T-01-44) is mitigated and tested: launch only after the full preflight and `assertLaunchArgsSafe`; 0600/0700 files in the data root; classification from facts only; redaction before storage; process group plus SIGTERM/SIGKILL plus reaping.

## Next Phase Readiness

- **01-16 (live proof):** the adapter is ready to run against the real claude. Things only a live run can settle (carried from 01-11 and 01-12): the hook `command` + `args` form under claude 2.1.316, whether a compound `cd X && cat` is denied under Read denies, GSD's secret guard hook copy, the real `system/permission_denied` shape, and that the GSD map actually completes with the hook's identity rules. The fixtures cover result and init shapes only.
- **01-17 and later (intel, knowledge):** call `prepareInvocation`/`completeInvocation`; `expectedFiles` must be non-empty for an invocation to be `progressed`; `knowledgePath` (graphify directory on PATH for the knowledge purpose only) is an adapter option that composition does not set yet.
- **Requirements:** none marked complete; `requirements.ready-ids` reports all six IDs (ONB-3, ONB-12, CON-2, CON-3, CON-6, ONB-8) blocked because later plans (01-16 to 01-20) declare them too.

## Self-Check: PASSED

- Created files exist (claude-host.ts, invocation-files.ts, preamble.ts, invocation.ts, fake-claude.ts, claude-replay.mjs, the three test files, the two RED evidence records): all FOUND.
- Commits a55eb45, c99cdf0, 40298af, 84a1378 are ancestors of HEAD.
- Acceptance criteria: both unit files pass with 32 tests (at least 12); `detached: true` 1, `redactSecrets` 2, `isError` 2 (outcome.ts); claude-host.test.ts has 32 tests (at least 8); `ClaudeHostAdapter` in composition.ts 3; `session-id` in claude-host.ts 2; `reap` in resume.ts 9; `api.anthropic.com|@anthropic-ai/sdk` in src: 0.
- Plan verification: `node --test` on the five named files green (as part of `npm test`: 806 of 806); `node scripts/check-boundaries.ts` ok (46 files); `npx tsc -p .` green.
