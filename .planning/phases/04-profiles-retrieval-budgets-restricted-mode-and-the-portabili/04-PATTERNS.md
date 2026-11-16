# Phase 4: Profiles, retrieval budgets, restricted mode and the portability proof - Pattern Map

**Mapped:** 2026-11-16
**Files analyzed:** 40 (new or modified, from 04-RESEARCH.md "Recommended Project Structure" and CONTEXT code_context)
**Analogs found:** 38 / 40 (all analog paths are git-tracked `src/`, `test/`, `scripts/` files)

Note: only lines 1-386 of RESEARCH.md were read (the Validation Architecture and Open Questions sections were not). Line numbers below were read this session.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/domain/profile.ts` (parseProfileConfig, selectProfile) | domain rule | transform | `src/domain/notify-policy.ts` (`parseProfileNotify`) + `src/domain/policy-narrowing.ts` | exact |
| `src/adapters/fs/profile-config.ts` (modify: read all sections) | adapter | file-I/O | itself (lines 13-40) | exact |
| `src/adapters/fs/profile-paths.ts` (modify: per-profile roots) | adapter | file-I/O | itself (`DEFAULT_PROFILE`, `resolveProfile`, `configPathFor`) | exact |
| `src/adapters/fs/profile-bindings.ts` | adapter | file-I/O | `src/adapters/fs/profile-config.ts` | role-match |
| `src/adapters/fs/profile-registry.ts` | adapter | file-I/O | `src/adapters/fs/profile-paths.ts` | role-match |
| `src/domain/credential-ref.ts` | domain rule | transform | `src/domain/root-rules.ts` / `notify-policy.ts` hand parsers | role-match |
| `src/ports/credential-provider.ts` | port | request-response | `src/ports/command-executor.ts`, `src/ports/artifact-store.ts` | exact |
| `src/adapters/credential/{delegated,keychain,cmd}.ts` | adapter | request-response | `src/adapters/exec/` SandboxedExecutor + `src/adapters/git/safe-git.ts` | role-match |
| `src/domain/redactor.ts` | domain rule | transform | `src/domain/secret-patterns.ts` | exact |
| `src/adapters/sqlite/events.ts` (modify: redact before hash) | adapter | CRUD | itself (lines 43-69) | exact |
| `src/adapters/host-claude/claude-host.ts` (modify: per-line redact) | adapter | streaming | itself (`redactSecrets(ran.transcript)` near line 244) | exact |
| `src/domain/action-class.ts` | domain table | transform | `src/domain/run-shell-rules.ts`, `hook-decision.ts` | role-match |
| `src/domain/policy.ts` | domain rule | transform | `src/domain/policy-narrowing.ts` | exact |
| `src/domain/approval.ts` | domain rule | transform | `src/domain/digest.ts` + `decision-policy.ts` | role-match |
| `src/app/authorize.ts` | app service | CRUD (transaction) | `src/app/decide.ts` | role-match |
| `src/cli/commands/approve.ts` | cli command | request-response | `src/cli/commands/decide.ts` + `src/cli/identity.ts` | exact |
| `src/adapters/sqlite/migrations/0004-profiles.ts` | migration | batch | `src/adapters/sqlite/migrations/0003-decisions.ts` | exact |
| `src/domain/retrieval-rules.ts` | domain table | transform | `src/domain/policy-narrowing.ts` (table + pure) | role-match |
| `src/app/context.ts` (modify: budget, caps, broadDiscovery) | app service | request-response | itself | exact |
| `src/adapters/context/gsd-graph.ts` (modify: readRule from table, line 119) | adapter | request-response | itself | exact |
| `src/adapters/context/git-files.ts`, `gsd-planning.ts` | adapter | request-response | `src/adapters/context/gsd-intel.ts` | exact |
| `src/domain/refresh-plan.ts` | domain rule | transform | `src/domain/preflight.ts` (`classifyExistingMap`) | role-match |
| `src/domain/preflight.ts` (modify: `EXISTING_MAP_OUTCOME`, line 52, 100, 146) | domain rule | transform | itself | exact |
| `src/app/refresh.ts` | app stage | batch | `src/app/stages/register.ts`, `src/app/stages/stage.ts` | role-match |
| `src/app/resume-refs.ts` | app | CRUD | `src/app/run-resume.ts` | role-match |
| `src/domain/capability-requirements.ts` | domain rule | transform | `src/ports/capability.ts` (descriptor shape) + `src/domain/runtime-support.ts` | role-match |
| `src/domain/enforcement-map.ts` | domain table | transform | `test/unit/containment-matrix.test.ts` consumer | partial |
| `src/ports/diagnostics.ts` | port | request-response | `src/ports/gsd-onboarding.ts` | role-match |
| `src/app/doctor.ts` | app read model | request-response | `src/app/status.ts` / `run-status.ts` | role-match |
| `src/cli/commands/doctor.ts` | cli command | request-response | `src/cli/commands/status.ts` | exact |
| `src/cli/composition.ts` (modify: createDoctorDeps, host choice at ~148-190) | composition | request-response | itself | exact |
| `src/cli/main.ts` (modify: selectProfile before createDeps) | cli | request-response | itself | exact |
| `src/adapters/host-claude/launch-preflight.ts` (modify: admission rule, line 24) | adapter | request-response | itself | exact |
| `src/adapters/schedule/launchd.ts`, `src/cli/spawn-supervisor.ts` (modify: env names) | adapter | file-I/O | themselves (`ENV_NAMES`, line 72, 120) | exact |
| `test/helpers/fake-remote-executor.ts`, `fake-remote-artifact-store.ts` | test helper | request-response | `test/helpers/fake-run-host.ts`, `src/adapters/fs/artifact-store.ts` | role-match |
| `test/contract/*` | test | request-response | `test/integration/*` suites | partial |
| `test/fixtures/org-acme/` | fixture | n/a | existing `test/fixtures` | role-match |
| `scripts/check-boundaries.ts` (maybe extend) | script | batch | itself + `test/unit/boundaries.test.ts` | exact |
| `docs/decisions/ADR-014*, ADR-015*`, `docs/system/*` | docs | n/a | existing ADRs and `docs/system/*` | exact |

## Pattern Assignments

### `src/domain/profile.ts` (domain rule, transform)

**Analog:** `src/domain/notify-policy.ts` (`parseProfileNotify`, `NOTIFY_DEFAULTS`) and `src/domain/policy-narrowing.ts` (pure table, header comment style, `Result` return).
Pure: no I/O, imports only `./result.ts`. Hand-written validators only (the footprint test refuses any dependency). Returns `err({ kind: 'invalid', field, reason })`.

Selection precedence (RESEARCH Pattern 2, sketch, D-16):
```typescript
export function selectProfile(i: { flag?: string; bound?: string; envDefault?: string }): Result<string> {
  if (i.bound !== undefined && i.flag !== undefined && i.flag !== i.bound) {
    return err({ kind: 'denied', rule: `repository-bound-to:${i.bound}`, enforcer: 'avarice' });
  }
  return ok(i.bound ?? i.flag ?? i.envDefault ?? DEFAULT_PROFILE);
}
```

### `src/adapters/fs/profile-config.ts` (modify) and `profile-bindings.ts`, `profile-registry.ts` (adapter, file-I/O)

**Analog:** `src/adapters/fs/profile-config.ts` lines 1-40. Copy this read discipline for every new config-home file (bindings, registry):
```typescript
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
export const MAX_PROFILE_CONFIG_BYTES = 64 * 1024;
let fd: number;
try {
  fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
} catch (e) {
  const code = (e as { code?: unknown }).code;
  if (code === 'ENOENT') return ok(structuredClone(NOTIFY_DEFAULTS));
  if (code === 'ELOOP') return err({ kind: 'invalid', field: 'config', reason: 'the profile config is a symbolic link, which is refused' });
  return err({ kind: 'unavailable', cause: `cannot read the profile config: ${typeof code === 'string' ? code : 'open failed'}` });
}
try {
  const info = fstatSync(fd);
  if (!info.isFile()) return err({ kind: 'invalid', field: 'config', reason: 'the profile config is not a regular file' });
  if (info.size > MAX_PROFILE_CONFIG_BYTES) return err({ ... });
  raw = JSON.parse(readFileSync(fd, 'utf8'));
  return parseProfileNotify(raw);   // replace with parseProfileConfig (all sections)
} finally { closeSync(fd); }
```
Generalize to return the whole parsed config, keep `notify` result byte-compatible. `configPathFor(configHome, profile)` is `join(configHome, 'profiles', profile, 'config.json')` (profile-paths.ts); `profile-registry.ts` enumerates `<configHome>/profiles/*/config.json` to build `otherProfileRoots()` (D-19). `profile-paths.ts` hard-codes `const profile = DEFAULT_PROFILE;` in `resolveProfile(env, probes)`; thread the selected profile in and apply the three env root overrides only to the selected profile (RESEARCH Pitfall 3). Realpath with `realpathNearest` / `canonicalAbsolute`.

### `src/domain/redactor.ts` (domain rule, transform)

**Analog:** `src/domain/secret-patterns.ts` (lines 14-22 patterns, 47-59 `globalOf` and `redactSecrets`). Wrap, do not duplicate:
```typescript
export function redactSecrets(text: string): string {
  let out = text.replace(PEM_BLOCK, '[REDACTED:private-key]');
  for (const { kind, pattern } of AVARICE_SECRET_PATTERNS) out = out.replace(globalOf(pattern), `[REDACTED:${kind}]`);
  return out.replace(globalOf(GSD_SECRET_REGEX), `[REDACTED:${GSD_KIND}]`);
}
```
`Redactor` class = `redactSecrets` plus seeded literal values (minimum length, shorter credentials refused). Must import nothing from cli/app (the lean hook entry loads `events.ts`).

### `src/adapters/sqlite/events.ts` (modify) (adapter, CRUD)

**Analog:** itself lines 43-69. Redact string leaves before `boundedEventJson` so the hash covers stored text:
```typescript
export function appendEventRow(db: DatabaseSync, ev: EventRowInput): EventRowReceipt {
  const dataJson = boundedEventJson(ev.data);   // -> boundedEventJson(redactLeaves(ev.data, redactor))
  const last = db.prepare('SELECT row_hash FROM events ORDER BY seq DESC LIMIT 1').get() as { row_hash: string } | undefined;
  const prevHash = last ? last.row_hash : GENESIS_HASH;
  const rowHash = sha256Hex([prevHash, ts, ev.type, ev.runId ?? '', dataJson].join('\n'));
```
Both `SqliteLedger.appendEvent` and `src/hook/pre-tool-use.ts` call it; keep the module's imports to node and domain digest helpers.

### `src/ports/credential-provider.ts` and `src/adapters/credential/*` (port + adapters, request-response)

**Analog:** `src/ports/command-executor.ts` (lines 50-54) and `src/ports/artifact-store.ts`:
```typescript
export interface CommandExecutor {
  readonly descriptor: CapabilityDescriptor;
  run(cmd: CommandSpec, signal?: AbortSignal): Promise<Result<CommandResult>>;
}
```
Port = `readonly descriptor: CapabilityDescriptor` plus a `Result`-returning method; `unauthenticated{credentialRef}` already exists in `src/domain/result.ts:10` and nothing produces it. `cmd:` helpers run through `CommandExecutor` (sandboxed), `keychain:` via `/usr/bin/security find-generic-password` through the safe spawn pattern of `src/adapters/git/safe-git.ts` (`runGit`). Each lookup appends a `credential.resolve` event with no value, length or digest.

### `src/domain/policy.ts`, `action-class.ts`, `approval.ts` (domain, transform)

**Analog:** `src/domain/policy-narrowing.ts` (header comment states rules, `PROFILE_POLICY` constant, pure functions returning accepted/rejected); digests via `src/domain/digest.ts` (`digestOf`, `canonicalJson`, `sha256Hex`). Parameter digest = `digestOf` of the canonical params. Invalid rank-1 policy returns deny for every privileged action.

### `src/app/authorize.ts` (app service, transaction)

**Analog:** `src/app/decide.ts` (ledger transaction, stale/applied outcomes `DecideOutcome`). Consume (`consumed_at`) in the same transaction that records the action start. `approvals` table (migrations/0001-initial.ts:76-83) has `idempotency_key TEXT NOT NULL UNIQUE`; derive key from `{runId, action, paramsDigest, ordinal}` (RESEARCH Pitfall 5, an Open Question).

### `src/cli/commands/approve.ts` (cli, request-response)

**Analog:** `src/cli/commands/decide.ts` (header at lines 1-22 documents exit codes 0/3/64/70; imports lines 23-40) and `src/cli/identity.ts` lines 40-53:
```typescript
import { ownsProfile, refuseOutsideTerminal, responderName } from '../identity.ts';
import { errorLine, stripControl } from '../render/style.ts';
const EXIT_NOT_APPLIED = 3;
const EXIT_USAGE = 64;
```
`refuseOutsideTerminal(env, ctx)` runs from `usage()` before the profile resolves, so a refusal reads no store; then `ownsProfile(dataRoot)` for foreign profiles. Grant recorded as `owner:<os user>` on the terminal channel.

### `src/adapters/sqlite/migrations/0004-profiles.ts` (migration, batch)

**Analog:** `src/adapters/sqlite/migrations/0003-decisions.ts`:
```typescript
import type { Migration } from '../migrate.ts';
const sql = `
ALTER TABLE ... ADD COLUMN ...;
CREATE INDEX attempts_item ON attempts (run_id, item_id);
`;
export const MIGRATION_0003: Migration = { version: 3, sql };
```
Header comment lists every column/index and states forward-only. Content: `run_id` indexes for `decisions`, `gate_results`, `notifications`, `evidence`/approvals (AC-2), optional `projects.profile_id DEFAULT 'personal-local'`. Never edit 0001-0003 (checksum). Register in the migration list; fault test in `test/fault/migrations.test.ts` (store with history, backup taken).

### `src/domain/retrieval-rules.ts`, `src/app/context.ts`, `src/adapters/context/*` (retrieval)

**Analog:** `src/ports/context-source.ts` (`ContextSource { descriptor; find(query, budget); read(handles, budget) }`, `ContextHandle.readRule?: 'descendants' | 'one-hop' | 'id-only'`) and `src/adapters/context/gsd-intel.ts` for new adapters:
```typescript
export class GsdIntelContext implements ContextSource {
  readonly descriptor: CapabilityDescriptor;
  #found = new Map<string, Found>();     // handles from latest find, so read answers without a second query
  constructor(gsd: GsdOnboarding, options: ContextAdapterOptions) { ... this.descriptor = { port: 'context-source', ... } }
```
Shared helpers: `import { currentHead, estimateTokens, freshnessAt, isCitablePath, pathExistsAtHead } from './freshness.ts';` and bounded excerpts (`MAX_EXCERPT_CHARS = 1500`, `…[cut]`). Edge-rule table: relation -> rule, unmapped defaults to `id-only`; replace the hard-coded `'one-hop'` at `gsd-graph.ts:119`. `app/context.ts`: `DEFAULT_CONTEXT_BUDGET = 4000` -> 24,000 profile bound, `MAX_CONTEXT_BUDGET = 100_000`; `PACK_BUDGET = 4000` in `src/app/run-stages/item.ts:68`; effective pack = `min(ceiling, floor((RUN_PROMPT_MAX_BYTES - contractBytes - overhead)/4))` (`src/app/run-gsd-config.ts:53`). Keep S-46 untrusted fencing; widen `PackItem.source` union for new adapters.

### `src/domain/preflight.ts` (modify) and `src/domain/refresh-plan.ts` (new)

**Analog:** `preflight.ts`. `ExistingMapClass = 'none' | 'stamped-complete' | 'stamped-partial' | 'unstamped' | 'unknown-format' | 'user-edited'` and `MapFileFacts` (lastMappedCommit, stampCommit, lastCommit) already drive `classifyExistingMap`. Replace the constant (line 52) and the outcome at line 146 with a per-class outcome function; remove the "only promotion `none` exists until Phase 4" refusal (line 100). `refresh-plan.ts` is a pure planner in the same file style (facts in, outcome out); GSD `verify codebase-drift` default threshold is 3 (`drift.cjs:202-204`).

### `src/adapters/host-claude/launch-preflight.ts` (modify, D-20)

**Analog:** itself, line 24 `ADMITTED_CLAUDE_VERSIONS` and `launchReady` input (lines 29-49), `refuse(reason)` returning `err({ kind: 'denied', rule: 'enforcement_failure:...', enforcer: 'avarice' })`, `REQUIRED_KEYS` (59-72). Replace the list with `admission(version): 'verified' | 'unverified-patch' | 'refused'` pure predicate; unverified patch must also pass sandbox probe and hook self-test. Update `test/unit/live-admission-override.test.ts`.

### `src/cli/main.ts`, `src/cli/composition.ts`, `src/cli/spawn-supervisor.ts`, `src/adapters/schedule/launchd.ts`

**Analog:** themselves. `createDeps` returns `{ ok: false, code: 70 }` on any store/profile problem (composition.ts ~152-190), so `doctor` needs a separate read-only `createDoctorDeps` (no migrate, bounded probes). Host choice at composition.ts:148, G0 at `src/app/run-stages/prepare.ts:359`, `src/app/stages/workspace.ts:122`. Add the profile name to launchd `ENV_NAMES` (launchd.ts:72, validated at :120) and `spawn-supervisor.ts:51-53`.

### `src/app/doctor.ts`, `src/ports/diagnostics.ts`, `src/cli/commands/doctor.ts`

**Analogs:** `src/app/status.ts` + `src/cli/commands/status.ts` (read model plus `--json` renderer; json keys frozen in `test/unit/json-shapes.test.ts`, regenerate deliberately with `AVARICE_SNAPSHOT_WRITE=1`). `app` must not import adapters (lint): probes come through the port, shaped like `src/ports/gsd-onboarding.ts`. Add `doctor` to `COMMANDS` in `src/cli/args.ts`.

### `test/helpers/fake-remote-executor.ts`, `fake-remote-artifact-store.ts`, `test/contract/*`

**Analogs:** `test/helpers/fake-run-host.ts`, `fake-graphify.ts` (script-per-mode, `FakeGraphifyMode` union of misbehaviours), `src/adapters/fs/artifact-store.ts` (`LocalArtifactStore`). Ports are `CommandExecutor.run` (async) and `ArtifactStore { put, get, has }` (sync; add latency with `Atomics.wait`, as in `src/hook/pre-tool-use.ts` and `test/helpers/test-cli.ts`). JSON-serialize each call; hide drops/duplicates inside the adapter (retry by `invocationId` / digest; `put` is idempotent by digest). Contract suite runs identical cases against local and fake-remote adapters.

### Migration/boundary tests

`test/unit/boundaries.test.ts` generates violation files at test time and runs `scripts/check-boundaries.ts --root-as <kind>`; extend the same way if adapter-to-adapter isolation is added.

## Shared Patterns

### Fail-closed refusals as `denied` PortError
**Source:** `src/adapters/host-claude/launch-preflight.ts` `refuse()` and `profile-config.ts` error mapping (`invalid`, `unavailable`, `denied`). **Apply to:** profile selection, policy, approvals, restricted-mode refusal (message names `--restricted`), credential `env:` refusal.

### Owner-terminal identity
**Source:** `src/cli/identity.ts:40-53`, `refuseOutsideTerminal`, `ownsProfile`. **Apply to:** `approve`, `repo add --profile`, promotion.

### Pure rule table + single-transaction enforcement + fault test
**Source:** `0002-run.ts` insert-only triggers, `0003-decisions.ts`, `src/app/decide.ts`. **Apply to:** approvals, budgets/caps counters, profile scoping.

### Hand-written parsing of untrusted JSON, `O_NOFOLLOW`, size cap
**Source:** `src/adapters/fs/profile-config.ts`. **Apply to:** bindings, registry, org package fixture.

### Safe subprocess
**Source:** `runGit` (`src/adapters/git/safe-git.ts`), `CommandExecutor`. **Apply to:** keychain/cmd credentials, disposable copy for restricted mode, adoption.

### Frozen `--json` shapes
**Source:** `test/unit/json-shapes.test.ts`. **Apply to:** every command output change (append optional keys only).

### Documentation pass
Per CLAUDE.md, final plan updates `docs/system/*` (README tables, coverage.md, findings.md, config-reference.md, data-model.md) and two ADRs; never edit proposal docs.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/domain/enforcement-map.ts` | domain table | transform | Enforcement map exists only as prose in `docs/enterprise-adaptation.md`; use that doc and `test/unit/containment-matrix.test.ts` as the consumer shape |
| `test/contract/*` | contract suite | request-response | No suite runs one case set against two adapter implementations yet; use RESEARCH Pattern 4 |

## Metadata

**Analog search scope:** `src/{domain,ports,app,adapters,cli,hook}`, `test/{helpers,unit,fault,integration}`, `scripts/`
**Files scanned:** about 25 read in full or in part; directory listings for the rest
**Pattern extraction date:** 2026-11-16
