// Root placement rules (SKELETON.md "Roots", spike "paths under the Claude config directory are unwritable").
// The inputs are already realpath'd strings, so the rules are pure and need no filesystem.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRoots } from '../../src/domain/root-rules.ts';

const HOME = '/home/u';
const DATA = '/home/u/.local/share/avarice/personal-local';
const WORK = '/home/u/.local/share/avarice-work/personal-local';

function check(over: Partial<{ home: string; claudeConfigDirReal: string; dataRoot: string; workRoot: string }>) {
  return checkRoots({ home: HOME, claudeConfigDirReal: '/home/u/.claude', dataRoot: DATA, workRoot: WORK, ...over });
}

function refusal(over: Parameters<typeof check>[0]): { field: string; reason: string } {
  const r = check(over);
  assert.equal(r.ok, false, 'expected a refusal');
  if (r.ok) throw new Error('unreachable');
  assert.equal(r.error.kind, 'invalid');
  if (r.error.kind !== 'invalid') throw new Error('unreachable');
  return { field: r.error.field, reason: r.error.reason };
}

describe('checkRoots accepts', () => {
  it('the SKELETON.md defaults', () => {
    assert.deepEqual(check({}), { ok: true, value: undefined });
  });

  it('roots outside the home directory', () => {
    assert.equal(check({ dataRoot: '/srv/avarice/data', workRoot: '/srv/avarice/work' }).ok, true);
  });

  it('siblings whose names share a prefix (avarice and avarice-work)', () => {
    assert.equal(check({ dataRoot: '/x/avarice', workRoot: '/x/avarice-work' }).ok, true);
  });

  it('a directory whose name only resembles the Claude config directory', () => {
    assert.equal(check({ claudeConfigDirReal: '/opt/cfg', dataRoot: '/opt/cfgother/data' }).ok, true);
    assert.equal(check({ dataRoot: '/home/u/claude/data' }).ok, true);
  });
});

describe('checkRoots refuses a root under a ~/.claude* directory', () => {
  for (const [name, path] of [
    ['~/.claude/x', '/home/u/.claude/x'],
    ['~/.claude-edu/x', '/home/u/.claude-edu/x'],
    ['~/.claudeanything/x', '/home/u/.claudeanything/x'],
    ['~/.claude itself', '/home/u/.claude'],
    ['a deep path under ~/.claude-work', '/home/u/.claude-work/a/b/c'],
  ] as const) {
    it(`data root ${name}`, () => {
      const r = refusal({ dataRoot: path });
      assert.equal(r.field, 'dataRoot');
      assert.match(r.reason, /~\/\.claude\*/);
    });
    it(`work root ${name}`, () => {
      const r = refusal({ workRoot: path });
      assert.equal(r.field, 'workRoot');
      assert.match(r.reason, /~\/\.claude\*/);
    });
  }
});

describe('checkRoots refuses a root under or around CLAUDE_CONFIG_DIR', () => {
  it('a path equal to it', () => {
    const r = refusal({ claudeConfigDirReal: '/opt/cfg', dataRoot: '/opt/cfg' });
    assert.match(r.reason, /CLAUDE_CONFIG_DIR/);
  });

  it('a path under it', () => {
    const r = refusal({ claudeConfigDirReal: '/opt/cfg', workRoot: '/opt/cfg/avarice/work' });
    assert.equal(r.field, 'workRoot');
    assert.match(r.reason, /CLAUDE_CONFIG_DIR/);
  });

  it('a root that would contain the config directory or the home directory', () => {
    assert.equal(refusal({ claudeConfigDirReal: '/opt/cfg/inner', dataRoot: '/opt/cfg' }).field, 'dataRoot');
    assert.equal(refusal({ dataRoot: '/home/u' }).field, 'dataRoot');
    assert.equal(refusal({ workRoot: '/home' }).field, 'workRoot');
  });
});

describe('checkRoots refuses nested roots', () => {
  it('a work root inside the data root', () => {
    const r = refusal({ dataRoot: '/d/avarice', workRoot: '/d/avarice/work' });
    assert.match(r.reason, /inside/);
  });

  it('a data root inside the work root', () => {
    const r = refusal({ dataRoot: '/w/work/data', workRoot: '/w/work' });
    assert.match(r.reason, /inside/);
  });

  it('the same directory for both', () => {
    assert.equal(check({ dataRoot: '/same', workRoot: '/same' }).ok, false);
  });
});
