# Walking Skeleton — AVARICE

**Phase:** 1 (slice 0, contained onboarding of one repository)
**Generated:** 2026-11-01
**Adapted for:** a local TypeScript CLI and library. There is no UI, route or deployment; the "stack" is CLI → application service → domain → ports → adapters (SQLite, git, GSD, Claude Code, sandbox).

This file is the contract every Phase 1 plan builds on. Plans cite it as `SKELETON.md §<section>`. Changing a decision here after plans 01-01 to 01-05 land is a deliberate act: say so in the plan that changes it.

## Capability Proven End-to-End

A developer runs `avarice onboard --policy onboarding <repo>` and, after the ledger, lifecycle, preflight, onboarding contract, staging worktree, AgentHost invocation (fake in the skeleton), validation and activation have run, `avarice status` shows an `active` project record offline; a SIGKILL at any committed step followed by `avarice resume <onboardingId>` reaches the same record.

The real contained Claude Code host replaces the fake host in plan 01-15 behind the same `AgentHost` port; the production entry `bin/avarice.ts` can never select the fake host.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node `>=22.22.3` (`engines`), dev machine 26.9.0; runtime probe requires bundled SQLite at or above 3.51.3 (or 3.50.7 / 3.44.6 in those lines) | Owner decision 2026-11-01; WAL-reset fix (spike); type stripping unflagged on 22.22.3 |
| Language | TypeScript, erasable syntax only, run directly by Node type stripping; `tsc -p .` is a check, never a build | ADR-001; no build step in Phase 1 (Pitfall 8: no stripping under `node_modules`, so install is a clone) |
| Runtime dependencies | None. Dev only: `typescript@7.0.2`, `@types/node@22.20.5` (pinned exact, installed with `--ignore-scripts` after the legitimacy checkpoint in 01-01) | NFR-1; Package Legitimacy Audit |
| Persistence | One `node:sqlite` database per profile at `{dataRoot}/state.db`, WAL, `synchronous=FULL`, `timeout: 5000`; every write is a `BEGIN IMMEDIATE` transaction; forward-only checksummed migrations | ADR-003, NFR-5, NFR-9 |
| Schema | Migration `0001-initial` = the full "Persisted entities" DDL of `docs/contracts-and-state.md` (including `budgets`, `decisions`, `work_items`) plus two AVARICE operational tables: `projects` (registration) and `onboarding_steps` (per-step results), plus immutability triggers on `project_records` and `contracts` and an append-only trigger on `events` | One schema version serves slices 0 and 1; changes after 01-01 need migration 0002 (rated `costly`) |
| Module layout | `src/domain` (pure), `src/ports` (interfaces), `src/app` (use cases, stages), `src/adapters/*` (sqlite, git, gsd, host-claude, exec, graph, fs, context, host), `src/hook` (lean hook entry), `src/cli` (args, composition root, one file per command) | ADR-004, architecture.md dependency direction |
| Import boundary | `scripts/check-boundaries.ts` (zero dependencies): `src/domain` imports only `src/domain` and `node:crypto`, uses no `process`; `src/ports` imports only `src/domain`/`src/ports`; `src/app` imports no adapter and no `src/cli`; dynamic `import()`/`require()` with a non-literal argument and `createRequire` fail everywhere under `src/domain`, `src/ports`, `src/app` | NFR-3 (TypeScript 7 has no JS API, so no `ts.*` walker) |
| Vendor code placement | Anything that names Claude Code flags, settings keys, tool names or stream-json shapes lives in `src/adapters/host-claude` or `src/hook`; the domain sees normalized types only (`InvocationScope`, `NormalizedToolCall`, `OutcomeFacts`) | NFR-3 forbids agent-vendor APIs in domain code |
| CLI entry | `bin/avarice.ts` with shebang `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`; `main(argv, overrides?)` in `src/cli/main.ts`; commands load from `src/cli/commands/{name}.ts` through the allowlist constant `COMMANDS = ['init','repo','onboard','status','resume','context']`, so later plans add a command file without editing `main.ts` | Parallel plans never share `main.ts` |
| Fake host | `test/helpers/fake-agent-host.ts` only; injected through `test/helpers/test-cli.ts` calling `main(argv, { host })` | A production path to an "active" record built from fixtures must not exist |
| Production host before 01-15 | `src/adapters/host/unavailable-host.ts`, descriptor `enforcement: 'none'`; onboarding reaches `blocked` with reason `enforcement_failure` and never invokes | ONB-12, CON-3 fail closed from day one |
| Staging | Strategy constant in `src/adapters/git/staging-strategy.ts`; skeleton = `git worktree add --detach {workRoot}/{onb}/staging {pin}` then branch `avarice/onboard-{onb}`; plan 01-08 confirms or switches to `git clone --local --no-hardlinks` after spike S0-B and the owner's decision | Spec default; `.git` exposure is open question 2 |
| Safe git | Every git subprocess (and the env inherited by the host) carries `GIT_CONFIG_COUNT=2`, `GIT_CONFIG_KEY_0=core.hooksPath` / `GIT_CONFIG_VALUE_0=/dev/null`, `GIT_CONFIG_KEY_1=core.fsmonitor` / `GIT_CONFIG_VALUE_1=false`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`; argv arrays only, never shell strings | ONB-4, research Pattern 4 (verified) |
| Roots | Config `{configHome}/profiles/{profile}/config.json` (default `~/.config/avarice`); data root `~/.local/share/avarice/{profile}`; work root `~/.local/share/avarice-work/{profile}` (sibling, never nested either way); none may resolve under a `~/.claude*` directory or under `realpath($CLAUDE_CONFIG_DIR)`; dirs `0700`, files `0600`; env overrides `AVARICE_CONFIG_HOME`, `AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT` (non-policy keys) | Spike: sandboxed writes under `~/.claude*` fail; a `Read` deny on the data root must not cover worktrees |
| Config dir | `CLAUDE_CONFIG_DIR` from the environment, default `~/.claude`; never a hard-coded path. gsd-core located by probing `GSD_HOME`, `$CLAUDE_CONFIG_DIR/gsd-core`, `~/.claude/gsd-core`, accepted only when `runtime-identity --raw` reports `@opengsd/gsd-core` 1.17.x | Owner decision 2026-11-01; research Pitfall 1 |
| IDs | ULID on `node:crypto` (48-bit ms time, 80 random bits, Crockford base32); prefixes `proj_`, `onb_`, `run_`, `inv_`, `att_`, `ckp_` | contracts-and-state.md correlation identifiers |
| Digests | `sha256:` + hex of SHA-256 over canonical JSON (sorted keys, no whitespace) for records and contracts; raw bytes for files | Deterministic record equality in the kill-point suite |
| Events | `events` rows with `row_hash = sha256(prev_hash + "\n" + ts + "\n" + type + "\n" + (run_id or "") + "\n" + data_json)`, genesis `prev_hash` = 64 zeros; `data_json` holds IDs, counts, digests, exit codes, never payloads | ops doc "Log integrity limits"; V7 |
| Test runner | `node:test` + `node:assert/strict`; quoted globs only (`node --test "test/unit/**/*.test.ts"`), never a bare directory (Pitfall 9); live tiers skip unless `AVARICE_LIVE=1` | 01-VALIDATION.md |

## Interfaces (names every plan uses)

### Onboarding lifecycle (`src/domain/onboarding-lifecycle.ts`)

- `OnboardingState`: `unregistered | discovered | contract_proposed | mapping | paused | validating | validation_failed | planning | planning_ready | active | stale | incompatible | blocked | deactivated`.
- `BlockedReason`: `enforcement_failure | budget_exhausted | existing_state_conflict | scope_unavailable | adapter_incompatible | decision`.
- `TRANSITIONS`: the edges of the lifecycle diagram in `docs/repository-onboarding.md`, plus every non-terminal pre-activation state (`discovered`, `contract_proposed`, `mapping`, `paused`, `validating`, `validation_failed`, `planning`, `planning_ready`) to `blocked`, plus `discovered → incompatible` and `contract_proposed → incompatible` (S-36: GSD outside the adapter range).
- `assertTransition(from, to): Result<void>`; `isStopState(s)` is true for `active`, `blocked`, `incompatible`, `deactivated`.
- Next actions written to `checkpoints.next_action`: `compile-contract` (discovered), `prepare-workspace` → `configure-gsd` → `verify-enforcement` (contract_proposed), `launch:map` (mapping), `reconcile-invocation` (paused), `validate` (validating), `retry-or-block` (validation_failed), `index:code-graph` → `index:intel` → `index:knowledge` → `activate` (planning_ready).

### Kill points (`src/app/onboarding-service.ts`)

Generic, so no stage file carries fault code: after every committed transition `faultPoint('after-transition:' + to)` and after every committed checkpoint `faultPoint('after-checkpoint:' + nextAction)`; `faultPoint(name)` calls `process.kill(process.pid, 'SIGKILL')` when `process.env.AVARICE_FAULT === name`. `mid-invocation` is a fake-host option (`killAfterFiles`), not production code. Research's catalog maps as: after-register = `after-transition:discovered`; after-contract-store = `after-transition:contract_proposed`; after-worktree-add = `after-checkpoint:configure-gsd`; before-launch = `after-transition:mapping`; after-invocation-before-validate = `after-transition:validating`; mid-validate = `after-checkpoint:validate`; before-activate-commit = `after-checkpoint:activate`; after-index-code-graph = `after-checkpoint:index:intel`.

### Ports (`src/ports/*.ts`)

- `capability.ts`: `CapabilityDescriptor { port, adapter, version, capabilities, attributes?, extensions?, offline }` (spec shape; `attributes.enforcement` is `'enforced' | 'restricted' | 'none'`).
- `ledger.ts`: `Ledger` with onboarding methods `registerProject`, `findProject`, `listProjects`, `createOnboarding`, `getOnboarding`, `listOnboardings`, `acquireLease`, `renewLease`, `releaseLease`, `transitionOnboarding`, `recordCheckpoint`, `latestCheckpoint`, `storeContract`, `getContract`, `recordStepResult`, `getStepResults`, `recordAttempt`, `listAttempts`, `insertRecordAndActivate`, `getActiveRecord`, `appendEvent`, `recordArtifact`, `upsertAdapterConfig`; plan 01-12 adds `createBudgets`, `reserveBudget`, `chargeBudget`, `getBudgets`.
- `agent-host.ts`: `AgentHost { descriptor; invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> }`; `InvocationRequest { onboardingId, runId, invocationId, purpose: 'map' | 'intel' | 'knowledge', contractVersion, contractDigest, prompt, cwd, model, costCapUsd, wallClockMs }` (01-15 adds `scope: InvocationScope`); `InvocationOutcome { sessionId, kind: 'progressed' | 'paused' | 'denied' | 'budget_exhausted' | 'failed' | 'no_progress' | 'inconclusive', permissionDenials, costUsd, durationMs, headBefore, headAfter, transcriptArtifact?, question? }`.
- `staging-workspace.ts`: `StagingWorkspace { prepare(input): Result<StagingInfo>; head(path); changes(path, pin): Result<{ modified, added, deleted }>; describe(path, pin): Result<WorkspaceDescription>; listTracked(path, pin): Result<string[]>; read(path, relPath, maxBytes): Result<string | null>; ensureDir(path, relPath): Result<void>; inspectRepo(repoPath): Result<RepoFacts>; }` (`inspectRepo` is read-only: root, root commit, pin, dirty names; 01-08 widens the facts) (app code reaches staging files only through this port; adapters are the only code that touches the filesystem, per architecture.md); `StagingInfo { path, branch, strategy: 'worktree' | 'clone' }`; `WorkspaceDescription { topLevelEntries, planningEntries, gitPaths, repoReadAllow }`.
- `artifact-store.ts`: `ArtifactStore { put(bytes, meta): Result<{ digest, size }>; get(digest); has(digest) }`.
- Added later: `gsd-onboarding.ts` (01-09), `command-executor.ts` (01-13), `context-source.ts` (01-17).

### Application (`src/app`)

- `deps.ts`: `AppDeps { ledger, host, staging, artifacts, clock, ids, profile, gsd?, executor?, graphify? }`.
- `onboarding-service.ts`: `runOnboarding(deps, onboardingId)` acquires the lease, then loops: read state → run the stage for that state → stop on `isStopState`. Each stage writes a checkpoint naming its side effect, performs it, then commits the transition.
- Stages: `src/app/stages/{register,contract,workspace,map,validate,index-stage,activate}.ts`. Index steps (01-14): `index-steps.ts` lists `index-code-graph.ts`, `index-intel.ts`, `index-knowledge.ts`; each returns `IndexStepResult { index, status: 'present' | 'absent', reason?, result? }` stored with `recordStepResult`; an absent index never blocks (ONB-13).

## Data and Work Root Layout

```text
{dataRoot}/state.db                          ledger (WAL)
{dataRoot}/artifacts/{sha[0:2]}/{sha}        content-addressed blobs (temp file + fsync + rename)
{dataRoot}/backups/pre-migration-{ts}.db     VACUUM INTO before applying a migration to an existing store
{dataRoot}/onboard/{onb}/{purpose}-{inv}/    host-settings.json, hook-policy.json, agents.json, mcp.json, plugin/ (01-11, 01-15)
{workRoot}/{onb}/staging/                    staging worktree or clone at the pin
{workRoot}/{onb}/graph-build/                graphify extract output (01-14 via the 01-13 graph tool), outside staging
```

Contained invocations write only inside `{workRoot}/{onb}/staging/.planning/codebase`, `.planning/intel` or `.avarice-knowledge` (one per purpose). AVARICE itself writes `.planning/config.json` (through `gsd_run config-set`) and `.planning/graphs/` in staging. Nothing is written to the user's checkout (promotion `none`).

## Stack Touched in Phase 1

- [ ] Project scaffold: `package.json` (`type: module`, `engines`, `bin`), `tsconfig.json`, boundary script, `node --test`
- [ ] CLI entry and composition root with one real command path (`onboard`, `status`)
- [ ] Ledger: one real write path (transition + checkpoint + event in one transaction) and one real read path (`status`)
- [ ] git: staging worktree at a pinned SHA with hooks neutralized
- [ ] AgentHost port: fake in tests, unavailable in production until 01-15
- [ ] Validation and activation producing an immutable `project_records` version
- [ ] Resume after SIGKILL (01-06)
- [ ] Tracer slices: `status` end to end (01-03), onboarding end to end with the fake host (01-05)
- [ ] Documented local full-stack run: `bin/avarice init && bin/avarice onboard --policy onboarding <repo> && bin/avarice status`

## Out of Scope (Deferred to Later Slices)

- Remote workers, NAS, dashboard, `doctor`, profiles beyond `personal-local`, restricted mode (Phase 4+)
- Planning initialization through `/gsd-ingest-docs`, adoption of existing stamped maps, path-scoped and incremental refresh, promotion `copy` and `commit` (Phase 4)
- Active validation of repository commands (ONB-10, Phase 2); run contracts, `avarice start`, decisions, gates (Phases 2-3)
- `@anthropic-ai/sandbox-runtime` (Phase 2 spike); `oxlint`; a bundled JavaScript build
- `graphify merge-graphs` (replaced by the AVARICE merge, spike decision)

## Subsequent Slice Plan

Each later phase adds one vertical slice on this skeleton without changing the decisions above:

- Phase 2: `avarice start --brief b.md --policy routine` runs one work item to `ready_for_review` or `blocked_on_decision` on the same ledger, contract compiler, settings generator, hook and host adapter
- Phase 3: decisions, independent work around them, `decide`, contract amendments
- Phase 4: profiles, handle-first retrieval with caps, restricted mode, `doctor`, adoption and refresh of existing maps, portability proof
- Phase 5: delivery to a draft PR, mutation gate, architecture model, dashboard, backup

## Phase 1 Plan Index

| Plan | Wave | Slice delivered |
|---|---|---|
| 01-01 | 1 | Toolchain gates and pure domain contracts (interface-first) |
| 01-02 | 1 | Wave 0 live spikes S0-A..S0-G (authorized spend) |
| 01-03 | 2 | Tracer: `bin/avarice status` on a migrated ledger; complete onboarding Ledger |
| 01-04 | 2 | Staging worktree with safe git, artifact store, fail-closed unavailable host |
| 01-05 | 3 | Tracer: onboard (fake host) → active → status; fail-closed production path |
| 01-06 | 4 | Resume, leases, kill-point suite, migration safety |
| 01-07 | 4 | `init`, root rules, runtime probe, AC-1 timing, offline suite |
| 01-08 | 4 | Staging strategy decision, safe git hardening, preflight, ONB-6 detection and refusal, `repo add` |
| 01-09 | 4 | GSD 1.17 adapter: locate, identity, probe, configure, stamp, mapping mode |
| 01-10 | 4 | Full validation, completeness labels, record builder, narrowing, snapshot |
| 01-11 | 4 | Bash strategy decision, invocation scope, Claude settings, env, launch line, agents, plugin, launch preflight |
| 01-12 | 5 | PreToolUse/PostToolUse/ConfigChange hook and persisted budgets |
| 01-13 | 5 | Sandboxed executor, sandboxed GSD verbs, graph tool adapter |
| 01-14 | 6 | Index step registry, code-only graph step, final scope check |
| 01-15 | 6 | Contained Claude Code host adapter, outcome classifier, hook self-test, orphan reaping (spend-free SC3) |
| 01-16 | 7 | Live containment suite T3 on a scratch repository (authorized spend) |
| 01-17 | 7 | Intel index step, `gsd-intel` and `gsd-graph` adapters, `avarice context` |
| 01-18 | 7 | Knowledge pass, AVARICE graph merge, document-node validation |
| 01-20 | 8 | Mutation and adversarial testing of the containment, validation and ledger units (FC-1 to FC-12); runs before the exit run |
| 01-19 | 9 | Rehearsal and exit run on `~/aa-phan-portfolio-v2` with kill and resume (T4), AC-1 recorded |
