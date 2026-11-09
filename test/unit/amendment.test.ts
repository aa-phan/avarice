import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyAmendment, budgetRowChanges, classifyInvalidation, staleTargets } from '../../src/domain/amendment.ts';
import type { AmendmentContext, AmendmentRequest } from '../../src/domain/amendment.ts';
import { parseBrief } from '../../src/domain/brief.ts';
import { parseConventions } from '../../src/domain/conventions.ts';
import { BUDGET_OVERRIDE_NAMES, compileRunContract } from '../../src/domain/run-contract.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { budgetRowsOfRun } from '../../src/app/budget.ts';
import type { Result } from '../../src/domain/result.ts';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const NOW = '2026-11-08T09:00:00.000Z';

const CONVENTIONS_OBJECT = {
  schema: 1,
  checks: [
    { name: 'test', argv: ['npm', 'test'] },
    { name: 'lint', argv: ['npm', 'run', 'lint'], required: false },
    { name: 'build', argv: ['npm', 'run', 'build'], required: false },
  ],
  paths: { write: ['src/**', 'tests/unit/**'], protected: ['src/vendor/**'], artifacts: [] },
};

const ONE_ITEM_BRIEF = [
  '---',
  'title: Collapse repeated dashes in slugs',
  'size: medium',
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
].join('\n');

const TWO_ITEM_BRIEF = [
  '---',
  'title: Two items',
  `items: ${JSON.stringify([
    { id: 'A', title: 'first', dependsOn: [], size: 'small', acceptance: ['AC1'] },
    { id: 'B', title: 'second', dependsOn: ['A'], acceptance: ['AC2'] },
  ])}`,
  '---',
  '## Behavior',
  'Do the thing.',
  '',
  '## Acceptance criteria',
  '- AC1: first | verifiedBy: check:test',
  '- AC2: second | verifiedBy: check:test',
  '',
  '## Write',
  '- src/**',
  '',
].join('\n');

function compile(briefText: string, conventionsObject: unknown = CONVENTIONS_OBJECT): RunContract {
  const brief = unwrap(parseBrief(briefText, { kind: 'file', id: 'briefs/slug.md' }));
  const conventions = unwrap(parseConventions(JSON.stringify(conventionsObject)));
  return unwrap(
    compileRunContract({
      runId: 'run_01JC8Z3V7QABCDEFGHJKMNPQRS',
      projectId: 'proj_01JC8Z3V7QABCDEFGHJKMNPQRS',
      baseRevision: '9f1cd8d',
      conventionsRevision: '4e5a6b7',
      brief,
      conventions,
      nowIso: '2026-11-05T12:00:00.000Z',
    }),
  ).contract;
}

const CONTEXT: AmendmentContext = { conventionsWrite: CONVENTIONS_OBJECT.paths.write, nowIso: NOW };

function amend(contract: RunContract, request: Partial<AmendmentRequest>, reason = 'because'): ReturnType<typeof applyAmendment> {
  return applyAmendment(contract, { reason, ...request }, CONTEXT);
}

function refusal(contract: RunContract, request: Partial<AmendmentRequest>, reason?: string): { field: string; reason: string } {
  const r = amend(contract, request, reason);
  assert.equal(r.ok, false, 'expected a refusal');
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.error.kind, 'invalid');
  if (r.error.kind !== 'invalid') throw new Error('unreachable');
  return { field: r.error.field, reason: r.error.reason };
}

describe('applyAmendment tracer: a budget raise produces contract version 2 (RC-6, D-19)', () => {
  it('gives version 2, the same policyRevision, the field-level diff and no invalidation', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const result = unwrap(amend(v1, { budgets: { costUsdPerRun: 12 } }, 'room for resume'));
    assert.equal(result.contract.contractVersion, 2);
    assert.equal(result.contract.policyRevision, v1.policyRevision);
    assert.equal(result.contract.runId, v1.runId);
    assert.equal(result.contract.budgets.costUsd.perRun, 12);
    assert.equal(result.contract.budgets.costUsd.perInvocation, v1.budgets.costUsd.perInvocation);
    assert.deepEqual(result.diff, [{ path: 'budgets.costUsd.perRun', from: 10, to: 12 }]);
    assert.deepEqual(result.invalidates, []);
  });

  it('names the ledger budget row and its new limit for the changed budget', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const { contract, diff } = unwrap(amend(v1, { budgets: { costUsdPerRun: 12 } }));
    assert.deepEqual(budgetRowChanges(diff, contract), [{ name: 'costUsd', limit: 12, exactness: 'estimated' }]);
  });

  it('agrees with budgetRowsOfRun for every budget that has a ledger row', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const amended = unwrap(
      amend(v1, { budgets: { invocations: 9, toolCalls: 900, subagentsTotal: 25, wallClockMinutes: 240, costUsdPerRun: 12 } }),
    );
    const rows = budgetRowsOfRun(amended.contract);
    const changes = budgetRowChanges(amended.diff, amended.contract);
    assert.deepEqual(changes.map((c) => c.name).sort(), ['costUsd', 'invocations', 'subagentsTotal', 'toolCalls', 'wallClockMs']);
    for (const change of changes) assert.deepEqual(change, rows.find((r) => r.name === change.name));
  });

  it('names no row for a budget the ledger does not keep (the concurrent subagent cap, the per-invocation cost cap)', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const { contract, diff } = unwrap(amend(v1, { budgets: { subagentsConcurrent: 1, costUsdPerInvocation: 1 } }));
    assert.equal(diff.length, 2);
    assert.deepEqual(budgetRowChanges(diff, contract), []);
  });

  it('lowers a limit the same way, and accepts a raise above the preset ceiling (D-19 sets no upper limit)', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const lowered = unwrap(amend(v1, { budgets: { toolCalls: 100 } }));
    assert.deepEqual(lowered.diff, [{ path: 'budgets.toolCalls', from: 400, to: 100 }]);
    assert.deepEqual(lowered.invalidates, []);
    const raised = unwrap(amend(v1, { budgets: { invocations: 50 } }));
    assert.equal(raised.contract.budgets.invocations, 50);
  });

  it('refuses a zero, negative, NaN or infinite value naming budget.<name>', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = refusal(v1, { budgets: { costUsdPerRun: value } });
      assert.equal(r.field, 'budget.costUsdPerRun');
    }
  });

  it('refuses an unknown budget name and a fractional count', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.equal(refusal(v1, { budgets: { cpuSeconds: 5 } }).field, 'budget.cpuSeconds');
    const fractional = refusal(v1, { budgets: { invocations: 2.5 } });
    assert.equal(fractional.field, 'budget.invocations');
    assert.match(fractional.reason, /integer/);
  });

  it('accepts a fractional cost and every name --budget accepts', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const values: Record<(typeof BUDGET_OVERRIDE_NAMES)[number], number> = {
      wallClockMinutes: 60,
      invocations: 5,
      toolCalls: 100,
      subagentsTotal: 5,
      subagentsConcurrent: 1,
      costUsdPerInvocation: 1.5,
      costUsdPerRun: 12.5,
    };
    for (const name of BUDGET_OVERRIDE_NAMES) {
      const r = amend(v1, { budgets: { [name]: values[name] } });
      assert.equal(r.ok, true, `${name} should be amendable`);
    }
  });

  it('refuses a per-invocation cost cap above the per-run cap, and a concurrent cap above the total', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.equal(refusal(v1, { budgets: { costUsdPerRun: 1 } }).field, 'budget.costUsdPerRun');
    assert.equal(refusal(v1, { budgets: { subagentsTotal: 1 } }).field, 'budget.subagentsTotal');
    assert.equal(amend(v1, { budgets: { costUsdPerRun: 1, costUsdPerInvocation: 1 } }).ok, true);
  });

  it('does not mutate the input contract and returns a separate object', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const before = structuredClone(v1);
    const { contract } = unwrap(amend(v1, { budgets: { costUsdPerRun: 12 } }));
    assert.deepEqual(v1, before);
    assert.notEqual(contract, v1);
    assert.notEqual(contract.budgets, v1.budgets);
    assert.equal(v1.contractVersion, 1);
  });

  it('refuses an empty request, and one that changes nothing, with `nothing to amend`', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.match(refusal(v1, {}).reason, /nothing to amend/);
    assert.match(refusal(v1, { budgets: {} }).reason, /nothing to amend/);
    assert.match(refusal(v1, { budgets: { costUsdPerRun: 10 } }).reason, /nothing to amend/);
  });

  it('refuses a reason that is empty, blank or over 500 characters, and accepts one of exactly 500', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const budgets = { costUsdPerRun: 12 };
    assert.equal(refusal(v1, { budgets }, '').field, 'reason');
    assert.equal(refusal(v1, { budgets }, '   ').field, 'reason');
    assert.equal(refusal(v1, { budgets }, 'x'.repeat(501)).field, 'reason');
    assert.equal(amend(v1, { budgets }, 'x'.repeat(500)).ok, true);
  });

  it('stamps the next version with the given time and leaves the original compile time on version 1', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const { contract } = unwrap(amend(v1, { budgets: { costUsdPerRun: 12 } }));
    assert.equal(contract.compiledAt, NOW);
    assert.equal(v1.compiledAt, '2026-11-05T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Scope, checks and acceptance amendments with their D-20 invalidation classes.
// ---------------------------------------------------------------------------------------------------------------------
const TWO_REQUIRED_CONVENTIONS = {
  ...CONVENTIONS_OBJECT,
  checks: [
    { name: 'test', argv: ['npm', 'test'] },
    { name: 'lint', argv: ['npm', 'run', 'lint'] },
    { name: 'build', argv: ['npm', 'run', 'build'], required: false },
  ],
};

describe('applyAmendment: --add-write (D-20 scope, T-03-16)', () => {
  it('adds a glob inside the conventions write set to files.write and files.create and invalidates scope-conformance', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const r = unwrap(amend(v1, { addWrite: ['tests/unit/date-copy.test.ts'] }));
    assert.deepEqual(r.contract.files.write, [...v1.files.write, 'tests/unit/date-copy.test.ts']);
    assert.deepEqual(r.contract.files.create, [...v1.files.create, 'tests/unit/date-copy.test.ts']);
    assert.deepEqual(r.diff, [
      { path: 'files.write', added: ['tests/unit/date-copy.test.ts'] },
      { path: 'files.create', added: ['tests/unit/date-copy.test.ts'] },
    ]);
    assert.deepEqual(r.invalidates, ['scope-conformance']);
    assert.deepEqual(r.contract.files.protected, v1.files.protected);
  });

  it('refuses a glob outside the conventions write set, naming add-write', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    for (const glob of ['scripts/x.ts', 'src-evil/**', '**', 'tests/**']) {
      const r = refusal(v1, { addWrite: [glob] });
      assert.equal(r.field, 'add-write', glob);
      assert.match(r.reason, /write set/);
    }
  });

  it('refuses a protected path, whether the conventions or the preset protect it', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const fromConventions = refusal(v1, { addWrite: ['src/vendor/lib.ts'] });
    assert.equal(fromConventions.field, 'add-write');
    assert.match(fromConventions.reason, /protected/);
    const wide = applyAmendment(v1, { addWrite: ['.github/workflows/ci.yml'], reason: 'r' }, { conventionsWrite: ['**'], nowIso: NOW });
    assert.equal(wide.ok, false);
    if (!wide.ok && wide.error.kind === 'invalid') {
      assert.equal(wide.error.field, 'add-write');
      assert.match(wide.error.reason, /protected/);
    }
  });

  it('refuses a malformed glob and a list that is not strings', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    for (const glob of ['/etc/passwd', '../x', 'src/../x', '', 'src\\x']) {
      assert.equal(refusal(v1, { addWrite: [glob] }).field, 'add-write', glob);
    }
    assert.equal(refusal(v1, { addWrite: [5 as unknown as string] }).field, 'add-write');
    assert.equal(refusal(v1, { addWrite: 'src/x.ts' as unknown as string[] }).field, 'add-write');
  });

  it('skips a glob the contract already holds, and refuses a request that adds nothing new', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.match(refusal(v1, { addWrite: ['src/**'] }).reason, /nothing to amend/);
    const r = unwrap(amend(v1, { addWrite: ['src/**', 'tests/unit/a.test.ts', 'tests/unit/a.test.ts'] }));
    assert.deepEqual(r.diff, [
      { path: 'files.write', added: ['tests/unit/a.test.ts'] },
      { path: 'files.create', added: ['tests/unit/a.test.ts'] },
    ]);
  });
});

describe('applyAmendment: --check +name / -name (D-20 required checks, AUT-16)', () => {
  it('makes a declared check required and invalidates all check evidence', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.deepEqual(v1.verification.requiredChecks, ['test']);
    const r = unwrap(amend(v1, { checks: [{ op: '+', name: 'build' }] }));
    assert.deepEqual(r.contract.verification.requiredChecks, ['test', 'build']);
    assert.deepEqual(r.diff, [{ path: 'verification.requiredChecks', added: ['build'] }]);
    assert.deepEqual(r.invalidates, ['check-evidence']);
  });

  it('makes a required check not required, keeping the declaration', () => {
    const v1 = compile(ONE_ITEM_BRIEF, TWO_REQUIRED_CONVENTIONS);
    assert.deepEqual(v1.verification.requiredChecks, ['test', 'lint']);
    const r = unwrap(amend(v1, { checks: [{ op: '-', name: 'test' }] }));
    assert.deepEqual(r.contract.verification.requiredChecks, ['lint']);
    assert.deepEqual(r.diff, [{ path: 'verification.requiredChecks', removed: ['test'] }]);
    assert.deepEqual(r.invalidates, ['check-evidence']);
    assert.equal(r.contract.execution.checks.some((c) => c.name === 'test'), true);
  });

  it('applies an add and a remove together, in one diff entry', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const r = unwrap(amend(v1, { checks: [{ op: '+', name: 'build' }, { op: '-', name: 'test' }] }));
    assert.deepEqual(r.contract.verification.requiredChecks, ['build']);
    assert.deepEqual(r.diff, [{ path: 'verification.requiredChecks', added: ['build'], removed: ['test'] }]);
  });

  it('refuses removing the only required check, naming check', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const r = refusal(v1, { checks: [{ op: '-', name: 'test' }] });
    assert.equal(r.field, 'check');
    assert.match(r.reason, /required/);
  });

  it('refuses an undeclared check, a conflicting pair and a malformed entry', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.equal(refusal(v1, { checks: [{ op: '+', name: 'nope' }] }).field, 'check');
    assert.equal(refusal(v1, { checks: [{ op: '-', name: 'nope' }] }).field, 'check');
    assert.equal(refusal(v1, { checks: [{ op: '+', name: 'build' }, { op: '-', name: 'build' }] }).field, 'check');
    assert.equal(refusal(v1, { checks: [{ op: '*' as '+', name: 'build' }] }).field, 'check');
    assert.equal(refusal(v1, { checks: [{ op: '+', name: 'Build!' }] }).field, 'check');
  });

  it('leaves the contract as it is when the check is already in the asked state, so the request changes nothing', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.match(refusal(v1, { checks: [{ op: '+', name: 'test' }] }).reason, /nothing to amend/);
    assert.match(refusal(v1, { checks: [{ op: '-', name: 'lint' }] }).reason, /nothing to amend/);
  });
});

describe('applyAmendment: --acceptance (D-20 acceptance, G0)', () => {
  it('changes an existing criterion on its own item and invalidates gates, mappings and checks', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    const r = unwrap(amend(v1, { acceptance: { text: '- AC2: new wording | verifiedBy: check:test' } }));
    assert.equal(r.contract.intent.acceptance.find((c) => c.id === 'AC2')?.text, 'new wording');
    assert.deepEqual(r.contract.intent.workItems.map((w) => w.acceptance), [['AC1'], ['AC2']]);
    assert.deepEqual(r.diff, [{ path: 'intent.acceptance.AC2.text', from: 'second', to: 'new wording' }]);
    assert.deepEqual(r.invalidates, ['gates', 'acceptance-mappings', 'checks-rerun']);
  });

  it('diffs a changed verifiedBy list', () => {
    const v1 = compile(TWO_ITEM_BRIEF, TWO_REQUIRED_CONVENTIONS);
    const r = unwrap(amend(v1, { acceptance: { text: '- AC1: first | verifiedBy: check:test, check:lint' } }));
    assert.deepEqual(r.diff, [{ path: 'intent.acceptance.AC1.verifiedBy', from: ['check:test'], to: ['check:test', 'check:lint'] }]);
  });

  it('adds a new criterion to the item named by item', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    const r = unwrap(amend(v1, { acceptance: { text: '- AC9: extra | verifiedBy: check:test', item: 'B' } }));
    assert.deepEqual(r.contract.intent.acceptance.map((c) => c.id), ['AC1', 'AC2', 'AC9']);
    assert.deepEqual(r.contract.intent.workItems.find((w) => w.id === 'B')?.acceptance, ['AC2', 'AC9']);
    assert.deepEqual(r.contract.intent.workItems.find((w) => w.id === 'A')?.acceptance, ['AC1']);
    assert.deepEqual(r.diff, [
      { path: 'intent.acceptance', added: ['AC9'] },
      { path: 'intent.workItems[B].acceptance', added: ['AC9'] },
    ]);
    assert.deepEqual(r.invalidates, ['gates', 'acceptance-mappings', 'checks-rerun']);
  });

  it('ignores item for an existing ID and leaves that ID on its own item', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    const r = unwrap(amend(v1, { acceptance: { text: '- AC1: reworded | verifiedBy: check:test', item: 'B' } }));
    assert.deepEqual(r.contract.intent.workItems.map((w) => w.acceptance), [['AC1'], ['AC2']]);
  });

  it('requires item for a new criterion on a run with more than one item, and names item', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    const r = refusal(v1, { acceptance: { text: '- AC9: extra | verifiedBy: check:test' } });
    assert.equal(r.field, 'item');
    assert.equal(refusal(v1, { acceptance: { text: '- AC9: extra | verifiedBy: check:test', item: 'Z' } }).field, 'item');
  });

  it('puts a new criterion on the only item of a one-item run when item is omitted', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const r = unwrap(amend(v1, { acceptance: { text: '- AC2: more | verifiedBy: check:test' } }));
    assert.deepEqual(r.contract.intent.workItems[0]?.acceptance, ['AC1', 'AC2']);
  });

  it('refuses text that is not acceptance lines, an empty file and more than 20 criteria, naming acceptance', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    assert.equal(refusal(v1, { acceptance: { text: 'prose, not a bullet' } }).field, 'acceptance');
    assert.equal(refusal(v1, { acceptance: { text: '- AC2 no colon' } }).field, 'acceptance');
    assert.equal(refusal(v1, { acceptance: { text: '\n  \n' } }).field, 'acceptance');
    const many = Array.from({ length: 20 }, (_, n) => `- AC${n + 2}: c | verifiedBy: check:test`).join('\n');
    assert.equal(refusal(v1, { acceptance: { text: many } }).field, 'acceptance');
  });

  it('refuses a result G0 rejects: an undeclared check reference or a criterion with no verifiedBy', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const undeclared = refusal(v1, { acceptance: { text: '- AC1: first | verifiedBy: check:nope' } });
    assert.equal(undeclared.field, 'g0');
    assert.match(undeclared.reason, /check-declared/);
    const bare = refusal(v1, { acceptance: { text: '- AC2: no proof' } });
    assert.equal(bare.field, 'g0');
    assert.match(bare.reason, /acceptance-verified-by/);
  });

  it('changes nothing when the criterion is identical', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    assert.match(refusal(v1, { acceptance: { text: '- AC1: first | verifiedBy: check:test' } }).reason, /nothing to amend/);
  });
});

describe('applyAmendment: combined requests', () => {
  it('gives the union of the classes in the order gates, acceptance-mappings, checks-rerun, scope-conformance, check-evidence, approvals', () => {
    const v1 = compile(TWO_ITEM_BRIEF);
    const r = unwrap(
      amend(v1, {
        budgets: { toolCalls: 100 },
        addWrite: ['tests/unit/a.test.ts'],
        checks: [{ op: '+', name: 'build' }],
        acceptance: { text: '- AC1: reworded | verifiedBy: check:test' },
      }),
    );
    assert.deepEqual(r.invalidates, ['gates', 'acceptance-mappings', 'checks-rerun', 'scope-conformance', 'check-evidence']);
    assert.equal(r.contract.contractVersion, 2);
    assert.equal(r.diff.length, 5);
  });

  it('gives scope-conformance alone for a write amendment beside a budget change', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const r = unwrap(amend(v1, { budgets: { toolCalls: 100 }, addWrite: ['tests/unit/a.test.ts'] }));
    assert.deepEqual(r.invalidates, ['scope-conformance']);
  });

  it('does not apply any part of a request that is refused in another part, and never mutates the input', () => {
    const v1 = compile(ONE_ITEM_BRIEF);
    const before = structuredClone(v1);
    const refused = amend(v1, { budgets: { toolCalls: 100 }, addWrite: ['scripts/x.ts'] });
    assert.equal(refused.ok, false);
    assert.deepEqual(v1, before);
    const applied = unwrap(amend(v1, { budgets: { toolCalls: 100 }, addWrite: ['tests/unit/a.test.ts'], checks: [{ op: '+', name: 'build' }] }));
    assert.deepEqual(v1, before);
    assert.notEqual(applied.contract.files.write, v1.files.write);
    assert.notEqual(applied.contract.verification.requiredChecks, v1.verification.requiredChecks);
  });
});

describe('classifyInvalidation: the D-20 table', () => {
  it('acceptance criteria: all gate results and acceptance mappings, and checks re-run', () => {
    for (const path of ['intent.acceptance', 'intent.acceptance.AC1.text', 'intent.acceptance.AC1.verifiedBy', 'intent.workItems[B].acceptance']) {
      assert.deepEqual(classifyInvalidation([{ path }]), ['gates', 'acceptance-mappings', 'checks-rerun'], path);
    }
  });

  it('writable or protected paths: scope-conformance results', () => {
    for (const path of ['files.write', 'files.create', 'files.protected', 'files.delete']) {
      assert.deepEqual(classifyInvalidation([{ path }]), ['scope-conformance'], path);
    }
  });

  it('required checks: all check evidence', () => {
    assert.deepEqual(classifyInvalidation([{ path: 'verification.requiredChecks' }]), ['check-evidence']);
  });

  it('policy revision: gate results and approvals that cite the old revision', () => {
    assert.deepEqual(classifyInvalidation([{ path: 'policyRevision' }]), ['gates', 'approvals']);
  });

  it('budgets, notifications and exclusions: nothing', () => {
    for (const path of ['budgets.toolCalls', 'budgets.costUsd.perRun', 'notify.reviewReady', 'intent.exclusions']) {
      assert.deepEqual(classifyInvalidation([{ path }]), [], path);
    }
  });

  it('combines entries into one list in the canonical order with no repeats', () => {
    const diff = [{ path: 'verification.requiredChecks' }, { path: 'policyRevision' }, { path: 'intent.acceptance' }, { path: 'files.write' }, { path: 'budgets.toolCalls' }];
    assert.deepEqual(classifyInvalidation(diff), ['gates', 'acceptance-mappings', 'checks-rerun', 'scope-conformance', 'check-evidence', 'approvals']);
  });
});

describe('staleTargets: appended rows only (T-03-17)', () => {
  const evidence = [
    { evidenceId: 'ev_1', kind: 'check', contractVersion: 1, status: 'passed', acceptance: ['AC1'] },
    { evidenceId: 'ev_2', kind: 'check', contractVersion: 2, status: 'passed', acceptance: [] },
    { evidenceId: 'ev_3', kind: 'check', contractVersion: 2, status: 'failed', acceptance: ['AC1'] },
    { evidenceId: 'ev_4', kind: 'diff', contractVersion: 2, status: 'passed', acceptance: ['AC2'] },
    { evidenceId: 'ev_5', kind: 'check', contractVersion: 2, status: 'stale', acceptance: ['AC1'] },
    { evidenceId: 'ev_6', kind: 'gsd-verdict', contractVersion: 2, status: 'passed' },
  ];
  const gates = [
    { gate: 'G1', passed: true },
    { gate: 'G2', passed: true },
    { gate: 'G4', passed: false },
    { gate: 'G4', passed: true },
  ];

  it('check-evidence lists every check-kind evidence row at the latest contract version that is not stale yet, and no gate', () => {
    assert.deepEqual(staleTargets(['check-evidence'], evidence, gates), { evidenceIds: ['ev_2', 'ev_3'], gates: [] });
  });

  it('scope-conformance lists gates G2 and G4 when they stand as passed', () => {
    assert.deepEqual(staleTargets(['scope-conformance'], evidence, gates), { evidenceIds: [], gates: ['G2', 'G4'] });
    assert.deepEqual(staleTargets(['scope-conformance'], evidence, [{ gate: 'G2', passed: true }]), { evidenceIds: [], gates: ['G2'] });
    assert.deepEqual(staleTargets(['scope-conformance'], evidence, []), { evidenceIds: [], gates: [] });
  });

  it('judges a gate by its latest row: a gate whose latest row failed has no pass to invalidate', () => {
    const later = [{ gate: 'G2', passed: true }, { gate: 'G2', passed: false }];
    assert.deepEqual(staleTargets(['scope-conformance'], [], later), { evidenceIds: [], gates: [] });
  });

  it('gates lists every gate that stands as passed; acceptance-mappings lists the latest evidence that maps acceptance', () => {
    assert.deepEqual(staleTargets(['gates'], evidence, gates), { evidenceIds: [], gates: ['G1', 'G2', 'G4'] });
    assert.deepEqual(staleTargets(['acceptance-mappings'], evidence, gates), { evidenceIds: ['ev_3', 'ev_4'], gates: [] });
  });

  it('unions the classes, and lists nothing for no class, for a rerun or for approvals', () => {
    assert.deepEqual(staleTargets(['check-evidence', 'gates'], evidence, gates), { evidenceIds: ['ev_2', 'ev_3'], gates: ['G1', 'G2', 'G4'] });
    assert.deepEqual(staleTargets([], evidence, gates), { evidenceIds: [], gates: [] });
    assert.deepEqual(staleTargets(['checks-rerun', 'approvals'], evidence, gates), { evidenceIds: [], gates: [] });
    assert.deepEqual(staleTargets(['check-evidence'], [], gates), { evidenceIds: [], gates: [] });
  });

  it('never mutates its inputs and returns only IDs: it proposes appended rows, never an update or a delete', () => {
    const e = structuredClone(evidence);
    const g = structuredClone(gates);
    const out = staleTargets(['check-evidence', 'scope-conformance'], e, g);
    assert.deepEqual(e, evidence);
    assert.deepEqual(g, gates);
    assert.deepEqual(Object.keys(out).sort(), ['evidenceIds', 'gates']);
  });
});
