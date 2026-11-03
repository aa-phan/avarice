// GsdOnboardingAdapter for @opengsd/gsd-core 1.17.x (ADR-008). It speaks to GSD only through gsd-tools verbs
// (no slash commands, no GSD files read or written by this adapter). Every verb that can write runs with
// cwd = the staging workspace the caller names; a verb is never aimed at the user's checkout. AVARICE never
// edits `.planning/codebase/*.md` itself (ONB-2): the only writes this adapter causes are `config-set` and
// `stamp-codebase-map`, both GSD's own, and (plan 01-14) `graphify build snapshot`, which writes the diff snapshot
// of the graph AVARICE installed into `.planning/graphs`.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import { GSD_ADMITTED_PACKAGE, GSD_ADMITTED_RANGE } from '../../ports/gsd-onboarding.ts';
import type {
  GsdAppliedSetting,
  GsdCapabilitySnapshot,
  GsdDriftResult,
  GsdGraphQueryResult,
  GsdGraphSnapshot,
  GsdGraphStatus,
  GsdIntelDiff,
  GsdIntelQueryResult,
  GsdIntelStatus,
  GsdIntelValidation,
  GsdOnboarding,
  GsdProjectState,
  GsdSetting,
  GsdStampResult,
} from '../../ports/gsd-onboarding.ts';
import type { CommandExecutor } from '../../ports/command-executor.ts';
import { join } from 'node:path';
import { runGsd } from './gsd-tools.ts';
import type { LocatedGsd } from './locate.ts';

const MAX_DOC_CANDIDATES = 200;
const MAP_DIR_PREFIX = '.planning/codebase/';
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;
const SETTING_VALUE = /^[A-Za-z0-9_.-]+$/;
const MAP_FILE_NAME = /^[A-Z][A-Z_]*\.md$/;
const ADMITTED_VERSION = /^1\.17\.\d+$/;

// Static capabilities of the 1.17.x surface this adapter drives. `map-paths` and `ingest-docs` exist in GSD
// but belong to Phase 4, so they are reported false here.
const CAPABILITIES: Readonly<Record<string, boolean>> = {
  'init-onboard': true,
  'map-full': true,
  'map-fast': true,
  'map-paths': false,
  stamp: true,
  'verify-drift': true,
  'ingest-docs': false,
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, limit) : [];
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

export interface GsdAdapterOptions {
  executor: CommandExecutor;
  dataRoot: string;
  home: string;
}

export class GsdOnboardingAdapter implements GsdOnboarding {
  readonly descriptor: CapabilityDescriptor;
  readonly located: LocatedGsd;
  readonly #executor: CommandExecutor;
  // What every verb may not read: the data root and the user's credential stores.
  readonly #denyRead: readonly string[];

  constructor(located: LocatedGsd, options: GsdAdapterOptions) {
    this.located = located;
    this.#executor = options.executor;
    this.#denyRead = [options.dataRoot, join(options.home, '.ssh'), join(options.home, '.aws'), join(options.home, '.config', 'gh')];
    this.descriptor = {
      port: 'gsd-onboarding',
      adapter: 'gsd-onboarding',
      version: '1.17',
      capabilities: { ...CAPABILITIES },
      // Part of the descriptor digest stored in adapter_configs, so a different GSD shows up as a change.
      attributes: { gsdVersion: located.version, packageName: located.packageName, gsdCoreDir: located.gsdCoreDir },
      offline: true,
    };
  }

  // Every verb goes through the executor with cwd = staging. A verb that writes GSD state may write staging
  // `.planning` and nothing else; a read verb may write nothing.
  #run(staging: string, args: readonly string[], writes: boolean | readonly string[]): Promise<Result<unknown>> {
    return runGsd(this.#executor, this.located.gsdCoreDir, args, {
      cwd: staging,
      writePaths: Array.isArray(writes) ? writes : writes === true ? [join(staging, '.planning')] : [],
      denyReadPaths: this.#denyRead,
    });
  }

  inspect(): Result<GsdCapabilitySnapshot> {
    const { gsdCoreDir, version, packageName } = this.located;
    if (packageName !== GSD_ADMITTED_PACKAGE || !ADMITTED_VERSION.test(version)) {
      return err({
        kind: 'unsupported',
        capability: 'gsd-core',
        reducedMode: `none: the admitted distribution is ${GSD_ADMITTED_PACKAGE} ${GSD_ADMITTED_RANGE}`,
        detail: `found ${packageName} ${version}`,
      });
    }
    return ok({
      version,
      packageName,
      gsdCoreDir,
      // Where GSD itself resolves its agents.
      agentsDir: join(gsdCoreDir, '..', 'agents'),
      capabilities: Object.entries(CAPABILITIES)
        .filter(([, available]) => available)
        .map(([name]) => name),
    });
  }

  async probeState(staging: string): Promise<Result<GsdProjectState>> {
    const ran = await this.#run(staging, ['init', 'onboard', '--raw'], true);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    const readiness = d['map_readiness'];
    if (readiness !== 'complete' && readiness !== 'fast' && readiness !== 'none') {
      return invalid('init onboard map_readiness', `unexpected value ${JSON.stringify(readiness)}`);
    }
    if (typeof d['is_brownfield'] !== 'boolean') return invalid('init onboard is_brownfield', 'not a boolean');
    const nextAction = record(d['next_action'])['kind'];
    const state: GsdProjectState = {
      isBrownfield: d['is_brownfield'],
      mapReadiness: readiness,
      missingMapFiles: strings(d['missing_codebase_map_files'], 50),
      planningFiles: {
        project: d['project_exists'] === true,
        requirements: d['requirements_exists'] === true,
        roadmap: d['roadmap_exists'] === true,
        state: d['state_exists'] === true,
        config: d['config_exists'] === true,
      },
      nextAction: typeof nextAction === 'string' ? nextAction : 'unknown',
      docCandidates: strings(d['doc_candidates'], MAX_DOC_CANDIDATES),
    };
    return ok(state);
  }

  async configure(staging: string, settings: readonly GsdSetting[]): Promise<Result<GsdAppliedSetting[]>> {
    const applied: GsdAppliedSetting[] = [];
    // Sequential on purpose: config-set takes a lock on staging `.planning/` and rewrites config.json.
    for (const [key, value] of settings) {
      if (!SETTING_KEY.test(key)) return invalid('setting key', `${JSON.stringify(key)} is not a dotted key`);
      if (!SETTING_VALUE.test(value)) return invalid(`setting ${key}`, `${JSON.stringify(value)} is not a plain value`);
      const ran = await this.#run(staging, ['config-set', key, value], true);
      if (!ran.ok) return ran;
      if (record(ran.value)['updated'] !== true) return err({ kind: 'internal', cause: `config-set ${key} did not report updated` });
      applied.push({ key, value });
    }
    return ok(applied);
  }

  async stamp(staging: string, files?: readonly string[]): Promise<Result<GsdStampResult>> {
    const args = ['stamp-codebase-map'];
    if (files !== undefined) {
      // `--files` takes names inside .planning/codebase; accept either the name or its repository path.
      const names = files.map((file) => (file.startsWith(MAP_DIR_PREFIX) ? file.slice(MAP_DIR_PREFIX.length) : file));
      const bad = names.find((name) => !MAP_FILE_NAME.test(name));
      if (bad !== undefined) return invalid('stamp files', `${JSON.stringify(bad)} is not a map file name`);
      args.push('--files', names.join(','));
    }
    const ran = await this.#run(staging, args, true);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    return ok({
      stamped: strings(d['stamped'], 50),
      failed: strings(d['failed'], 50),
      commit: typeof d['commit'] === 'string' ? d['commit'] : null,
      skipped: d['skipped'] === true,
    });
  }

  async checkDrift(staging: string): Promise<Result<GsdDriftResult>> {
    const ran = await this.#run(staging, ['verify', 'codebase-drift'], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    return ok({
      block: d['block'] === true,
      skipped: d['skipped'] === true,
      reason: typeof d['reason'] === 'string' ? d['reason'] : null,
      lastMappedCommit: typeof d['last_mapped_commit'] === 'string' ? d['last_mapped_commit'] : null,
      threshold: typeof d['threshold'] === 'number' ? d['threshold'] : null,
      action: typeof d['action'] === 'string' ? d['action'] : null,
      affectedPaths: strings(d['affected_paths'], 200),
    });
  }

  // `graphify build snapshot` writes `.planning/graphs/.last-build-snapshot.json` and nothing else, so the verb may
  // write that one directory (the installed graph must already be there).
  async graphifySnapshot(staging: string): Promise<Result<GsdGraphSnapshot>> {
    const ran = await this.#run(staging, ['graphify', 'build', 'snapshot'], [join(staging, '.planning', 'graphs')]);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    if (typeof d['error'] === 'string') return err({ kind: 'internal', cause: `graphify build snapshot: ${d['error'].slice(0, 200)}` });
    if (d['saved'] !== true) return err({ kind: 'internal', cause: 'graphify build snapshot did not report saved' });
    return ok({ saved: true, nodeCount: count(d['node_count']), edgeCount: count(d['edge_count']) });
  }

  // `graphify status` reads the config, the graph and git; it writes nothing. A disabled capability and a missing
  // graph are results, not errors; an `error` field (an unparseable graph) is an error.
  async graphifyStatus(staging: string): Promise<Result<GsdGraphStatus>> {
    const ran = await this.#run(staging, ['graphify', 'status'], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    if (typeof d['error'] === 'string') return err({ kind: 'internal', cause: `graphify status: ${d['error'].slice(0, 200)}` });
    return ok({
      disabled: d['disabled'] === true,
      exists: d['exists'] === true,
      stale: d['stale'] === true,
      commitStale: typeof d['commit_stale'] === 'boolean' ? d['commit_stale'] : null,
      commitsBehind: typeof d['commits_behind'] === 'number' ? d['commits_behind'] : null,
      builtAtCommit: typeof d['built_at_commit'] === 'string' ? d['built_at_commit'] : null,
      currentCommit: typeof d['current_commit'] === 'string' ? d['current_commit'] : null,
      nodeCount: count(d['node_count']),
      edgeCount: count(d['edge_count']),
    });
  }

  async intelValidate(_staging: string): Promise<Result<GsdIntelValidation>> {
    return err({ kind: 'internal', cause: 'intel validate is not implemented' });
  }

  async intelDiff(_staging: string): Promise<Result<GsdIntelDiff>> {
    return err({ kind: 'internal', cause: 'intel diff is not implemented' });
  }

  async intelStatus(_staging: string): Promise<Result<GsdIntelStatus>> {
    return err({ kind: 'internal', cause: 'intel status is not implemented' });
  }

  async intelQuery(_staging: string, _term: string): Promise<Result<GsdIntelQueryResult>> {
    return err({ kind: 'internal', cause: 'intel query is not implemented' });
  }

  async graphifyQuery(_staging: string, _term: string, _budget: number): Promise<Result<GsdGraphQueryResult>> {
    return err({ kind: 'internal', cause: 'graphify query is not implemented' });
  }

  initPlanning(): Result<never> {
    return err({ kind: 'unsupported', capability: 'init-planning', reducedMode: 'out of scope for Phase 1; planning initialization arrives in Phase 4' });
  }
}
