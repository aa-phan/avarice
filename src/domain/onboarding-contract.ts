// Onboarding contract compiler (docs/repository-onboarding.md "Onboarding contract";
// docs/contracts-and-state.md "Run contract"). Pure: the clock, ids and preflight facts are arguments.
//
// The compiler is where RC-5 is enforced for onboarding: promotion other than `none` and any budget
// above the preset are refused here, so no later stage has to remember to check.
import { digestOf } from './digest.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { MAPPING_MODES } from './mapping.ts';
import type { MappingMode } from './mapping.ts';
import { CORPUS_LIMITS } from './knowledge-corpus.ts';

// How the run's subagent total is derived (deferred item 11): the subagents one map round spawns in the mapping mode, times
// the map rounds (the first map and its retries), plus the knowledge pass allowance, plus intel's none. Stored in the contract
// so the number is explained by the contract that carries it.
export interface SubagentDerivation {
  mode: MappingMode;
  mapAgents: number;
  mapRounds: number;
  knowledgeAllowance: number;
  intelAgents: number;
  // The derived ceiling; `budgets.subagentsTotal` is this value or a lower override.
  total: number;
  formula: string;
}

export interface OnboardingBudgets {
  wallClockMinutes: number;
  wallClockShares: { map: number; intel: number; knowledge: number };
  invocations: number;
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
  delivery: { promote: 'none' };
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
  promote: 'none',
  budgets: {
    wallClockMinutes: 45,
    wallClockShares: { map: 20, intel: 10, knowledge: 15 },
    invocations: 4,
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
    // The knowledge pass spawns one subagent per `documentsPerSubagent` documents, up to the corpus cap.
    knowledgeAllowance: Math.ceil(CORPUS_LIMITS.maxFiles / CORPUS_LIMITS.documentsPerSubagent),
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
  invocations: { limit: ONBOARDING_PRESET.budgets.invocations, integer: true },
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

// The subagent total for a mapping mode and a map retry limit: map agents for the mode x (1 + retries) + the knowledge pass
// allowance + intel's none (docs/repository-onboarding.md "Onboarding contract").
export function deriveSubagents(mode: MappingMode, retry: number): SubagentDerivation {
  const { mapAgents, knowledgeAllowance, intelAgents } = ONBOARDING_PRESET.subagents;
  const perRound = mapAgents[mode];
  const mapRounds = 1 + retry;
  const total = perRound * mapRounds + knowledgeAllowance + intelAgents;
  return {
    mode,
    mapAgents: perRound,
    mapRounds,
    knowledgeAllowance,
    intelAgents,
    total,
    formula: `${perRound} map agents (${mode}) x ${mapRounds} map rounds (1 + ${retry} retry) + ${knowledgeAllowance} knowledge (ceil(${CORPUS_LIMITS.maxFiles} documents / ${CORPUS_LIMITS.documentsPerSubagent} per subagent)) + ${intelAgents} intel = ${total}`,
  };
}

function applyBudgetOverrides(raw: unknown, mode: MappingMode): Result<OnboardingBudgets> {
  const preset = ONBOARDING_PRESET.budgets;
  const budgets: OnboardingBudgets = {
    wallClockMinutes: preset.wallClockMinutes,
    wallClockShares: { ...preset.wallClockShares },
    invocations: preset.invocations,
    toolCalls: preset.toolCalls,
    subagentsConcurrent: preset.subagentsConcurrent,
    subagentsTotal: 0,
    subagentsDerivation: deriveSubagents(mode, preset.retry),
    costUsd: { ...preset.costUsd },
    retry: preset.retry,
  };
  budgets.subagentsTotal = budgets.subagentsDerivation.total;
  if (raw === undefined) return ok(budgets);
  if (!isPlainObject(raw)) return invalid('request.budgetOverrides', 'must be an object');
  let requestedSubagentsTotal: number | undefined;

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
        budgets.invocations = value;
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

export function compileOnboardingContract(input: CompileInput): Result<OnboardingContract> {
  const { request, preflight } = input;

  // Promotion: only `none` is authorized by the onboarding preset (RC-5). Copy and commit arrive in Phase 4.
  if (request.promote !== undefined && request.promote !== 'none') {
    return invalid(
      'request.promote',
      `promotion ${JSON.stringify(request.promote)} is not authorized: the onboarding preset allows only "none"`,
    );
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
      delete: [],
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
    delivery: { promote: 'none' },
    indexes: { ...indexes },
  });
}

export function contractDigest(body: OnboardingContract): string {
  return digestOf(body);
}
