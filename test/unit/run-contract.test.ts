import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Result } from '../../src/domain/result.ts';
import { digestOf } from '../../src/domain/digest.ts';
import { parseBrief } from '../../src/domain/brief.ts';
import type { Brief } from '../../src/domain/brief.ts';
import { parseConventions } from '../../src/domain/conventions.ts';
import type { Conventions } from '../../src/domain/conventions.ts';
import {
  ROUTINE_PRESET,
  ROUTINE_POLICY,
  compileRunContract,
} from '../../src/domain/run-contract.ts';
import type { RunCompileInput } from '../../src/domain/run-contract.ts';

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
    assert.equal(contract.budgets.wallClockMinutes, 60);
    assert.equal(contract.budgets.invocations, 3);
    assert.equal(contract.budgets.toolCalls, 400);
    assert.deepEqual(contract.budgets.costUsd, { perInvocation: 2, perRun: 5, exactness: 'estimated' });
    assert.equal(digest, digestOf(contract));
  });

  it('carries policyRevision equal to the digest of the preset, and it changes with any preset value', () => {
    const { contract } = unwrap(compileRunContract(inputFor()));
    assert.equal(contract.policyRevision, digestOf(ROUTINE_PRESET));
    const changed = { ...ROUTINE_PRESET, budgets: { ...ROUTINE_PRESET.budgets, toolCalls: 401 } };
    assert.notEqual(digestOf(changed), contract.policyRevision);
  });
});
