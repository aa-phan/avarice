// restrictedMapPrompt (plan 04-34, product defect found by the first live restricted onboarding): the restricted host has no shell to resolve a home
// directory, so the map prompt names the absolute gsd-core paths the skill reads. Pure function; no host is started.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { restrictedMapPrompt } from '../../src/domain/mapping.ts';

const ROOT = '/opt/tools/claude-home/gsd-core';

describe('restrictedMapPrompt', () => {
  it('keeps the map prompt first and names the absolute map workflow files under the given gsd-core root', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase --fast', ROOT);
    assert.ok(out.startsWith('/gsd-map-codebase --fast\n'), out);
    assert.ok(out.includes(`${ROOT}/workflows/map-codebase.md`), out);
    assert.ok(out.includes(`${ROOT}/workflows/scan.md`), out);
  });

  it('names no home directory in any form: no tilde, no $HOME', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase --fast', ROOT);
    assert.ok(!out.includes('~'), `no tilde in: ${out}`);
    assert.ok(!/\$\{?HOME/.test(out), `no $HOME in: ${out}`);
  });

  it('drops trailing slashes of the root, the form the hook policy holds', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase', `${ROOT}//`);
    assert.ok(out.includes(`${ROOT}/workflows/scan.md`), out);
    assert.ok(!out.includes('//workflows'), out);
  });

  it('keeps a prompt that carries an existing-map answer intact and ahead of the paths', () => {
    const base = '/gsd-map-codebase --fast\nIf .planning/codebase already exists, answer the question about it with: Refresh.';
    const out = restrictedMapPrompt(base, ROOT);
    assert.ok(out.startsWith(`${base}\n`), out);
  });

  it('refuses a root that is not an absolute path, so a guess never reaches the model', () => {
    for (const bad of ['', 'gsd-core', '~/.claude/gsd-core', '$HOME/.claude/gsd-core']) {
      assert.throws(() => restrictedMapPrompt('/gsd-map-codebase --fast', bad), /absolute/, bad);
    }
  });
});
