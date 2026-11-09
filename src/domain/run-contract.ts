// Run contract compiler for the `routine` preset (docs/contracts-and-state.md "Run contract", RC-1, RC-2, RC-5).
// Pure: the clock, the ids and the parsed brief and conventions are arguments. The compiler is the one place where a
// run's authority is fixed, and it only narrows: a brief or the repository conventions never raise a budget, widen the
// write set past the conventions, write a protected path, or grant the agent git, avarice or network commands.
import { digestOf } from './digest.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import type { Brief, BriefItem } from './brief.ts';
import { isRefusedAgentCommand } from './conventions.ts';
import type { CheckSpec, Conventions } from './conventions.ts';
import { matchesGlob } from './glob.ts';

export const ROUTINE_POLICY = 'routine';

// How the run's invocation count is derived (D-13): one work item runs one invocation, the CON-16 discard-and-retry runs
// a second, and one more covers a relaunch after an interruption (a killed invocation stays charged).
export interface InvocationDerivation {
  units: number;
  retries: number;
  interruptionRelaunches: number;
  total: number;
  formula: string;
}

// How the run's subagent total is derived: one quick unit spawns a planner, up to two plan-checker passes, an executor and
// a verifier (5 per unit), and a CON-16 retry runs the unit again. RESEARCH A7 suggested 8; 10 covers a full retry.
export interface SubagentDerivation {
  perUnit: { planner: number; planChecker: number; executor: number; verifier: number; total: number };
  rounds: number;
  total: number;
  formula: string;
}

export interface BudgetAdjustment {
  field: string;
  from: number;
  to: number;
  reason: string;
}

export interface RunBudgets {
  wallClockMinutes: number;
  invocations: number;
  invocationsDerivation: InvocationDerivation;
  toolCalls: number;
  subagentsConcurrent: number;
  subagentsTotal: number;
  subagentsDerivation: SubagentDerivation;
  costUsd: { perInvocation: number; perRun: number; exactness: 'estimated' | 'exact' };
  repairAttemptsPerCheck: number;
  repairAttemptsReason: string;
  retry: number;
  // Values the compiler moved so the budgets stay consistent (a per-invocation cap above the per-run cap).
  adjustments: BudgetAdjustment[];
}

const INVOCATION_DERIVATION: InvocationDerivation = {
  units: 1,
  retries: 1,
  interruptionRelaunches: 1,
  total: 3,
  formula: '1 unit invocation + 1 CON-16 retry + 1 interruption relaunch = 3',
};

const SUBAGENT_DERIVATION: SubagentDerivation = {
  perUnit: { planner: 1, planChecker: 2, executor: 1, verifier: 1, total: 5 },
  rounds: 2,
  total: 10,
  formula: '(1 planner + 2 plan-checker + 1 executor + 1 verifier = 5 per unit) x 2 rounds (the unit and one CON-16 retry) = 10',
};

const SECRET_GLOBS = ['**/*.key', '**/*.pem', '**/.env', '**/.env.*', '**/id_ed25519*', '**/id_rsa*'];

// Preset values. Changing any value changes `policyRevision`.
export const ROUTINE_PRESET = {
  id: ROUTINE_POLICY,
  readExclude: ['.git'],
  secretGlobs: SECRET_GLOBS,
  protected: [
    '.avarice/**',
    '.github/**',
    '.claude/**',
    '.git/**',
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.gitignore',
    'CLAUDE.md',
  ],
  // GSD quick-task bookkeeping stays off the review branch (D-17).
  artifacts: ['.planning/quick/**', '.planning/STATE.md', '.planning/config.json'],
  toolClasses: ['read', 'search', 'edit', 'write', 'shell', 'subagent'],
  defaultSize: 'medium',
  modelBySize: { small: 'haiku', medium: 'sonnet', large: 'opus' },
  budgets: {
    wallClockMinutes: 60,
    invocations: 3,
    invocationsDerivation: INVOCATION_DERIVATION,
    toolCalls: 400,
    subagentsConcurrent: 2,
    subagentsTotal: 10,
    subagentsDerivation: SUBAGENT_DERIVATION,
    costUsd: { perInvocation: 2.0, perRun: 5.0, exactness: 'estimated' },
    repairAttemptsPerCheck: 0,
    repairAttemptsReason: 'no repair work items exist in this phase: a failing required check ends the run rather than opening a repair item',
    retry: 1,
  },
  decisions: {
    delegated: ['internal naming', 'test structure', 'refactors inside write paths'],
    human: ['user-visible behavior changes', 'new dependencies', 'public API changes', 'scope expansion', 'acceptance criteria changes'],
    prohibited: ['policy changes', 'budget changes', 'credential changes', 'merge', 'push'],
  },
  escalation: { consecutiveDenials: 3, consecutiveSearches: 25, noProgressInvocations: 2 },
  delivery: { endpoint: 'ready_for_review', handoff: 'local-branch', pushBranch: false, draftPr: false },
  notify: ['local'],
  verification: {
    gsdVerifier: 'required-passed',
    baseline: 'delta',
    afterEachItem: 'required-checks',
    integrityGates: ['no-new-overrides', 'no-test-deletion', 'no-skip-markers', 'scope-conformance', 'prune-is-decision'],
  },
} as const;

export interface RunWorkItem {
  id: string;
  task: string;
  size: 'small' | 'medium' | 'large';
  model: string;
  modelSource: 'brief' | 'modelBySize';
  dependsOn: string[];
  // IDs of the acceptance criteria this item owns; every criterion belongs to exactly one item.
  acceptance: string[];
  spec: { files: string[]; symbols: string[]; configKeys: string[]; references: string[]; derived: string[] };
}

export interface RunContract {
  schema: 1;
  // A number, so an amendment can write version n+1; a compiled contract starts at 1.
  contractVersion: number;
  runId: string;
  policyPreset: typeof ROUTINE_POLICY;
  policyRevision: string;
  compiledAt: string;
  intent: {
    title: string;
    behavior: string;
    acceptance: Array<{ id: string; text: string; verifiedBy: string[] }>;
    exclusions: string[];
    requirementRefs: Array<{ provider: string; kind: string; id: string; revision: string }>;
    workItems: RunWorkItem[];
    expectedDecisions?: number;
  };
  workspace: { projectId: string; baseRevision: string; conventionsRevision: string; branch: string };
  files: {
    read: string[];
    readExclude: string[];
    secretGlobs: string[];
    write: string[];
    create: string[];
    delete: string[];
    protected: string[];
    artifacts: string[];
  };
  execution: {
    commands: string[];
    checks: CheckSpec[];
    toolClasses: string[];
    endpoints: string[];
    supervisorEndpoints: string[];
    dependencies: { install: string[]; lockfile: string } | null;
    environment: 'local-sandbox';
    modelBySize: { small: string; medium: string; large: string };
  };
  decisions: { delegated: string[]; defaults: Array<{ class: string; default: string }>; human: string[]; prohibited: string[] };
  budgets: RunBudgets;
  verification: {
    requiredChecks: string[];
    targetChecks: string[];
    testInventory: { argv?: string[]; globs: string[] } | null;
    gsdVerifier: string;
    baseline: string;
    afterEachItem: string;
    integrityGates: string[];
  };
  delivery: { endpoint: string; handoff: string; pushBranch: boolean; draftPr: boolean };
  escalation: { consecutiveDenials: number; consecutiveSearches: number; noProgressInvocations: number };
  notify: { reviewReady: string[]; blocking: string[]; digest: string[] };
}

// Facts the start command reads from the index (graph and intel) and hands to the pure compiler (D-07 stage 1).
export interface IndexFacts {
  files: readonly string[];
  symbolsByFile: Readonly<Record<string, readonly string[]>>;
}

export interface ScaledBudgetLimits {
  wallClockMinutes: number;
  invocations: number;
  invocationsDerivation: InvocationDerivation;
  toolCalls: number;
  subagentsConcurrent: number;
  subagentsTotal: number;
  subagentsDerivation: SubagentDerivation;
  costUsd: { perInvocation: number; perRun: number };
}

// Stub: the scaled limits arrive with the green step of the plan.
export function scaledBudgetLimits(itemCount: number): ScaledBudgetLimits {
  void itemCount;
  const preset = ROUTINE_PRESET.budgets;
  return {
    wallClockMinutes: preset.wallClockMinutes,
    invocations: preset.invocations,
    invocationsDerivation: structuredClone(INVOCATION_DERIVATION),
    toolCalls: preset.toolCalls,
    subagentsConcurrent: preset.subagentsConcurrent,
    subagentsTotal: preset.subagentsTotal,
    subagentsDerivation: structuredClone(SUBAGENT_DERIVATION),
    costUsd: { perInvocation: preset.costUsd.perInvocation, perRun: preset.costUsd.perRun },
  };
}

export interface RunCompileInput {
  runId: string;
  projectId: string;
  baseRevision: string;
  conventionsRevision: string;
  brief: Brief;
  conventions: Conventions;
  nowIso: string;
  // Only `routine` is compiled here; any other name is refused.
  policy?: string;
  // `--budget` style overrides. Untrusted: validated here, and they can only lower a preset value.
  budgetOverrides?: unknown;
  // Index facts the compiler derives item specs from; without them a spec derives from the write set alone.
  indexFacts?: IndexFacts;
}

export interface G0Failure {
  rule: string;
  detail: string;
}

export const BUDGET_OVERRIDE_NAMES = [
  'wallClockMinutes',
  'invocations',
  'toolCalls',
  'subagentsTotal',
  'subagentsConcurrent',
  'costUsdPerInvocation',
  'costUsdPerRun',
] as const;
type BudgetOverrideName = (typeof BUDGET_OVERRIDE_NAMES)[number];

const OVERRIDE_LIMITS: Readonly<Record<BudgetOverrideName, { limit: number; integer: boolean }>> = {
  wallClockMinutes: { limit: ROUTINE_PRESET.budgets.wallClockMinutes, integer: true },
  invocations: { limit: ROUTINE_PRESET.budgets.invocations, integer: true },
  toolCalls: { limit: ROUTINE_PRESET.budgets.toolCalls, integer: true },
  subagentsTotal: { limit: ROUTINE_PRESET.budgets.subagentsTotal, integer: true },
  subagentsConcurrent: { limit: ROUTINE_PRESET.budgets.subagentsConcurrent, integer: true },
  costUsdPerInvocation: { limit: ROUTINE_PRESET.budgets.costUsd.perInvocation, integer: false },
  costUsdPerRun: { limit: ROUTINE_PRESET.budgets.costUsd.perRun, integer: false },
};

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const unique = (items: readonly string[]): string[] => [...new Set(items)];

const hasGlobSyntax = (glob: string): boolean => /[*?[\]{}]/.test(glob);

// Whether every path `inner` can match is inside `outer`. Equal strings, or `**`, or an outer `dir/**` with an inner that is
// `dir` or starts with `dir/` (a prefix alone is not containment: `src-evil/**` is not inside `src/**`), or a concrete
// path the outer glob matches. Anything else is treated as not contained, so the check errs toward refusing.
export function globWithin(inner: string, outer: string): boolean {
  if (inner === outer || outer === '**') return true;
  if (outer.endsWith('/**')) {
    const prefix = outer.slice(0, -3);
    if (!hasGlobSyntax(prefix) && (inner === prefix || inner.startsWith(`${prefix}/`))) return true;
  }
  return !hasGlobSyntax(inner) && matchesGlob(inner, outer);
}

const withinAny = (inner: string, outers: readonly string[]): boolean => outers.some((outer) => globWithin(inner, outer));

function applyBudgetOverrides(raw: unknown): Result<RunBudgets> {
  const preset = ROUTINE_PRESET.budgets;
  const budgets: RunBudgets = {
    wallClockMinutes: preset.wallClockMinutes,
    invocations: preset.invocations,
    invocationsDerivation: structuredClone(INVOCATION_DERIVATION),
    toolCalls: preset.toolCalls,
    subagentsConcurrent: preset.subagentsConcurrent,
    subagentsTotal: preset.subagentsTotal,
    subagentsDerivation: structuredClone(SUBAGENT_DERIVATION),
    costUsd: { ...preset.costUsd },
    repairAttemptsPerCheck: preset.repairAttemptsPerCheck,
    repairAttemptsReason: preset.repairAttemptsReason,
    retry: preset.retry,
    adjustments: [],
  };
  if (raw === undefined) return ok(budgets);
  if (!isPlainObject(raw)) return invalid('budget', 'overrides must be an object of budget names to numbers');

  for (const [key, value] of Object.entries(raw)) {
    const field = `budget.${key}`;
    if (!(BUDGET_OVERRIDE_NAMES as readonly string[]).includes(key)) {
      return invalid(field, `unknown budget; the overridable budgets are ${BUDGET_OVERRIDE_NAMES.join(', ')}`);
    }
    const spec = OVERRIDE_LIMITS[key as BudgetOverrideName];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return invalid(field, 'must be a finite number above 0');
    if (spec.integer && !Number.isInteger(value)) return invalid(field, 'must be an integer');
    if (value > spec.limit) return invalid(field, `budgets can only be lowered: ${value} is above the preset ${spec.limit}`);
    switch (key as BudgetOverrideName) {
      case 'wallClockMinutes':
        budgets.wallClockMinutes = value;
        break;
      case 'invocations':
        budgets.invocations = value;
        break;
      case 'toolCalls':
        budgets.toolCalls = value;
        break;
      case 'subagentsTotal':
        budgets.subagentsTotal = value;
        break;
      case 'subagentsConcurrent':
        budgets.subagentsConcurrent = value;
        break;
      case 'costUsdPerInvocation':
        budgets.costUsd.perInvocation = value;
        break;
      case 'costUsdPerRun':
        budgets.costUsd.perRun = value;
        break;
    }
  }

  // A cap that sits above the cap that contains it could never bind: move it down and say so.
  if (budgets.costUsd.perInvocation > budgets.costUsd.perRun) {
    budgets.adjustments.push({
      field: 'costUsd.perInvocation',
      from: budgets.costUsd.perInvocation,
      to: budgets.costUsd.perRun,
      reason: 'a per-invocation cost cap above the per-run cap is lowered to the per-run cap',
    });
    budgets.costUsd.perInvocation = budgets.costUsd.perRun;
  }
  if (budgets.subagentsConcurrent > budgets.subagentsTotal) {
    budgets.adjustments.push({
      field: 'subagentsConcurrent',
      from: budgets.subagentsConcurrent,
      to: budgets.subagentsTotal,
      reason: 'a concurrent subagent cap above the total cap is lowered to the total cap',
    });
    budgets.subagentsConcurrent = budgets.subagentsTotal;
  }
  return ok(budgets);
}

// G0 (docs/contracts-and-state.md "Phase gates"), the conditions that can be judged from the contract alone. The host
// enforcement condition is evaluated at the run's verify-enforcement step, not here (AUT-7).
export function checkG0Static(contract: RunContract): G0Failure[] {
  const failures: G0Failure[] = [];
  const declared = new Set(contract.execution.checks.map((check) => check.name));
  if (contract.intent.acceptance.length === 0) {
    failures.push({ rule: 'acceptance-present', detail: 'the contract has no acceptance criterion' });
  }
  for (const criterion of contract.intent.acceptance) {
    if (criterion.verifiedBy.length === 0) {
      failures.push({ rule: 'acceptance-verified-by', detail: `${criterion.id} has no verifiedBy` });
    } else if (!criterion.verifiedBy.some((ref) => ref.startsWith('check:') || ref.startsWith('test:') || ref.startsWith('diff:'))) {
      // A decision: reference marks a choice that belongs to the owner; it is never evidence by itself.
      failures.push({ rule: 'acceptance-verified-by', detail: `${criterion.id} needs a check, test or diff reference beside decision:` });
    }
    for (const ref of criterion.verifiedBy) {
      if (ref.startsWith('check:') && !declared.has(ref.slice('check:'.length))) {
        failures.push({ rule: 'check-declared', detail: `${criterion.id}: ${ref} names no declared check` });
      }
      if (ref.startsWith('test:') && contract.verification.testInventory === null) {
        failures.push({ rule: 'test-inventory-declared', detail: `${criterion.id}: ${ref} needs a declared test inventory` });
      }
    }
  }
  for (const name of contract.verification.targetChecks) {
    if (!declared.has(name)) failures.push({ rule: 'target-check-declared', detail: `target check ${name} is not declared` });
  }
  if (contract.verification.requiredChecks.length === 0) {
    failures.push({ rule: 'required-check-present', detail: 'no required check is declared in the repository conventions' });
  }
  return failures;
}

// One work item per brief item in declaration order, or the single item A that owns every criterion when the brief has no
// items (a Phase 2 brief). A size the brief did not give is the preset default and is named in `spec.derived`; a model the
// brief did not give is the size's `modelBySize` entry (D-10).
function compileWorkItems(brief: Brief, write: readonly string[], protectedGlobs: readonly string[]): Result<RunWorkItem[]> {
  const preset = ROUTINE_PRESET;
  // A brief without items is the single item A that owns every criterion, with the brief's own size and model.
  const items: BriefItem[] = brief.items ?? [
    {
      id: 'A',
      title: brief.title,
      dependsOn: [],
      acceptance: brief.acceptance.map((c) => c.id),
      ...(brief.size !== undefined ? { size: brief.size } : {}),
      ...(brief.model !== undefined ? { model: brief.model } : {}),
    },
  ];
  const out: RunWorkItem[] = [];
  for (const [n, item] of items.entries()) {
    // An explicit spec.files can only narrow the run's write set (RC-5, T-03-05).
    for (const glob of item.spec?.files ?? []) {
      const field = `brief.items[${n}].spec.files`;
      if (withinAny(glob, protectedGlobs)) return invalid(field, `${glob} is a protected path`);
      if (!withinAny(glob, write)) return invalid(field, `${glob} is not inside the write set of the run`);
    }
    const size = item.size ?? preset.defaultSize;
    const derived: string[] = item.size === undefined ? ['size'] : [];
    const spec = item.spec ?? {};
    const files = spec.files !== undefined ? [...spec.files] : [...write];
    if (spec.files === undefined) derived.push('files');
    if (spec.symbols === undefined) derived.push('symbols');
    if (spec.configKeys === undefined) derived.push('configKeys');
    if (spec.references === undefined) derived.push('references');
    out.push({
      id: item.id,
      task: item.title,
      size,
      model: item.model ?? preset.modelBySize[size],
      modelSource: item.model !== undefined ? 'brief' : 'modelBySize',
      dependsOn: [...item.dependsOn],
      acceptance: [...item.acceptance],
      spec: {
        files,
        symbols: [...(spec.symbols ?? [])],
        configKeys: [...(spec.configKeys ?? [])],
        references: [...(spec.references ?? [])],
        derived,
      },
    });
  }
  return ok(out);
}

const RUN_ID = /^run_[0-9A-Za-z]{4,64}$/;
const PROJECT_ID = /^[0-9A-Za-z_-]{1,64}$/;
const REVISION = /^[0-9a-f]{7,64}$/;

export function compileRunContract(input: RunCompileInput): Result<{ contract: RunContract; digest: string }> {
  const { brief, conventions } = input;
  const preset = ROUTINE_PRESET;

  if (input.policy !== undefined && input.policy !== ROUTINE_POLICY) {
    return invalid('policy', `only the ${JSON.stringify(ROUTINE_POLICY)} preset is compiled here, not ${JSON.stringify(input.policy)}`);
  }
  if (typeof input.runId !== 'string' || !RUN_ID.test(input.runId)) return invalid('runId', 'must look like run_<id>');
  if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)) return invalid('projectId', 'is not a valid project ID');
  if (typeof input.baseRevision !== 'string' || !REVISION.test(input.baseRevision)) {
    return invalid('baseRevision', 'must be 7 to 64 lowercase hexadecimal digits');
  }
  if (typeof input.conventionsRevision !== 'string' || !REVISION.test(input.conventionsRevision)) {
    return invalid('conventionsRevision', 'must be 7 to 64 lowercase hexadecimal digits');
  }
  const named = brief.baseRevision;
  if (named !== undefined && !input.baseRevision.startsWith(named) && !named.startsWith(input.baseRevision)) {
    return invalid('brief.baseRevision', `the brief names ${named} but the run is pinned to ${input.baseRevision}`);
  }
  if (brief.acceptance.length === 0) {
    return invalid('brief.acceptance', 'the brief has no acceptance criteria: add a "## Acceptance criteria" section');
  }

  const budgets = applyBudgetOverrides(input.budgetOverrides);
  if (!budgets.ok) return budgets;

  // The protected list is the preset's and the repository's together; nothing the repository says removes a preset entry.
  const protectedGlobs = unique([...preset.protected, ...conventions.paths.protected]);

  // Everything the conventions let the run write (write set, artifacts, check outputs) must stay off protected paths.
  for (const glob of conventions.paths.write) {
    if (withinAny(glob, protectedGlobs)) return invalid('conventions.paths.write', `${glob} is a protected path`);
  }
  for (const glob of conventions.paths.artifacts) {
    if (withinAny(glob, protectedGlobs)) return invalid('conventions.paths.artifacts', `${glob} is a protected path`);
  }
  for (const [index, check] of conventions.checks.entries()) {
    for (const glob of check.writes) {
      if (withinAny(glob, protectedGlobs)) return invalid(`conventions.checks[${index}].writes`, `${glob} is a protected path`);
    }
  }

  // The brief can only narrow the conventions' write set (RC-5).
  let write = unique(conventions.paths.write);
  if (brief.write !== undefined) {
    for (const glob of brief.write) {
      if (withinAny(glob, protectedGlobs)) return invalid('brief.write', `${glob} is a protected path`);
      if (!withinAny(glob, conventions.paths.write)) {
        return invalid('brief.write', `${glob} is not inside the write set of the repository conventions`);
      }
    }
    write = unique(brief.write);
  }
  if (write.length === 0) return invalid('files.write', 'the run would have no writable path: the conventions declare no write set');

  const commands = unique([...conventions.agentCommands, ...conventions.checks.map((check) => check.argv.join(' '))]);
  for (const command of commands) {
    if (isRefusedAgentCommand(command)) {
      return invalid('execution.commands', `${JSON.stringify(command)} would grant the agent a command that is never granted`);
    }
  }

  const compiledItems = compileWorkItems(brief, write, protectedGlobs);
  if (!compiledItems.ok) return compiledItems;
  const workItems = compiledItems.value;
  const contract: RunContract = {
    schema: 1,
    contractVersion: 1,
    runId: input.runId,
    policyPreset: ROUTINE_POLICY,
    policyRevision: digestOf(preset),
    compiledAt: input.nowIso,
    intent: {
      title: brief.title,
      behavior: brief.behavior,
      acceptance: brief.acceptance.map((c) => ({ id: c.id, text: c.text, verifiedBy: [...c.verifiedBy] })),
      exclusions: [...brief.exclusions],
      requirementRefs: [{ provider: 'manual', kind: 'brief', id: brief.source.id, revision: brief.digest }],
      workItems,
    },
    workspace: {
      projectId: input.projectId,
      baseRevision: input.baseRevision,
      conventionsRevision: input.conventionsRevision,
      branch: `avarice/${input.runId}`,
    },
    files: {
      read: ['**'],
      readExclude: [...preset.readExclude],
      secretGlobs: [...preset.secretGlobs],
      write: [...write],
      create: [...write],
      delete: [],
      protected: protectedGlobs,
      artifacts: unique([...preset.artifacts, ...conventions.paths.artifacts, ...conventions.checks.flatMap((check) => check.writes)]),
    },
    execution: {
      commands,
      checks: conventions.checks.map((check) => ({ ...check, argv: [...check.argv], writes: [...check.writes], env: { ...check.env } })),
      toolClasses: [...preset.toolClasses],
      endpoints: [],
      supervisorEndpoints: [...(conventions.dependencies?.registryHosts ?? [])],
      dependencies: conventions.dependencies
        ? { install: [...conventions.dependencies.install], lockfile: conventions.dependencies.lockfile }
        : null,
      environment: 'local-sandbox',
      modelBySize: { ...preset.modelBySize },
    },
    decisions: {
      delegated: [...preset.decisions.delegated],
      defaults: [],
      human: [...preset.decisions.human],
      prohibited: [...preset.decisions.prohibited],
    },
    budgets: budgets.value,
    verification: {
      requiredChecks: conventions.checks.filter((check) => check.required).map((check) => check.name),
      targetChecks: [...brief.targetChecks],
      testInventory: conventions.testInventory
        ? { ...(conventions.testInventory.argv ? { argv: [...conventions.testInventory.argv] } : {}), globs: [...conventions.testInventory.globs] }
        : null,
      gsdVerifier: preset.verification.gsdVerifier,
      baseline: preset.verification.baseline,
      afterEachItem: preset.verification.afterEachItem,
      integrityGates: [...preset.verification.integrityGates],
    },
    delivery: { ...preset.delivery },
    escalation: { ...preset.escalation },
    notify: { reviewReady: [...preset.notify], blocking: [...preset.notify], digest: [] },
  };
  if (brief.expectedDecisions !== undefined) contract.intent.expectedDecisions = brief.expectedDecisions;

  const failures = checkG0Static(contract);
  if (failures.length > 0) {
    return invalid('g0', `G0 static conditions failed: ${failures.map((f) => `${f.rule}: ${f.detail}`).join('; ')}`);
  }
  return ok({ contract, digest: digestOf(contract) });
}
