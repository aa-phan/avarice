// D-35 (plan 03-51): a declared check that is neither required nor a target is reported as not run, and it is still never run. checksToRun and checksNotRun share one
// predicate, so the two lists partition the declared checks; checksNotRunOf reads the stored contract body defensively.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checksNotRun, checksToRun } from '../../src/app/checks.ts';
import { checksNotRunOf } from '../../src/app/run-status.ts';
import { parseBrief } from '../../src/domain/brief.ts';
import { parseConventions } from '../../src/domain/conventions.ts';
import { compileRunContract } from '../../src/domain/run-contract.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';

const CONVENTIONS = {
  schema: 1,
  checks: [
    { name: 'test', argv: ['npm', 'test'], required: true },
    { name: 'e2e', argv: ['node', 'scripts/e2e.mjs'], required: false },
    { name: 'lint', argv: ['npm', 'run', 'lint'], required: true },
  ],
  paths: { write: ['src/**', 'test/**'], protected: [], artifacts: [] },
};

const briefTargeting = (target: string): string =>
  [
    '---',
    'title: Collapse repeated dashes in slugs',
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
    `- ${target}`,
    '',
  ].join('\n');

function contractTargeting(target: string): RunContract {
  const brief = parseBrief(briefTargeting(target), { kind: 'file', id: 'briefs/slug.md' });
  assert.ok(brief.ok, JSON.stringify(brief));
  const conventions = parseConventions(JSON.stringify(CONVENTIONS));
  assert.ok(conventions.ok, JSON.stringify(conventions));
  const compiled = compileRunContract({
    runId: 'run_01JC8Z3V7QABCDEFGHJKMNPQRS',
    projectId: 'proj_01JC8Z3V7QABCDEFGHJKMNPQRS',
    baseRevision: '9f1cd8d',
    conventionsRevision: '4e5a6b7',
    brief: brief.value,
    conventions: conventions.value,
    nowIso: '2026-11-05T12:00:00.000Z',
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  return compiled.value.contract;
}

describe('checksNotRun and checksToRun partition the declared checks (D-35)', () => {
  it('names the declared check that is neither required nor a target, and still leaves it out of checksToRun', () => {
    const contract = contractTargeting('test');
    assert.deepEqual(checksNotRun(contract), ['e2e']);
    assert.deepEqual(
      checksToRun(contract).map((c) => c.spec.name),
      ['test', 'lint'],
    );
  });

  it('a check named as a target is not in the not-run list', () => {
    const contract = contractTargeting('e2e');
    assert.deepEqual(checksNotRun(contract), []);
    assert.deepEqual(
      checksToRun(contract).map((c) => c.spec.name),
      ['test', 'e2e', 'lint'],
    );
  });

  it('the two lists are disjoint and their union is every declared name, in declaration order', () => {
    for (const target of ['test', 'e2e', 'lint']) {
      const contract = contractTargeting(target);
      const run = checksToRun(contract).map((c) => c.spec.name);
      const notRun = checksNotRun(contract);
      assert.deepEqual(
        run.filter((name) => notRun.includes(name)),
        [],
        `disjoint for target ${target}`,
      );
      const union = contract.execution.checks.map((c) => c.name).filter((name) => run.includes(name) || notRun.includes(name));
      assert.deepEqual(union, ['test', 'e2e', 'lint'], `every declared check is in exactly one list for target ${target}`);
      assert.equal(run.length + notRun.length, contract.execution.checks.length);
    }
  });
});

describe('checksNotRunOf reads a stored contract body defensively (D-35)', () => {
  it('returns each not-run check with the reason `not required`', () => {
    const body = JSON.parse(JSON.stringify(contractTargeting('test'))) as unknown;
    assert.deepEqual(checksNotRunOf(body), [{ name: 'e2e', reason: 'not required' }]);
  });

  it('returns [] for a body that is null, a string, has no execution, or has execution.checks that is not an array', () => {
    assert.deepEqual(checksNotRunOf(null), []);
    assert.deepEqual(checksNotRunOf('contract'), []);
    assert.deepEqual(checksNotRunOf({ verification: { requiredChecks: [], targetChecks: [] } }), []);
    assert.deepEqual(checksNotRunOf({ execution: { checks: 'e2e' }, verification: { requiredChecks: [], targetChecks: [] } }), []);
  });

  it('returns [] when a name is not a string or the verification lists are not string arrays', () => {
    assert.deepEqual(checksNotRunOf({ execution: { checks: [{ name: 7 }] }, verification: { requiredChecks: [], targetChecks: [] } }), []);
    assert.deepEqual(checksNotRunOf({ execution: { checks: [{ name: 'e2e' }] }, verification: { requiredChecks: 'test', targetChecks: [] } }), []);
    assert.deepEqual(checksNotRunOf({ execution: { checks: [{ name: 'e2e' }] } }), []);
  });
});
