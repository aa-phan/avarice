---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 23
subsystem: containment
tags: [restricted-mode, claude-code, host-launch, run-contract, status, d-12, s-22, con-4, typescript]

requires:
  - phase: 04
    provides: "plan 04-02: spike S4-C, the flags `claude --help` lists (including --restricted) and what no offline probe can prove"
  - phase: 04
    provides: "plan 04-11: host admission, the --help flag probe, and the refusal rules a restricted launch reuses the shape of"
  - phase: 04
    provides: "plan 04-18: the artifact store redacts only kinds listed in REDACTED_TEXT_KINDS"
  - phase: 02
    provides: "the run clone, the run invocation records, blockRun and the permission decision"
provides:
  - "`avarice start --restricted`: the run contract records mode restricted, and the one unit is `claude -p ... --restricted` in the run clone"
  - "restricted-plan, restricted-patch and restricted-decisions artifacts, one permission decision that names them, and a run that ends blocked_on_decision (enforcement_failure) with no gate, no commit and no hand-off"
  - "AppDeps.restrictedHost: a ClaudeHostAdapter in restricted mode, reached only by a run whose stored contract says restricted"
  - "src/adapters/host-claude/launch-args.ts: restrictedLaunchArgs, assertRestrictedLaunchArgsSafe; launch-preflight.ts: checkRestrictedHostReady, checkRestrictedLaunchReady"
  - "RunWorkspace.patch(path, { exclude }): the clone's working content against HEAD as one patch"
  - "the refusal of an unenforced host says `enforcement: restricted (<cause>); rerun with --restricted for analysis and planning only`"
  - "status: optional `restricted: true` appended last to the run entry of `status --json`, and a `restricted` label in the STATE column"
affects: [04-34, 04-37, 04-38, 04-39]

actuals:
  tokens: 25000
  tasks: 3
  commits: 7
plan_head_before: fe07001f9057abef0f12ab71347fe28c060debef
plan_head_after: 493725af45e37e8fb07b94b7340cb24eeaeeb904
commits: 7

tech-stack:
  added: []
  patterns:
    - "The mode of a run is a field of its stored contract, read on every stage entry; the host a run reaches is chosen from it (hostOfRun), never from a flag or from the state of another host"
    - "The restricted host is a separate AppDeps member, composed without being probed; its `claude --help` probe runs only when a descriptor is read"
    - "A contained contract carries no `mode` key, so every digest a contained run had stays the same"

key-files:
  created:
    - src/app/run-stages/restricted.ts
    - src/app/run-host.ts
    - test/integration/restricted-mode.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-23-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-23-red-task2.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-23-red-task3.json
  modified:
    - src/cli/commands/start.ts
    - src/cli/composition.ts
    - src/app/deps.ts
    - src/app/run-start.ts
    - src/app/run-resume.ts
    - src/app/run-stages/prepare.ts
    - src/app/run-status.ts
    - src/cli/render/run-view.ts
    - src/domain/run-contract.ts
    - src/domain/run-lifecycle.ts
    - src/domain/host-admission.ts
    - src/adapters/host-claude/claude-host.ts
    - src/adapters/host-claude/launch-args.ts
    - src/adapters/host-claude/launch-preflight.ts
    - src/adapters/fs/redacting-artifact-store.ts
    - src/adapters/git/run-workspace.ts
    - src/ports/run-workspace.ts
    - test/fixtures/claude-fake/claude-replay.mjs
    - test/helpers/fake-claude.ts
    - test/integration/claude-host.test.ts
    - test/unit/run-lifecycle.test.ts

key-decisions:
  - "The restricted host is its own AppDeps member (restrictedHost), not a createDeps flag: `supervise` and `resume` are separate processes that get no flag, so the mode a run is continued under has to come from its stored contract"
  - "A restricted run prepares only the clone: no GSD configuration, dependency install, check validation or baseline, because none of them is wanted when no check runs and no /gsd-quick unit starts"
  - "The restricted line keeps `--setting-sources \"\"` and `--strict-mcp-config` beside `--restricted`: a host that refuses the combination fails closed, where leaving them off would rest on an unproven claim"
  - "The end of a restricted run is the existing enforcement block: reason enforcement_failure, one permission decision (withdraw only), the plan, patch and question digests in its issue and evidence references"
  - "The contract field `mode` is present only for a restricted run, so a contained contract keeps its digest"

patterns-established:
  - "A test that needs a host which lists flags uses makeFakeClaude({ helpFlags }); the fake answers --help without counting a launch"

requirements-completed: [CON-4]

coverage:
  - id: D1
    description: "A host without required enforcement still refuses an unattended run by default, and the refusal says `enforcement: restricted` and names --restricted"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#without the flag, an unadmitted host refuses: exit 3, the message says `enforcement: restricted` and names --restricted, and no invocation started"
        status: pass
      - kind: integration
        ref: "test/integration/claude-host.test.ts#records why the production host is the unavailable one, in the descriptor adapter_configs keeps"
        status: pass
    human_judgment: false
  - id: D2
    description: "start --restricted records mode restricted and runs one `claude -p ... --restricted --permission-mode dontAsk --permission-prompts none --settings <run settings>` in a clone under the work root, with no tool grant"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#start --restricted launches the restricted line in the run clone, edits only the clone, stores the plan and the patch, and ends blocked without a gate, a commit or a hand-off"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#judges the restricted argv: the generated line passes, and a line without --restricted or with a tool grant is refused"
        status: pass
    human_judgment: true
    rationale: "The tests prove AVARICE built and judged the line and that a fake host received it. Whether the real host removes its shell, honours dontAsk and accepts --setting-sources with --restricted needs the live run of plan 04-34"
  - id: D3
    description: "A restricted run's outputs are a plan, a patch and a decision list stored as artifacts; it never commits, hands off a branch or writes the user's repository"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#stores the question list as restricted-decisions and opens one permission decision that names the plan, the patch and the list"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#`avarice cancel` ends the blocked restricted run and leaves the user repository exactly as it was"
        status: pass
    human_judgment: false
  - id: D4
    description: "status labels the run restricted in text, and the run entry of status --json gains an optional `restricted: true` key appended last; existing snapshots stay byte-identical"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#labels the run restricted in text status and appends the optional `restricted` key last to the run entry of status --json; a contained run has neither"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "A restricted run killed during its invocation resumes restricted; it never resumes unrestricted, runs no check and writes no gate row"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#relaunches the restricted line when the supervisor is killed during the invocation and the run is resumed; no check runs and no gate row is written"
        status: pass
    human_judgment: false
  - id: D6
    description: "The restricted launch preflight is fail-closed: it refuses a missing claude, a missing --restricted or other flag in --help, and run settings that do not deny by default, and asks for no admitted version, sandbox probe or hook"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#refuses when --restricted is absent from --help, with this exact rule text"
        status: pass
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#start --restricted with a claude that does not list --restricted exits 3 with enforcement_failure:host-flag-missing:--restricted, and stores no run"
        status: pass
    human_judgment: false
  - id: D7
    description: "No code path falls back to instructions-only or unrestricted execution when enforcement is missing"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#relaunches the restricted line when the supervisor is killed during the invocation and the run is resumed; no check runs and no gate row is written"
        status: pass
    human_judgment: true
    rationale: "The tests cover the paths that exist (start, resume, an absent or failing restricted host). That no other path exists is a reading of the code, which a reviewer should repeat: hostOfRun and runRestrictedItem are the only two places that choose a host for a run"

duration: 28min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 23: Restricted mode for runs Summary

**`avarice start --restricted` runs one `claude -p ... --restricted` invocation in the run's disposable clone and ends the run blocked (enforcement_failure) with a stored plan, patch and question list; without the flag an unenforced host still refuses, and the refusal now names `--restricted`.**

## Performance

- **Duration:** about 28 min
- **Started:** 2026-11-17T08:15:00Z
- **Completed:** 2026-11-17T08:45:00Z
- **Tasks:** 3 of 3
- **Files:** 27 touched by the plan's commits (6 created, 21 modified, counting the three RED records)

## Accomplishments

- A host that cannot be contained (an unadmitted minor, a failed probe) still refuses a run by default. The blocked run, its G0 row and the `--wait` output of `start` now carry `enforcement: restricted (<cause>); rerun with --restricted for analysis and planning only`.
- `start --restricted` stores `mode: "restricted"` in the contract (and only then, so no contained digest moves), refuses before storing anything when the restricted host is not ready (exit 3, `enforcement_failure:host-flag-missing:--restricted` for a host without the flag), and supervises the run like any other.
- The restricted stage prepares the clone and nothing else, resets it to the pin on a relaunch, makes the restricted directory after the scope is computed, launches the restricted host once, stores `restricted-plan`, `restricted-patch` (the clone's diff against the pin without the restricted directory) and `restricted-decisions` (the question list), records the `restricted:outputs` step, opens one permission decision that names the digests, and blocks the run. It never reaches `ready_for_review`, and no gate, check or hand-off row exists.
- The restricted launch line is built and judged separately: `--restricted`, `--setting-sources ""`, the run settings, `dontAsk`, no prompts, a strict MCP set, a budget cap, stream-json and a session ID. It carries no `--tools`, `--allowedTools`, `--plugin-dir`, `--agents` or `--add-dir`, and the argv judge refuses each of them.
- The restricted preflight reads the run settings (`permissions.defaultMode` must be `dontAsk`) and `claude --help` (every flag of the line must be listed). It asks for no admitted version, sandbox probe or hook.
- `status` shows `restricted` in the STATE column and a `mode:` detail line; `status --json` appends `"restricted": true` last to a restricted run's entry. All Phase 2 and 3 snapshots are byte-identical.

## Task Commits

Each task followed RED, GREEN:

1. **Task 1: Tracer** - RED `6d5ef3d` (test), GREEN `8dd35b6` (feat)
2. **Task 2: Status label** - RED `0cd4820` (test), GREEN `c984780` (feat)
3. **Task 3: Restricted preflight and descriptor** - RED `be33dae` (test), GREEN `1c4e8f6` (feat)
4. Follow-up `493725a` (test): RUN_NEXT_ACTIONS lists `restricted-run`, and a test that the owner ends a restricted run with `avarice cancel`

**Plan metadata:** the docs commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

| Task | RED evidence | Verdict |
|------|--------------|---------|
| 1 | `04-23-red-task1.json`: both tracer tests failed on their planned assertions (refusal text missing; the fake saw 0 invocations where 1 was planned) | RED_EVIDENCE_OK |
| 2 | `04-23-red-task2.json`: the status label test failed on `restricted` undefined where `true` was planned | RED_EVIDENCE_OK |
| 3 | `04-23-red-task3.json`: the settings-file test failed on `expected a refusal` for a missing settings file | RED_EVIDENCE_OK |

Two of task 2's three tests (the decision list, kill and resume) and four of task 3's tests passed before any code of their own task, because the restricted stage and a minimal preflight that task 1 had to build to end the tracer already did that work. Only the status label (task 2) and the settings and other-flag checks (task 3) were RED, and each RED record names that target. The tests that went green early stay in the suite as the plan's behavior cases.

## Files Created/Modified

- `src/app/run-stages/restricted.ts` - `runRestrictedItem`: reset, launch, store outputs, block (`runRestrictedItem` at line 164)
- `src/app/run-host.ts` - `hostOfRun`: a restricted contract maps to `deps.restrictedHost`, a contained one to `deps.host`
- `src/adapters/host-claude/launch-args.ts` - `restrictedLaunchArgs` (line 188), `assertRestrictedLaunchArgsSafe` (line 234)
- `src/adapters/host-claude/launch-preflight.ts` - `checkRestrictedHostReady`, `checkRestrictedLaunchReady` (line 349)
- `src/adapters/host-claude/claude-host.ts` - `mode: 'restricted'` option; descriptor `enforcement: restricted`, capability `restricted-invocation`
- `src/cli/composition.ts` - `productionRestrictedHost`, `restrictedHint`, `DepsOverrides.restrictedHost`
- `src/cli/commands/start.ts` - `--restricted`, the early refusal, the hint after `--wait`
- `src/app/run-stages/prepare.ts` - dispatch on the stored mode; the G0 note carries the host's reason
- `src/adapters/git/run-workspace.ts`, `src/ports/run-workspace.ts` - `patch`
- `src/app/run-status.ts`, `src/cli/render/run-view.ts` - the `restricted` key and label
- `src/adapters/fs/redacting-artifact-store.ts` - the three artifact kinds are redacted text kinds
- `test/integration/restricted-mode.test.ts` - 14 tests; `test/fixtures/claude-fake/claude-replay.mjs` answers `--help`

## Decisions Made

See key-decisions. The ones that are owner policy are listed next.

## Decisions needing owner review

1. **A permission decision offers `withdraw` only, not "cancel the run" and "keep it open".** The plan asked for those two options. The decision policy (owner decision 2) gives a permission decision one `withdraw` option, and answering it applies nothing and does not cancel the run, so a label "cancel the run" would say something the answer does not do. The restricted run therefore uses the existing enforcement decision: the issue text says to apply the patch by hand and end the run with `avarice cancel`, and "keep it open" is leaving the decision unanswered. Say if you want a dedicated restricted decision whose answer cancels.
2. **A restricted run runs no GSD configuration, dependency install, check validation or baseline.** The plan said no declared check runs; it did not say whether the preparation steps that run repository code in AVARICE's own sandbox still run. They do not, so a restricted run needs no network and runs no repository code. The cost is that the planning host sees a clone with no installed dependencies.
3. **The restricted line keeps `--setting-sources ""` and `--strict-mcp-config`**, which `docs/containment.md:158` omits. Kept on purpose (see key-decisions); if the live host refuses the combination, restricted mode does not start until someone decides to drop them on evidence.
4. **A contained contract carries no `mode` key** (the plan said `mode: 'restricted' | 'contained'` defaulting to contained). Storing `contained` would have changed every contained run's contract digest.
5. **There is no command that prints a restricted artifact.** The decision names the digests; the owner reads the plan, patch and questions from the profile's artifact store (`artifacts/<first two hex digits>/<hex>` under the data root). Whether to add a read-back command, or a copy under `runs/<runId>/`, is a product choice.
6. **`--restricted` on `start` is checked against the restricted host before anything is stored** (exit 3), while a plain `start` on an unenforced host still stores the run and blocks it at G0, as before. The hint for the plain case is printed on standard error after `--wait`, so the `--wait` standard output is unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restricted host composed in every command instead of a `createDeps` flag**
- **Found during:** Task 1 (composition)
- **Issue:** The plan's `CreateDepsOptions.restricted` and `main.ts` flag pass-through cannot reach `supervise` or `resume`, which are separate processes with no `--restricted` flag, yet must continue a restricted run restricted.
- **Fix:** `AppDeps.restrictedHost` is composed for every non-read-only command and probed lazily; the stage and `hostOfRun` choose it from the stored contract. `main.ts` is unchanged.
- **Files modified:** `src/cli/composition.ts`, `src/app/deps.ts`, `src/app/run-host.ts`, `src/app/run-resume.ts`
- **Committed in:** `8dd35b6`

**2. [Rule 1 - Bug] The reap of an interrupted launch used `deps.host`**
- **Found during:** Task 1 (resume path)
- **Issue:** `reapRunLaunches` called `deps.host.reap`; a restricted run's host is another object, and the contained host of an unadmitted deployment has no `reap`, so a resume would have failed to end the surviving host.
- **Fix:** it reaps through `hostOfRun`.
- **Files modified:** `src/app/run-resume.ts`
- **Committed in:** `8dd35b6`

**3. [Rule 3 - Blocking] Existing tests updated for planned changes**
- `test/integration/claude-host.test.ts` asserted the old reason text of the unavailable host; it asserts the new `enforcement: restricted (...)` text (`8dd35b6`).
- `test/unit/run-lifecycle.test.ts` asserted the action list of `contract_ready`; it lists `restricted-run`, which `killpoint-coverage.test.ts` requires for any literal checkpoint name (`493725a`).
- The fake `claude` answered `--help` as a launch; it now answers it before logging (`6d5ef3d`).

**4. [Rule 2 - Missing critical] Argv judge, preflight and artifact redaction for the restricted path**
- `assertRestrictedLaunchArgsSafe` refuses `--tools`, `--allowedTools`, `--add-dir`, `--plugin-dir`, `--agents`, `--bare`, `--safe-mode` and every bypass flag, and requires `--restricted`; the three artifact kinds are in `REDACTED_TEXT_KINDS` (plan 04-18's source scan would fail otherwise).
- The scope of the restricted invocation is narrowed beyond the run scope: shell strategy `none` (denied in the settings as well as removed by the host), no subagents, no listed commands, and only the restricted directory added as a write root.
- **Committed in:** `8dd35b6`

---

**Total deviations:** 4 (1 bug, 2 blocking, 1 missing critical), plus the owner-review decisions above.
**Impact on plan:** none changes what the plan delivers; the first changes how the mode reaches `supervise` and `resume`.

## Issues Encountered

- The `claude-host` suite's expected reason text had to follow the new refusal wording (above).
- No test spends on a model: every launch goes to the fake `claude`.

## What plan 04-34's live run must confirm

None of these is assumed by the code in a way that would weaken containment if it is wrong; each is a place where the code fails closed or rests on a stated host behavior.

1. `claude --restricted` removes Bash, PowerShell and WebFetch, confines the file tools to the working directory and refuses `bypassPermissions` on the pinned host (the help text says so; no probe runs it).
2. **Hooks under `--restricted`:** whether the PreToolUse, ConfigChange and PostToolUse hooks named in `--settings` run. The generated settings still carry them and deny by default (`dontAsk`, allow rules only for the write roots and the restricted directory); if the hooks do not run, the read-before-edit and secret-path rules are not applied to a restricted run.
3. **`--restricted` together with `--setting-sources ""` and `--strict-mcp-config`:** accepted or rejected. A rejection fails the launch closed (the run blocks with `enforcement_failure`).
4. Whether the file tools honour the `Edit(...)` allow rules of the generated settings under `dontAsk` in restricted mode, so the plan and the working-copy edits are written and nothing else is.
5. The shape of the stream-json result under `--restricted` (cost, `is_error`), which the invocation record and the budget settle from.
6. That a `--restricted` host started by the supervisor leaves no process after the wall clock or a reap (the same process-group handling as the contained line is used).

## Documentation surfaces

For plans 04-37, 04-38 and 04-39 (`docs/system/` was not edited here; the phase documentation plans own it):

- **Flag:** `avarice start --restricted` (usage line `... [--wait] [--restricted]`); exit 3 when the restricted host is not ready, with `enforcement_failure:<probe>`.
- **Refusal text:** `enforcement: restricted (<cause>); rerun with --restricted for analysis and planning only`, in the unavailable host's descriptor reason, the G0 `host-enforcement` detail, the supervisor's note, and on standard error after `start --wait`.
- **Launch line:** `claude -p <planning prompt> --restricted --setting-sources "" --settings <run settings> --permission-mode dontAsk --permission-prompts none --strict-mcp-config --mcp-config <file> --model <m> --max-budget-usd <n> --output-format stream-json --verbose --session-id <uuid>` (`--resume <uuid>` instead of `--session-id` on a resume of a session). No tool grant. Differs from `docs/containment.md:158` by the extra flags (a findings line: `src/adapters/host-claude/launch-args.ts:188` against `docs/containment.md:158`).
- **Contract field:** optional `mode`, present (`restricted`) only for a restricted run.
- **Run flow:** only the clone is prepared; checkpoints `prepare-workspace` then `restricted-run`; steps `launch:run` and `restricted:outputs`; attempt reused across a resume.
- **Artifacts:** `restricted-plan`, `restricted-patch`, `restricted-decisions` (all redacted text kinds); the patch excludes `.avarice-restricted/`.
- **End state:** `blocked_on_decision` with reason `enforcement_failure`, one `permission` decision (option `withdraw`), the three digests in its issue and evidence references (`artifact:<digest>`); never `ready_for_review`; no gate, evidence, hand-off or commit.
- **Status:** `status --json` run entry `restricted: true` (last key, optional); text STATE column `restricted <state>` and a `mode:` detail line.
- **Host:** `AppDeps.restrictedHost` (adapter descriptor `enforcement: restricted`, capability `restricted-invocation`, no `contained-invocation`); `checkRestrictedLaunchReady` rules `settings-missing`, `settings-invalid`, `settings-key:permissions.defaultMode`, `host-unavailable`, `host-flag-missing:<flag>`; `RunWorkspace.patch`.
- **Findings for `docs/system/findings.md`:** line 90 (`docs/containment.md:148`: no restricted mode) is closed by this plan; the extra flags above; no read-back command for the artifacts (decision 5); the restricted run skips the preparation steps that run repository code.

## Threat Flags

None beyond the plan's register. T-04-62 (no shell on the line, restricted preflight, argv judged), T-04-63 (disposable clone, no hand-off, user checkout and refs unchanged in the test) and T-04-64 (mode read from the stored contract, kill-and-resume test) are mitigated and tested; what the host really enforces is the live run's.

## Known Stubs

None.

## Next Phase Readiness

Plan 04-34 can run the live restricted case. The offline parts are done; the six confirmations above are the live run's.

## Self-Check: PASSED

- Created files exist: `src/app/run-stages/restricted.ts`, `src/app/run-host.ts`, `test/integration/restricted-mode.test.ts` and the three RED records.
- Commits exist on the branch: `6d5ef3d`, `8dd35b6`, `0cd4820`, `c984780`, `be33dae`, `1c4e8f6`, `493725a`.
- Verification run: `test/integration/restricted-mode.test.ts` 14 of 14; unit suite 2687 tests with the two lifecycle expectations updated and re-run green; 315 related integration tests (run supervisor, resume, status, cancel, decisions, claude-host, artifact and event redaction, redaction suite, profile isolation and propagation, transcript retention, host search tools, fail-closed) green; `npm run typecheck` and `npm run check:boundaries` clean. The full suite is the orchestrator's.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
