// The records of a GSD quick unit (plan 02-13; AUT-7, T-02-43, T-02-44): pure parsing of model-written text into the facts a gate reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countPruneEntries, parseQuickVerification, quickRecordKind, storedText } from '../../src/domain/quick-record.ts';

describe('parseQuickVerification', () => {
  it('reads the status of the frontmatter and nothing else in the text', () => {
    assert.deepEqual(parseQuickVerification('---\nstatus: passed\n---\n# Verification\n\nstatus: gaps_found\n'), { status: 'passed', overrides: 0 });
    assert.equal(parseQuickVerification('---\nstatus: human_needed\n---\n').status, 'human_needed');
    assert.equal(parseQuickVerification('---\nstatus: "passed"\n---\n').status, 'passed');
  });

  it('a record that is absent is `missing`, and a status it does not know, or no frontmatter at all, blocks (gaps_found)', () => {
    assert.equal(parseQuickVerification(null).status, 'missing');
    assert.equal(parseQuickVerification('---\nstatus: great\n---\n').status, 'gaps_found');
    assert.equal(parseQuickVerification('# Verification\n\nstatus: passed\n').status, 'gaps_found', 'a status line in the body is prose, not the frontmatter');
    assert.equal(parseQuickVerification('---\nscore: 3\n---\n').status, 'gaps_found');
  });

  it('counts the overrides: overrides_applied, or the entries under overrides, whichever is larger', () => {
    assert.equal(parseQuickVerification('---\nstatus: passed\noverrides_applied: 2\n---\n').overrides, 2);
    assert.equal(parseQuickVerification('---\nstatus: passed\noverrides:\n  - must_have: a\n    reason: b\n  - must_have: c\n---\n').overrides, 2);
    assert.equal(parseQuickVerification('---\nstatus: passed\noverrides_applied: 1\noverrides:\n  - must_have: a\n  - must_have: b\n  - must_have: c\n---\n').overrides, 3);
    assert.equal(parseQuickVerification('---\nstatus: passed\noverrides_applied: 0\n---\n').overrides, 0);
  });
});

describe('countPruneEntries and quickRecordKind', () => {
  it('counts the node-repair PRUNE lines of a record', () => {
    assert.equal(countPruneEntries(null), 0);
    assert.equal(countPruneEntries('# Summary\n[Node Repair - PRUNE] Task 2 skipped: infeasible\n[Node Repair - PRUNE] Task 3 skipped: nothing to do\n'), 2);
    assert.equal(countPruneEntries('# Summary\nPRUNE is a word\n'), 0);
  });

  it('names the record by the GSD file name, and only under .planning/quick', () => {
    assert.equal(quickRecordKind('.planning/quick/261105-a1b-fix/261105-a1b-SUMMARY.md'), 'summary');
    assert.equal(quickRecordKind('.planning/quick/261105-a1b-fix/261105-a1b-VERIFICATION.md'), 'verification');
    assert.equal(quickRecordKind('.planning/quick/261105-a1b-fix/261105-a1b-PLAN.md'), 'plan');
    assert.equal(quickRecordKind('.planning/quick/261105-a1b-fix/notes.md'), 'other');
    assert.equal(quickRecordKind('src/SUMMARY.md'), null);
    assert.equal(quickRecordKind('.planning/phases/01-x/01-01-SUMMARY.md'), null);
  });
});

describe('storedText', () => {
  it('removes control, zero-width and bidirectional characters, keeps the line feed, and cuts to the limit (T-02-44)', () => {
    assert.equal(storedText('a\u001b[31mb\u0007c​d‮e\nf', 100), 'a[31mbcde\nf');
    assert.equal(storedText('x'.repeat(30), 10), 'x'.repeat(10));
    assert.equal(storedText('', 10), '');
  });
});
