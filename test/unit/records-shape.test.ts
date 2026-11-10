// The VERIFICATION.md shape the unit prompt states (plan 03-46; the 03-45 run 1 stop). The three lines are taken from the records sentence itself, a record is built from
// them, and the real parser and the real gate G2 read it: the stated shape passes, and the form the resumed unit of run 1 wrote (a bare first line) still fails closed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateG2 } from '../../src/domain/gates.ts';
import type { G2Facts } from '../../src/domain/gates.ts';
import { parseQuickVerification } from '../../src/domain/quick-record.ts';
import { RUN_RECORDS_SENTENCE } from '../../src/domain/run-shell-rules.ts';

// The quoted lines of the VERIFICATION clause, in the order the sentence names them: the opening fence, the three statuses, the closing fence.
function statedShape(): { open: string; statuses: string[]; close: string } {
  const clause = /VERIFICATION\.md (?:begins|starts) with[^.]*\./.exec(RUN_RECORDS_SENTENCE);
  assert.ok(clause !== null, 'the sentence has a clause that says how the VERIFICATION.md begins');
  const quoted = [...clause[0].matchAll(/'(---|status: \w+)'/g)].map((m) => m[1] as string);
  assert.equal(quoted.length, 5, `the clause names five quoted lines, found ${JSON.stringify(quoted)}`);
  return { open: quoted[0] as string, statuses: quoted.slice(1, 4), close: quoted[4] as string };
}

// A record built from the sentence's own lines, with the status line the sentence names for that status.
const record = (status: 'passed' | 'gaps_found' | 'human_needed', body = '# Verification\n\nEvery check is green.\n'): string => {
  const shape = statedShape();
  const line = shape.statuses.find((candidate) => candidate === `status: ${status}`);
  assert.ok(line !== undefined, `the sentence names status: ${status}`);
  return `${shape.open}\n${line}\n${shape.close}\n${body}`;
};

function g2(verification: G2Facts['verification']): G2Facts {
  return {
    outcome: 'progressed',
    changes: [{ path: 'src/a.ts', status: 'modified' }],
    globs: { write: ['src/**'], create: ['src/**'], artifacts: ['.planning/quick/**'], delete: [], protected: ['package.json'] },
    inventory: [],
    verification,
    newOverrides: 0,
    pruneEntries: 0,
    delta: [],
  };
}

describe('the VERIFICATION shape the records sentence states, read by the real parser and gate', () => {
  it('names a --- line, the three statuses and a --- line, in that order', () => {
    const shape = statedShape();
    assert.equal(shape.open, '---');
    assert.deepEqual(shape.statuses, ['status: passed', 'status: gaps_found', 'status: human_needed']);
    assert.equal(shape.close, '---');
  });

  it('a record in the stated shape with status passed parses as passed and passes the gsd-verification rule', () => {
    const text = record('passed');
    assert.equal(parseQuickVerification(text).status, 'passed');
    const verdict = evaluateG2(g2(parseQuickVerification(text).status));
    assert.deepEqual(verdict.failures.filter((f) => f.rule === 'gsd-verification'), []);
    assert.deepEqual(verdict, { passed: true, failures: [] });
  });

  it('the stated shape with gaps_found or human_needed reads as that status and fails the gsd-verification rule', () => {
    for (const status of ['gaps_found', 'human_needed'] as const) {
      const parsed = parseQuickVerification(record(status));
      assert.equal(parsed.status, status);
      assert.deepEqual(evaluateG2(g2(parsed.status)).failures.map((f) => f.rule), ['gsd-verification'], status);
    }
  });

  it('a record whose first line is a bare status line (run 1 of plan 03-45) reads as gaps_found and fails the gsd-verification rule', () => {
    const bare = 'status: passed\n\n# Verification\n\nEvery check is green.\n';
    const parsed = parseQuickVerification(bare);
    assert.equal(parsed.status, 'gaps_found');
    const verdict = evaluateG2(g2(parsed.status));
    assert.equal(verdict.passed, false);
    assert.deepEqual(verdict.failures.map((f) => f.rule), ['gsd-verification']);
    assert.match(verdict.failures[0]?.detail ?? '', /gaps_found, not passed/);
  });
});
