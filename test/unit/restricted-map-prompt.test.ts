// restrictedMapPrompt (plan 04-34): the restricted host has no shell and confines the file tools to the working directory, so the map prompt names the GSD
// specs where AVARICE stages them inside the working directory (owner ruling (a) after the second D-04 stop). Pure function; no host is started.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { restrictedMapPrompt } from '../../src/domain/mapping.ts';

describe('restrictedMapPrompt', () => {
  it('keeps the map prompt first and names the map and fast scan workflows at their staged paths, relative to the working directory', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase --fast');
    assert.ok(out.startsWith('/gsd-map-codebase --fast\n'), out);
    assert.ok(out.includes('.claude/gsd-core/workflows/map-codebase.md'), out);
    assert.ok(out.includes('.claude/gsd-core/workflows/scan.md'), out);
  });

  it('names every path relative: nothing is absolute, no tilde and no $HOME', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase --fast');
    assert.ok(!out.includes('~'), `no tilde in: ${out}`);
    assert.ok(!/\$\{?HOME/.test(out), `no $HOME in: ${out}`);
    for (const match of out.matchAll(/(.)\.claude\/gsd-core/g)) assert.ok(/[\s(`'"]/.test(match[1] as string), `a staged path is relative, found ${JSON.stringify(match[0])} in: ${out}`);
    assert.ok(!out.includes('/Users/') && !out.includes('/home/'), out);
  });

  it('keeps a prompt that carries an existing-map answer intact and ahead of the paths', () => {
    const base = '/gsd-map-codebase --fast\nIf .planning/codebase already exists, answer the question about it with: Refresh.';
    const out = restrictedMapPrompt(base);
    assert.ok(out.startsWith(`${base}\n`), out);
  });

  it('tells the model to read a spec from the staged copy wherever a spec names a home-directory path, and that the staged files are not the project', () => {
    const out = restrictedMapPrompt('/gsd-map-codebase --fast');
    assert.match(out, /wherever .*home-directory path/i);
    assert.match(out, /not part of the project/i);
  });

  it('refuses a staged directory that is absolute, climbs out of the working directory or names a home directory, so a guess never reaches the model', () => {
    for (const bad of ['', '/opt/gsd-core', '../gsd-core', '.claude/../../gsd-core', '~/.claude/gsd-core', '$HOME/.claude/gsd-core']) {
      assert.throws(() => restrictedMapPrompt('/gsd-map-codebase --fast', bad), /relative/, bad);
    }
  });
});
