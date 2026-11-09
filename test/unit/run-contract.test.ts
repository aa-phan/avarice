import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '../../src/domain/result.ts';
import { digestOf } from '../../src/domain/digest.ts';
import { parseBrief } from '../../src/domain/brief.ts';
import type { Brief } from '../../src/domain/brief.ts';
import { parseConventions } from '../../src/domain/conventions.ts';
import type { Conventions } from '../../src/domain/conventions.ts';
import {
  BUDGET_OVERRIDE_NAMES,
  ROUTINE_PRESET,
  ROUTINE_POLICY,
  checkG0Static,
  compileRunContract,
  scaledBudgetLimits,
} from '../../src/domain/run-contract.ts';
import type { IndexFacts, RunCompileInput, RunContract } from '../../src/domain/run-contract.ts';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

export const RUN_ID = 'run_01JC8Z3V7QABCDEFGHJKMNPQRS';
export const PROJECT_ID = 'proj_01JC8Z3V7QABCDEFGHJKMNPQRS';
export const BASE = '9f1cd8d';
export const CONVENTIONS_REVISION = '4e5a6b7';
export const NOW = '2026-11-05T12:00:00.000Z';

export const BRIEF_TEXT = [
  '---',
  'title: Collapse repeated dashes in slugs',
  'size: medium',
  'expectedDecisions: 0',
  '---',
  '## Behavior',
  'A slug never contains two dashes in a row.',
  '',
  '## Acceptance criteria',
  '- AC1: Repeated dashes collapse to one | verifiedBy: check:test',
  '',
  '## Write',
  '- src/**',
  '',
  '## Target checks',
  '- test',
  '',
].join('\n');

export const CONVENTIONS_OBJECT = {
  schema: 1,
  checks: [
    { name: 'test', argv: ['npm', 'test'] },
    { name: 'lint', argv: ['npm', 'run', 'lint'] },
  ],
  paths: { write: ['src/**', 'test/**'], protected: [], artifacts: [] },
};

export function loadBrief(text: string = BRIEF_TEXT): Brief {
  return unwrap(parseBrief(text, { kind: 'file', id: 'briefs/slug.md' }));
}

export function loadConventions(object: unknown = CONVENTIONS_OBJECT): Conventions {
  return unwrap(parseConventions(JSON.stringify(object)));
}

export function inputFor(overrides: Partial<RunCompileInput> = {}): RunCompileInput {
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    baseRevision: BASE,
    conventionsRevision: CONVENTIONS_REVISION,
    brief: loadBrief(),
    conventions: loadConventions(),
    nowIso: NOW,
    ...overrides,
  };
}

describe('run contract tracer: a brief and conventions compile into a routine contract', () => {
  it('compiles the acceptance criteria, the one work item, the branch and the D-13 budgets', () => {
    const { contract, digest } = unwrap(compileRunContract(inputFor()));
    assert.equal(contract.policyPreset, ROUTINE_POLICY);
    assert.deepEqual(contract.intent.acceptance, [
      { id: 'AC1', text: 'Repeated dashes collapse to one', verifiedBy: ['check:test'] },
    ]);
    assert.equal(contract.intent.workItems.length, 1);
    assert.equal(contract.intent.workItems[0]?.id, 'A');
    assert.equal(contract.intent.workItems[0]?.size, 'medium');
    assert.equal(contract.intent.workItems[0]?.model, 'sonnet');
    assert.equal(contract.workspace.branch, `avarice/${RUN_ID}`);
    assert.match(contract.workspace.branch, /^avarice\/run_/);
    assert.equal(contract.budgets.wallClockMinutes, 120);
    assert.equal(contract.budgets.invocations, 3);
    assert.equal(contract.budgets.toolCalls, 400);
    assert.deepEqual(contract.budgets.costUsd, { perInvocation: 2, perRun: 10, exactness: 'estimated' });
    assert.equal(digest, digestOf(contract));
  });

  it('carries policyRevision equal to the digest of the preset, and it changes with any preset value', () => {
    const { contract } = unwrap(compileRunContract(inputFor()));
    assert.equal(contract.policyRevision, digestOf(ROUTINE_PRESET));
    const changed = { ...ROUTINE_PRESET, budgets: { ...ROUTINE_PRESET.budgets, toolCalls: 401 } };
    assert.notEqual(digestOf(changed), contract.policyRevision);
  });

  it('carries the loop limits: 3 consecutive denials and 25 consecutive searches (CON-14), and the revision follows the search limit', () => {
    const { contract } = unwrap(compileRunContract(inputFor()));
    assert.deepEqual(contract.escalation, { consecutiveDenials: 3, consecutiveSearches: 25, noProgressInvocations: 2 });
    const changed = { ...ROUTINE_PRESET, escalation: { ...ROUTINE_PRESET.escalation, consecutiveSearches: 26 } };
    assert.notEqual(digestOf(changed), contract.policyRevision);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Task 3: write-set narrowing, protected paths, lower-only budgets, agent commands, model override and G0 static.
// ---------------------------------------------------------------------------------------------------------------------
function conventionsWith(patch: Record<string, unknown>): Conventions {
  return loadConventions({ ...CONVENTIONS_OBJECT, ...patch });
}

function briefWith(opts: { write?: string[]; acceptance?: string[]; targets?: string[]; front?: string[]; exclusions?: string[] }): Brief {
  const lines = ['---', 'title: A brief', ...(opts.front ?? []), '---', '## Behavior', 'Do the thing.', ''];
  lines.push('## Acceptance criteria');
  lines.push(...(opts.acceptance ?? ['- AC1: It works | verifiedBy: check:test']));
  if (opts.exclusions) lines.push('', '## Exclusions', ...opts.exclusions.map((e) => `- ${e}`));
  if (opts.write) lines.push('', '## Write', ...opts.write.map((w) => `- ${w}`));
  lines.push('', '## Target checks', ...(opts.targets ?? ['test']).map((t) => `- ${t}`), '');
  return loadBrief(lines.join('\n'));
}

function compile(overrides: Partial<RunCompileInput> = {}): RunContract {
  return unwrap(compileRunContract(inputFor(overrides))).contract;
}

function refusal(overrides: Partial<RunCompileInput> = {}): { field: string; reason: string } {
  const result = compileRunContract(inputFor(overrides));
  assert.equal(result.ok, false, 'expected a refusal');
  if (result.ok) throw new Error('unreachable');
  assert.equal(result.error.kind, 'invalid');
  return result.error as { field: string; reason: string };
}

function at(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], object);
}

describe('compileRunContract: every RC-1 field exists on a compiled contract', () => {
  const FIELDS = [
    'intent.behavior', 'intent.acceptance', 'intent.exclusions', 'intent.requirementRefs', 'intent.workItems',
    'workspace.projectId', 'workspace.baseRevision', 'workspace.conventionsRevision', 'workspace.branch',
    'files.read', 'files.readExclude', 'files.secretGlobs', 'files.write', 'files.create', 'files.delete', 'files.protected', 'files.artifacts',
    'execution.commands', 'execution.checks', 'execution.toolClasses', 'execution.endpoints', 'execution.supervisorEndpoints', 'execution.environment', 'execution.modelBySize',
    'decisions', 'budgets', 'verification', 'delivery', 'escalation', 'notify',
  ];
  const contract = compile();
  for (const field of FIELDS) {
    it(`carries ${field}`, () => {
      assert.notEqual(at(contract, field), undefined, field);
    });
  }

  it('carries the preset limits with their recorded derivations (D-13)', () => {
    const { budgets } = contract;
    assert.equal(budgets.wallClockMinutes, 120);
    assert.equal(budgets.invocations, 3);
    assert.equal(budgets.toolCalls, 400);
    assert.equal(budgets.subagentsConcurrent, 2);
    assert.equal(budgets.subagentsTotal, 10);
    assert.equal(budgets.costUsd.perInvocation, 2);
    assert.equal(budgets.costUsd.perRun, 10);
    assert.equal(budgets.costUsd.exactness, 'estimated');
    assert.equal(budgets.repairAttemptsPerCheck, 1);
    assert.match(budgets.repairAttemptsReason, /one repair invocation.*repeated_failure/);
    assert.equal(budgets.invocationsDerivation.total, budgets.invocations);
    assert.equal(budgets.subagentsDerivation.total, budgets.subagentsTotal);
    assert.equal(budgets.subagentsDerivation.perUnit.total * budgets.subagentsDerivation.rounds, budgets.subagentsTotal);
    assert.deepEqual(budgets.adjustments, []);
  });

  it('does not share mutable state with the preset', () => {
    const before = digestOf(ROUTINE_PRESET);
    const mine = compile();
    mine.files.protected.push('x');
    mine.budgets.subagentsDerivation.perUnit.planner = 99;
    mine.execution.toolClasses.push('network');
    assert.equal(digestOf(ROUTINE_PRESET), before);
    assert.equal(compile().budgets.subagentsDerivation.perUnit.planner, 1);
  });
});

describe('compileRunContract: write set, protected paths and artifacts (RC-5)', () => {
  it('accepts a brief write path inside a conventions glob, and a brief glob equal to a conventions glob', () => {
    const inside = compile({ brief: briefWith({ write: ['src/hooks/useSwipeStep.ts'] }) });
    assert.deepEqual(inside.files.write, ['src/hooks/useSwipeStep.ts']);
    assert.deepEqual(inside.files.create, ['src/hooks/useSwipeStep.ts']);
    const equal = compile({ brief: briefWith({ write: ['src/**', 'test/**'] }) });
    assert.deepEqual(equal.files.write, ['src/**', 'test/**']);
    const narrower = compile({ brief: briefWith({ write: ['src/hooks/**'] }) });
    assert.deepEqual(narrower.files.write, ['src/hooks/**']);
  });

  it('refuses src-evil/** under conventions src/**: a prefix match is not containment (adjacency)', () => {
    const r = refusal({ brief: briefWith({ write: ['src-evil/**'] }) });
    assert.equal(r.field, 'brief.write');
    assert.equal(refusal({ brief: briefWith({ write: ['src-evil/x.ts'] }) }).field, 'brief.write');
    assert.equal(refusal({ brief: briefWith({ write: ['srcx'] }) }).field, 'brief.write');
    assert.equal(refusal({ brief: briefWith({ write: ['docs/readme.md'] }) }).field, 'brief.write');
  });

  it('refuses a brief write glob wider than the conventions, naming the field', () => {
    assert.equal(refusal({ brief: briefWith({ write: ['**'] }) }).field, 'brief.write');
    assert.equal(refusal({ brief: briefWith({ write: ['*'] }) }).field, 'brief.write');
  });

  it('refuses a brief write path equal to a protected glob or under one, even when the conventions allow everything', () => {
    const open = conventionsWith({ paths: { write: ['**'], protected: [], artifacts: [] } });
    for (const path of ['package.json', 'package-lock.json', '.github/workflows/ci.yml', '.github/**', '.avarice/config.json', '.claude/settings.json', 'CLAUDE.md']) {
      const r = refusal({ conventions: open, brief: briefWith({ write: [path] }) });
      assert.equal(r.field, 'brief.write', path);
      assert.match(r.reason, /protected/, path);
    }
    const custom = conventionsWith({ paths: { write: ['src/**'], protected: ['src/generated/**'], artifacts: [] } });
    assert.equal(refusal({ conventions: custom, brief: briefWith({ write: ['src/generated/api.ts'] }) }).field, 'brief.write');
    assert.deepEqual(compile({ conventions: custom, brief: briefWith({ write: ['src/other.ts'] }) }).files.write, ['src/other.ts']);
  });

  it('gives the conventions write set when the brief has no Write section; create mirrors write; delete is empty', () => {
    const contract = compile({ brief: briefWith({}) });
    assert.deepEqual(contract.files.write, ['src/**', 'test/**']);
    assert.deepEqual(contract.files.create, contract.files.write);
    assert.deepEqual(contract.files.delete, []);
  });

  it('refuses an empty write set, and conventions that write a protected path', () => {
    assert.equal(
      refusal({ conventions: conventionsWith({ paths: { write: [], protected: [], artifacts: [] } }), brief: briefWith({}) }).field,
      'files.write',
    );
    assert.equal(
      refusal({ conventions: conventionsWith({ paths: { write: [], protected: [], artifacts: [] } }) }).field,
      'brief.write',
    );
    const r = refusal({ conventions: conventionsWith({ paths: { write: ['package.json'], protected: [], artifacts: [] } }) });
    assert.equal(r.field, 'conventions.paths.write');
    assert.equal(refusal({ conventions: conventionsWith({ paths: { write: ['src/**'], protected: [], artifacts: ['.github/**'] } }) }).field, 'conventions.paths.artifacts');
    assert.equal(
      refusal({ conventions: conventionsWith({ checks: [{ name: 'test', argv: ['npm', 'test'], writes: ['package-lock.json'] }] }) }).field,
      'conventions.checks[0].writes',
    );
  });

  it('lists artifacts as preset, then conventions, then every check writes, de-duplicated with the order kept', () => {
    const conventions = conventionsWith({
      checks: [
        { name: 'test', argv: ['npm', 'test'], writes: ['node_modules/.cache/**', 'dist/**'] },
        { name: 'lint', argv: ['npm', 'run', 'lint'], writes: ['dist/**', 'coverage/**'] },
      ],
      paths: { write: ['src/**'], protected: ['test/fixtures/**'], artifacts: ['dist/**', 'tmp/**'] },
    });
    const { files } = compile({ conventions });
    assert.deepEqual(files.artifacts, [...ROUTINE_PRESET.artifacts, 'dist/**', 'tmp/**', 'node_modules/.cache/**', 'coverage/**']);
    assert.deepEqual(files.protected, [...ROUTINE_PRESET.protected, 'test/fixtures/**']);
  });
});

describe('compileRunContract: commands, endpoints and checks', () => {
  it('lists agent commands, then each check argv joined by one space, de-duplicated', () => {
    const conventions = conventionsWith({ agentCommands: ['npm test', 'npx tsc --noEmit <paths>'] });
    const { execution } = compile({ conventions });
    assert.deepEqual(execution.commands, ['npm test', 'npx tsc --noEmit <paths>', 'npm run lint']);
    assert.deepEqual(execution.checks.map((c) => c.name), ['test', 'lint']);
    assert.deepEqual(execution.endpoints, []);
    assert.deepEqual(execution.supervisorEndpoints, []);
  });

  it('takes supervisorEndpoints from dependencies.registryHosts and leaves endpoints empty', () => {
    const conventions = conventionsWith({
      dependencies: { install: ['npm', 'ci', '--ignore-scripts'], lockfile: 'package-lock.json', registryHosts: ['host-one.example', 'host-two.example'] },
    });
    const { execution } = compile({ conventions });
    assert.deepEqual(execution.supervisorEndpoints, ['host-one.example', 'host-two.example']);
    assert.deepEqual(execution.endpoints, []);
    assert.deepEqual(execution.dependencies, { install: ['npm', 'ci', '--ignore-scripts'], lockfile: 'package-lock.json' });
  });

  it('refuses a check whose argv would grant the agent git, avarice, claude, gh, curl, wget, ssh, scp or sudo, with field execution.commands', () => {
    for (const word of ['git', 'avarice', 'claude', 'gh', 'curl', 'wget', 'ssh', 'scp', 'sudo']) {
      const conventions = conventionsWith({ checks: [{ name: 'test', argv: ['npm', 'test'] }, { name: 'extra', argv: [word, 'x'] }] });
      assert.equal(refusal({ conventions }).field, 'execution.commands', word);
    }
  });
});

describe('compileRunContract: budgets only go down (RC-5)', () => {
  it('names the overridable budgets', () => {
    assert.deepEqual([...BUDGET_OVERRIDE_NAMES], [
      'wallClockMinutes', 'invocations', 'toolCalls', 'subagentsTotal', 'subagentsConcurrent', 'costUsdPerInvocation', 'costUsdPerRun',
    ]);
  });

  it('lowers perRun with costUsdPerRun 3', () => {
    const { budgets } = compile({ budgetOverrides: { costUsdPerRun: 3 } });
    assert.equal(budgets.costUsd.perRun, 3);
    assert.equal(budgets.costUsd.perInvocation, 2);
    assert.deepEqual(budgets.adjustments, []);
  });

  it('lowers every other budget and keeps the rest of the preset', () => {
    const { budgets } = compile({
      budgetOverrides: { wallClockMinutes: 30, invocations: 2, toolCalls: 100, subagentsTotal: 5, subagentsConcurrent: 1, costUsdPerInvocation: 1.5 },
    });
    assert.equal(budgets.wallClockMinutes, 30);
    assert.equal(budgets.invocations, 2);
    assert.equal(budgets.toolCalls, 100);
    assert.equal(budgets.subagentsTotal, 5);
    assert.equal(budgets.subagentsConcurrent, 1);
    assert.equal(budgets.costUsd.perInvocation, 1.5);
    assert.equal(budgets.costUsd.perRun, 10);
    assert.equal(compile({ budgetOverrides: { toolCalls: 400, wallClockMinutes: 60 } }).budgets.toolCalls, 400);
  });

  it('refuses a value above the preset with field budget.<name>', () => {
    const above: Record<string, number> = {
      wallClockMinutes: 121, invocations: 4, toolCalls: 401, subagentsTotal: 11, subagentsConcurrent: 3, costUsdPerInvocation: 2.01, costUsdPerRun: 11,
    };
    for (const [name, value] of Object.entries(above)) {
      assert.equal(refusal({ budgetOverrides: { [name]: value } }).field, `budget.${name}`, name);
    }
  });

  it('refuses a non-positive, non-finite, non-integer or non-numeric value with field budget.<name>', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '2', null, true]) {
      assert.equal(refusal({ budgetOverrides: { invocations: value } }).field, 'budget.invocations', String(value));
    }
    assert.equal(refusal({ budgetOverrides: { costUsdPerRun: 0 } }).field, 'budget.costUsdPerRun');
    assert.equal(refusal({ budgetOverrides: { wallClockMinutes: 30.5 } }).field, 'budget.wallClockMinutes');
    assert.equal(refusal({ budgetOverrides: { toolCalls: 1.5 } }).field, 'budget.toolCalls');
  });

  it('refuses an unknown budget name, such as retries, and a non-object override', () => {
    assert.equal(refusal({ budgetOverrides: { retries: 1 } }).field, 'budget.retries');
    assert.equal(refusal({ budgetOverrides: { repairAttemptsPerCheck: 3 } }).field, 'budget.repairAttemptsPerCheck');
    assert.equal(refusal({ budgetOverrides: JSON.parse('{"__proto__": 1}') }).field, 'budget.__proto__');
    assert.equal(refusal({ budgetOverrides: [] }).field, 'budget');
    assert.equal(refusal({ budgetOverrides: 'cheap' }).field, 'budget');
  });

  it('keeps a perInvocation below a lowered perRun, and clamps one above it, recording the move', () => {
    const kept = compile({ budgetOverrides: { costUsdPerRun: 3, costUsdPerInvocation: 1 } }).budgets;
    assert.deepEqual(kept.costUsd, { perInvocation: 1, perRun: 3, exactness: 'estimated' });
    assert.deepEqual(kept.adjustments, []);
    const clamped = compile({ budgetOverrides: { costUsdPerRun: 1.5 } }).budgets;
    assert.equal(clamped.costUsd.perRun, 1.5);
    assert.equal(clamped.costUsd.perInvocation, 1.5);
    assert.equal(clamped.adjustments.length, 1);
    assert.equal(clamped.adjustments[0]?.field, 'costUsd.perInvocation');
    assert.equal(clamped.adjustments[0]?.from, 2);
    assert.equal(clamped.adjustments[0]?.to, 1.5);
    const explicit = compile({ budgetOverrides: { costUsdPerRun: 1, costUsdPerInvocation: 1.8 } }).budgets;
    assert.equal(explicit.costUsd.perInvocation, 1);
    assert.equal(explicit.adjustments[0]?.from, 1.8);
  });

  it('does not let the conventions carry a budget: the parser has no budget key', () => {
    assert.throws(() => loadConventions({ ...CONVENTIONS_OBJECT, budgets: { toolCalls: 9999 } }));
  });
});

describe('compileRunContract: work item size and model (D-14)', () => {
  it('defaults to size medium and the modelBySize model, recording modelSource modelBySize', () => {
    const item = compile().intent.workItems[0];
    assert.equal(item?.size, 'medium');
    assert.equal(item?.model, 'sonnet');
    assert.equal(item?.modelSource, 'modelBySize');
    assert.deepEqual(compile().execution.modelBySize, { small: 'haiku', medium: 'sonnet', large: 'opus' });
  });

  it('maps a brief size through modelBySize, and lets a brief model override with modelSource brief', () => {
    const large = compile({ brief: briefWith({ front: ['size: large'] }) }).intent.workItems[0];
    assert.equal(large?.model, 'opus');
    assert.equal(large?.modelSource, 'modelBySize');
    const haiku = compile({ brief: briefWith({ front: ['model: haiku'] }) }).intent.workItems[0];
    assert.equal(haiku?.model, 'haiku');
    assert.equal(haiku?.size, 'medium');
    assert.equal(haiku?.modelSource, 'brief');
  });
});

describe('compileRunContract: input and revisions', () => {
  it('refuses a malformed run ID, project ID or revision, and a policy other than routine', () => {
    assert.equal(refusal({ runId: 'run_../x' }).field, 'runId');
    assert.equal(refusal({ runId: 'avarice' }).field, 'runId');
    assert.equal(refusal({ projectId: '' }).field, 'projectId');
    assert.equal(refusal({ baseRevision: 'main' }).field, 'baseRevision');
    assert.equal(refusal({ conventionsRevision: 'HEAD' }).field, 'conventionsRevision');
    assert.equal(refusal({ policy: 'hardening' }).field, 'policy');
    assert.equal(compile({ policy: 'routine' }).policyPreset, 'routine');
  });

  it('refuses a brief that names a base revision the run is not pinned to, and accepts a prefix of the pin', () => {
    assert.equal(refusal({ brief: briefWith({ front: ['baseRevision: abcdef1'] }) }).field, 'brief.baseRevision');
    assert.equal(compile({ brief: briefWith({ front: [`baseRevision: ${BASE}`] }) }).workspace.baseRevision, BASE);
    const long = `${BASE}${'0'.repeat(33)}`;
    assert.equal(compile({ baseRevision: long, brief: briefWith({ front: [`baseRevision: ${BASE}`] }) }).workspace.baseRevision, long);
  });
});

describe('compileRunContract: empty and ordering edges (RC-1)', () => {
  it('gives exclusions [] for a brief with no exclusions, and carries them in source order otherwise', () => {
    assert.deepEqual(compile().intent.exclusions, []);
    assert.deepEqual(compile({ brief: briefWith({ exclusions: ['zeta', 'alpha'] }) }).intent.exclusions, ['zeta', 'alpha']);
  });

  it('refuses a brief with no acceptance criteria, with field brief.acceptance', () => {
    assert.equal(refusal({ brief: briefWith({ acceptance: [] }) }).field, 'brief.acceptance');
  });

  it('keeps acceptance criteria and checks in source order', () => {
    const brief = briefWith({
      acceptance: ['- AC3: third | verifiedBy: check:lint', '- AC1: first | verifiedBy: check:test', '- AC2: second | verifiedBy: check:test, check:lint'],
    });
    const conventions = conventionsWith({
      checks: [{ name: 'zeta', argv: ['z'] }, { name: 'test', argv: ['t'] }, { name: 'lint', argv: ['l'], required: false }, { name: 'alpha', argv: ['a'] }],
    });
    const contract = compile({ brief, conventions });
    assert.deepEqual(contract.intent.acceptance.map((c) => c.id), ['AC3', 'AC1', 'AC2']);
    assert.deepEqual(contract.execution.checks.map((c) => c.name), ['zeta', 'test', 'lint', 'alpha']);
    assert.deepEqual(contract.verification.requiredChecks, ['zeta', 'test', 'alpha']);
    assert.deepEqual(contract.verification.targetChecks, ['test']);
  });

  it('gives the same contract digest for two conventions texts that differ only in JSON key order', () => {
    const forward = JSON.stringify(CONVENTIONS_OBJECT);
    const reversed = JSON.stringify(CONVENTIONS_OBJECT, (_k, v: unknown) =>
      v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse()) : v,
    );
    assert.notEqual(forward, reversed);
    const a = unwrap(compileRunContract(inputFor({ conventions: unwrap(parseConventions(forward)) })));
    const b = unwrap(compileRunContract(inputFor({ conventions: unwrap(parseConventions(reversed)) })));
    assert.equal(a.digest, b.digest);
    assert.equal(a.digest, digestOf(a.contract));
    const different = unwrap(compileRunContract(inputFor({ brief: briefWith({ acceptance: ['- AC1: other | verifiedBy: check:test'] }) })));
    assert.notEqual(different.digest, a.digest);
  });
});

describe('checkG0Static and the g0 refusal (AUT-7)', () => {
  it('passes a contract whose criteria are verified by declared checks and whose target checks are declared', () => {
    assert.deepEqual(checkG0Static(compile()), []);
  });

  it('flags an acceptance criterion with no verifiedBy', () => {
    const r = refusal({ brief: briefWith({ acceptance: ['- AC1: no way to check this'] }) });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /acceptance-verified-by/);
    assert.match(r.reason, /AC1/);
  });

  it('flags check:<name> that names no declared check', () => {
    const r = refusal({ brief: briefWith({ acceptance: ['- AC1: x | verifiedBy: check:nope'] }) });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /check-declared/);
    assert.match(r.reason, /nope/);
  });

  it('flags a target check that is not declared', () => {
    const r = refusal({ brief: briefWith({ targets: ['test', 'nope'] }) });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /target-check-declared/);
  });

  it('flags a repository with no required check', () => {
    const optional = conventionsWith({ checks: [{ name: 'test', argv: ['npm', 'test'], required: false }] });
    const r = refusal({ conventions: optional });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /required-check-present/);
    const none = refusal({
      conventions: conventionsWith({ checks: [] }),
      brief: briefWith({ acceptance: ['- AC1: x | verifiedBy: diff:src/a.ts unchanged'], targets: [] }),
    });
    assert.equal(none.field, 'g0');
    assert.match(none.reason, /required-check-present/);
  });

  it('flags a test: reference when no test inventory is declared, and accepts it when one is', () => {
    const brief = briefWith({ acceptance: ['- AC1: x | verifiedBy: check:test, test:slug.collapse'] });
    const r = refusal({ brief });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /test-inventory-declared/);
    const withInventory = conventionsWith({ testInventory: { globs: ['test/**/*.test.ts'] } });
    assert.deepEqual(checkG0Static(compile({ brief, conventions: withInventory })), []);
    assert.deepEqual(compile({ brief, conventions: withInventory }).verification.testInventory, { globs: ['test/**/*.test.ts'] });
  });

  it('lists every failure at once', () => {
    const brief = briefWith({
      acceptance: ['- AC1: a', '- AC2: b | verifiedBy: check:nope, test:x'],
      targets: ['ghost'],
    });
    const r = refusal({ brief, conventions: conventionsWith({ checks: [{ name: 'test', argv: ['npm', 'test'], required: false }] }) });
    assert.equal(r.field, 'g0');
    for (const rule of ['acceptance-verified-by', 'check-declared', 'target-check-declared', 'required-check-present', 'test-inventory-declared']) {
      assert.match(r.reason, new RegExp(rule), rule);
    }
  });

  it('returns structured failures from checkG0Static as { rule, detail }', () => {
    const contract = compile();
    const broken: RunContract = { ...contract, intent: { ...contract.intent, acceptance: [{ id: 'AC9', text: 'x', verifiedBy: [] }] } };
    const failures = checkG0Static(broken);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.rule, 'acceptance-verified-by');
    assert.match(failures[0]?.detail ?? '', /AC9/);
  });
});

describe('domain purity (NFR-3)', () => {
  it('compiles the same input to the same digest on every call and reads no clock', () => {
    const a = unwrap(compileRunContract(inputFor()));
    const b = unwrap(compileRunContract(inputFor()));
    assert.equal(a.digest, b.digest);
    assert.equal(a.contract.compiledAt, NOW);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Work items (D-06, D-10): the compiler emits one work item per brief item, each with its own acceptance, size and model.
// ---------------------------------------------------------------------------------------------------------------------
export function itemsBrief(items: unknown[], extraAcceptance: string[] = [], front: string[] = []): Brief {
  const lines = ['---', 'title: Two items', ...front, `items: ${JSON.stringify(items)}`, '---', '## Behavior', 'Do the thing.', ''];
  lines.push('## Acceptance criteria', '- AC1: first | verifiedBy: check:test', '- AC2: second | verifiedBy: check:test', ...extraAcceptance);
  lines.push('', '## Write', '- src/**', '', '## Target checks', '- test', '');
  return loadBrief(lines.join('\n'));
}

export const TWO_ITEM_LIST = [
  { id: 'A', title: 't1', dependsOn: [], size: 'small', acceptance: ['AC1'] },
  { id: 'B', title: 't2', dependsOn: ['A'], model: 'opus', acceptance: ['AC2'] },
];

describe('compileRunContract: a two-item brief compiles to two work items (tracer)', () => {
  it('gives A (small, haiku from modelBySize) and B (medium derived, opus from the brief), each with its acceptance', () => {
    const { workItems } = compile({ brief: itemsBrief(TWO_ITEM_LIST) }).intent;
    assert.deepEqual(workItems.map((w) => w.id), ['A', 'B']);
    const [a, b] = workItems;
    assert.equal(a?.size, 'small');
    assert.equal(a?.model, 'haiku');
    assert.equal(a?.modelSource, 'modelBySize');
    assert.deepEqual(a?.acceptance, ['AC1']);
    assert.deepEqual(a?.dependsOn, []);
    assert.equal(a?.task, 't1');
    assert.equal(b?.size, 'medium');
    assert.ok(b?.spec.derived.includes('size'), 'a defaulted size is named in spec.derived');
    assert.ok(!a?.spec.derived.includes('size'), 'a given size is not derived');
    assert.equal(b?.model, 'opus');
    assert.equal(b?.modelSource, 'brief');
    assert.deepEqual(b?.dependsOn, ['A']);
    assert.deepEqual(b?.acceptance, ['AC2']);
  });

  it('compiles a brief without items to the single item A that carries every criterion', () => {
    const { workItems } = compile({
      brief: briefWith({ acceptance: ['- AC1: one | verifiedBy: check:test', '- AC2: two | verifiedBy: check:test'] }),
    }).intent;
    assert.equal(workItems.length, 1);
    assert.equal(workItems[0]?.id, 'A');
    assert.deepEqual(workItems[0]?.acceptance, ['AC1', 'AC2']);
    assert.deepEqual(workItems[0]?.dependsOn, []);
  });

  it('writes contractVersion as a number an amendment can raise', () => {
    const { contract } = unwrap(compileRunContract(inputFor()));
    assert.equal(typeof contract.contractVersion, 'number');
    assert.equal(contract.contractVersion, 1);
  });
});

describe('compileRunContract: spec files stay inside the run write set (RC-7, T-03-05)', () => {
  const specItems = (a: unknown, b: unknown): unknown[] => [
    { id: 'A', title: 't1', dependsOn: [], acceptance: ['AC1'], ...(a as object) },
    { id: 'B', title: 't2', dependsOn: [], acceptance: ['AC2'], ...(b as object) },
  ];

  it('accepts two items whose explicit spec files overlap', () => {
    const { workItems } = compile({
      brief: itemsBrief(specItems({ spec: { files: ['src/lib/copy.ts', 'src/shared/**'] } }, { spec: { files: ['src/shared/**'] } })),
    }).intent;
    assert.deepEqual(workItems[0]?.spec.files, ['src/lib/copy.ts', 'src/shared/**']);
    assert.deepEqual(workItems[1]?.spec.files, ['src/shared/**']);
    assert.ok(!workItems[0]?.spec.derived.includes('files'), 'an explicit field is not derived');
    assert.ok(workItems[0]?.spec.derived.includes('symbols'));
  });

  it('refuses src-evil/** under src/** and a glob outside the write set with field brief.items[n].spec.files', () => {
    for (const glob of ['src-evil/**', 'src-evil/x.ts', 'srcx', 'docs/readme.md', '**']) {
      const r = refusal({ brief: itemsBrief(specItems({}, { spec: { files: [glob] } })) });
      assert.equal(r.field, 'brief.items[1].spec.files', glob);
    }
  });

  it('refuses a spec file on a protected path with field brief.items[n].spec.files', () => {
    const custom = conventionsWith({ paths: { write: ['src/**'], protected: ['src/generated/**'], artifacts: [] } });
    const r = refusal({ conventions: custom, brief: itemsBrief(specItems({ spec: { files: ['src/generated/api.ts'] } }, {})) });
    assert.equal(r.field, 'brief.items[0].spec.files');
    assert.match(r.reason, /protected/);
  });

  it('refuses an item whose explicit spec.files is empty before it reaches the compiler (an item must be allowed to write something)', () => {
    const parsed = parseBrief(
      ['---', 'title: x', `items: ${JSON.stringify(specItems({ spec: { files: [] } }, {}))}`, '---', '## Behavior', 'x', '## Acceptance criteria', '- AC1: a | verifiedBy: check:test', '- AC2: b | verifiedBy: check:test', ''].join('\n'),
      { kind: 'file', id: 'b.md' },
    );
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal((parsed.error as { field: string }).field, 'brief.items[0].spec.files');
  });

  it('keeps work items in declaration order, so the same brief gives the same digest', () => {
    const items = specItems({}, {});
    const a = unwrap(compileRunContract(inputFor({ brief: itemsBrief(items) })));
    const b = unwrap(compileRunContract(inputFor({ brief: itemsBrief(items) })));
    assert.equal(a.digest, b.digest);
    assert.deepEqual(a.contract.intent.workItems.map((w) => w.id), ['A', 'B']);
    const reversed = unwrap(compileRunContract(inputFor({ brief: itemsBrief([...items].reverse()) })));
    assert.deepEqual(reversed.contract.intent.workItems.map((w) => w.id), ['B', 'A']);
  });

  it('records modelSource brief when an explicit model equals the size map value, and haiku/sonnet/opus from the size otherwise', () => {
    const { workItems } = compile({
      brief: itemsBrief(specItems({ model: 'sonnet' }, { size: 'large' })),
    }).intent;
    assert.equal(workItems[0]?.model, 'sonnet');
    assert.equal(workItems[0]?.modelSource, 'brief');
    assert.equal(workItems[0]?.size, 'medium');
    assert.equal(workItems[1]?.model, 'opus');
    assert.equal(workItems[1]?.modelSource, 'modelBySize');
    assert.ok(!workItems[1]?.spec.derived.includes('size'));
  });
});

describe('checkG0Static: a decision: reference never stands alone (D-02)', () => {
  it('refuses a criterion whose only references are decision: forms, naming the criterion', () => {
    const r = refusal({ brief: briefWith({ acceptance: ['- AC1: copy is the owner\'s choice | verifiedBy: decision:fallback-wording'] }) });
    assert.equal(r.field, 'g0');
    assert.match(r.reason, /acceptance-verified-by/);
    assert.match(r.reason, /AC1 needs a check, test or diff reference beside decision:/);
  });

  it('accepts decision: beside a check, test or diff reference', () => {
    const brief = briefWith({ acceptance: ['- AC1: copy | verifiedBy: decision:fallback-wording, check:test'] });
    assert.deepEqual(checkG0Static(compile({ brief })), []);
    const diff = briefWith({ acceptance: ['- AC1: copy | verifiedBy: decision:fallback-wording, diff:src/a.ts unchanged'], targets: [] });
    assert.deepEqual(checkG0Static(compile({ brief: diff })), []);
  });

  it('flags the criterion from checkG0Static directly', () => {
    const contract = compile();
    const only: RunContract = { ...contract, intent: { ...contract.intent, acceptance: [{ id: 'AC9', text: 'x', verifiedBy: ['decision:k'] }] } };
    const failures = checkG0Static(only);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.rule, 'acceptance-verified-by');
    assert.match(failures[0]?.detail ?? '', /AC9 needs a check, test or diff reference beside decision:/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Scaled routine budgets (D-11, D-12, owner decision 1, CON-15) and spec derivation from index facts (RC-7, D-07 stage 1).
// ---------------------------------------------------------------------------------------------------------------------
function threeItemBrief(): Brief {
  const items = [
    { id: 'A', title: 't1', dependsOn: [], acceptance: ['AC1'] },
    { id: 'B', title: 't2', dependsOn: ['A'], acceptance: ['AC2'] },
    { id: 'C', title: 't3', dependsOn: ['B'], acceptance: ['AC3'] },
  ];
  const lines = ['---', 'title: Three items', `items: ${JSON.stringify(items)}`, '---', '## Behavior', 'Do the thing.', ''];
  lines.push('## Acceptance criteria');
  for (const n of [1, 2, 3]) lines.push(`- AC${n}: criterion ${n} | verifiedBy: check:test`);
  lines.push('', '## Write', '- src/**', '', '## Target checks', '- test', '');
  return loadBrief(lines.join('\n'));
}

describe('scaledBudgetLimits: the routine limits grow with the item count (D-12)', () => {
  it('gives the Phase 2 single-item values for one item, with a cost and wall clock that do not scale', () => {
    const one = scaledBudgetLimits(1);
    assert.equal(one.invocations, 3);
    assert.equal(one.subagentsTotal, 10);
    assert.equal(one.toolCalls, 400);
    assert.equal(one.wallClockMinutes, 120);
    assert.equal(one.costUsd.perRun, 10);
    assert.equal(one.costUsd.perInvocation, 2);
  });

  it('gives items x 2 + 1 invocations, items x 10 subagents and items x 400 tool calls for three items', () => {
    const three = scaledBudgetLimits(3);
    assert.equal(three.invocations, 7);
    assert.equal(three.subagentsTotal, 30);
    assert.equal(three.toolCalls, 1200);
    assert.equal(three.wallClockMinutes, 120);
    assert.equal(three.costUsd.perRun, 10);
    assert.equal(three.costUsd.perInvocation, 2);
  });

  it('records the invocation formula and a subagent derivation scaled by the item count', () => {
    const three = scaledBudgetLimits(3);
    assert.equal(three.invocationsDerivation.formula, '3 item units + 3 retries or repairs + 1 resume = 7');
    assert.equal(three.invocationsDerivation.total, 7);
    assert.equal(three.subagentsDerivation.total, 30);
    assert.equal(three.subagentsDerivation.units, 3);
    assert.equal(three.subagentsDerivation.perUnit.total * three.subagentsDerivation.rounds * three.subagentsDerivation.units, 30);
    assert.match(three.subagentsDerivation.formula, /3 items/);
  });

  it('carries the derivations onto the compiled budgets of a three-item brief', () => {
    const { budgets } = compile({ brief: threeItemBrief() });
    assert.equal(budgets.invocations, 7);
    assert.equal(budgets.subagentsTotal, 30);
    assert.equal(budgets.toolCalls, 1200);
    assert.equal(budgets.invocationsDerivation.total, 7);
    assert.equal(budgets.subagentsDerivation.total, 30);
    assert.equal(budgets.repairAttemptsPerCheck, 1);
  });
});

describe('compileRunContract: overrides only lower the scaled limits (CON-15)', () => {
  it('refuses invocations=8 for three items and accepts 5; refuses 4 for one item', () => {
    const r = refusal({ brief: threeItemBrief(), budgetOverrides: { invocations: 8 } });
    assert.equal(r.field, 'budget.invocations');
    assert.match(r.reason, /7/);
    assert.equal(compile({ brief: threeItemBrief(), budgetOverrides: { invocations: 5 } }).budgets.invocations, 5);
    assert.equal(compile({ brief: threeItemBrief(), budgetOverrides: { invocations: 7 } }).budgets.invocations, 7);
    assert.equal(refusal({ budgetOverrides: { invocations: 4 } }).field, 'budget.invocations');
  });

  it('refuses a subagent or tool-call override above the scaled limit and accepts one at or below it', () => {
    assert.equal(refusal({ brief: threeItemBrief(), budgetOverrides: { subagentsTotal: 31 } }).field, 'budget.subagentsTotal');
    assert.equal(refusal({ brief: threeItemBrief(), budgetOverrides: { toolCalls: 1201 } }).field, 'budget.toolCalls');
    assert.equal(compile({ brief: threeItemBrief(), budgetOverrides: { subagentsTotal: 30, toolCalls: 1200 } }).budgets.toolCalls, 1200);
  });

  it('refuses costUsdPerRun=11 for a one-item brief and accepts 6; cost does not scale with items', () => {
    assert.equal(refusal({ budgetOverrides: { costUsdPerRun: 11 } }).field, 'budget.costUsdPerRun');
    assert.equal(compile({ budgetOverrides: { costUsdPerRun: 6 } }).budgets.costUsd.perRun, 6);
    assert.equal(refusal({ brief: threeItemBrief(), budgetOverrides: { costUsdPerRun: 11 } }).field, 'budget.costUsdPerRun');
    assert.equal(compile({ brief: threeItemBrief() }).budgets.costUsd.perRun, 10);
  });

  it('keeps the repair limit at 1 with a reason that names one repair invocation then repeated_failure', () => {
    const { budgets } = compile();
    assert.equal(budgets.repairAttemptsPerCheck, 1);
    assert.match(budgets.repairAttemptsReason, /one repair invocation/);
    assert.match(budgets.repairAttemptsReason, /repeated_failure/);
    assert.equal(refusal({ budgetOverrides: { repairAttemptsPerCheck: 3 } }).field, 'budget.repairAttemptsPerCheck');
  });
});

describe('compileRunContract: spec derivation from index facts (RC-7, D-07 stage 1)', () => {
  const FACTS: IndexFacts = {
    files: ['src/lib/copy.ts', 'src/lib/dates.ts', 'scripts/tool.ts', 'docs/guide.md'],
    symbolsByFile: { 'src/lib/copy.ts': ['copyText', 'otherThing'], 'src/lib/dates.ts': ['formatDate'] },
  };

  function briefWithText(title: string, ac1: string, ac2 = 'second'): Brief {
    const items = [
      { id: 'A', title, dependsOn: [], acceptance: ['AC1'] },
      { id: 'B', title: 'plain', dependsOn: [], acceptance: ['AC2'] },
    ];
    const lines = ['---', 'title: Facts', `items: ${JSON.stringify(items)}`, '---', '## Behavior', 'Do the thing.', ''];
    lines.push('## Acceptance criteria', `- AC1: ${ac1} | verifiedBy: check:test`, `- AC2: ${ac2} | verifiedBy: check:test`);
    lines.push('', '## Write', '- src/**', '', '## Target checks', '- test', '');
    return loadBrief(lines.join('\n'));
  }

  it('derives files and symbols the item text names, each named in spec.derived', () => {
    const { workItems } = compile({ brief: briefWithText('Rewrite `copyText` in `src/lib/copy.ts`', 'It works'), indexFacts: FACTS }).intent;
    const a = workItems[0];
    assert.deepEqual(a?.spec.files, ['src/lib/copy.ts']);
    assert.deepEqual(a?.spec.symbols, ['copyText']);
    for (const field of ['files', 'symbols', 'configKeys', 'references']) assert.ok(a?.spec.derived.includes(field), field);
  });

  it('reads the acceptance text too, and sorts and de-duplicates each derived list', () => {
    const brief = briefWithText('Touch src/lib/dates.ts and `src/lib/copy.ts`', 'Also `src/lib/dates.ts`, `formatDate`, `copyText` and `src/lib/copy.ts`.');
    const a = compile({ brief, indexFacts: FACTS }).intent.workItems[0];
    assert.deepEqual(a?.spec.files, ['src/lib/copy.ts', 'src/lib/dates.ts']);
    assert.deepEqual(a?.spec.symbols, ['copyText', 'formatDate']);
  });

  it('gives an item that names no known path the run write set, marked derived', () => {
    const { workItems } = compile({ brief: briefWithText('Do something', 'It works'), indexFacts: FACTS }).intent;
    assert.deepEqual(workItems[0]?.spec.files, ['src/**']);
    assert.deepEqual(workItems[0]?.spec.symbols, []);
    assert.ok(workItems[0]?.spec.derived.includes('files'));
    assert.deepEqual(workItems[1]?.spec.files, ['src/**']);
  });

  it('does not take a named file that is outside the run write set', () => {
    const { workItems } = compile({ brief: briefWithText('Edit `scripts/tool.ts`', 'It works'), indexFacts: FACTS }).intent;
    assert.deepEqual(workItems[0]?.spec.files, ['src/**']);
  });

  it('derives references from a .md path under the write set or docs/, and config keys from dotted lower-case spans', () => {
    const brief = briefWithText('Update `docs/guide.md` and `notes.md`', 'Honors `budget.max-cost` and `copy.ts` and `src/lib/copy.ts`.');
    const a = compile({ brief, indexFacts: FACTS }).intent.workItems[0];
    assert.deepEqual(a?.spec.references, ['docs/guide.md']);
    assert.deepEqual(a?.spec.configKeys, ['budget.max-cost']);
    assert.deepEqual(a?.spec.files, ['src/lib/copy.ts']);
  });

  it('works without facts: files are the write set and symbols stay empty, both derived', () => {
    const a = compile({ brief: briefWithText('Rewrite `copyText` in `src/lib/copy.ts`', 'It works') }).intent.workItems[0];
    assert.deepEqual(a?.spec.files, ['src/**']);
    assert.deepEqual(a?.spec.symbols, []);
    assert.ok(a?.spec.derived.includes('files') && a?.spec.derived.includes('symbols'));
  });

  it('keeps an explicit spec field as given and not in derived, and derives the others', () => {
    const items = [{ id: 'A', title: 'Rewrite `copyText` in `src/lib/copy.ts`', dependsOn: [], acceptance: ['AC1'], spec: { files: ['src/lib/dates.ts'] } }];
    const lines = ['---', 'title: Facts', `items: ${JSON.stringify(items)}`, '---', '## Behavior', 'x', '## Acceptance criteria', '- AC1: ok | verifiedBy: check:test', '## Write', '- src/**', ''];
    const a = compile({ brief: loadBrief(lines.join('\n')), indexFacts: FACTS }).intent.workItems[0];
    assert.deepEqual(a?.spec.files, ['src/lib/dates.ts']);
    assert.ok(!a?.spec.derived.includes('files'));
    assert.ok(a?.spec.derived.includes('symbols'));
  });

  it('gives the same contract digest for the same brief and facts, and a different one when the facts differ', () => {
    const brief = briefWithText('Rewrite `copyText` in `src/lib/copy.ts`', 'It works');
    const one = unwrap(compileRunContract(inputFor({ brief, indexFacts: FACTS })));
    const two = unwrap(compileRunContract(inputFor({ brief, indexFacts: { files: [...FACTS.files].reverse(), symbolsByFile: FACTS.symbolsByFile } })));
    assert.equal(one.digest, two.digest);
    const none = unwrap(compileRunContract(inputFor({ brief })));
    assert.notEqual(one.digest, none.digest);
  });
});

describe('RC-8: the model never exceeds the explicit model or the size map entry (prohibition)', () => {
  it('maps small to haiku, medium to sonnet and large to opus, and never selects a larger model than asked', () => {
    const expected: Record<string, string> = { small: 'haiku', medium: 'sonnet', large: 'opus' };
    for (const [size, model] of Object.entries(expected)) {
      const items = [{ id: 'A', title: 't', dependsOn: [], size, acceptance: ['AC1'] }];
      const lines = ['---', 'title: x', `items: ${JSON.stringify(items)}`, '---', '## Behavior', 'x', '## Acceptance criteria', '- AC1: ok | verifiedBy: check:test', '## Write', '- src/**', ''];
      const item = compile({ brief: loadBrief(lines.join('\n')) }).intent.workItems[0];
      assert.equal(item?.model, model, size);
      assert.equal(item?.modelSource, 'modelBySize');
    }
    const explicit = [{ id: 'A', title: 't', dependsOn: [], size: 'large', model: 'haiku', acceptance: ['AC1'] }];
    const lines = ['---', 'title: x', `items: ${JSON.stringify(explicit)}`, '---', '## Behavior', 'x', '## Acceptance criteria', '- AC1: ok | verifiedBy: check:test', '## Write', '- src/**', ''];
    const item = compile({ brief: loadBrief(lines.join('\n')) }).intent.workItems[0];
    assert.equal(item?.model, 'haiku', 'an explicit model wins even over a larger size');
    assert.equal(item?.modelSource, 'brief');
  });
});
