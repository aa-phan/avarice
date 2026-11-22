// The privileged-command line classifier (plan 04-40; FR-12, CR-01, CR-02, WR-01, WR-02; threats T-04-105, T-04-106). classifyLine answers one of three things about a
// shell line: nothing privileged, the privileged commands it holds, or "could not be read". An unreadable line is never an answer of "nothing privileged".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyLine } from '../../src/domain/privileged-commands.ts';

// `git push origin main #` followed by x up to exactly `length` characters: the comment keeps the line a push whatever its length.
const pushOfLength = (length: number): string => {
  const head = 'git push origin main #';
  return head + 'x'.repeat(length - head.length);
};

describe('the length limit is exact: 65,536 characters classify and one more is unparseable (CR-01, FR-12)', () => {
  it('classifies a git push command of exactly 65,536 characters as git.push', () => {
    const command = pushOfLength(65_536);
    assert.equal(command.length, 65_536);
    const found = classifyLine(command);
    assert.equal(found.kind, 'privileged');
    if (found.kind === 'privileged') assert.equal(found.commands[0]?.action, 'git.push');
  });

  it('says unparseable, naming the limit, for a line of 65,537 characters', () => {
    const command = pushOfLength(65_537);
    assert.equal(command.length, 65_537);
    const found = classifyLine(command);
    assert.equal(found.kind, 'unparseable');
    if (found.kind === 'unparseable') assert.match(found.reason, /65,536/);
  });
});
