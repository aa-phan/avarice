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
  GsdGraphEdge,
  GsdGraphNode,
  GsdGraphQueryResult,
  GsdGraphSnapshot,
  GsdGraphStatus,
  GsdIntelDiff,
  GsdIntelEntry,
  GsdIntelFileStatus,
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
const MAX_MESSAGES = 50;
const MAX_INTEL_SOURCES = 10;
const MAX_INTEL_ENTRIES = 100;
const MAX_GRAPH_NODES = 500;
const MAX_GRAPH_EDGES = 2000;
const MAX_GRAPH_BUDGET = 1_000_000;
const MAX_TERM_CHARS = 200;

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

// A query term goes to GSD as one argv word: it may not look like an option, carry control characters or run on.
function refuseTerm(term: string): string | null {
  if (term.trim() === '') return 'empty';
  if (term.length > MAX_TERM_CHARS) return `longer than ${MAX_TERM_CHARS} characters`;
  if (term.startsWith('-')) return 'starts with a dash';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(term)) return 'contains a control character';
  return null;
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

  // `intel validate` reads the five intel files and the config; it writes nothing. A disabled capability is a result.
  async intelValidate(staging: string): Promise<Result<GsdIntelValidation>> {
    const ran = await this.#run(staging, ['intel', 'validate'], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    if (d['disabled'] === true) return ok({ disabled: true, valid: false, errors: [], warnings: [] });
    if (typeof d['valid'] !== 'boolean') return invalid('intel validate valid', 'not a boolean');
    return ok({ disabled: false, valid: d['valid'], errors: strings(d['errors'], MAX_MESSAGES), warnings: strings(d['warnings'], MAX_MESSAGES) });
  }

  // `intel diff` compares the intel files with the hashes `intel snapshot` saved; it writes nothing.
  async intelDiff(staging: string): Promise<Result<GsdIntelDiff>> {
    const ran = await this.#run(staging, ['intel', 'diff'], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    return ok({
      disabled: d['disabled'] === true,
      noBaseline: d['no_baseline'] === true,
      changed: strings(d['changed'], MAX_MESSAGES),
      added: strings(d['added'], MAX_MESSAGES),
      removed: strings(d['removed'], MAX_MESSAGES),
    });
  }

  async intelStatus(staging: string): Promise<Result<GsdIntelStatus>> {
    const ran = await this.#run(staging, ['intel', 'status'], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    const files: Record<string, GsdIntelFileStatus> = {};
    for (const [name, value] of Object.entries(record(d['files'])).slice(0, MAX_MESSAGES)) {
      const f = record(value);
      files[name] = { exists: f['exists'] === true, updatedAt: typeof f['updated_at'] === 'string' ? f['updated_at'] : null, stale: f['stale'] === true };
    }
    return ok({ disabled: d['disabled'] === true, files, overallStale: d['overall_stale'] === true });
  }

  // `intel query <term>`: GSD's own search over the intel files' keys and values. A read verb.
  async intelQuery(staging: string, term: string): Promise<Result<GsdIntelQueryResult>> {
    const refused = refuseTerm(term);
    if (refused !== null) return invalid('query term', refused);
    const ran = await this.#run(staging, ['intel', 'query', term], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    if (d['disabled'] === true) return ok({ disabled: true, matches: [], total: 0, truncated: false });
    const matches: GsdIntelQueryResult['matches'] = [];
    if (Array.isArray(d['matches'])) {
      for (const match of d['matches'].slice(0, MAX_INTEL_SOURCES)) {
        const m = record(match);
        if (typeof m['source'] !== 'string' || !Array.isArray(m['entries'])) continue;
        const entries: GsdIntelEntry[] = [];
        for (const entry of m['entries'].slice(0, MAX_INTEL_ENTRIES)) {
          const e = record(entry);
          if (typeof e['key'] === 'string') entries.push({ key: e['key'], value: e['value'] });
        }
        matches.push({ source: m['source'], entries });
      }
    }
    return ok({ disabled: false, matches, total: count(d['total']), truncated: d['truncated'] === true });
  }

  // `graphify query <term> --budget <n>` is GSD's built-in reader (never the standalone `graphify query`: the two
  // return different shapes and read `--budget` in different units). It writes nothing. A missing graph is an error.
  async graphifyQuery(staging: string, term: string, budget: number): Promise<Result<GsdGraphQueryResult>> {
    const refused = refuseTerm(term);
    if (refused !== null) return invalid('query term', refused);
    if (!Number.isSafeInteger(budget) || budget < 0 || budget > MAX_GRAPH_BUDGET) return invalid('graph budget', `${String(budget)} is not an integer from 0 to ${MAX_GRAPH_BUDGET}`);
    const ran = await this.#run(staging, ['graphify', 'query', term, '--budget', String(budget)], false);
    if (!ran.ok) return ran;
    const d = record(ran.value);
    if (d['disabled'] === true) return ok({ disabled: true, nodes: [], edges: [], trimmed: null, budgetMet: null, budgetEstimate: null });
    if (typeof d['error'] === 'string') return err({ kind: 'internal', cause: `graphify query: ${d['error'].slice(0, 200)}` });
    const nodes: GsdGraphNode[] = [];
    if (Array.isArray(d['nodes'])) {
      for (const raw of d['nodes'].slice(0, MAX_GRAPH_NODES)) {
        const n = record(raw);
        const id = n['id'];
        if (typeof id !== 'string' && typeof id !== 'number') continue;
        nodes.push({
          id: String(id),
          label: typeof n['label'] === 'string' ? n['label'] : String(id),
          fileType: typeof n['file_type'] === 'string' ? n['file_type'] : null,
          sourceFile: typeof n['source_file'] === 'string' ? n['source_file'] : null,
          description: typeof n['description'] === 'string' ? n['description'] : null,
        });
      }
    }
    const edges: GsdGraphEdge[] = [];
    if (Array.isArray(d['edges'])) {
      for (const raw of d['edges'].slice(0, MAX_GRAPH_EDGES)) {
        const e = record(raw);
        if ((typeof e['source'] !== 'string' && typeof e['source'] !== 'number') || (typeof e['target'] !== 'string' && typeof e['target'] !== 'number')) continue;
        const tier = e['confidence'];
        edges.push({
          source: String(e['source']),
          target: String(e['target']),
          relation: typeof e['relation'] === 'string' ? e['relation'] : null,
          confidence: tier === 'EXTRACTED' || tier === 'INFERRED' || tier === 'AMBIGUOUS' ? tier : null,
        });
      }
    }
    return ok({
      disabled: false,
      nodes,
      edges,
      trimmed: typeof d['trimmed'] === 'string' ? d['trimmed'] : null,
      budgetMet: typeof d['budget_met'] === 'boolean' ? d['budget_met'] : null,
      budgetEstimate: typeof d['budget_estimate'] === 'number' ? d['budget_estimate'] : null,
    });
  }

  initPlanning(): Result<never> {
    return err({ kind: 'unsupported', capability: 'init-planning', reducedMode: 'out of scope for Phase 1; planning initialization arrives in Phase 4' });
  }
}
