// Run contract compiler for the `routine` preset (docs/contracts-and-state.md "Run contract", RC-1, RC-2, RC-5).
// Pure: the clock, the ids and the parsed brief and conventions are arguments. The compiler is the one place where a
// run's authority is fixed, and it only narrows: a brief or the repository conventions never raise a budget, widen the
// write set past the conventions, write a protected path, or grant the agent git, avarice or network commands.
import { digestOf } from './digest.ts';
import { ok } from './result.ts';
import type { Result } from './result.ts';
import type { Brief } from './brief.ts';
import type { CheckSpec, Conventions } from './conventions.ts';

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
  escalation: { consecutiveDenials: 3, noProgressInvocations: 2 },
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
  spec: { files: string[]; symbols: string[]; configKeys: string[]; references: string[]; derived: string[] };
}

export interface RunContract {
  schema: 1;
  contractVersion: 1;
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
  escalation: { consecutiveDenials: number; noProgressInvocations: number };
  notify: { reviewReady: string[]; blocking: string[]; digest: string[] };
}

export interface RunCompileInput {
  runId: string;
  projectId: string;
  baseRevision: string;
  conventionsRevision: string;
  brief: Brief;
  conventions: Conventions;
  nowIso: string;
}

const unique = (items: readonly string[]): string[] => [...new Set(items)];

export function compileRunContract(input: RunCompileInput): Result<{ contract: RunContract; digest: string }> {
  const { brief, conventions } = input;
  const preset = ROUTINE_PRESET;
  const size = brief.size ?? preset.defaultSize;
  const model = brief.model ?? preset.modelBySize[size];
  const write = brief.write ?? conventions.paths.write;
  const budgets: RunBudgets = {
    ...preset.budgets,
    invocationsDerivation: { ...INVOCATION_DERIVATION },
    subagentsDerivation: { ...SUBAGENT_DERIVATION },
    costUsd: { ...preset.budgets.costUsd },
    adjustments: [],
  };
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
      workItems: [
        {
          id: 'A',
          task: brief.title,
          size,
          model,
          modelSource: brief.model !== undefined ? 'brief' : 'modelBySize',
          dependsOn: [],
          spec: { files: [...write], symbols: [], configKeys: [], references: [], derived: ['files', 'symbols', 'configKeys', 'references'] },
        },
      ],
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
      protected: unique([...preset.protected, ...conventions.paths.protected]),
      artifacts: unique([...preset.artifacts, ...conventions.paths.artifacts, ...conventions.checks.flatMap((c) => c.writes)]),
    },
    execution: {
      commands: unique([...conventions.agentCommands, ...conventions.checks.map((c) => c.argv.join(' '))]),
      checks: conventions.checks.map((c) => ({ ...c, argv: [...c.argv], writes: [...c.writes], env: { ...c.env } })),
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
    budgets,
    verification: {
      requiredChecks: conventions.checks.filter((c) => c.required).map((c) => c.name),
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
  return ok({ contract, digest: digestOf(contract) });
}
