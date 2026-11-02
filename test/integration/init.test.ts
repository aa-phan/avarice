// avarice init and root placement (SKELETON.md "Roots"; spike "paths under the Claude config directory are
// unwritable"; ADR-003 local storage). Every case runs with temp roots or a temp HOME: nothing here creates or
// touches the real profile locations.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { err, ok } from '../../src/domain/result.ts';
import { resolveProfile } from '../../src/adapters/fs/profile-paths.ts';
import { describeError } from '../../src/adapters/sqlite/db.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(dir);
  return dir;
}

function freshRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

const NO_OVERRIDES = { AVARICE_CONFIG_HOME: undefined, AVARICE_DATA_ROOT: undefined, AVARICE_WORK_ROOT: undefined };

// Environment with a temp HOME, the Claude config dir inside it and no AVARICE_* root overrides.
function homeEnv(home: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...NO_OVERRIDES, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ...extra };
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

function schemaVersion(dataRoot: string): string {
  const db = new DatabaseSync(join(dataRoot, 'state.db'), { readOnly: true });
  try {
    return String((db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value);
  } finally {
    db.close();
  }
}

function listAll(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String);
}

describe('avarice init', () => {
  it('creates the config, data root and work root, migrates the store and prints the resolved paths', () => {
    const roots = freshRoots();
    const r = runCli(['init'], { roots });
    assert.equal(r.code, 0, r.stderr);
    const configPath = join(roots.AVARICE_CONFIG_HOME, 'profiles', 'personal-local', 'config.json');
    assert.ok(r.stdout.includes('personal-local'), r.stdout);
    assert.ok(r.stdout.includes(configPath), r.stdout);
    assert.ok(r.stdout.includes(roots.AVARICE_DATA_ROOT), r.stdout);
    assert.ok(r.stdout.includes(roots.AVARICE_WORK_ROOT), r.stdout);
    assert.match(r.stdout, /schema version:\s+1/);
    assert.match(r.stdout, /node:sqlite/);
    assert.match(r.stdout, /experimental/i);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), {
      schema: 1,
      profile: 'personal-local',
      dataRoot: roots.AVARICE_DATA_ROOT,
      workRoot: roots.AVARICE_WORK_ROOT,
    });
    assert.equal(schemaVersion(roots.AVARICE_DATA_ROOT), '1');
  });

  it('uses mode 0700 for every directory and 0600 for the config file and the store files', () => {
    const roots = freshRoots();
    assert.equal(runCli(['init'], { roots }).code, 0);
    const profileDir = join(roots.AVARICE_CONFIG_HOME, 'profiles', 'personal-local');
    for (const dir of [roots.AVARICE_CONFIG_HOME, join(roots.AVARICE_CONFIG_HOME, 'profiles'), profileDir, roots.AVARICE_DATA_ROOT, roots.AVARICE_WORK_ROOT]) {
      assert.equal(mode(dir), 0o700, dir);
    }
    assert.equal(mode(join(profileDir, 'config.json')), 0o600);
    for (const name of readdirSync(roots.AVARICE_DATA_ROOT).filter((n) => n.startsWith('state.db'))) {
      assert.equal(mode(join(roots.AVARICE_DATA_ROOT, name)), 0o600, name);
    }
    assert.ok(existsSync(join(roots.AVARICE_DATA_ROOT, 'state.db')));
  });

  it('is idempotent: a second init changes neither the config nor the schema', () => {
    const roots = freshRoots();
    assert.equal(runCli(['init'], { roots }).code, 0);
    const configPath = join(roots.AVARICE_CONFIG_HOME, 'profiles', 'personal-local', 'config.json');
    const before = readFileSync(configPath, 'utf8');
    const second = runCli(['init'], { roots });
    assert.equal(second.code, 0, second.stderr);
    assert.equal(readFileSync(configPath, 'utf8'), before);
    assert.equal(schemaVersion(roots.AVARICE_DATA_ROOT), '1');
    const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
    try {
      assert.equal((db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n, 1);
    } finally {
      db.close();
    }
  });

  it('accepts --profile personal-local and refuses any other profile name', () => {
    const roots = freshRoots();
    assert.equal(runCli(['init', '--profile', 'personal-local'], { roots }).code, 0);
    const other = runCli(['init', '--profile', 'team'], { roots: freshRoots() });
    assert.equal(other.code, 64);
    assert.match(other.stderr, /only personal-local in Phase 1/);
  });

  it('refuses another profile name before anything is created', () => {
    const roots = freshRoots();
    const r = runCli(['init', '--profile', 'team'], { roots });
    assert.equal(r.code, 64);
    for (const dir of [roots.AVARICE_CONFIG_HOME, roots.AVARICE_DATA_ROOT, roots.AVARICE_WORK_ROOT]) assert.equal(existsSync(dir), false, dir);
  });

  it('warns about an existing root that other users can open, and still succeeds', () => {
    const roots = freshRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT);
    chmodSync(roots.AVARICE_DATA_ROOT, 0o755);
    const r = runCli(['init'], { roots });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /warning: .*0755.*chmod 700/);
  });

  it('places the default roots under the home directory in a temp HOME', () => {
    const home = tempDir('avarice-home-');
    const r = runCli(['init'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(home, '.config', 'avarice', 'profiles', 'personal-local', 'config.json')));
    assert.ok(existsSync(join(home, '.local', 'share', 'avarice', 'personal-local', 'state.db')));
    assert.ok(existsSync(join(home, '.local', 'share', 'avarice-work', 'personal-local')));
    assert.equal(existsSync(join(home, '.claude')), false);
  });
});

describe('root placement refusals (T-01-11)', () => {
  function assertRefused(home: string, env: Record<string, string | undefined>, pattern: RegExp, command = 'init'): void {
    const r = runCli([command], { env: homeEnv(home, env) });
    assert.notEqual(r.code, 0, r.stdout);
    assert.match(r.stderr, pattern);
    // Nothing was created: the refusal comes before any directory.
    assert.deepEqual(listAll(home), [], 'no directory may be created before the refusal');
  }

  it('refuses a data root under ~/.claude-edu and names the rule', () => {
    const home = tempDir('avarice-home-');
    assertRefused(home, { AVARICE_DATA_ROOT: join(home, '.claude-edu', 'avarice-test') }, /~\/\.claude\*/);
  });

  it('refuses a work root under ~/.claude', () => {
    const home = tempDir('avarice-home-');
    assertRefused(home, { AVARICE_WORK_ROOT: join(home, '.claude', 'work') }, /~\/\.claude\*/);
  });

  it('refuses a root under a name that merely starts with .claude', () => {
    const home = tempDir('avarice-home-');
    assertRefused(home, { AVARICE_DATA_ROOT: join(home, '.claudeanything', 'x') }, /~\/\.claude\*/);
  });

  it('refuses a root under CLAUDE_CONFIG_DIR wherever it points', () => {
    const home = tempDir('avarice-home-');
    const cfg = join(home, 'elsewhere', 'cfg');
    assertRefused(home, { CLAUDE_CONFIG_DIR: cfg, AVARICE_DATA_ROOT: join(cfg, 'avarice') }, /CLAUDE_CONFIG_DIR/);
  });

  it('refuses a root reached through a symlink into ~/.claude-edu (realpath before the check)', () => {
    const home = tempDir('avarice-home-');
    mkdirSync(join(home, '.claude-edu'));
    symlinkSync(join(home, '.claude-edu'), join(home, 'innocent'));
    const r = runCli(['init'], { env: homeEnv(home, { AVARICE_DATA_ROOT: join(home, 'innocent', 'data') }) });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /~\/\.claude\*/);
    assert.deepEqual(readdirSync(join(home, '.claude-edu')), [], 'nothing may be created through the symlink');
    assert.equal(existsSync(join(home, '.config')), false);
  });

  it('refuses a work root inside the data root and a data root inside the work root', () => {
    const home = tempDir('avarice-home-');
    assertRefused(home, { AVARICE_DATA_ROOT: join(home, 'd'), AVARICE_WORK_ROOT: join(home, 'd', 'work') }, /inside/);
    assertRefused(home, { AVARICE_DATA_ROOT: join(home, 'w', 'data'), AVARICE_WORK_ROOT: join(home, 'w') }, /inside/);
  });

  it('applies to every command that resolves the profile, not only init', () => {
    const home = tempDir('avarice-home-');
    assertRefused(home, { AVARICE_DATA_ROOT: join(home, '.claude-edu', 'x') }, /~\/\.claude\*/, 'status');
  });
});

describe('local storage requirement (T-01-12)', () => {
  const roots = (): { env: NodeJS.ProcessEnv; base: string } => {
    const base = tempDir('avarice-resolve-');
    return { base, env: { HOME: base, CLAUDE_CONFIG_DIR: join(base, '.claude'), AVARICE_CONFIG_HOME: join(base, 'c'), AVARICE_DATA_ROOT: join(base, 'd'), AVARICE_WORK_ROOT: join(base, 'w') } };
  };

  it('refuses a data root on a mount without the local flag, before creating anything', () => {
    const { base, env } = roots();
    const r = resolveProfile(env, { isLocalMount: () => ok(false) });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(describeError(r.error), /local/);
    assert.deepEqual(readdirSync(base), []);
  });

  it('checks the data root and passes the realpath of its nearest existing ancestor', () => {
    const { base, env } = roots();
    const seen: string[] = [];
    const r = resolveProfile(env, { isLocalMount: (p) => (seen.push(p), ok(true)) });
    assert.ok(r.ok);
    assert.deepEqual(seen, [join(base, 'd')]);
  });

  it('fails closed when the mount table cannot be read', () => {
    const { base, env } = roots();
    const r = resolveProfile(env, { isLocalMount: () => err({ kind: 'unavailable', cause: 'mount: not found' }) });
    assert.equal(r.ok, false);
    assert.deepEqual(readdirSync(base), []);
  });

  it('creates the profile when the data root is local', () => {
    const { base, env } = roots();
    const r = resolveProfile(env, { isLocalMount: () => ok(true) });
    assert.ok(r.ok);
    assert.ok(existsSync(join(base, 'd')) && existsSync(join(base, 'w')));
  });
});
