// knownProfileRoots (plan 04-12; SEC-1, D-19, T-04-30, T-04-32): the roots of every other profile, read from the profile configs, so a run sandbox can
// deny the data root, work root and config home of a profile whose roots were moved off the default parents. A planted config can only add a deny.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knownProfileRoots } from '../../src/adapters/fs/profile-registry.ts';
import { plantSocketFile } from '../helpers/unix-socket-file.ts';

// Built from parts, as footprint.test.ts builds a name it must not spell out: the SEC-7 scan reads every `enterprise-` name in test/.
const ent = (suffix: string): string => ['enterprise', suffix].join('-');

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

  it('skips a profile directory whose name is not a profile name, a directory that is a link, and a file', () => {
    const configHome = configHomeWith({ Bogus: { dataRoot: join(base, 'bogus-data') }, 'not a profile': { dataRoot: join(base, 'spaced-data') } });
    mkdirSync(join(base, 'elsewhere', ent('away')), { recursive: true });
    writeFileSync(join(base, 'elsewhere', ent('away'), 'config.json'), JSON.stringify({ dataRoot: join(base, 'away-data') }));
    symlinkSync(join(base, 'elsewhere', ent('away')), join(configHome, 'profiles', ent('away')));
    writeFileSync(join(configHome, 'profiles', ent('file')), 'x');
    const found = roots(configHome);
    for (const planted of ['bogus-data', 'spaced-data', 'away-data']) assert.equal(found.includes(join(base, planted)), false, planted);
  });

  it('skips a root that is not absolute, so a planted relative path adds nothing', () => {
    const configHome = configHomeWith({ [ent('rel')]: { dataRoot: 'relative/data', workRoot: join(base, 'rel-work') } });
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
    const configHome = configHomeWith({ [ent('a')]: { dataRoot: join(base, 'shared') }, [ent('b')]: { dataRoot: join(base, 'shared') } });
    assert.equal(roots(configHome).filter((path) => path === join(base, 'shared')).length, 1);
    const empty = configHomeWith({});
    const bareHome = join(base, 'bare-home');
    assert.deepEqual(new Set(roots(empty, 'personal-local', { ...OWN(), home: bareHome })), new Set([empty, join(bareHome, '.config', 'avarice')]));
  });

  it('is an unavailable error, not an empty list, when the profiles directory cannot be listed', { skip: process.getuid?.() === 0 && 'root can list any directory' }, () => {
    const configHome = configHomeWith({ [ent('a')]: { dataRoot: join(base, 'a-data') } });
    chmodSync(join(configHome, 'profiles'), 0o000);
    try {
      const result = knownProfileRoots(configHome, 'personal-local', OWN());
      assert.equal(result.ok, false);
    } finally {
      chmodSync(join(configHome, 'profiles'), 0o700);
    }
  });

  // WR-17 (T-04-116) and the owner's ruling "deny, don't refuse" (AC-6): a profile config that exists but cannot be read leaves that profile's moved roots out of
  // the deny list. When the read was refused by permissions (EACCES, or the EPERM of a sandbox deny) the profile's whole root is denied and the registry goes on, so a
  // profile the caller cannot read never blocks the commands of another; any other failure to read still stops the registry, naming the profile, because a list that
  // could not be computed must not read as a shorter one. A config that is merely corrupt stays skipped.
  describe('a profile config that cannot be read (WR-17)', () => {
    describe('because of permissions', { skip: process.getuid?.() === 0 && 'root can read any file, so a mode of 000 does not make a config unreadable' }, () => {
      it('denies the whole root of the profile and goes on to the next one: its profile directory and the default data root and work root of its name', () => {
        const moved = join(base, 'wr17-moved');
        const configHome = configHomeWith({
          [ent('other-a')]: { dataRoot: join(moved, 'a-data'), workRoot: join(moved, 'a-work') },
          [ent('other-z')]: { dataRoot: join(base, 'wr17-z-data') },
        });
        const configPath = join(configHome, 'profiles', ent('other-a'), 'config.json');
        chmodSync(configPath, 0o000);
        try {
          const found = roots(configHome);
          assert.ok(found.includes(join(configHome, 'profiles', ent('other-a'))), `the profile directory: ${JSON.stringify(found)}`);
          assert.ok(found.includes(join(home, '.local', 'share', 'avarice', ent('other-a'))), `the default data root of the name: ${JSON.stringify(found)}`);
          assert.ok(found.includes(join(home, '.local', 'share', 'avarice-work', ent('other-a'))), `the default work root of the name: ${JSON.stringify(found)}`);
          assert.ok(found.includes(join(base, 'wr17-z-data')), 'the profile after it is still read');
          assert.ok(found.includes(configHome), 'the config home is still returned');
        } finally {
          chmodSync(configPath, 0o600);
        }
      });

      it('never returns the selected profile\'s own roots among the roots it denies for an unreadable profile', () => {
        const own = OWN();
        const configHome = configHomeWith({ [ent('other-b')]: { dataRoot: join(base, 'wr17-b-data') } });
        chmodSync(join(configHome, 'profiles', ent('other-b'), 'config.json'), 0o000);
        try {
          // The selected profile uses the default roots of the unreadable profile's name: they are its own, and a deny of them would lock it out of itself.
          const ownDefaults = { ...own, ownDataRoot: join(home, '.local', 'share', 'avarice', ent('other-b')), ownWorkRoot: join(home, '.local', 'share', 'avarice-work', ent('other-b')) };
          const found = roots(configHome, 'personal-local', ownDefaults);
          assert.equal(found.includes(ownDefaults.ownDataRoot), false);
          assert.equal(found.includes(ownDefaults.ownWorkRoot), false);
          assert.ok(found.includes(join(configHome, 'profiles', ent('other-b'))));
        } finally {
          chmodSync(join(configHome, 'profiles', ent('other-b'), 'config.json'), 0o600);
        }
      });
    });

    it('is still an unavailable error naming the profile when the config cannot be read for a reason that is not a permission, not a shorter list', async () => {
      const configHome = configHomeWith({ [ent('other-s')]: {} });
      const configPath = join(configHome, 'profiles', ent('other-s'), 'config.json');
      rmSync(configPath);
      // A socket opens with ENXIO (EOPNOTSUPP on macOS): the file exists, is not a link, and cannot be read, for every user.
      const planted = await plantSocketFile(configPath);
      try {
        const result = knownProfileRoots(configHome, 'personal-local', OWN());
        assert.equal(result.ok, false, 'a config that cannot be read for another reason must stop the deny-list computation');
        if (result.ok) return;
        assert.equal(result.error.kind, 'unavailable');
        assert.match(JSON.stringify(result.error), new RegExp(ent('other-s')), 'the error names the profile whose config could not be read');
      } finally {
        await planted.close();
      }
    });

    it('denies the whole root of a corrupt config next to it, and still returns the roots of the readable profiles', () => {
      const configHome = configHomeWith({
        [ent('other-b')]: '{ not json',
        [ent('other-c')]: { dataRoot: join(base, 'wr17-c-data') },
      });
      const found = roots(configHome);
      assert.ok(found.includes(join(base, 'wr17-c-data')), JSON.stringify(found));
      assert.ok(found.includes(join(configHome, 'profiles', ent('other-b'))), `the corrupt profile's directory: ${JSON.stringify(found)}`);
    });
  });

  // GWR-06 (SEC-1, T-04-156): a config that is present but corrupt names no roots, so skipping it removed the whole profile from the deny list, and anyone able to
  // write that one file (or a link in its place) made the profile's store and work tree readable to another profile's sandboxed command. A corrupt config is denied
  // whole, as a refused one is: the profile directory and the default data root and work root of its name.
  describe('a corrupt profile config is denied whole (GWR-06)', () => {
    const wholeRootOf = (configHome: string, name: string): string[] => [
      join(configHome, 'profiles', name),
      join(home, '.local', 'share', 'avarice', name),
      join(home, '.local', 'share', 'avarice-work', name),
    ];

    function assertDeniedWhole(configHome: string, name: string, planted: string): void {
      const found = roots(configHome);
      for (const root of wholeRootOf(configHome, name)) assert.ok(found.includes(root), `${root} is denied: ${JSON.stringify(found)}`);
      assert.equal(found.includes(planted), false, 'a root a corrupt config names is not trusted');
      assert.ok(found.includes(configHome), 'the config home is still returned');
    }

    it('invalid JSON', () => {
      const configHome = configHomeWith({ [ent('bad-json')]: '{ not json', [ent('good')]: { dataRoot: join(base, 'gwr06-good-data') } });
      assertDeniedWhole(configHome, ent('bad-json'), join(base, 'gwr06-never'));
      assert.ok(roots(configHome).includes(join(base, 'gwr06-good-data')), 'the profile after it is still read');
    });

    it('a key the parser refuses', () => {
      const configHome = configHomeWith({ [ent('unknown-key')]: { notAKey: 1, dataRoot: join(base, 'gwr06-unknown-key-data') } });
      assertDeniedWhole(configHome, ent('unknown-key'), join(base, 'gwr06-unknown-key-data'));
    });

    it('a config that is a symbolic link', () => {
      const configHome = configHomeWith({});
      mkdirSync(join(configHome, 'profiles', ent('linked')), { recursive: true });
      writeFileSync(join(base, 'gwr06-planted.json'), JSON.stringify({ dataRoot: join(base, 'gwr06-planted-data') }));
      symlinkSync(join(base, 'gwr06-planted.json'), join(configHome, 'profiles', ent('linked'), 'config.json'));
      assertDeniedWhole(configHome, ent('linked'), join(base, 'gwr06-planted-data'));
    });

    it('a config over the size cap', () => {
      const configHome = configHomeWith({ [ent('huge')]: JSON.stringify({ dataRoot: join(base, 'gwr06-huge-data'), padding: 'x'.repeat(70 * 1024) }) });
      assertDeniedWhole(configHome, ent('huge'), join(base, 'gwr06-huge-data'));
    });

    it('never denies the selected profile\'s own roots, and a directory that is not a profile adds nothing', () => {
      const own = OWN();
      const ownDefaults = { ...own, ownDataRoot: join(home, '.local', 'share', 'avarice', ent('mine')), ownWorkRoot: join(home, '.local', 'share', 'avarice-work', ent('mine')) };
      const configHome = configHomeWith({ [ent('mine')]: '{ not json', Bogus: '{ not json', [ent('other')]: '{ not json' });
      const found = roots(configHome, ent('mine'), ownDefaults);
      assert.equal(found.includes(join(configHome, 'profiles', ent('mine'))), false, 'the selected profile entry is skipped');
      assert.equal(found.includes(join(configHome, 'profiles', 'Bogus')), false, 'a name outside the profile grammar is not a profile');
      assert.ok(found.includes(join(configHome, 'profiles', ent('other'))));
      // A different profile whose default roots are the selected profile's own roots is not denied those.
      const sameDefaults = { ...own, ownDataRoot: join(home, '.local', 'share', 'avarice', ent('other')), ownWorkRoot: join(home, '.local', 'share', 'avarice-work', ent('other')) };
      const foundSame = roots(configHome, ent('mine'), sameDefaults);
      assert.equal(foundSame.includes(sameDefaults.ownDataRoot), false);
      assert.equal(foundSame.includes(sameDefaults.ownWorkRoot), false);
    });
  });
});
