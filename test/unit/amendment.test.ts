import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyAmendment, budgetRowChanges } from '../../src/domain/amendment.ts';
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

function compile(briefText: string): RunContract {
  const brief = unwrap(parseBrief(briefText, { kind: 'file', id: 'briefs/slug.md' }));
  const conventions = unwrap(parseConventions(JSON.stringify(CONVENTIONS_OBJECT)));
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
