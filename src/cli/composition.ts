// Composition root: resolves the profile, opens and migrates the ledger, builds the dependencies.
// A refusal or failure here is returned as { ok: false, code, message }; main prints the message to
// stderr and exits with the code. Plans after 01-03 add their adapters and refusals in this file.
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../domain/ids.ts';
import type { IdPrefix } from '../domain/ids.ts';
import { describeError, openDb } from '../adapters/sqlite/db.ts';
import type { Db } from '../adapters/sqlite/db.ts';
import { migrate, pendingMigrations } from '../adapters/sqlite/migrate.ts';
import type { Migration } from '../adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../adapters/sqlite/migrations/0001-initial.ts';
import { MIGRATION_0002 } from '../adapters/sqlite/migrations/0002-run.ts';
import { MIGRATION_0003 } from '../adapters/sqlite/migrations/0003-decisions.ts';
import { MIGRATION_0004 } from '../adapters/sqlite/migrations/0004-profiles.ts';
import { SqliteLedger } from '../adapters/sqlite/ledger.ts';
import { configPathFor, realpathNearest, resolveProfile } from '../adapters/fs/profile-paths.ts';
import { knownProfileRoots } from '../adapters/fs/profile-registry.ts';
import { readProfileNotify } from '../adapters/fs/profile-config.ts';
import { backfillBindings } from '../adapters/fs/profile-bindings.ts';
import { readOrganizationPolicy, readRepositoryPolicy } from '../adapters/fs/policy-sources.ts';
import { CmdProvider } from '../adapters/credential/cmd.ts';
import { DelegatedProvider } from '../adapters/credential/delegated.ts';
import { KeychainProvider } from '../adapters/credential/keychain.ts';
import { LocalNotifier } from '../adapters/notify/local-notifier.ts';
import { LocalArtifactStore } from '../adapters/fs/artifact-store.ts';
import { RedactingArtifactStore } from '../adapters/fs/redacting-artifact-store.ts';
import { processRedactor } from '../adapters/redaction/process-redactor.ts';
import { createStagingWorkspace, STAGING_STRATEGY } from '../adapters/git/staging-strategy.ts';
import { GitRunSource } from '../adapters/git/run-source.ts';
import { CloneRunWorkspace } from '../adapters/git/run-workspace.ts';
import { AllowlistEgressProxy } from '../adapters/exec/allowlist-proxy.ts';
import { SandboxedExecutor } from '../adapters/exec/sandboxed-executor.ts';
import { GitFilesContext } from '../adapters/context/git-files.ts';
import { GsdGraphContext } from '../adapters/context/gsd-graph.ts';
import { GsdIntelContext } from '../adapters/context/gsd-intel.ts';
import { GsdPlanningContext } from '../adapters/context/gsd-planning.ts';
import { GraphifyTool, findGraphifyBinary } from '../adapters/graph/graphify.ts';
import { UnavailableAgentHost } from '../adapters/host/unavailable-host.ts';
import { ClaudeHostAdapter } from '../adapters/host-claude/claude-host.ts';
import { fingerprintGsdPreamble } from '../adapters/gsd/preamble.ts';
import { GsdOnboardingAdapter } from '../adapters/gsd/gsd-onboarding.ts';
import { locateGsdCore } from '../adapters/gsd/locate.ts';
import type { LocatedGsd } from '../adapters/gsd/locate.ts';
import { parseContextAdapters, parseKnowledgePass } from '../domain/context-adapters.ts';
import { parseCredentialSection, providersFor } from '../domain/credential-ref.ts';
import type { CredentialSection, ProviderName } from '../domain/credential-ref.ts';
import { DEFAULT_TRANSCRIPT_RETENTION, parseRetentionSection } from '../domain/redactor.ts';
import type { TranscriptRetention } from '../domain/redactor.ts';
import { digestOf } from '../domain/digest.ts';
import { parsePolicyFile, policySources } from '../domain/policy.ts';
import type { PolicyFile, PolicySources } from '../domain/policy.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { LIMIT_DEFAULTS, parseLimitsSection } from '../domain/resource-bounds.ts';
import { NOTIFY_DEFAULTS } from '../domain/notify-policy.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { ArtifactStore } from '../ports/artifact-store.ts';
import type { CredentialProvider } from '../ports/credential-provider.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { Notifier } from '../ports/notifier.ts';
import type { StagingWorkspace } from '../ports/staging-workspace.ts';
import type { CommandExecutor } from '../ports/command-executor.ts';
import type { EgressProxy } from '../ports/egress-proxy.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../ports/gsd-onboarding.ts';
import type { GsdOnboarding } from '../ports/gsd-onboarding.ts';
import type { AppDeps, Clock, GsdProblem, IdSource, NotifyDeps, ProfilePaths } from '../app/deps.ts';
import { resolveCredential } from '../app/credentials.ts';

export const MIGRATIONS: readonly Migration[] = [MIGRATION_0001, MIGRATION_0002, MIGRATION_0003, MIGRATION_0004];
export const EXIT_INTERNAL = 70;

export interface DepsOverrides {
  clock?: Clock;
  ids?: IdSource;
  // Replaces the production host. Only test entry points pass this; bin/avarice.ts never does, so the production
  // path always runs the contained ClaudeHostAdapter (when it is admitted) or the fail-closed UnavailableAgentHost.
  host?: AgentHost;
  // Replaces the restricted host (plan 04-23). Only test entry points pass this; bin/avarice.ts never does.
  restrictedHost?: AgentHost;
  // Replaces the sandboxed executor. Only test entries pass this (a test that already runs inside a sandbox,
  // where `sandbox-exec` cannot nest); bin/avarice.ts never does, so production always runs SandboxedExecutor.
  executor?: CommandExecutor;
  // Replaces the allowlisting egress proxy. Only test entries pass this (a test whose registry is a local server on a port the conventions
  // cannot name); bin/avarice.ts never does, so production always runs the in-repo allowlist proxy.
  egress?: EgressProxy;
  // Replaces the local osascript notifier. Only test entries pass this (so a test never posts a real banner); bin/avarice.ts never
  // does, so production always runs LocalNotifier with the path from the profile config.
  notifier?: Notifier;
}

export interface CreateDepsOptions {
  // Open the store read-only (after making sure it is migrated). Used by status.
  readOnly?: boolean;
  // Locate GSD even though the store is read-only: a command that only reads the indexes through GSD's own readers
  // (`context`) needs the adapter but records nothing.
  gsd?: boolean;
  // The profile main() selected (D-16); a name that follows the profile grammar. Absent means personal-local.
  profile?: string;
}

export interface Composition {
  deps: AppDeps;
  close(): void;
}

export type CompositionResult = { ok: true; value: Composition } | { ok: false; code: number; message: string };

function failure(what: string, message: string): CompositionResult {
  return { ok: false, code: EXIT_INTERNAL, message: `${what}: ${message}` };
}

// The profile a store was created for (meta.profile_id, written by migrate), or undefined for a store that has none yet.
function storeProfile(db: Db): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'profile_id'").get() as { value?: unknown } | undefined;
    return typeof row?.value === 'string' ? row.value : undefined;
  } catch {
    return undefined;
  }
}

// A store belongs to the profile it was created for (D-18, T-04-19): one that names another profile is closed untouched, before any
// migration, backup or record write, so a store copied or pointed at between profiles is never read or changed under the wrong one.
function refuseForeignStore(db: Db, dbPath: string, selected: string): CompositionResult | undefined {
  const owner = storeProfile(db);
  if (owner === undefined || owner === selected) return undefined;
  db.close();
  const shown = owner.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 64);
  return { ok: false, code: EXIT_INTERNAL, message: `store at ${dbPath} belongs to profile ${shown}, not ${selected}; run it under that profile (--profile ${shown}) or point the roots at a store of ${selected}` };
}

interface BasePolicy {
  organization: Result<PolicyFile> | 'absent';
  user?: PolicyFile;
}

// The file and the rules the profile's `policy` section holds: `organizationFile` names the rank-1 file, and the rest of the section
// (`schema`, `rules`) is the user's own policy.
function readBasePolicy(profile: ProfilePaths): Result<BasePolicy> {
  const section = profile.config.sections.policy;
  if (section !== undefined && (typeof section !== 'object' || section === null || Array.isArray(section))) {
    return err({ kind: 'invalid', field: 'policy', reason: 'expected an object in the profile config' });
  }
  const { organizationFile, ...own } = (section ?? {}) as Record<string, unknown>;
  let organization: BasePolicy['organization'] = 'absent';
  // Only an enterprise profile has an organization file (SEC-4): a personal profile that names one does not read it.
  if (profile.class === 'enterprise' && organizationFile !== undefined) {
    if (typeof organizationFile !== 'string' || organizationFile === '' || organizationFile.length > 1024 || /[\u0000-\u001f\u007f-\u009f]/.test(organizationFile)) {
      return err({ kind: 'invalid', field: 'policy.organizationFile', reason: 'expected a path without control characters' });
    }
    const read = readOrganizationPolicy(resolve(dirname(configPathFor(profile.configHome, profile.profile)), organizationFile));
    organization = !read.ok && read.error.kind === 'not_found' ? 'absent' : read;
  }
  if (Object.keys(own).length === 0) return ok({ organization });
  const user = parsePolicyFile(own, 'user');
  if (!user.ok) return user;
  return ok({ organization, user: user.value });
}

// AppDeps.policy: the organization file and the user section are read at the first call and kept, so a file edited while a command runs
// applies from the next command (SEC-4); a repository's policy is read at its pin, which no later edit can change, and kept by pin.
function policyLoader(profile: ProfilePaths): AppDeps['policy'] {
  let base: Result<BasePolicy> | undefined;
  const repositories = new Map<string, Result<PolicyFile | null>>();
  return (repo) => {
    base ??= readBasePolicy(profile);
    if (!base.ok) return base;
    const input: Record<string, unknown> = { profileClass: profile.class, organization: base.value.organization };
    if (base.value.user !== undefined) input['user'] = base.value.user;
    if (repo !== undefined) {
      const key = `${repo.path}\0${repo.pin}`;
      let read = repositories.get(key);
      if (read === undefined) {
        read = readRepositoryPolicy(repo.path, repo.pin);
        repositories.set(key, read);
      }
      if (!read.ok) return read;
      if (read.value !== null) input['repository'] = read.value;
    }
    return policySources(input);
  };
}

export function systemClock(): Clock {
  return { nowMs: () => Date.now() };
}

export function systemIds(clock: Clock): IdSource {
  return { next: (prefix: IdPrefix) => newId(prefix, clock.nowMs(), randomBytes(10)) };
}

// The first executable file named `name` on `pathEnv`, or undefined.
export function locateOnPath(name: string, pathEnv: string | undefined): string | undefined {
  for (const dir of (pathEnv ?? '').split(':')) {
    if (dir === '') continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

interface HostInputs {
  env: NodeJS.ProcessEnv;
  home: string;
  dataRoot: string;
  located: LocatedGsd | undefined;
  ledger: Ledger;
  artifacts: ArtifactStore;
  staging: StagingWorkspace;
  // What a run keeps of the host transcript: the profile's `retention.transcripts` (D-14).
  transcripts: TranscriptRetention;
}

// The production host: the contained Claude Code adapter when everything it needs is present and admitted (a
// `claude` from AVARICE_CLAUDE_BIN or PATH at an admitted version, the sandbox, the hook entry from
// AVARICE_HOOK_ENTRY or this checkout, an admitted gsd-core with its shim preamble), otherwise the host that refuses,
// with the reason recorded in its descriptor (ONB-12, CON-3, SC3).
function productionHost(inputs: HostInputs): AgentHost {
  const { env, home, dataRoot, located } = inputs;
  if (located === undefined) return new UnavailableAgentHost('no admitted gsd-core');
  const claudeBin = env['AVARICE_CLAUDE_BIN'] !== undefined && env['AVARICE_CLAUDE_BIN'] !== '' ? env['AVARICE_CLAUDE_BIN'] : locateOnPath('claude', env['PATH']);
  if (claudeBin === undefined) return new UnavailableAgentHost('claude was not found (set AVARICE_CLAUDE_BIN or put it on PATH)');
  const hookEntry = env['AVARICE_HOOK_ENTRY'] !== undefined && env['AVARICE_HOOK_ENTRY'] !== '' ? env['AVARICE_HOOK_ENTRY'] : fileURLToPath(new URL('../hook/pre-tool-use.ts', import.meta.url));
  const preamble = fingerprintGsdPreamble(located.gsdCoreDir);
  if (!preamble.ok) return new UnavailableAgentHost('the GSD shim preamble was not found in the located gsd-core');
  // The same rule as effectiveHostConfigDir (src/cli/host-config-dir.ts), which a run records at start and every supervisor of it is launched with; the two must agree.
  const configDir = env['CLAUDE_CONFIG_DIR'] !== undefined && env['CLAUDE_CONFIG_DIR'] !== '' ? env['CLAUDE_CONFIG_DIR'] : join(home, '.claude');
  const adapter = new ClaudeHostAdapter({
    claudeBin,
    hookEntry,
    ledgerPath: join(dataRoot, 'state.db'),
    dataRoot,
    gsd: { gsdCoreDir: located.gsdCoreDir, agentsDir: join(located.gsdCoreDir, '..', 'agents'), skillsRoot: join(configDir, 'skills'), configDir, preamble: preamble.value },
    artifacts: inputs.artifacts,
    staging: inputs.staging,
    countHookDenies: (invocationId) => inputs.ledger.countHookDenials(invocationId),
    env,
    transcripts: inputs.transcripts,
  });
  const attributes = adapter.descriptor.attributes ?? {};
  return attributes['enforcement'] === 'enforced' ? adapter : new UnavailableAgentHost(restrictedHint(attributes['reason'] ?? 'the host adapter is not enforced'));
}

// What the refusal of a host that cannot be contained says (plan 04-23; D-12, S-22): the cause, and the one way to still get analysis and planning out of the run.
// Only a `claude` that is there and failed its containment probes (an unadmitted version, no sandbox, no hook) gets it: with no claude, no gsd-core or no preamble
// restricted mode has nothing to run on either. The wording is a stored contract of the CLI (`enforcement: restricted`, `--restricted`).
export function restrictedHint(cause: string): string {
  return `enforcement: restricted (${cause}); rerun with --restricted for analysis and planning only`;
}

// The host of a restricted run (plan 04-23; CON-4, D-12): the Claude Code adapter in restricted mode. It needs a `claude` and the located gsd-core (the run's hook policy
// and settings are generated the same way), and no admitted version, sandbox or hook: restricted mode is what a host that cannot be contained is for. Building it executes
// nothing: the adapter probes `claude --help` when its descriptor is first read, so a command that never reads it never spawns `claude` for it. A missing piece gives the
// host that refuses, with the reason.
function productionRestrictedHost(inputs: HostInputs): AgentHost {
  const { env, home, dataRoot, located } = inputs;
  if (located === undefined) return new UnavailableAgentHost('no admitted gsd-core');
  const claudeBin = env['AVARICE_CLAUDE_BIN'] !== undefined && env['AVARICE_CLAUDE_BIN'] !== '' ? env['AVARICE_CLAUDE_BIN'] : locateOnPath('claude', env['PATH']);
  if (claudeBin === undefined) return new UnavailableAgentHost('claude was not found (set AVARICE_CLAUDE_BIN or put it on PATH)');
  const hookEntry = env['AVARICE_HOOK_ENTRY'] !== undefined && env['AVARICE_HOOK_ENTRY'] !== '' ? env['AVARICE_HOOK_ENTRY'] : fileURLToPath(new URL('../hook/pre-tool-use.ts', import.meta.url));
  const preamble = fingerprintGsdPreamble(located.gsdCoreDir);
  if (!preamble.ok) return new UnavailableAgentHost('the GSD shim preamble was not found in the located gsd-core');
  const configDir = env['CLAUDE_CONFIG_DIR'] !== undefined && env['CLAUDE_CONFIG_DIR'] !== '' ? env['CLAUDE_CONFIG_DIR'] : join(home, '.claude');
  return new ClaudeHostAdapter({
    mode: 'restricted',
    claudeBin,
    hookEntry,
    ledgerPath: join(dataRoot, 'state.db'),
    dataRoot,
    gsd: { gsdCoreDir: located.gsdCoreDir, agentsDir: join(located.gsdCoreDir, '..', 'agents'), skillsRoot: join(configDir, 'skills'), configDir, preamble: preamble.value },
    artifacts: inputs.artifacts,
    staging: inputs.staging,
    countHookDenies: (invocationId) => inputs.ledger.countHookDenials(invocationId),
    env,
    transcripts: inputs.transcripts,
  });
}

// The providers of the credential broker (SEC-2, D-17): exactly those the profile's class allows, each built once. The cmd provider runs its
// approved helpers through the same sandboxed executor as every other command AVARICE starts.
function credentialProviders(profile: ProfilePaths, section: CredentialSection, executor: CommandExecutor, env: NodeJS.ProcessEnv, home: string): Partial<Record<ProviderName, CredentialProvider>> {
  const providers: Partial<Record<ProviderName, CredentialProvider>> = {};
  for (const name of providersFor(profile.profile)) {
    if (name === 'keychain') providers.keychain = new KeychainProvider({ home });
    else if (name === 'cmd') providers.cmd = new CmdProvider({ executor, helpers: section.helpers, cwd: profile.workRoot, home });
    else providers.delegated = new DelegatedProvider(env['PATH'] !== undefined ? { pathEnv: env['PATH'] } : {});
  }
  return providers;
}

export function createDeps(env: NodeJS.ProcessEnv, overrides: DepsOverrides = {}, options: CreateDepsOptions = {}): CompositionResult {
  const resolved = resolveProfile(env, {}, options.profile);
  if (!resolved.ok) return failure('cannot prepare the profile directories', describeError(resolved.error));
  // D-19: the roots every run sandbox of this profile denies beside the default parents, read from the profile configs: the data root, work root
  // and config home of every other known profile wherever it was moved, and the config homes this one and the default one use.
  const home = env['HOME'] && env['HOME'].length > 0 ? env['HOME'] : homedir();
  const others = knownProfileRoots(resolved.value.configHome, resolved.value.profile, { home, ownDataRoot: resolved.value.dataRoot, ownWorkRoot: resolved.value.workRoot });
  if (!others.ok) return failure('cannot read the other profiles of this machine', describeError(others.error));
  const profile: ProfilePaths = { ...resolved.value, otherRoots: [...new Set([...others.value, realpathNearest(resolved.value.configHome)])] };
  // SEC-2, S-49: a credentials section that holds an env: reference, or anything else that is not a credential reference, stops the command here,
  // before a store is opened or a run could start. A read-only command resolves no credential, so it does not read the section.
  let credentialSection: CredentialSection | undefined;
  if (options.readOnly !== true) {
    const parsedSection = parseCredentialSection(profile.config.sections.credentials);
    if (!parsedSection.ok) {
      const e = parsedSection.error;
      return { ok: false, code: EXIT_INTERNAL, message: e.kind === 'invalid' ? `profile config ${e.field}: ${e.reason}` : `profile config credentials: ${describeError(e)}` };
    }
    credentialSection = parsedSection.value;
  }
  // D-14: what a run keeps of the host transcript. A value other than summary or full stops the command here, naming the key. A read-only
  // command launches no host, so it does not read the section.
  let transcripts: TranscriptRetention = DEFAULT_TRANSCRIPT_RETENTION;
  if (options.readOnly !== true) {
    const parsedRetention = parseRetentionSection(profile.config.sections.retention);
    if (!parsedRetention.ok) {
      const e = parsedRetention.error;
      return { ok: false, code: EXIT_INTERNAL, message: e.kind === 'invalid' ? `profile config ${e.field}: ${e.reason}` : `profile config retention: ${describeError(e)}` };
    }
    transcripts = parsedRetention.value.transcripts;
  }
  // FR-3: the context sources this profile selects. A name outside the closed list stops the command here, naming `adapters.context`. `context` is a read-only
  // command, so the list is read whether or not the command writes.
  const contextAdapters = parseContextAdapters(profile.config.sections.adapters);
  if (!contextAdapters.ok) {
    const e = contextAdapters.error;
    return { ok: false, code: EXIT_INTERNAL, message: e.kind === 'invalid' ? `profile config ${e.field}: ${e.reason}` : `profile config adapters: ${describeError(e)}` };
  }
  // D-08: whether onboarding runs the knowledge pass. A value that is not a boolean stops the command here, naming `adapters.knowledgePass`.
  const knowledgePass = parseKnowledgePass(profile.config.sections.adapters);
  if (!knowledgePass.ok) {
    const e = knowledgePass.error;
    return { ok: false, code: EXIT_INTERNAL, message: e.kind === 'invalid' ? `profile config ${e.field}: ${e.reason}` : `profile config adapters: ${describeError(e)}` };
  }
  const dbPath = join(profile.dataRoot, 'state.db');
  const clock = overrides.clock ?? systemClock();
  const ids = overrides.ids ?? systemIds(clock);

  let db: Db | undefined;
  if (options.readOnly === true && existsSync(dbPath)) {
    const opened = openDb(dbPath, { readOnly: true });
    if (!opened.ok) return failure(`cannot open ${dbPath}`, describeError(opened.error));
    const foreign = refuseForeignStore(opened.value, dbPath, profile.profile);
    if (foreign !== undefined) return foreign;
    const pending = pendingMigrations(opened.value, MIGRATIONS);
    if (!pending.ok) {
      opened.value.close();
      return failure(`cannot use ${dbPath}`, describeError(pending.error));
    }
    if (pending.value.length === 0) db = opened.value;
    else opened.value.close();
  }
  if (db === undefined) {
    const opened = openDb(dbPath);
    if (!opened.ok) return failure(`cannot open ${dbPath}`, describeError(opened.error));
    const foreign = refuseForeignStore(opened.value, dbPath, profile.profile);
    if (foreign !== undefined) return foreign;
    const migrated = migrate(opened.value, MIGRATIONS, { profileId: profile.profile, nowMs: clock.nowMs() });
    if (!migrated.ok) {
      opened.value.close();
      return failure(`cannot migrate ${dbPath}`, describeError(migrated.error));
    }
    db = opened.value;
    if (options.readOnly === true) {
      db.close();
      const reopened = openDb(dbPath, { readOnly: true });
      if (!reopened.ok) return failure(`cannot open ${dbPath}`, describeError(reopened.error));
      db = reopened.value;
    }
  }
  const store = db;
  // OPS-5: the profile's limits bound the events table (debug events past it are refused) and the artifact store (new blobs past the quota are refused). A section that cannot
  // be read leaves the documented defaults in force here, so a typo never removes a bound; `start` refuses it and `doctor` names it.
  const limitsRead = parseLimitsSection(profile.config.sections.limits);
  const limits = limitsRead.ok ? limitsRead.value : { ...LIMIT_DEFAULTS };
  const ledger = new SqliteLedger(store, (prefix) => ids.next(prefix), { maxEventRows: limits.maxEventRows });
  // D-18: a project already in this store belongs to this store's profile. The first command that may write makes that explicit in the
  // binding registry, so the repository can no longer be run under another profile. A read-only command writes nothing.
  if (options.readOnly !== true) {
    const projects = ledger.listProjects();
    if (!projects.ok) {
      store.close();
      return failure('cannot list the projects of the store', describeError(projects.error));
    }
    const bound = backfillBindings(profile.configHome, profile.profile, projects.value, clock.nowMs());
    if (!bound.ok) {
      store.close();
      return failure('cannot bind the projects of the store to its profile', describeError(bound.error));
    }
  }
  // The executor for AVARICE's own subprocesses. A read-only command never runs one, so it neither probes the
  // sandbox nor records the executor.
  const executor = overrides.executor ?? new SandboxedExecutor();
  if (options.readOnly !== true) {
    const descriptor = executor.descriptor;
    const recorded = ledger.upsertAdapterConfig({
      name: descriptor.port,
      port: descriptor.port,
      adapter: descriptor.adapter,
      configDigest: digestOf(descriptor),
      descriptor,
    });
    if (!recorded.ok) {
      store.close();
      return failure('cannot record the executor adapter', describeError(recorded.error));
    }
  }
  // The credential broker (SEC-2, ADR-009, D-17): the providers this profile's class allows, each recorded with its descriptor (which holds no secret).
  let credentials: AppDeps['credentials'];
  if (options.readOnly !== true && credentialSection !== undefined) {
    const providers = credentialProviders(profile, credentialSection, executor, env, home);
    for (const [provider, adapter] of Object.entries(providers) as Array<[ProviderName, CredentialProvider]>) {
      const recorded = ledger.upsertAdapterConfig({
        name: `credential-${provider}`,
        port: adapter.descriptor.port,
        adapter: adapter.descriptor.adapter,
        configDigest: digestOf(adapter.descriptor),
        descriptor: adapter.descriptor,
      });
      if (!recorded.ok) {
        store.close();
        return failure(`cannot record the ${provider} credential provider`, describeError(recorded.error));
      }
    }
    const broker = { ledger, clock, profile, providers };
    credentials = { resolve: (ref, purpose, ctx) => resolveCredential(broker, ref, purpose, ctx) };
  }
  // The graph tool. Building its descriptor executes nothing; the graphify version is read by locate() when the
  // index stage uses it. A missing graphify is not a composition failure.
  const graph = new GraphifyTool(executor, { env, dataRoot: profile.dataRoot, home });
  if (options.readOnly !== true) {
    const recorded = ledger.upsertAdapterConfig({
      name: 'graph',
      port: graph.descriptor.port,
      adapter: graph.descriptor.adapter,
      configDigest: digestOf(graph.descriptor),
      descriptor: graph.descriptor,
    });
    if (!recorded.ok) {
      store.close();
      return failure('cannot record the graph adapter', describeError(recorded.error));
    }
  }
  // Locate GSD (ONB-12). A read-only command (status) never runs GSD, so it does not look for it, unless it asks for
  // the adapter to read the indexes (`context`). Without an admitted gsd-core no adapter exists and onboarding stops
  // `incompatible` at the contract stage.
  let gsd: GsdOnboarding | undefined;
  let gsdProblem: GsdProblem | undefined;
  let locatedGsd: LocatedGsd | undefined;
  if (options.readOnly !== true || options.gsd === true) {
    const located = locateGsdCore(env);
    if (located.ok) {
      locatedGsd = located.value;
      const adapter = new GsdOnboardingAdapter(located.value, { executor, dataRoot: profile.dataRoot, home });
      if (options.readOnly !== true) {
        const stored = ledger.upsertAdapterConfig({
          name: 'gsd',
          port: adapter.descriptor.port,
          adapter: adapter.descriptor.adapter,
          configDigest: digestOf(adapter.descriptor),
          descriptor: adapter.descriptor,
        });
        if (!stored.ok) {
          store.close();
          return failure('cannot record the gsd adapter', describeError(stored.error));
        }
      }
      gsd = adapter;
    } else {
      const e = located.error;
      gsdProblem = {
        found: e.kind === 'unsupported' ? (e.detail ?? 'an unsupported gsd-core') : e.kind === 'not_found' ? `no gsd-core found (${e.ref})` : describeError(e),
        admitted: `${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}`,
      };
    }
  }
  const staging = createStagingWorkspace(STAGING_STRATEGY);
  // The run ports. Building them executes nothing and records nothing.
  const runSource = new GitRunSource();
  const runWorkspace = new CloneRunWorkspace();
  const egress = overrides.egress ?? new AllowlistEgressProxy();
  // SEC-3, D-14: every text artifact is redacted before it is stored, whoever writes it.
  const artifacts = new RedactingArtifactStore(new LocalArtifactStore(profile.dataRoot, {}, { mib: limits.artifactQuotaMiB, profile: profile.profile }), processRedactor);
  // The agent host. A read-only command never launches one, so it neither probes the host nor records it.
  const host =
    overrides.host ??
    (options.readOnly === true ? new UnavailableAgentHost() : productionHost({ env, home, dataRoot: profile.dataRoot, located: locatedGsd, ledger, artifacts, staging, transcripts }));
  if (options.readOnly !== true) {
    // Record which host this profile ran with, so a later reader sees the enforcement level it had.
    const recorded = ledger.upsertAdapterConfig({
      name: host.descriptor.port,
      port: host.descriptor.port,
      adapter: host.descriptor.adapter,
      configDigest: digestOf(host.descriptor),
      descriptor: host.descriptor,
    });
    if (!recorded.ok) {
      store.close();
      return failure('cannot record the host adapter', describeError(recorded.error));
    }
  }
  // The context sources read the indexes through GSD's own readers, so they exist exactly when the GSD adapter does.
  // Only the sources the profile's `adapters.context` lists are built, and each one's descriptor is recorded (a read-only command records nothing).
  let context: NonNullable<AppDeps['context']> | undefined;
  if (gsd !== undefined) {
    const contextOptions = { nowMs: () => clock.nowMs() };
    context = {};
    for (const name of contextAdapters.value) {
      if (name === 'gsd-intel') context.intel = new GsdIntelContext(gsd, contextOptions);
      else if (name === 'gsd-graph') context.graph = new GsdGraphContext(gsd, contextOptions);
      else if (name === 'gsd-planning') context.planning = new GsdPlanningContext(contextOptions);
      else context.gitFiles = new GitFilesContext(contextOptions);
    }
    if (options.readOnly !== true) {
      for (const source of [context.intel, context.graph, context.planning, context.gitFiles]) {
        if (source === undefined) continue;
        const recorded = ledger.upsertAdapterConfig({
          name: `context-${source.descriptor.adapter}`,
          port: source.descriptor.port,
          adapter: source.descriptor.adapter,
          configDigest: digestOf(source.descriptor),
          descriptor: source.descriptor,
        });
        if (!recorded.ok) {
          store.close();
          return failure(`cannot record the ${source.descriptor.adapter} context adapter`, describeError(recorded.error));
        }
      }
    }
  }
  // Local notification (plan 03-16). The settings are read from the profile config each time they are asked for, so an edited file is
  // honored by the next banner; the osascript path is read once. A read-only command raises no banner.
  const readNotifySettings = () => readProfileNotify(profile.configHome, profile.profile);
  let notify: NotifyDeps | undefined;
  if (options.readOnly !== true) {
    const settings = readNotifySettings();
    notify = {
      notifier: overrides.notifier ?? new LocalNotifier({ osascriptPath: settings.ok ? settings.value.local.osascriptPath : NOTIFY_DEFAULTS.local.osascriptPath }),
      settings: readNotifySettings,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      minuteOfDay: (nowMs) => {
        const at = new Date(nowMs);
        return at.getHours() * 60 + at.getMinutes();
      },
    };
  }
  // The restricted host (plan 04-23): built beside the host, never recorded and never probed here (its descriptor is read when a restricted run, or `start --restricted`, asks).
  const restrictedHost =
    overrides.restrictedHost ??
    (options.readOnly === true ? undefined : productionRestrictedHost({ env, home, dataRoot: profile.dataRoot, located: locatedGsd, ledger, artifacts, staging, transcripts }));
  return {
    ok: true,
    value: {
      deps: { ledger, host, ...(restrictedHost !== undefined ? { restrictedHost } : {}), staging, artifacts, executor, graph, runSource, runWorkspace, egress, ...(gsd !== undefined ? { gsd } : {}), ...(gsdProblem !== undefined ? { gsdProblem } : {}), ...(context !== undefined ? { context } : {}), ...(notify !== undefined ? { notify } : {}), ...(credentials !== undefined ? { credentials } : {}), clock, ids, profile, home, redact: (text: string) => processRedactor.redact(text), policy: policyLoader(profile) },
      close: () => {
        try {
          store.close();
        } catch {
          // already closed
        }
      },
    },
  };
}
