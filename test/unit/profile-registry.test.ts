// knownProfileRoots (plan 04-12; SEC-1, D-19, T-04-30, T-04-32): the roots of every other profile, read from the profile configs, so a run sandbox can
// deny the data root, work root and config home of a profile whose roots were moved off the default parents. A planted config can only add a deny.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knownProfileRoots } from '../../src/adapters/fs/profile-registry.ts';

let base = '';
let home = '';

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-registry-')));
  home = join(base, 'home');
  mkdirSync(home, { recursive: true });
});
after(() => rmSync(base, { recursive: true, force: true }));

let counter = 0;
// A config home under its own directory, so cases do not see each other's profiles.
function configHomeWith(profiles: Record<string, unknown>): string {
  counter += 1;
  const configHome = join(base, `case-${String(counter)}`, 'config');
  for (const [name, config] of Object.entries(profiles)) {
    mkdirSync(join(configHome, 'profiles', name), { recursive: true });
    writeFileSync(join(configHome, 'profiles', name, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  mkdirSync(configHome, { recursive: true });
  return configHome;
}

const OWN = (): { home: string; ownDataRoot: string; ownWorkRoot: string } => ({ home, ownDataRoot: join(base, 'own', 'data'), ownWorkRoot: join(base, 'own', 'work') });

function roots(configHome: string, selected = 'personal-local', options = OWN()): string[] {
  const result = knownProfileRoots(configHome, selected, options);
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

describe('knownProfileRoots (D-19)', () => {
  it('returns the data root and work root another profile moved, and the config home', () => {
    const moved = join(base, 'moved');
    mkdirSync(moved, { recursive: true });
    const configHome = configHomeWith({
      'enterprise-acme': { schema: 1, profile: 'enterprise-acme', dataRoot: join(moved, 'acme-data'), workRoot: join(moved, 'acme-work') },
      'personal-local': { schema: 1, profile: 'personal-local', dataRoot: join(base, 'own', 'data'), workRoot: join(base, 'own', 'work') },
    });
    const found = roots(configHome);
    assert.ok(found.includes(join(moved, 'acme-data')), JSON.stringify(found));
    assert.ok(found.includes(join(moved, 'acme-work')), JSON.stringify(found));
    assert.ok(found.includes(configHome), 'the config home itself is returned');
  });

  it('never returns the selected profile roots, whichever config names them', () => {
    const own = OWN();
    const configHome = configHomeWith({
      'personal-local': { dataRoot: own.ownDataRoot, workRoot: own.ownWorkRoot },
      'personal-extended': { dataRoot: own.ownDataRoot, workRoot: join(base, 'ext-work') },
    });
    const found = roots(configHome, 'personal-local', own);
    assert.equal(found.includes(own.ownDataRoot), false);
    assert.equal(found.includes(own.ownWorkRoot), false);
    assert.ok(found.includes(join(base, 'ext-work')));
  });

  it('realpaths a root that sits behind a symbolic link and expands a leading ~/ against the home', () => {
    const real = join(base, 'real-parent');
    mkdirSync(real, { recursive: true });
    symlinkSync(real, join(base, 'link-parent'));
    const configHome = configHomeWith({ 'enterprise-acme': { dataRoot: join(base, 'link-parent', 'data'), workRoot: '~/acme-work' } });
    const found = roots(configHome);
    assert.ok(found.includes(join(real, 'data')), JSON.stringify(found));
    assert.ok(found.includes(join(home, 'acme-work')), JSON.stringify(found));
  });

  it('skips a config.json that is a symbolic link', () => {
    const configHome = configHomeWith({});
    mkdirSync(join(configHome, 'profiles', 'enterprise-linked'), { recursive: true });
    writeFileSync(join(base, 'planted.json'), JSON.stringify({ dataRoot: join(base, 'planted-data') }));
    symlinkSync(join(base, 'planted.json'), join(configHome, 'profiles', 'enterprise-linked', 'config.json'));
    assert.equal(roots(configHome).includes(join(base, 'planted-data')), false);
  });

  it('skips a profile directory whose name is not a profile name, a directory that is a link, and a file', () => {
    const configHome = configHomeWith({ Bogus: { dataRoot: join(base, 'bogus-data') }, 'not a profile': { dataRoot: join(base, 'spaced-data') } });
    mkdirSync(join(base, 'elsewhere', 'enterprise-away'), { recursive: true });
    writeFileSync(join(base, 'elsewhere', 'enterprise-away', 'config.json'), JSON.stringify({ dataRoot: join(base, 'away-data') }));
    symlinkSync(join(base, 'elsewhere', 'enterprise-away'), join(configHome, 'profiles', 'enterprise-away'));
    writeFileSync(join(configHome, 'profiles', 'enterprise-file'), 'x');
    const found = roots(configHome);
    for (const planted of ['bogus-data', 'spaced-data', 'away-data']) assert.equal(found.includes(join(base, planted)), false, planted);
  });

  it('skips a config that does not parse and goes on to the next profile', () => {
    const configHome = configHomeWith({
      'enterprise-broken': '{ not json',
      'enterprise-unknown-key': { notAKey: 1, dataRoot: join(base, 'unknown-key-data') },
      'enterprise-good': { dataRoot: join(base, 'good-data') },
    });
    const found = roots(configHome);
    assert.equal(found.includes(join(base, 'unknown-key-data')), false);
    assert.ok(found.includes(join(base, 'good-data')));
  });

  it('skips a root that is not absolute, so a planted relative path adds nothing', () => {
    const configHome = configHomeWith({ 'enterprise-rel': { dataRoot: 'relative/data', workRoot: join(base, 'rel-work') } });
    const found = roots(configHome);
    assert.equal(found.some((path) => path.endsWith('relative/data')), false);
    assert.ok(found.includes(join(base, 'rel-work')));
  });

  it('also reads the default config home when this one was moved, and returns both config homes', () => {
    const moved = configHomeWith({ 'personal-local': {} });
    const defaultHome = join(home, '.config', 'avarice');
    mkdirSync(join(defaultHome, 'profiles', 'enterprise-acme'), { recursive: true });
    writeFileSync(join(defaultHome, 'profiles', 'enterprise-acme', 'config.json'), JSON.stringify({ dataRoot: join(base, 'default-home-acme-data') }));
    const found = roots(moved);
    assert.ok(found.includes(join(base, 'default-home-acme-data')), JSON.stringify(found));
    assert.ok(found.includes(moved));
    assert.ok(found.includes(defaultHome));
  });

  it('returns each root once, and only the config homes when there is no profiles directory', () => {
    const configHome = configHomeWith({ 'enterprise-a': { dataRoot: join(base, 'shared') }, 'enterprise-b': { dataRoot: join(base, 'shared') } });
    assert.equal(roots(configHome).filter((path) => path === join(base, 'shared')).length, 1);
    const empty = configHomeWith({});
    assert.deepEqual(new Set(roots(empty)), new Set([empty, join(home, '.config', 'avarice')]));
  });

  it('is an unavailable error, not an empty list, when the profiles directory cannot be listed', { skip: process.getuid?.() === 0 && 'root can list any directory' }, () => {
    const configHome = configHomeWith({ 'enterprise-a': { dataRoot: join(base, 'a-data') } });
    chmodSync(join(configHome, 'profiles'), 0o000);
    try {
      const result = knownProfileRoots(configHome, 'personal-local', OWN());
      assert.equal(result.ok, false);
    } finally {
      chmodSync(join(configHome, 'profiles'), 0o700);
    }
  });
});
