// Composition root: resolves the profile, opens and migrates the ledger, builds the dependencies.
// A refusal or failure here is returned as { ok: false, code, message }; main prints the message to
// stderr and exits with the code. Plans after 01-03 add their adapters and refusals in this file.
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../domain/ids.ts';
import type { IdPrefix } from '../domain/ids.ts';
import { describeError, openDb } from '../adapters/sqlite/db.ts';
import type { Db } from '../adapters/sqlite/db.ts';
import { migrate, pendingMigrations } from '../adapters/sqlite/migrate.ts';
import type { Migration } from '../adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../adapters/sqlite/migrations/0001-initial.ts';
import { SqliteLedger } from '../adapters/sqlite/ledger.ts';
import { resolveProfile } from '../adapters/fs/profile-paths.ts';
import { LocalArtifactStore } from '../adapters/fs/artifact-store.ts';
import { createStagingWorkspace, STAGING_STRATEGY } from '../adapters/git/staging-strategy.ts';
import { SandboxedExecutor } from '../adapters/exec/sandboxed-executor.ts';
import { GsdGraphContext } from '../adapters/context/gsd-graph.ts';
import { GsdIntelContext } from '../adapters/context/gsd-intel.ts';
import { GraphifyTool, findGraphifyBinary } from '../adapters/graph/graphify.ts';
import { UnavailableAgentHost } from '../adapters/host/unavailable-host.ts';
import { ClaudeHostAdapter } from '../adapters/host-claude/claude-host.ts';
import { fingerprintGsdPreamble } from '../adapters/gsd/preamble.ts';
import { GsdOnboardingAdapter } from '../adapters/gsd/gsd-onboarding.ts';
import { locateGsdCore } from '../adapters/gsd/locate.ts';
import type { LocatedGsd } from '../adapters/gsd/locate.ts';
import { digestOf } from '../domain/digest.ts';
import type { AgentHost } from '../ports/agent-host.ts';
import type { ArtifactStore } from '../ports/artifact-store.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { StagingWorkspace } from '../ports/staging-workspace.ts';
import type { CommandExecutor } from '../ports/command-executor.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../ports/gsd-onboarding.ts';
import type { GsdOnboarding } from '../ports/gsd-onboarding.ts';
import type { AppDeps, Clock, GsdProblem, IdSource } from '../app/deps.ts';

export const MIGRATIONS: readonly Migration[] = [MIGRATION_0001];
export const EXIT_INTERNAL = 70;

export interface DepsOverrides {
  clock?: Clock;
  ids?: IdSource;
  // Replaces the production host. Only test entry points pass this; bin/avarice.ts never does, so the production
  // path always runs the contained ClaudeHostAdapter (when it is admitted) or the fail-closed UnavailableAgentHost.
  host?: AgentHost;
  // Replaces the sandboxed executor. Only test entries pass this (a test that already runs inside a sandbox,
  // where `sandbox-exec` cannot nest); bin/avarice.ts never does, so production always runs SandboxedExecutor.
  executor?: CommandExecutor;
}

export interface CreateDepsOptions {
  // Open the store read-only (after making sure it is migrated). Used by status.
  readOnly?: boolean;
  // Locate GSD even though the store is read-only: a command that only reads the indexes through GSD's own readers
  // (`context`) needs the adapter but records nothing.
  gsd?: boolean;
}

export interface Composition {
  deps: AppDeps;
  close(): void;
}

export type CompositionResult = { ok: true; value: Composition } | { ok: false; code: number; message: string };

function failure(what: string, message: string): CompositionResult {
  return { ok: false, code: EXIT_INTERNAL, message: `avarice: ${what}: ${message}` };
}

export function systemClock(): Clock {
  return { nowMs: () => Date.now() };
}

export function systemIds(clock: Clock): IdSource {
  return { next: (prefix: IdPrefix) => newId(prefix, clock.nowMs(), randomBytes(10)) };
}

// The first executable file named `name` on `pathEnv`, or undefined.
function locateOnPath(name: string, pathEnv: string | undefined): string | undefined {
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
  const graphifyBin = findGraphifyBinary(env);
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
    // The graphify skill resolves its interpreter from the graphify shebang, so the knowledge invocation (only) gets the
    // directory of the graphify binary on PATH (spike S0-G); without a graphify there is no knowledge pass to run.
    ...(graphifyBin !== undefined ? { knowledgePath: [dirname(graphifyBin)] } : {}),
  });
  const attributes = adapter.descriptor.attributes ?? {};
  return attributes['enforcement'] === 'enforced' ? adapter : new UnavailableAgentHost(attributes['reason'] ?? 'the host adapter is not enforced');
}

export function createDeps(env: NodeJS.ProcessEnv, overrides: DepsOverrides = {}, options: CreateDepsOptions = {}): CompositionResult {
  const resolved = resolveProfile(env);
  if (!resolved.ok) return failure('cannot prepare the profile directories', describeError(resolved.error));
  const profile = resolved.value;
  const dbPath = join(profile.dataRoot, 'state.db');
  const clock = overrides.clock ?? systemClock();
  const ids = overrides.ids ?? systemIds(clock);

  let db: Db | undefined;
  if (options.readOnly === true && existsSync(dbPath)) {
    const opened = openDb(dbPath, { readOnly: true });
    if (!opened.ok) return failure(`cannot open ${dbPath}`, describeError(opened.error));
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
  const ledger = new SqliteLedger(store, (prefix) => ids.next(prefix));
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
  // The graph tool. Building its descriptor executes nothing; the graphify version is read by locate() when the
  // index stage uses it. A missing graphify is not a composition failure.
  const home = env['HOME'] && env['HOME'].length > 0 ? env['HOME'] : homedir();
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
  const artifacts = new LocalArtifactStore(profile.dataRoot);
  // The agent host. A read-only command never launches one, so it neither probes the host nor records it.
  const host =
    overrides.host ??
    (options.readOnly === true ? new UnavailableAgentHost() : productionHost({ env, home, dataRoot: profile.dataRoot, located: locatedGsd, ledger, artifacts, staging }));
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
  const context = gsd !== undefined ? { intel: new GsdIntelContext(gsd, { nowMs: () => clock.nowMs() }), graph: new GsdGraphContext(gsd, { nowMs: () => clock.nowMs() }) } : undefined;
  return {
    ok: true,
    value: {
      deps: { ledger, host, staging, artifacts, executor, graph, ...(gsd !== undefined ? { gsd } : {}), ...(gsdProblem !== undefined ? { gsdProblem } : {}), ...(context !== undefined ? { context } : {}), clock, ids, profile, home },
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
