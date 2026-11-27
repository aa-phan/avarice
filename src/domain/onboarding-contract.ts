// Onboarding contract compiler (docs/repository-onboarding.md "Onboarding contract";
// docs/contracts-and-state.md "Run contract"). Pure: the clock, ids and preflight facts are arguments.
//
// The compiler is where RC-5 is enforced for onboarding: a promotion value outside none, copy and commit and any budget
// above the preset are refused here, so no later stage has to remember to check.
import { digestOf } from './digest.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { MAPPING_MODES } from './mapping.ts';
import type { MappingMode } from './mapping.ts';

// How the run's subagent total is derived (deferred item 11): the subagents one map round spawns in the mapping mode, plus the mapper re-runs the mode
// allows in a round (plan 04-35), times the map rounds (the first map and its retries), plus the knowledge pass allowance, plus intel's none. Stored in the contract
// so the number is explained by the contract that carries it. The knowledge pass runs no subagent since plan 01-19 decision B (the
// model reads the chunks itself, no graphify skill), so its allowance is 0.
export interface SubagentDerivation {
  mode: MappingMode;
  mapAgents: number;
  // Mappers the orchestrator may spawn again in one round on top of `mapAgents`.
  mapRerunAllowance: number;
  mapRounds: number;
  knowledgeAllowance: number;
  intelAgents: number;
  // The derived ceiling; `budgets.subagentsTotal` is this value or a lower override.
  total: number;
  formula: string;
}

// How the run's invocation count is derived (plan 01-19, user decision): the map invocations of every map round (the first
// map and its retries), the relaunches an interruption costs (a killed invocation stays charged and is run again), plus one
// intel and one knowledge invocation. Stored beside `subagentsDerivation`.
export interface InvocationDerivation {
  mode: MappingMode;
  // Map invocations in one round: 1 when the mode runs a mapper, else 0.
  mapInvocations: number;
  mapRounds: number;
  // One relaunch per map round when a mapper runs, else 1 (an intel or knowledge invocation killed once).
  interruptionAllowance: number;
  intelInvocations: number;
  knowledgeInvocations: number;
  // The derived ceiling; `budgets.invocations` is this value or a lower override.
  total: number;
  formula: string;
}

// What the owner can ask AVARICE to do with the accepted map after activation (ONB-6, D-15). `none` is the default; `copy` and `commit` are explicit
// opt-ins, and each is a privileged action that the approval gate lets through because this contract names it.
export const PROMOTE_MODES = ['none', 'copy', 'commit'] as const;
export type PromoteMode = (typeof PROMOTE_MODES)[number];

export function isPromoteMode(value: unknown): value is PromoteMode {
  return typeof value === 'string' && (PROMOTE_MODES as readonly string[]).includes(value);
}

// The refusal text of an unknown promotion value, shared by the preflight and the compiler so both name the same set.
export function promoteRefusal(value: unknown): string {
  return `promotion ${JSON.stringify(value)} is not accepted: the allowed values are ${PROMOTE_MODES.join(', ')}`;
}

export interface OnboardingBudgets {
  wallClockMinutes: number;
  wallClockShares: { map: number; intel: number; knowledge: number };
  invocations: number;
  invocationsDerivation: InvocationDerivation;
  toolCalls: number;
  subagentsConcurrent: number;
  subagentsTotal: number;
  subagentsDerivation: SubagentDerivation;
  costUsd: { perInvocation: number; perRun: number; exactness: 'estimated' | 'exact' };
  retry: number;
}

export interface OnboardingContract {
  schema: 1;
  contractVersion: 1;
  onboardingId: string;
  runId: string;
  policyPreset: 'onboarding';
  policyRevision: string;
  compiledAt: string;
  workspace: { projectId: string; baseRevision: string };
  mapping: { mode: MappingMode };
  files: {
    read: string[];
    // Directories the mapper must not read, in addition to secrets.
    readExclude: string[];
    // Secret-bearing path globs removed from the read scope.
    secretGlobs: string[];
    // Agent write sets, one per contained invocation purpose. create mirrors write.
    write: { map: string[]; intel: string[]; knowledge: string[] };
    create: { map: string[]; intel: string[]; knowledge: string[] };
    // Written by AVARICE's own executor, never by the agent.
    avariceWrite: string[];
    delete: string[];
  };
  knowledge: { documents: string[] };
  execution: {
    commands: string[];
    endpoints: string[];
    toolClasses: string[];
    environment: 'local-sandbox';
    model: string;
  };
  decisions: {
    defaults: Array<{ class: string; default: string }>;
    human: string[];
    prohibited: string[];
  };
  budgets: OnboardingBudgets;
  delivery: { promote: PromoteMode };
  indexes: { codeGraph: boolean; intel: boolean; knowledge: boolean };
}

// Facts from preflight that change the contract. Optional: a missing field means "none found".
// Typed `unknown` at the edge because preflight output is data, validated here.
export type ContractPreflight = Readonly<Record<string, unknown>>;

export interface CompileInput {
  onboardingId: string;
  runId: string;
  projectId: string;
  pin: string;
  preflight: ContractPreflight;
  // User request: { mode?, promote?, budgetOverrides? }. Untrusted; validated here.
  request: Readonly<Record<string, unknown>>;
  nowIso: string;
}

const WRITE_SETS = {
  map: ['.planning/codebase/**'],
  intel: ['.planning/intel/**'],
  knowledge: ['.avarice-knowledge/**'],
} as const;

// Preset values. Changing any value changes `policyRevision`.
export const ONBOARDING_PRESET = {
  id: 'onboarding',
  defaultMode: 'full',
  readExclude: ['.git', 'build', 'coverage', 'dist', 'node_modules', 'vendor'],
  secretGlobs: ['**/*.key', '**/*.pem', '**/.env', '**/.env.*', '**/id_ed25519*', '**/id_rsa*'],
  write: WRITE_SETS,
  create: WRITE_SETS,
  avariceWrite: ['.planning/config.json', '.planning/graphs/**'],
  delete: [] as string[],
  knowledgeDocuments: ['docs/**/*.md'],
  // Read-only inspection only (ONB-4). The gsd_run verbs and the intel verbs are provisional until
  // the slice 0 spike (S0-A) fixes the exact set.
  commands: [
    'cat',
    'find',
    'git log',
    'git ls-files',
    'git rev-parse',
    'gsd_run query',
    'gsd_run verify',
    'head',
    'ls',
    'wc',
  ],
  intelCommands: ['gsd_run intel'],
  endpoints: [] as string[],
  toolClasses: ['read', 'edit', 'shell-sandboxed'],
  environment: 'local-sandbox',
  model: 'haiku',
  existingMapAnswer: 'refresh',
  humanDecisions: [
    'secret-scan hits',
    'ingest BLOCKER and WARNING conflicts',
    'overwriting any existing artifact outside staging',
    'scope expansion',
  ],
  prohibitedDecisions: ['policy changes', 'budget changes', 'credential changes', 'merge'],
  promote: 'none' as PromoteMode,
  budgets: {
    wallClockMinutes: 45,
    wallClockShares: { map: 20, intel: 10, knowledge: 15 },
    toolCalls: 600,
    subagentsConcurrent: 4,
    costUsd: { perInvocation: 3.0, perRun: 12.0, exactness: 'estimated' },
    retry: 1,
  },
  // The subagent total is derived from the mapping mode (see deriveSubagents), not a flat number.
  subagents: {
    // What one map round spawns: GSD's full map spawns 4 mappers, its fast map (scan, tech+arch) one; `paths` needs the full
    // file set, `skip` and `adopt` run no mapper.
    mapAgents: { full: 4, fast: 1, paths: 4, skip: 0, adopt: 0 },
    // Mapper re-runs one map round may spawn on top of `mapAgents` (plan 04-35, owner ruling 2026-11-18). GSD's map-codebase workflow spawns 4 mappers, and its orchestrator
    // spawned a fifth in the retry round of the live full map of auto_search_workflow (a re-run of the concerns mapper, whose first answer had concluded that Python
    // modules were absent), which the total of 8 refused. A full map allows two such re-runs per round: the measured need (one) with one more of headroom. The other
    // modes are unchanged, and a hook denial still blocks the onboarding.
    mapRerunAllowance: { full: 2, fast: 0, paths: 0, skip: 0, adopt: 0 },
    // The knowledge pass starts no subagent (decision B, 2026-11-03): one model session reads the chunked documents itself.
    knowledgeAllowance: 0,
    intelAgents: 0,
  },
  indexes: { codeGraph: true, intel: true, knowledge: true },
} as const;

type OverrideKey =
  | 'wallClockMinutes'
  | 'invocations'
  | 'toolCalls'
  | 'subagentsConcurrent'
  | 'subagentsTotal'
  | 'costUsdPerInvocation'
  | 'costUsdPerRun'
  | 'retry';

const OVERRIDE_LIMITS: Readonly<Record<OverrideKey, { limit: number; integer: boolean }>> = {
  wallClockMinutes: { limit: ONBOARDING_PRESET.budgets.wallClockMinutes, integer: true },
  // Like subagentsTotal, the ceiling is derived from the mapping mode and the retry limit, so it is checked after the other overrides apply.
  invocations: { limit: Number.POSITIVE_INFINITY, integer: true },
  toolCalls: { limit: ONBOARDING_PRESET.budgets.toolCalls, integer: true },
  subagentsConcurrent: { limit: ONBOARDING_PRESET.budgets.subagentsConcurrent, integer: true },
  // The ceiling is derived from the mapping mode and the retry limit, so it is checked after the other overrides apply.
  subagentsTotal: { limit: Number.POSITIVE_INFINITY, integer: true },
  costUsdPerInvocation: { limit: ONBOARDING_PRESET.budgets.costUsd.perInvocation, integer: false },
  costUsdPerRun: { limit: ONBOARDING_PRESET.budgets.costUsd.perRun, integer: false },
  retry: { limit: ONBOARDING_PRESET.budgets.retry, integer: true },
};

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// A repository-relative directory: no absolute path, no `.` or `..` segment, no glob or backslash.
function cleanDirectory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const dir = raw.replace(/\/+$/, '');
  if (dir === '' || dir.startsWith('/') || dir.startsWith('~')) return null;
  if (/[\\\0*?[\]{}]/.test(dir)) return null;
  if (dir.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return dir;
}

function readDirectories(field: string, raw: unknown): Result<string[]> {
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return invalid(field, 'must be an array of repository-relative directories');
  const out: string[] = [];
  for (const entry of raw) {
    const dir = cleanDirectory(entry);
    if (dir === null) return invalid(field, `unsafe directory ${JSON.stringify(entry)}`);
    out.push(dir);
  }
  return ok(out);
}

const unique = (items: readonly string[]): string[] => [...new Set(items)];

// The subagent total for a mapping mode and a map retry limit: (map agents for the mode + its re-run allowance) x (1 + retries) + the knowledge pass
// allowance + intel's none (docs/repository-onboarding.md "Onboarding contract").
export function deriveSubagents(mode: MappingMode, retry: number): SubagentDerivation {
  const { mapAgents, mapRerunAllowance, knowledgeAllowance, intelAgents } = ONBOARDING_PRESET.subagents;
  const perRound = mapAgents[mode];
  const rerun = mapRerunAllowance[mode];
  const mapRounds = 1 + retry;
  const total = (perRound + rerun) * mapRounds + knowledgeAllowance + intelAgents;
  const agents = rerun > 0 ? `${perRound} map agents + ${rerun} re-run allowance (${mode})` : `${perRound} map agents (${mode})`;
  return {
    mode,
    mapAgents: perRound,
    mapRerunAllowance: rerun,
    mapRounds,
    knowledgeAllowance,
    intelAgents,
    total,
    formula: `${agents} x ${mapRounds} map rounds (1 + ${retry} retry) + ${knowledgeAllowance} knowledge (no subagent: the model reads the chunks itself) + ${intelAgents} intel = ${total}`,
  };
}

// The invocation count for a mapping mode and a map retry limit: map invocations (1 per round when the mode runs a mapper) x
// (1 + retries) + the interruption relaunches + 1 intel + 1 knowledge.
export function deriveInvocations(mode: MappingMode, retry: number): InvocationDerivation {
  const mapInvocations = ONBOARDING_PRESET.subagents.mapAgents[mode] > 0 ? 1 : 0;
  const mapRounds = 1 + retry;
  const interruptionAllowance = mapInvocations > 0 ? mapInvocations * mapRounds : 1;
  const total = mapInvocations * mapRounds + interruptionAllowance + 1 + 1;
  const allowanceText = mapInvocations > 0 ? `${interruptionAllowance} interruption relaunches (1 per map round)` : `${interruptionAllowance} interruption relaunches (1 for a run with no mapper)`;
  return {
    mode,
    mapInvocations,
    mapRounds,
    interruptionAllowance,
    intelInvocations: 1,
    knowledgeInvocations: 1,
    total,
    formula: `${mapInvocations} map invocation (${mode}) x ${mapRounds} map rounds (1 + ${retry} retry) + ${allowanceText} + 1 intel + 1 knowledge = ${total}`,
  };
}

function applyBudgetOverrides(raw: unknown, mode: MappingMode): Result<OnboardingBudgets> {
  const preset = ONBOARDING_PRESET.budgets;
  const budgets: OnboardingBudgets = {
    wallClockMinutes: preset.wallClockMinutes,
    wallClockShares: { ...preset.wallClockShares },
    invocations: 0,
    invocationsDerivation: deriveInvocations(mode, preset.retry),
    toolCalls: preset.toolCalls,
    subagentsConcurrent: preset.subagentsConcurrent,
    subagentsTotal: 0,
    subagentsDerivation: deriveSubagents(mode, preset.retry),
    costUsd: { ...preset.costUsd },
    retry: preset.retry,
  };
  budgets.subagentsTotal = budgets.subagentsDerivation.total;
  budgets.invocations = budgets.invocationsDerivation.total;
  if (raw === undefined) return ok(budgets);
  if (!isPlainObject(raw)) return invalid('request.budgetOverrides', 'must be an object');
  let requestedSubagentsTotal: number | undefined;
  let requestedInvocations: number | undefined;

  for (const [key, value] of Object.entries(raw)) {
    const field = `request.budgetOverrides.${key}`;
    if (!Object.hasOwn(OVERRIDE_LIMITS, key)) return invalid(field, 'unknown budget');
    const spec = OVERRIDE_LIMITS[key as OverrideKey];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return invalid(field, 'must be a finite non-negative number');
    }
    if (spec.integer && !Number.isInteger(value)) return invalid(field, 'must be an integer');
    if (value > spec.limit) {
      return invalid(field, `budgets can only be lowered: ${value} is above the preset ${spec.limit}`);
    }
    switch (key as OverrideKey) {
      case 'wallClockMinutes':
        budgets.wallClockMinutes = value;
        break;
      case 'invocations':
        requestedInvocations = value;
        break;
      case 'toolCalls':
        budgets.toolCalls = value;
        break;
      case 'subagentsConcurrent':
        budgets.subagentsConcurrent = value;
        break;
      case 'subagentsTotal':
        requestedSubagentsTotal = value;
        break;
      case 'costUsdPerInvocation':
        budgets.costUsd.perInvocation = value;
        break;
      case 'costUsdPerRun':
        budgets.costUsd.perRun = value;
        break;
      case 'retry':
        budgets.retry = value;
        break;
    }
  }

  // The derived total follows the retry limit in force; an override may only lower it.
  budgets.subagentsDerivation = deriveSubagents(mode, budgets.retry);
  budgets.subagentsTotal = budgets.subagentsDerivation.total;
  if (requestedSubagentsTotal !== undefined) {
    if (requestedSubagentsTotal > budgets.subagentsDerivation.total) {
      return invalid(
        'request.budgetOverrides.subagentsTotal',
        `budgets can only be lowered: ${requestedSubagentsTotal} is above the ${budgets.subagentsDerivation.total} derived for mapping mode ${mode} (${budgets.subagentsDerivation.formula})`,
      );
    }
    budgets.subagentsTotal = requestedSubagentsTotal;
  }

  // The same for the invocation count: derived from the retry limit in force, lowered only.
  budgets.invocationsDerivation = deriveInvocations(mode, budgets.retry);
  budgets.invocations = budgets.invocationsDerivation.total;
  if (requestedInvocations !== undefined) {
    if (requestedInvocations > budgets.invocationsDerivation.total) {
      return invalid(
        'request.budgetOverrides.invocations',
        `budgets can only be lowered: ${requestedInvocations} is above the ${budgets.invocationsDerivation.total} derived for mapping mode ${mode} (${budgets.invocationsDerivation.formula})`,
      );
    }
    budgets.invocations = requestedInvocations;
  }

  // The per-purpose shares of the wall clock scale down with it, so they never sum above the total.
  if (budgets.wallClockMinutes < preset.wallClockMinutes) {
    const scale = (share: number): number =>
      Math.floor((share * budgets.wallClockMinutes) / preset.wallClockMinutes);
    budgets.wallClockShares = {
      map: scale(preset.wallClockShares.map),
      intel: scale(preset.wallClockShares.intel),
      knowledge: scale(preset.wallClockShares.knowledge),
    };
  }
  return ok(budgets);
}

// `files.delete` (docs "Onboarding contract"): the map directory is deletable only when the existing-map answer is Refresh, and only when there is a
// map to refresh. It is a statement about the staging worktree, where every regeneration happens; the user's checkout is never written (ONB-6).
export function filesDeleteFor(answer: string, existingMap: string): string[] {
  return answer === 'refresh' && existingMap !== 'none' ? [...WRITE_SETS.map] : [];
}

// The classification preflight recorded for the map the repository already has; `none` when absent or not a string.
function existingMapOf(preflight: ContractPreflight): string {
  const state = preflight['existingState'];
  const value = typeof state === 'object' && state !== null ? (state as Record<string, unknown>)['codebaseMap'] : undefined;
  return typeof value === 'string' && value !== '' ? value : 'none';
}

export function compileOnboardingContract(input: CompileInput): Result<OnboardingContract> {
  const { request, preflight } = input;

  // Promotion: none (the default), copy or commit; anything else is refused (RC-5).
  let promote: PromoteMode = ONBOARDING_PRESET.promote;
  if (request.promote !== undefined) {
    if (!isPromoteMode(request.promote)) return invalid('request.promote', promoteRefusal(request.promote));
    promote = request.promote;
  }

  let mode: MappingMode = ONBOARDING_PRESET.defaultMode;
  if (request.mode !== undefined) {
    if (typeof request.mode !== 'string' || !(MAPPING_MODES as readonly string[]).includes(request.mode)) {
      return invalid('request.mode', `unknown mapping mode ${JSON.stringify(request.mode)}`);
    }
    mode = request.mode as MappingMode;
  }

  const budgets = applyBudgetOverrides(request.budgetOverrides, mode);
  if (!budgets.ok) return budgets;

  const excluded = readDirectories('preflight.excludedDirectories', preflight.excludedDirectories);
  if (!excluded.ok) return excluded;
  const adrDirs = readDirectories('preflight.adrDirectories', preflight.adrDirectories);
  if (!adrDirs.ok) return adrDirs;

  const indexes = ONBOARDING_PRESET.indexes;
  const commands = [...ONBOARDING_PRESET.commands, ...(indexes.intel ? ONBOARDING_PRESET.intelCommands : [])];

  return ok({
    schema: 1,
    contractVersion: 1,
    onboardingId: input.onboardingId,
    runId: input.runId,
    policyPreset: 'onboarding',
    policyRevision: digestOf(ONBOARDING_PRESET),
    compiledAt: input.nowIso,
    workspace: { projectId: input.projectId, baseRevision: input.pin },
    mapping: { mode },
    files: {
      read: ['**'],
      readExclude: unique([...ONBOARDING_PRESET.readExclude, ...excluded.value]).sort(),
      secretGlobs: [...ONBOARDING_PRESET.secretGlobs],
      write: {
        map: [...WRITE_SETS.map],
        intel: [...WRITE_SETS.intel],
        knowledge: [...WRITE_SETS.knowledge],
      },
      create: {
        map: [...WRITE_SETS.map],
        intel: [...WRITE_SETS.intel],
        knowledge: [...WRITE_SETS.knowledge],
      },
      avariceWrite: [...ONBOARDING_PRESET.avariceWrite],
      delete: filesDeleteFor(ONBOARDING_PRESET.existingMapAnswer, existingMapOf(preflight)),
    },
    knowledge: {
      documents: unique([
        ...ONBOARDING_PRESET.knowledgeDocuments,
        ...adrDirs.value.sort().map((dir) => `${dir}/**/*.md`),
      ]),
    },
    execution: {
      commands,
      endpoints: [],
      toolClasses: [...ONBOARDING_PRESET.toolClasses],
      environment: 'local-sandbox',
      model: ONBOARDING_PRESET.model,
    },
    decisions: {
      defaults: [{ class: 'existing-map', default: ONBOARDING_PRESET.existingMapAnswer }],
      human: [...ONBOARDING_PRESET.humanDecisions],
      prohibited: [...ONBOARDING_PRESET.prohibitedDecisions],
    },
    budgets: budgets.value,
    delivery: { promote },
    indexes: { ...indexes },
  });
}

export function contractDigest(body: OnboardingContract): string {
  return digestOf(body);
}
