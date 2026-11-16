// Profile selection (SEC-1, D-16, D-17, D-18): which profile a command runs under is decided in main() before any store is opened.
// Every case runs with a temp HOME and no AVARICE_* root override, so the default roots (`<home>/.local/share/avarice/<profile>`) are the
// ones under test and nothing here touches the real profile locations.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runCli } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

const NO_OVERRIDES = { AVARICE_CONFIG_HOME: undefined, AVARICE_DATA_ROOT: undefined, AVARICE_WORK_ROOT: undefined, AVARICE_PROFILE: undefined };

// Environment with a temp HOME, the Claude config dir inside it and no AVARICE_* root or profile override.
function homeEnv(home: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...NO_OVERRIDES, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ...extra };
}

function dataRootOf(home: string, profile: string): string {
  return join(home, '.local', 'share', 'avarice', profile);
}

function storedProfile(home: string, profile: string): string {
  const db = new DatabaseSync(join(dataRootOf(home, profile), 'state.db'), { readOnly: true });
  try {
    return String((db.prepare("SELECT value FROM meta WHERE key = 'profile_id'").get() as { value: string }).value);
  } finally {
    db.close();
  }
}

function listAll(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String);
}

describe('profile selection (D-16, D-17)', () => {
  it('opens the store of the profile named by --profile and creates nothing under personal-local', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json', '--profile', 'personal-extended'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(dataRootOf(home, 'personal-extended'), 'state.db')));
    assert.equal(storedProfile(home, 'personal-extended'), 'personal-extended');
    assert.ok(existsSync(join(home, '.config', 'avarice', 'profiles', 'personal-extended', 'config.json')));
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
    assert.equal(existsSync(join(home, '.local', 'share', 'avarice-work', 'personal-local')), false);
  });

  it('selects personal-local with no flag and no environment variable', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(storedProfile(home, 'personal-local'), 'personal-local');
    assert.equal(existsSync(dataRootOf(home, 'personal-extended')), false);
  });

  it('selects the profile in AVARICE_PROFILE when there is no flag', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json'], { env: homeEnv(home, { AVARICE_PROFILE: 'personal-extended' }) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(storedProfile(home, 'personal-extended'), 'personal-extended');
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
  });

  it('lets --profile win over AVARICE_PROFILE', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json', '--profile', 'personal-local'], { env: homeEnv(home, { AVARICE_PROFILE: 'personal-extended' }) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(storedProfile(home, 'personal-local'), 'personal-local');
    assert.equal(existsSync(dataRootOf(home, 'personal-extended')), false);
  });

  it('accepts an enterprise-<org> name', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json', '--profile', 'enterprise-acme'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(storedProfile(home, 'enterprise-acme'), 'enterprise-acme');
  });

  for (const bad of ['Personal', 'enterprise-', 'enterprise-Acme', 'personal', '../x', 'enterprise-../x']) {
    it(`exits 64 for the profile name ${JSON.stringify(bad)} and creates no directory`, () => {
      const home = tempDir('avarice-home-');
      const r = runCli(['status', '--json', `--profile=${bad}`], { env: homeEnv(home) });
      assert.equal(r.code, 64, r.stderr);
      assert.match(r.stderr, /profile/);
      assert.deepEqual(listAll(home), []);
    });
  }

  it('exits 64 for --profile with no value and creates no directory', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--profile'], { env: homeEnv(home) });
    assert.equal(r.code, 64, r.stderr);
    assert.deepEqual(listAll(home), []);
  });

  it('exits 64 for an invalid AVARICE_PROFILE when it is the profile that would be chosen', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['status', '--json'], { env: homeEnv(home, { AVARICE_PROFILE: 'Bogus' }) });
    assert.equal(r.code, 64, r.stderr);
    assert.match(r.stderr, /AVARICE_PROFILE/);
    assert.deepEqual(listAll(home), []);
  });
});
