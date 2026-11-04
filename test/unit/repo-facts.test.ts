// parseStatus: `git status --porcelain=v2 -z` records. `!` records (ignored files) appear only when the caller asks
// for ignored files, which only the staging diff does; they are read as untracked (plan 01-22, gap P-2).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../../src/adapters/git/repo-facts.ts';

const SHA = 'a'.repeat(40);
const changed = (path: string): string => `1 .M N... 100644 100644 100644 ${SHA} ${SHA} ${path}`;
const renamed = (path: string): string => `2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 ${path}`;
const records = (...rs: string[]): string => `${rs.join('\0')}\0`;

describe('parseStatus', () => {
  it('reads ignored and untracked records alike into untracked', () => {
    assert.deepEqual(parseStatus(records('! a.txt', '? b.txt')), { modified: [], untracked: ['a.txt', 'b.txt'] });
  });

  it('keeps an ignored path with a space whole', () => {
    assert.deepEqual(parseStatus(records('! dir/with space.txt')).untracked, ['dir/with space.txt']);
  });

  it('keeps tracked changes in modified, consumes the original-path field of a rename, and never lists a ! record as modified', () => {
    const parsed = parseStatus(records(changed('src/a.ts'), renamed('new.ts'), 'old.ts', '! ignored.log'));
    assert.deepEqual(parsed.modified, ['new.ts', 'src/a.ts']);
    assert.deepEqual(parsed.untracked, ['ignored.log']);
  });

  it('returns untracked sorted whatever order git printed', () => {
    assert.deepEqual(parseStatus(records('? z.txt', '! m.txt', '? a.txt', '! b/c.txt')).untracked, ['a.txt', 'b/c.txt', 'm.txt', 'z.txt']);
  });

  it('gives empty lists for empty output', () => {
    assert.deepEqual(parseStatus(''), { modified: [], untracked: [] });
  });
});
