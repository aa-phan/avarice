# Phase 2: Contained unattended run of one work item - Pattern Map

**Mapped:** 2026-11-05
**Files analyzed:** 27 (new or modified)
**Analogs found:** 26 / 27 (all analog paths verified git-tracked via `git ls-files src test`)

Every analog below is a tracked file under `src/`, `test/`, `scripts/` or `docs/`. No gitignored mirror paths are used.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/domain/run-contract.ts` | model (pure compiler) | transform | `src/domain/onboarding-contract.ts` | exact |
| `src/domain/run-lifecycle.ts` | model (state table) | transform | `src/domain/onboarding-lifecycle.ts` | exact |
| `src/domain/gates.ts` (G2, G4) | utility (pure) | transform | `src/domain/outcome.ts` (pure facts to verdict) | role-match |
| `src/domain/evidence.ts`, `test-inventory.ts` | utility (pure) | transform | `src/domain/outcome.ts`, `src/domain/validation.ts` | role-match |
| `src/domain/outcome.ts` (modify) | utility | transform | itself | exact |
| `src/domain/invocation-scope.ts` (modify: `run` purpose) | config/model | transform | itself (`INVOCATION_PURPOSES`, `PURPOSE_EXTENSIONS`, `GSD_READ_VERBS`) | exact |
| `src/domain/hook-decision.ts`, `src/hook/pre-tool-use.ts` (modify: read-before-edit, denial counter) | middleware (hook) | request-response | themselves | exact |
| `src/app/run-service.ts` | service | event-driven (lease loop) | `src/app/onboarding-service.ts` | exact |
| `src/app/run-resume.ts` | service | event-driven | `src/app/resume.ts` | exact |
| `src/app/run-stages/*` (workspace, configure, deps, baseline, delegate, gate-g2, commit, verify-g4, handoff) | service (stages) | batch / file-I/O | `src/app/stages/workspace.ts`, `stage.ts`, `map.ts`, `validate.ts` | exact |
| `src/app/checks.ts` (required checks, ONB-10 validation) | service | request-response | `src/app/stages/validate.ts` + `src/adapters/exec/sandboxed-executor.ts` caller shape | role-match |
| `src/app/budget.ts`, `src/app/invocation.ts` (modify: generalize beyond onboarding) | service | CRUD | themselves | exact |
| `src/app/run-status.ts`, `src/app/status.ts` (modify, additive) | service (read model) | CRUD read | `src/app/status.ts` | exact |
| `src/adapters/exec/allowlist-proxy.ts` | adapter | streaming (CONNECT) | none in repo | no analog (RESEARCH Pitfall 7) |
| `src/adapters/exec/seatbelt-profile.ts` (modify: `allowLoopbackPorts`) | adapter | transform | itself | exact |
| `src/adapters/git/run-workspace.ts` | adapter | file-I/O | `src/adapters/git/staging-clone.ts` + `safe-git.ts` | exact |
| `src/adapters/git/safe-git.ts` (modify: allowlisted extra config, fetch/commit) | adapter | request-response | itself (`safeGitEnv` extraConfig, `refuseUnsafeArgs`) | exact |
| `src/adapters/host-claude/*` (modify: run purpose) | adapter | request-response | themselves | exact |
| `src/adapters/sqlite/migrations/0002-run.ts` | migration | CRUD | `src/adapters/sqlite/migrations/0001-initial.ts` | exact |
| `src/cli/commands/start.ts` | controller (command) | request-response | `src/cli/commands/onboard.ts` | exact |
| `src/cli/commands/supervise.ts`, `inbox.ts`, `install-host.ts` | controller (command) | request-response | `src/cli/commands/resume.ts`, `status.ts` | role-match |
| `src/cli/commands/status.ts`, `resume.ts` (modify) | controller | request-response | themselves | exact |
| `src/cli/main.ts` (modify `COMMANDS`, bare-shell branch) | config/dispatch | request-response | itself | exact |
| `src/cli/shell/*`, `src/cli/render/*` | component | event-driven / transform | none for shell; `renderStatus` in `src/app/status.ts` for render | no analog (shell) / partial (render) |
| `test/unit/run-contract.test.ts`, `gates.test.ts`, `run-lifecycle.test.ts` | test | transform | `test/unit/outcome.test.ts`, `test/unit/domain-contracts.test.ts` | exact |
| `test/fault/run-killpoints.test.ts` (+ `RUN_KILL_POINTS` in `test/helpers/fault-run.ts`) | test | event-driven | `test/fault/killpoints.test.ts` | exact |
| `test/containment/live-run.test.ts` + LIVE-CASES spend ledger | test | request-response | `test/containment/live-onboarding.test.ts`, `LIVE-CASES.md` | exact |
| `test/helpers/fake-run-host.ts` | test helper | request-response | `test/helpers/fake-agent-host.ts` | exact |

## Pattern Assignments

### `src/domain/run-contract.ts` (model, transform)

**Analog:** `src/domain/onboarding-contract.ts` (455 lines; pure compiler, lower-only budgets, derivations).

**Header and imports** (lines 1-10):
```typescript
// Pure: the clock, ids and preflight facts are arguments.
// The compiler is where RC-5 is enforced for onboarding: promotion other than `none` and any budget
// above the preset are refused here, so no later stage has to remember to check.
import { digestOf } from './digest.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
```

**Budget and contract shape** (lines 45-66): `OnboardingBudgets` has `wallClockMinutes`, `invocations`, `toolCalls`, `subagentsConcurrent`, `subagentsTotal` plus a `*Derivation` record, `costUsd: { perInvocation, perRun, exactness }`, `retry`. Mirror it for `routine` with D-13 values (60 min, 3 invocations, 400 tool calls, 2.00 / 5.00 USD) and recorded derivations for `subagentsTotal` (RESEARCH A7 suggests 8, concurrent 2). The contract carries `schema`, `contractVersion`, `policyPreset`, `policyRevision`, `compiledAt`, `workspace: { projectId, baseRevision }`, `files: { read, readExclude, secretGlobs, write, create, avariceWrite, delete }`. Add `artifacts` (RESEARCH Pitfall 5 and 8) and `checks` (`name`, `argv`, `timeoutSec`, `required`, optional `env`, `writes`). Copy the lower-only `--budget` override handling used by the compiler (read lines 80-455 of the analog for the override loop) and the `digestOf` stored digest. Budget names must stay in `BUDGET_NAMES` of `src/app/budget.ts` (`invocations`, `toolCalls`, `subagentsTotal`, `wallClockMs`, `costUsd`).

### `src/domain/run-lifecycle.ts` (model, transform)

**Analog:** `src/domain/onboarding-lifecycle.ts`.

**Pattern** (lines 5-58): `as const` state tuple, derived union type, `BlockedReason` union (reuse `enforcement_failure | budget_exhausted | decision`), edge list `DIAGRAM_EDGES: readonly Edge[]`, a `PRE_*` list for "may move to blocked", then `isStopState` / `isResumable` helpers (lines 60+, not excerpted). Run states for this phase: a subset of the docs state machine ending in `ready_for_review`, `blocked_on_decision`, `failed`, `paused`. Keep the next-action catalog in the same file so checkpoints name their action.

### `src/domain/outcome.ts` (modify) and gates

**Analog:** itself (lines 18-64). Pure `classifyOutcome(facts)` with ordered rules and "first that applies decides".

```typescript
if (headMoved) return result('failed');
if (!facts.resultSeen || facts.timedOut) return result('inconclusive');
...
if (facts.expectedFilesPresent) return result('progressed');
```
Extend additively (RESEARCH Pitfall 11): `expectedFilesPresent` for a run = SUMMARY exists and in-scope tree differs from the checkpoint commit, measured by AVARICE; add a structural `paused` signal as a new fact field, never a heuristic over model text. Do not reorder rule 1 (HEAD moved = failed is the D-03 backstop). Update `test/unit/outcome.test.ts` in the same plan (its `facts(over)` factory is the pattern). G2 and G4 in `gates.ts` follow the same shape: a facts interface in, a verdict plus reasons out, no I/O.

### `src/domain/invocation-scope.ts` (modify: run purpose)

**Analog:** itself.

**Purpose registration** (lines 12, 41-55): add `'run'` to `InvocationPurpose`, an entry in `INVOCATION_PURPOSES` (`cwd: 'staging'`, write dir per contract), `PURPOSE_EXTENSIONS.run = { skills: ['gsd-quick'], agents: ['gsd-planner','gsd-plan-checker','gsd-executor','gsd-verifier'] }`, `PURPOSE_SUBAGENT_TYPES.run`, and `GSD_READ_VERBS.run` (lines 119-124). These three records are `Record<InvocationPurpose, ...>`, so the compiler forces every one to be filled. Keep `'git commit'`, `'avarice'` in `DENIED_COMMAND_PREFIXES` (lines 127-144); only `npm`/`npx` may be conditionally removed for `run`, argv-exact from `execution.commands` (RESEARCH Pitfall 3). Every admitted GSD verb needs a comment citing its GSD source line, as the existing list does.

### `src/hook/pre-tool-use.ts` + `src/domain/hook-decision.ts` (modify)

**Analog:** themselves. `normalizeToolCall` (decision.ts line 99) and `parseHookPolicy` (line 148) produce a pure decision from an injected `Canon`. Add read-before-edit state as a ledger table (migration 0002 `hook_reads`) written inside the same `BEGIN IMMEDIATE` pattern the hook uses for budget charges (read the budget-charge code path in `src/hook/pre-tool-use.ts` before editing). Keep the decision function pure: pass in the recorded digest, return `deny` with a reason that tells the model to re-read. Unit-test against `test/unit/hook-decision.test.ts` and `test/integration/hook.test.ts`; helper `test/helpers/hook-fixture.ts`.

### `src/app/run-service.ts` (service, event-driven lease loop)

**Analog:** `src/app/onboarding-service.ts` (204 lines). Copy structure, not code: do not fork the lease loop, extract a shared helper if the diff is small.

**Fault points** (lines 26-40): `faultPoint(name)` with counted `name#N` form. Export and reuse it; do not duplicate.

**StageContext construction** (lines 81-123): `checkpoint(nextAction)` calls `ledger.recordCheckpoint(id, { fence }, { nextAction, nowMs })` then `faultPoint('after-checkpoint:' + nextAction)`; `transition(row, to, nextAction, options)` calls `transitionOnboarding` with `{ version, fence }` and then fires `after-transition:` and `after-checkpoint:`. Generate the run equivalent (`transitionRun`) so generic kill points fire without stage code.

**Lease loop** (lines 152-204):
```typescript
const grant = deps.ledger.acquireLease(onboardingId, holder, ttl, deps.clock.nowMs());
...
const timer = setInterval(() => { const renewed = deps.ledger.renewLease(...); if (!renewed.ok) { lease.lost = renewed.error; clearInterval(timer); } }, Math.max(1, Math.floor(ttl / 3)));
timer.unref();
try { if (options.prelude) {...} for (;;) { ...stage = STAGES[row.state]...; if (after.value.state === row.state && after.value.version === row.version) return err({kind:'internal', cause: `the ${row.state} stage made no progress`}); } }
finally { clearInterval(timer); deps.ledger.releaseLease(onboardingId, holder, fence); }
```
The `runs` table already has `lease_holder`, `lease_expires_at`, `lease_fence` (0001 DDL), so generalize `acquireLease`/`renewLease`/`releaseLease` in `src/ports/ledger.ts` (lines 253-255) to a run identity rather than adding parallel methods. IDs: `deps.ids.next('run_')`. `AVARICE_LEASE_TTL_MS` env already honoured.

### `src/app/run-stages/*` (stages)

**Analog:** `src/app/stages/workspace.ts`, `stage.ts`, `validate.ts`, `map.ts`.

**Stage contract** (`stage.ts` lines 20-35): `Stage = (ctx, row) => Promise<Result<void>> | Result<void>`; `StageContext` offers `checkpoint`, `transition`, `activate`, `note`. Add a run variant (`RunStageContext`) with `runId` in place of `onboardingId`.

**Checkpoint-before-effect** (`workspace.ts` lines 47-49):
```typescript
const first = ctx.checkpoint('prepare-workspace');
if (!first.ok) return first;
const prepared = deps.staging.prepare({ repoPath: project.value.repoPath, ... });
```
**Run-scoped GSD settings** (`workspace.ts` lines 18-23): `STAGING_GSD_SETTINGS: readonly GsdSetting[]` as `[key, value]` pairs applied by AVARICE before any invocation. Add `RUN_GSD_SETTINGS` (`commit_docs=false`, `workflow.use_worktrees=false`, `git.branching_strategy=none`, plus the ADR-006 keys; verify `workflow.windows_enforce` before listing, RESEARCH A5). Apply with the existing `deps.gsd` port in `src/ports/gsd-onboarding.ts` / `src/adapters/gsd/gsd-onboarding.ts`.

**Incompatible-environment stop** (`workspace.ts` lines 36-41): `stopIncompatible(ctx, row, found, admitted)` from `./shared.ts` for a missing GSD; copy for admitted Claude version refusal (`host-version-not-admitted:2.1.318` is expected until Wave 0 admits it).

**Hand-off stage:** `git fetch <clone> refs/heads/avarice/run_<id>:refs/heads/avarice/run_<id>` through a new allowlisted `runGit` form (see `safe-git.ts` below), checkpoint `handoff:fetch` first, idempotent when the ref already equals the clone's.

### `src/app/run-resume.ts`

**Analog:** `src/app/resume.ts`. Imports `runOnboarding` and `StageContext`; constants `LAUNCH = 'launch:map'`, `LAUNCH_PREFIX = 'launch:'`; `reapInterrupted(ctx, started, runId)` terminates the surviving host found by the session ID in the `started` launch step before any stage runs; resume passes it as `RunOptions.prelude`. Copy that shape: prelude reaps by session ID, then reconciles an in-flight `launch:run` (CON-16: reset inside the clone to the last item checkpoint, retry once, `invocations: 3` budget) and a `verify:*` step with no completion.

### `src/app/budget.ts` and `src/app/invocation.ts` (generalize)

**Analog:** themselves. `budgetRowsOf(contract: OnboardingContract)` (line 51), `reserveInvocation(deps, onboarding: OnboardingRow, purpose)` (line 64), `prepareInvocation(deps, onboarding, purpose, prompt, options)` (invocation.ts line 50). Replace the onboarding parameter with a small `BudgetedRun` interface (`runId`, contract body with `budgets`), keep the orphan-charge logic verbatim (lines 71-95; killed or orphaned invocations stay charged) and `wallClockShares[purpose]` becomes a single `run` share. Existing tests `test/fault/budgets.test.ts` must stay green unchanged.

### `src/adapters/git/run-workspace.ts` and `safe-git.ts`

**Analog:** `src/adapters/git/staging-clone.ts` (clone at pin, branch `avarice/onboard-{onb}`, build in `staging.partial`, rename on completion; `CLONE_TIMEOUT_MS = 120_000`; extends `GitStagingWorkspace` from `staging-base.ts`). The run clone uses branch `avarice/run_<id>` and the same atomic partial-then-rename rule; `STAGING_STRATEGY='clone'` is in `staging-strategy.ts`.

**Safe git excerpts to extend** (`safe-git.ts`): `safeGitEnv(base, extraConfig: readonly ConfigEntry[])` (lines 57-70) already supports extra config entries via `GIT_CONFIG_KEY_n`; `RunGitOptions` (36-47) has no caller-supplied config. Add an allowlisted option (for example `identity` and `gpgsignOff`) that maps to fixed entries (`user.name`, `user.email`, `commit.gpgsign=false`, `transfer.fsckObjects=true`), never free `-c`. `refuseUnsafeArgs` (75-90) is an allowlist for `clone`; add an equivalent allowlist for `fetch` (`--no-tags`, no `+` refspec) and `commit` (`--no-verify`, `-m`, pathspec after `--`). Keep `neutralizeFilters: true` on `add`/`commit`/`status`/`diff`.

### `src/adapters/exec/seatbelt-profile.ts` (modify)

**Analog:** itself. `SeatbeltInput` (lines 15-23); profile built as ordered lines (59-69). Add `allowLoopbackPorts: readonly number[]` validated as integers 1-65535 and emit after `(deny network*)` (line 62):
```typescript
`(allow network-outbound (remote ip "localhost:${port}"))`
```
(verified in RESEARCH Code Examples; hostnames are rejected by Seatbelt). Mirror the existing `canonical()` refusal style for invalid input (`err({ kind: 'invalid', field, reason })`). Pass through `SandboxedExecutor` / `CommandSpec` in `src/ports/command-executor.ts`.

### `src/adapters/exec/allowlist-proxy.ts`

**No analog.** Use RESEARCH Pitfall 7: `node:http` `'connect'` handler accepting only `registry.npmjs.org:443`, bound 127.0.0.1 on an ephemeral port, node built-ins only (`test/unit/footprint.test.ts` forbids runtime deps). Follow the Result/PortError conventions of `sandboxed-executor.ts` and log CONNECT targets (host only) through `appendEvent`.

### `src/adapters/sqlite/migrations/0002-run.ts`

**Analog:** `0001-initial.ts`. Pattern: `import type { Migration } from '../migrate.ts'; const sql = \`...\`;` exporting a `Migration`. The comment (line 4) states the checksum is recorded, so 0002 is forward-only and never edits 0001. `runs`, `attempts`, `checkpoints` (with `item_id`), `work_items`, `evidence`, `gate_results`, `decisions` already exist; 0002 adds `hook_reads(invocation_id, agent_id, path, digest, seq)` and any run step table. Test with `test/fault/migrations.test.ts` and `test/fixtures/db/schema-v1.sqlite` (regenerate a v2 fixture with `scripts/make-fixture-db.ts`).

### `src/cli/commands/start.ts` (controller)

**Analog:** `src/cli/commands/onboard.ts` (72 lines).

**Usage and exit codes** (lines 11-18): `EXIT_NOT_ACTIVE = 3`, `EXIT_USAGE = 64`, `EXIT_INTERNAL = 70`; `usage(io, message)` writes `avarice onboard: ...\nusage: ...` and returns 64 before anything registers.

**Budget flag parsing** (lines 20-34): `BUDGET_FLAG = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/`; repeatable `--budget name=value`; the shape is checked in the CLI, the names and lower-only rule belong to the compiler (RC-5). Extract to a shared helper rather than copy.

**Flow** (lines 36-71): validate flags (`--policy routine` required, `--brief` path), `startX(deps, ...)`, map `conflict` to exit 3 and `invalid|not_found` to 64, then `describeError` for others. For `start`, return after spawning the detached supervisor (`spawn(process.execPath, [bin,'supervise',runId],{detached:true,stdio:'ignore'}).unref()`, RESEARCH Pitfall 13); `--wait` runs the loop in-process like `onboard` does and returns 0 for `ready_for_review`, 3 otherwise. Export `run`; export `booleanFlags` for `--wait`/`--json`.

### `src/cli/commands/inbox.ts`, `status.ts`, `resume.ts`, `supervise.ts`, `install-host.ts`

**Analogs:** `status.ts` (read-only, `export const readOnly = true; export const booleanFlags = ['json'] as const;`, prints `JSON.stringify(status.value, null, 2) + '\n'` for `--json`, else `renderStatus`), and `resume.ts` (one positional ID, `not_found` to 64, `conflict` to 3 with a "lease must expire first" message, `state === 'active' ? 0 : 3`). `inbox` copies `status.ts`. `supervise` copies `resume.ts` (positional run ID, runs the lease loop). `install-host` must refuse when `AVARICE_RUN` is set (CS-11) and writes only the `avarice-run` skill. Keep every existing `--json` shape byte-identical: add `runs` only as an optional key present when a project has runs (RESEARCH Pitfall 12) and snapshot the Phase 1 output in a frozen-shape test before restyling.

### `src/cli/main.ts` (modify)

**Analog:** itself. Line 11: `export const COMMANDS = ['init','repo','onboard','status','resume','context'] as const;`. Add `start`, `supervise`, `inbox`, `install-host`. Dispatch dynamically imports `./commands/${name}.ts` and treats `ERR_MODULE_NOT_FOUND` for that exact path as "not available in this build" (lines 49-59), so the allowlist is the only change. The no-argument branch (currently `no command given`, exit 64, lines 44-47) becomes the ADR-013 shell when `stdout`/`stdin` is a TTY and `AVARICE_RUN` is unset.

### Tests

- **`test/fault/run-killpoints.test.ts`** copies `test/fault/killpoints.test.ts`: arm `AVARICE_FAULT` via `runWithFault`, assert `statusCli` shows interrupted and never `ready_for_review`, `resumeCli`, then compare `normalizeRecord` to an uninterrupted run in a second profile; survivors tracked in `after` (isAlive, `survivorPidFile`). Add `RUN_KILL_POINTS` beside `KILL_POINTS` (`test/helpers/fault-run.ts` lines 27-49), including `mid-invocation`, `mid-verify`, `mid-commit`, `mid-handoff` and counted `name#N` forms.
- **`test/helpers/fake-run-host.ts`** copies `test/helpers/fake-agent-host.ts` (test-only, nothing under `src/` may import it; options via `AVARICE_FAKE_HOST` JSON; `reapBySessionId`; writes files in cwd the way the real unit would). Add options for "edits a file", "attempts git commit", "asks a question", "crashes mid-invocation".
- **`test/containment/live-run.test.ts`** copies `live-onboarding.test.ts` (gated by `AVARICE_LIVE=1` via `{ skip: LIVE ? false : '...' }`, ground-truth verdicts from refs, tree and ledger, `recordedSpend` against `AUTHORIZED_CAP_USD`, cap lowered only via `AVARICE_LIVE_CAP_USD`), helpers in `test/helpers/live-harness.ts`. Record spend per case and cumulative against the 25 USD ceiling in `test/containment/LIVE-CASES.md` style.
- **Unit tests** copy `test/unit/outcome.test.ts` (a `facts(over: Partial<...>)` factory and `assert.deepEqual` per rule).
- **Hand-off no-touch proof:** extend `scripts/checkout-digest.ts` and `test/integration/checkout-unchanged.test.ts` (S-20, source index, HEAD and tree byte-identical; only `refs/heads/avarice/run_*` added).

## Shared Patterns

### Result and PortError
**Source:** `src/domain/result.ts` (`ok`, `err`, kinds `invalid | not_found | conflict | internal | unavailable | timeout`).
**Apply to:** every new domain, app and adapter function. No exceptions across layers; CLI maps kinds to exit codes (64 usage/not_found, 3 refused/not-ready, 70 internal).

### Checkpoint before side effect, counted fault points
**Source:** `src/app/onboarding-service.ts` lines 31-40, 86-112 and `src/app/stages/workspace.ts` line 47.
**Apply to:** all run stages and the hand-off. Each side effect (clone, `npm ci`, baseline, launch, commit, fetch) is preceded by `ctx.checkpoint('<action>')`.

### Hardened git
**Source:** `src/adapters/git/safe-git.ts` lines 19-29 (`SAFE_GIT_ENV`), 120-139 (`runGit`).
**Apply to:** clone, commit, fetch and every `git` call. Never raw `spawn('git')`, never `-c`.

### Sandboxed command execution
**Source:** `src/adapters/exec/sandboxed-executor.ts` (no unsandboxed fallback; result `unavailable` when the probe fails) and the `CommandSpec` shape in RESEARCH Code Examples (argv array, `cwd`, `env`, `timeoutMs`, `invocationId`, `writePaths`, `denyReadPaths`).
**Apply to:** `npm ci`, required checks at base and head, ONB-10 validation. Map `CommandResult.status` to evidence status as RESEARCH shows (`timed_out`/`cancelled` to `inconclusive`, spawn error to `unavailable`).

### Ledger conventions
**Source:** `src/app/budget.ts`, `src/adapters/sqlite/events.ts`.
**Apply to:** all new ledger writes. `nowMs` comes from `deps.clock.nowMs()`, IDs from `deps.ids.next('<prefix>_')`, events through `appendEvent` with `runId`, `attemptId`, `invocationId` (OPS-2), event data limited to IDs, counts, digests and short strings (limits 1024 and 8192).

### Command module contract
**Source:** `src/cli/commands/status.ts`, `onboard.ts`, `resume.ts`.
**Apply to:** each new command. Export `run`; export `readOnly` and `booleanFlags` where relevant; `usage()` refuses before any state is created; `--json` shapes frozen.

### Layering and footprint
**Source:** `scripts/check-boundaries.ts`, `test/unit/boundaries.test.ts`, `test/unit/footprint.test.ts`.
**Apply to:** all new files. Domain imports no ports or adapters, no vendor names in domain, no runtime dependency added, relative imports with `.ts` extension, `import type` for types.

### Red-then-green evidence
**Source:** Phase 1 convention (`*-red-evidence*.json` per task, per CONTEXT "Established Patterns").
**Apply to:** every task that adds behavior.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/adapters/exec/allowlist-proxy.ts` | adapter | streaming | No network service exists in the repo; use RESEARCH Pitfall 7 and keep to node built-ins |
| `src/cli/shell/*` | component | event-driven | No interactive UI exists; follow ADR-013 (`docs/decisions/ADR-013-interactive-shell.md`) with `node:readline`, raw mode and ANSI only |
| `src/cli/render/*` (OPS-7) | utility | transform | Only `renderStatus` in `src/app/status.ts` exists and `init`, `repo` and dispatcher errors do not meet OPS-7; follow `docs/extensions.md` section 1 |
| `hook_reads` read-before-edit state | middleware | request-response | CON-7 is not implemented anywhere (RESEARCH Pitfall 10); design in the plan |
| `.avarice/config.json` reader (git object read) | utility | file-I/O | No repo-conventions reader; use `runGit(['show', '<rev>:.avarice/config.json'])` through `safe-git.ts`, see RESEARCH Pitfall 6 |

## Metadata

**Analog search scope:** `src/domain`, `src/app`, `src/app/stages`, `src/adapters/{git,exec,sqlite,host-claude}`, `src/cli`, `src/hook`, `test/{unit,fault,containment,helpers}`, `scripts`.
**Files scanned:** about 130 tracked files listed; 14 read in part or in full.
**Pattern extraction date:** 2026-11-05
**Not read in full (planner should open before editing):** `src/hook/pre-tool-use.ts`, `src/app/invocation.ts` body, `src/domain/onboarding-contract.ts` lines 80-455, `src/adapters/host-claude/*`, RESEARCH.md lines 397-521 (validation architecture) which this mapping did not load.
