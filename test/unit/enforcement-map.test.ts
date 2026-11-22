// Plan 04-06 Task 3 (SEC-6, D-17, T-04-15): the enforcement map is a code table. Every row names its enforcer, AVARICE's role, its bypass
// limitation and the tracked test that proves it, or `unverified` with a reason; the rows the host limitations 3 and 4 leave open are
// unverified and claimed by no profile. The checker is exercised on synthetic tables first (duplicate id, empty cells, an untracked test
// path, a missing `not-claimed`) and then on the real table, as test/unit/containment-matrix.test.ts does for the containment matrix.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENFORCEMENT_MAP, ENFORCERS } from '../../src/domain/enforcement-map.ts';
import type { EnforcementRow } from '../../src/domain/enforcement-map.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function trackedFiles(): ReadonlySet<string> {
  return new Set(execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((l) => l !== ''));
}

// Everything wrong with a table; empty means the table is sound.
export function mapProblems(rows: readonly EnforcementRow[], tracked: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const where = `row ${JSON.stringify(row.id)}`;
    if (typeof row.id !== 'string' || row.id.trim() === '') problems.push(`${where}: empty id`);
    if (seen.has(row.id)) problems.push(`${where}: duplicate id`);
    seen.add(row.id);
    for (const cell of ['control', 'avariceRole', 'bypassLimitation'] as const) {
      if (typeof row[cell] !== 'string' || row[cell].trim() === '') problems.push(`${where}: empty ${cell}`);
    }
    if (!(ENFORCERS as readonly string[]).includes(row.enforcer)) problems.push(`${where}: empty or unknown enforcer ${JSON.stringify(row.enforcer)}`);
    if (row.test.kind === 'test') {
      if (!tracked.has(row.test.path)) problems.push(`${where}: test ${row.test.path} is not a tracked file`);
    } else if (row.test.reason.trim() === '') {
      problems.push(`${where}: unverified without a reason`);
    }
    if (row.hostLimitation !== undefined && (row.test.kind !== 'unverified' || row.profileStrength !== 'not-claimed')) {
      problems.push(`${where}: a row a host limitation leaves open must be unverified and not-claimed`);
    }
    if (row.profileStrength === 'not-claimed' && row.test.kind !== 'unverified') problems.push(`${where}: not-claimed with a proving test`);
    if (row.enforcer === 'external-platform' && row.test.kind !== 'unverified') problems.push(`${where}: an external platform's enforcement is not proved by an AVARICE test`);
  }
  return problems;
}

const GOOD: EnforcementRow = {
  id: 'a',
  control: 'c',
  enforcer: 'avarice',
  avariceRole: 'owns',
  bypassLimitation: 'a user with file access',
  test: { kind: 'unverified', reason: 'proved by plan 04-99' },
};
const NONE: ReadonlySet<string> = new Set();

describe('the table checker (control cases)', () => {
  it('accepts a sound row', () => {
    assert.deepEqual(mapProblems([GOOD], NONE), []);
  });

  it('fails two rows with the same id (adjacency)', () => {
    assert.equal(mapProblems([GOOD, { ...GOOD }], NONE).length, 1);
  });

  it('fails an empty enforcer or an empty bypass cell, and a blank one (empty)', () => {
    assert.equal(mapProblems([{ ...GOOD, enforcer: '' as never }], NONE).length, 1);
    assert.equal(mapProblems([{ ...GOOD, bypassLimitation: '' }], NONE).length, 1);
    assert.equal(mapProblems([{ ...GOOD, bypassLimitation: '   ' }], NONE).length, 1);
    assert.equal(mapProblems([{ ...GOOD, avariceRole: '' }], NONE).length, 1);
  });

  it('fails a test path that is not tracked, and an unverified row with no reason', () => {
    assert.equal(mapProblems([{ ...GOOD, test: { kind: 'test', path: 'test/unit/nope.test.ts' } }], NONE).length, 1);
    assert.equal(mapProblems([{ ...GOOD, test: { kind: 'test', path: 'test/unit/yes.test.ts' } }], new Set(['test/unit/yes.test.ts'])).length, 0);
    assert.equal(mapProblems([{ ...GOOD, test: { kind: 'unverified', reason: '' } }], NONE).length, 1);
  });

  it('fails a host-limitation row that is verified or not marked not-claimed', () => {
    assert.equal(mapProblems([{ ...GOOD, hostLimitation: 3 }], NONE).length, 1);
    assert.equal(mapProblems([{ ...GOOD, hostLimitation: 4, profileStrength: 'not-claimed' }], NONE).length, 0);
    const verified: EnforcementRow = { ...GOOD, hostLimitation: 4, profileStrength: 'not-claimed', test: { kind: 'test', path: 'test/unit/yes.test.ts' } };
    assert.ok(mapProblems([verified], new Set(['test/unit/yes.test.ts'])).length > 0);
  });
});

describe('ENFORCEMENT_MAP (SEC-6)', () => {
  it('has at least fourteen rows, each with an enforcer from the closed set', () => {
    assert.ok(ENFORCEMENT_MAP.length >= 14, `${ENFORCEMENT_MAP.length} rows`);
    for (const row of ENFORCEMENT_MAP) assert.ok((ENFORCERS as readonly string[]).includes(row.enforcer), row.id);
  });

  it('is sound: unique ids, no empty cell, every named test file tracked', () => {
    assert.deepEqual(mapProblems(ENFORCEMENT_MAP, trackedFiles()), []);
  });

  it('covers every control of the written enforcement map and the controls the phase adds', () => {
    const ids = new Set(ENFORCEMENT_MAP.map((r) => r.id));
    for (const id of [
      'scm-branch-protection',
      'ci-gates',
      'identity',
      'host-managed-permissions',
      'sandbox-confinement',
      'tool-call-decisions',
      'budgets',
      'privileged-approval',
      'approval-single-use',
      'profile-isolation',
      'redaction',
      'prompt-injection',
      'write-scope',
      'network-scope',
      'credential-denial',
      'organization-policy-fail-closed',
      'restricted-mode',
      'hook-cost-fields',
    ]) {
      assert.ok(ids.has(id), `row ${id}`);
    }
  });

  it('marks the rows the host limitations 3 and 4 leave open unverified and not-claimed, and only those carry not-claimed', () => {
    const open = ENFORCEMENT_MAP.filter((r) => r.hostLimitation !== undefined);
    assert.deepEqual(open.map((r) => r.hostLimitation).sort(), [3, 4]);
    for (const row of open) {
      assert.equal(row.test.kind, 'unverified', row.id);
      assert.equal(row.profileStrength, 'not-claimed', row.id);
    }
    assert.deepEqual(ENFORCEMENT_MAP.filter((r) => r.profileStrength === 'not-claimed').map((r) => r.id), open.map((r) => r.id));
  });

  it('names the external platform as enforcer of its three controls and proves none of them with an AVARICE test', () => {
    const external = ENFORCEMENT_MAP.filter((r) => r.enforcer === 'external-platform').map((r) => r.id);
    assert.deepEqual(external, ['scm-branch-protection', 'ci-gates', 'identity']);
  });
});

// SEC-6 ordering: nothing sorts the map, so its order is specified here. Rewriting a row cannot reorder the map (plan 04-51).
const MAP_ORDER: readonly string[] = [
  'scm-branch-protection',
  'ci-gates',
  'identity',
  'host-managed-permissions',
  'sandbox-confinement',
  'tool-call-decisions',
  'budgets',
  'privileged-approval',
  'approval-single-use',
  'profile-isolation',
  'redaction',
  'prompt-injection',
  'write-scope',
  'network-scope',
  'credential-denial',
  'organization-policy-fail-closed',
  'restricted-mode',
  'hook-cost-fields',
];

describe('the enforcement map keeps its specified order (SEC-6 ordering, plan 04-51)', () => {
  it('lists the ids in the order of the documented table, then the rows the strength and policy sections add', () => {
    assert.deepEqual(
      ENFORCEMENT_MAP.map((row) => row.id),
      MAP_ORDER,
    );
  });

  it('keeps the privileged-approval row between budgets and approval-single-use', () => {
    const ids = ENFORCEMENT_MAP.map((row) => row.id);
    const at = ids.indexOf('privileged-approval');
    assert.equal(ids[at - 1], 'budgets');
    assert.equal(ids[at + 1], 'approval-single-use');
  });
});

describe('the privileged-approval row says what the gate does and does not do (SEC-6, IN-03, plan 04-51)', () => {
  const row = ENFORCEMENT_MAP.find((r) => r.id === 'privileged-approval') as EnforcementRow;

  it('says the hook classifies every command of a Bash call and consumes one approval per privileged command, bound to its parameters, the line and the directory', () => {
    assert.match(row.avariceRole, /classifies every command of a Bash call/);
    assert.match(row.avariceRole, /one approval per privileged command/);
    assert.match(row.avariceRole, /parameters/);
    assert.match(row.avariceRole, /line/);
    assert.match(row.avariceRole, /directory/);
    assert.doesNotMatch(row.avariceRole, /evaluates policy/, 'the hook does not evaluate policy for an attended session');
  });

  it('names the seven covered forms, as a closed list', () => {
    for (const form of ['git push', 'gh pr create', 'gh pr merge', 'gh pr edit', 'gh release create', 'gh api', 'npm publish']) {
      assert.ok(row.bypassLimitation.includes(form), `the row does not name ${form}`);
    }
    assert.match(row.bypassLimitation, /only these/i);
  });

  it('names the residual bypasses: an earlier separate call, and names built at run time', () => {
    assert.match(row.bypassLimitation, /earlier separate call/);
    assert.match(row.bypassLimitation, /built at run time/);
    assert.match(row.bypassLimitation, /variables, aliases, functions, scripts/);
    assert.match(row.bypassLimitation, /removed hook/);
  });

  it('names a tracked test as its proof, in place and not unverified', () => {
    assert.deepEqual(row.test, { kind: 'test', path: 'test/integration/hook-privileged.test.ts' });
    assert.ok(trackedFiles().has('test/integration/hook-privileged.test.ts'));
  });

  it('keeps passing the table checker', () => {
    assert.deepEqual(mapProblems(ENFORCEMENT_MAP, trackedFiles()), []);
  });
});
