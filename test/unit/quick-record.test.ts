// The records of a GSD quick unit (plan 02-13; AUT-7, T-02-43, T-02-44): pure parsing of model-written text into the facts a gate reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countPruneEntries, parseQuickPlan, parseQuickVerification, quickRecordKind, storedText } from '../../src/domain/quick-record.ts';

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

const PLAN = [
  '---',
  'phase: quick',
  'files_modified: [src/lib/copy.ts, docs/x.md]',
  '---',
  '# Plan',
  'The copy fallback covers AC1 and, for the wording, AC3.',
  '<task type="auto"><name>Task 1</name><files>src/lib/copy.ts</files></task>',
  '<task type="auto">',
  '  <name>Task 2</name>',
  '  <files>docs/x.md, src/lib/copy.ts</files>',
  '</task>',
  '<task type="checkpoint:decision" gate="blocking">',
  '  <options>',
  '    <option id="a"><name>Short</name></option>',
  '    <option id="b"><name>Long</name></option>',
  '  </options>',
  '</task>',
].join('\n');

describe('parseQuickPlan', () => {
  it('reads the modified files, the task files, the decision checkpoints and the acceptance IDs it cites', () => {
    assert.deepEqual(parseQuickPlan(PLAN), {
      filesModified: ['src/lib/copy.ts', 'docs/x.md'],
      taskFiles: ['src/lib/copy.ts', 'docs/x.md'],
      decisionCheckpoints: [{ hasAutoSelect: false, optionIds: ['a', 'b'] }],
      acceptanceRefs: ['AC1', 'AC3'],
    });
  });

  it('reads the files_modified list in its block form too, and drops quotes and backticks', () => {
    const plan = parseQuickPlan('---\nfiles_modified:\n  - src/a.ts\n  - "src/b.ts"\n  - `src/c.ts`\nother: x\n---\n');
    assert.deepEqual(plan?.filesModified, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('sees an auto_select attribute or element as a resolved checkpoint, and only there', () => {
    const attr = parseQuickPlan('<task type="checkpoint:decision" auto_select="a"><option id="a"/><option id="b"/></task>');
    assert.deepEqual(attr?.decisionCheckpoints, [{ hasAutoSelect: true, optionIds: ['a', 'b'] }]);
    const element = parseQuickPlan('<task type="checkpoint:decision"><auto_select>b</auto_select><option id="a"/><option id="b"/></task>');
    assert.deepEqual(element?.decisionCheckpoints, [{ hasAutoSelect: true, optionIds: ['a', 'b'] }]);
    const prose = parseQuickPlan('<task type="checkpoint:decision"><option id="a"/>There is no auto_select here.</task>');
    assert.equal(prose?.decisionCheckpoints[0]?.hasAutoSelect, false);
    const other = parseQuickPlan('<task type="checkpoint:human-verify"><option id="a"/></task>');
    assert.deepEqual(other?.decisionCheckpoints, []);
  });

  it('is null for text that is absent and an empty plan for text with nothing in it', () => {
    assert.equal(parseQuickPlan(null), null);
    assert.deepEqual(parseQuickPlan('nothing here'), { filesModified: [], taskFiles: [], decisionCheckpoints: [], acceptanceRefs: [] });
  });

  it('cuts input over 64 KiB and never throws on it', () => {
    const text = `---\nfiles_modified: [src/a.ts]\n---\n${'x'.repeat(70 * 1024)}\n<task type="auto"><files>src/late.ts</files></task> AC9`;
    const plan = parseQuickPlan(text);
    assert.deepEqual(plan?.filesModified, ['src/a.ts']);
    assert.deepEqual(plan?.taskFiles, []);
    assert.deepEqual(plan?.acceptanceRefs, []);
  });

  it('does not take a lookalike acceptance word as an ID', () => {
    assert.deepEqual(parseQuickPlan('AC1 xAC2 AC3x AC10 AC1')?.acceptanceRefs, ['AC1', 'AC10']);
  });
});
