// Profile selection (SEC-1, D-16, D-17, D-18): which profile a command runs under is decided in main() before any store is opened.
// Every case runs with a temp HOME and no AVARICE_* root override, so the default roots (`<home>/.local/share/avarice/<profile>`) are the
// ones under test and nothing here touches the real profile locations.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ONBOARDING_POLICY } from '../../src/app/onboarding-service.ts';
import { runCli } from '../helpers/run-cli.ts';
import { git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(remote?: string): ScratchRepo {
  const repo = makeScratchRepo();
  cleanup.push(repo.base);
  if (remote !== undefined) git(repo.path, ['remote', 'add', 'origin', remote]);
  return repo;
}

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

describe('init and existing data (D-17, D-18)', () => {
  it('initializes every valid profile in its own roots', () => {
    const home = tempDir('avarice-home-');
    for (const profile of ['personal-extended', 'enterprise-acme', 'enterprise-a1-b2']) {
      const r = runCli(['init', '--profile', profile], { env: homeEnv(home) });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.split('\n')[0], `profile ${profile}: initialized`);
      assert.match(r.stdout, new RegExp(`config:\\s+${join(home, '.config', 'avarice', 'profiles', profile, 'config.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.equal(storedProfile(home, profile), profile);
      assert.ok(existsSync(join(home, '.local', 'share', 'avarice-work', profile)));
    }
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
  });

  it('exits 64 for init --profile bogus and creates nothing', () => {
    const home = tempDir('avarice-home-');
    for (const argv of [['init', '--profile', 'bogus'], ['init', '--profile'], ['init', '--profile', 'enterprise-']]) {
      const r = runCli(argv, { env: homeEnv(home) });
      assert.equal(r.code, 64, r.stderr);
      assert.deepEqual(listAll(home), []);
    }
  });

  it('opens an existing personal-local store with its records unchanged, with no flag', () => {
    const home = tempDir('avarice-home-');
    const dir = dataRootOf(home, 'personal-local');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    copyFileSync(join(import.meta.dirname, '..', 'fixtures', 'db', 'schema-v1.sqlite'), join(dir, 'state.db'));
    const count = (table: string): number => {
      const db = new DatabaseSync(join(dir, 'state.db'), { readOnly: true });
      try {
        return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    const tables = ['projects', 'onboardings', 'events', 'contracts', 'project_records'];
    const before = tables.map(count);
    assert.deepEqual(before, [1, 1, 11, 1, 1]);

    const r = runCli(['status', '--json'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    const fixture = new DatabaseSync(join(dir, 'state.db'), { readOnly: true });
    const projectId = String((fixture.prepare('SELECT project_id FROM projects').get() as { project_id: string }).project_id);
    fixture.close();
    assert.ok(r.stdout.includes(projectId), 'status lists the project the fixture holds');
    assert.deepEqual(tables.map(count), before);
    assert.equal(storedProfile(home, 'personal-local'), 'personal-local');
    assert.equal(existsSync(dataRootOf(home, 'personal-extended')), false);
  });
});

function bindingsPath(home: string): string {
  return join(home, '.config', 'avarice', 'bindings.json');
}

function readBindingFile(home: string): { schema: number; bindings: Array<{ gitRoot: string; rootCommit: string; profile: string; boundAt: string }> } {
  assert.ok(existsSync(bindingsPath(home)), 'bindings.json was written');
  return JSON.parse(readFileSync(bindingsPath(home), 'utf8'));
}

// What a store directory holds, with sizes and modification times: equal before and after means nothing opened it for writing.
function storeFingerprint(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .map((name) => `${name}:${statSync(join(dir, name)).size}:${statSync(join(dir, name)).mtimeMs}`);
}

function writeEnterpriseConfig(home: string, org: string, remotePatterns: unknown): void {
  const dir = join(home, '.config', 'avarice', 'profiles', `enterprise-${org}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ schema: 1, profile: `enterprise-${org}`, remotePatterns }, null, 2));
}

describe('repository binding (D-16, S-9)', () => {
  it('writes a create-only binding for the realpath git root and root commit, mode 0600, and refuses a second profile', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    const first = runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) });
    assert.equal(first.code, 0, first.stderr);
    const file = readBindingFile(home);
    assert.equal(file.bindings.length, 1);
    assert.deepEqual({ ...file.bindings[0], boundAt: typeof file.bindings[0]?.boundAt }, { gitRoot: repo.path, rootCommit: repo.shas[0], profile: 'enterprise-acme', boundAt: 'string' });
    assert.equal(statSync(bindingsPath(home)).mode & 0o777, 0o600);
    const before = readFileSync(bindingsPath(home), 'utf8');

    const second = runCli(['repo', 'add', '--profile', 'personal-local', repo.path], { env: homeEnv(home) });
    assert.equal(second.code, 3, second.stderr);
    assert.match(second.stderr, /repository bound to enterprise-acme/);
    assert.equal(readFileSync(bindingsPath(home), 'utf8'), before);
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
  });

  it('binds nothing when repo add is given no --profile', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    const r = runCli(['repo', 'add', repo.path], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(bindingsPath(home)), false);
  });

  it('adding the same repository again under the profile it is bound to leaves the one binding unchanged', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) }).code, 0);
    assert.equal(readBindingFile(home).bindings.length, 1);
    const before = readFileSync(bindingsPath(home), 'utf8');
    runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) });
    assert.equal(readFileSync(bindingsPath(home), 'utf8'), before);
  });

  it('refuses another profile for onboard and status in a bound repository and opens neither store', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) }).code, 0);
    assert.equal(readBindingFile(home).bindings.length, 1);
    const enterpriseStore = dataRootOf(home, 'enterprise-acme');
    const before = storeFingerprint(enterpriseStore);

    const onboard = runCli(['onboard', '--policy', ONBOARDING_POLICY, '--profile', 'personal-local', repo.path], { env: homeEnv(home), cwd: home });
    assert.equal(onboard.code, 3, onboard.stderr);
    assert.match(onboard.stderr, /repository bound to enterprise-acme/);

    const status = runCli(['status', '--json', '--profile', 'personal-local'], { env: homeEnv(home), cwd: repo.path });
    assert.equal(status.code, 3, status.stderr);
    assert.match(status.stderr, /repository bound to enterprise-acme/);

    // S-9: neither data root holds a store the refused command could have opened or created, and the bound one was not touched.
    assert.equal(existsSync(join(dataRootOf(home, 'personal-local'), 'state.db')), false);
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
    assert.equal(existsSync(join(home, '.config', 'avarice', 'profiles', 'personal-local')), false);
    assert.ok(existsSync(join(enterpriseStore, 'state.db')));
    assert.deepEqual(storeFingerprint(enterpriseStore), before);
  });

  it('creates neither profile\'s store when a binding that no store knows about refuses the command', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    mkdirSync(join(home, '.config', 'avarice'), { recursive: true });
    writeFileSync(
      bindingsPath(home),
      JSON.stringify({ schema: 1, bindings: [{ gitRoot: repo.path, rootCommit: repo.shas[0], profile: 'enterprise-acme', boundAt: '2026-01-01T00:00:00.000Z' }] }),
    );
    for (const argv of [['status', '--json', '--profile', 'personal-local'], ['status', '--json', '--profile', 'personal-extended'], ['status', '--json', '--profile=enterprise-other']]) {
      const r = runCli(argv, { env: homeEnv(home), cwd: repo.path });
      assert.equal(r.code, 3, r.stderr);
      assert.match(r.stderr, /repository bound to enterprise-acme/);
    }
    for (const profile of ['personal-local', 'personal-extended', 'enterprise-acme', 'enterprise-other']) {
      assert.equal(existsSync(join(dataRootOf(home, profile), 'state.db')), false, `${profile} store`);
    }
    assert.equal(existsSync(join(home, '.local')), false);
  });

  it('selects the bound profile when no flag is given, and AVARICE_PROFILE never overrides the binding', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) }).code, 0);

    const plain = runCli(['status', '--json'], { env: homeEnv(home), cwd: repo.path });
    assert.equal(plain.code, 0, plain.stderr);
    const withEnv = runCli(['status', '--json'], { env: homeEnv(home, { AVARICE_PROFILE: 'personal-local' }), cwd: repo.path });
    assert.equal(withEnv.code, 0, withEnv.stderr);
    assert.equal(existsSync(dataRootOf(home, 'personal-local')), false);
    assert.equal(storedProfile(home, 'enterprise-acme'), 'enterprise-acme');

    const sameFlag = runCli(['status', '--json', '--profile', 'enterprise-acme'], { env: homeEnv(home), cwd: repo.path });
    assert.equal(sameFlag.code, 0, sameFlag.stderr);
  });

  it('leaves a repository that is not bound, and a directory that is no repository, to the ordinary selection', () => {
    const home = tempDir('avarice-home-');
    const bound = scratchRepo();
    const other = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'enterprise-acme', bound.path], { env: homeEnv(home) }).code, 0);
    assert.equal(runCli(['status', '--json'], { env: homeEnv(home), cwd: other.path }).code, 0);
    assert.equal(storedProfile(home, 'personal-local'), 'personal-local');
    assert.equal(runCli(['status', '--json', '--profile', 'personal-extended'], { env: homeEnv(home), cwd: home }).code, 0);
  });

  it('does not let a path argument that is no repository inherit the binding of the directory it was run from', () => {
    const home = tempDir('avarice-home-');
    const bound = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'enterprise-acme', bound.path], { env: homeEnv(home) }).code, 0);
    const notARepo = tempDir('avarice-plain-');
    const r = runCli(['repo', 'add', '--profile', 'personal-local', notARepo], { env: homeEnv(home), cwd: bound.path });
    assert.notEqual(r.code, 3, r.stderr);
  });

  it('refuses a bindings file that is a symbolic link, for a read and for a write, and creates nothing', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    const target = join(home, 'elsewhere.json');
    writeFileSync(target, JSON.stringify({ schema: 1, bindings: [] }));
    mkdirSync(join(home, '.config', 'avarice'), { recursive: true });
    symlinkSync(target, bindingsPath(home));

    const status = runCli(['status', '--json'], { env: homeEnv(home) });
    assert.equal(status.code, 3, status.stderr);
    assert.match(status.stderr, /symbolic link/);
    assert.equal(existsSync(join(home, '.local')), false);

    const add = runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) });
    assert.equal(add.code, 3, add.stderr);
    assert.equal(readFileSync(target, 'utf8'), JSON.stringify({ schema: 1, bindings: [] }));
  });

  it('refuses a bindings file that is not valid, naming the file', () => {
    const home = tempDir('avarice-home-');
    mkdirSync(join(home, '.config', 'avarice'), { recursive: true });
    writeFileSync(bindingsPath(home), '{"schema":1,"bindings":[{"gitRoot":"/x","rootCommit":"abc","profile":"../evil","boundAt":"t"}]}');
    const r = runCli(['status', '--json'], { env: homeEnv(home) });
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /bindings\.json/);
    assert.equal(existsSync(join(home, '.local')), false);
  });
});

describe('enterprise remote refusal (D-16, T-04-09)', () => {
  const ACME = ['github.example.com/acme/*'];

  it('refuses a repository whose remote matches an enterprise profile when run under a personal profile, and never binds it', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', ACME);
    const repo = scratchRepo('https://github.example.com/acme/tool.git');
    for (const argv of [['repo', 'add', repo.path], ['repo', 'add', '--profile', 'personal-extended', repo.path]]) {
      const r = runCli(argv, { env: homeEnv(home) });
      assert.equal(r.code, 3, r.stderr);
      assert.match(r.stderr, /enterprise-acme/);
    }
    assert.equal(existsSync(bindingsPath(home)), false);
    assert.equal(existsSync(join(home, '.local')), false);
  });

  it('refuses any command run from inside such a repository, not only repo add', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', ACME);
    const repo = scratchRepo('https://github.example.com/acme/tool.git');
    const r = runCli(['status', '--json'], { env: homeEnv(home), cwd: repo.path });
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /enterprise-acme/);
    assert.equal(existsSync(join(home, '.local')), false);
  });

  it('matches a remote written with credentials or in scp form, and does not print the credentials', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', ACME);
    for (const remote of ['https://user:s3cr3t-token@github.example.com/acme/tool.git', 'git@github.example.com:acme/tool.git', 'ssh://git@github.example.com:2222/acme/tool']) {
      const repo = scratchRepo(remote);
      const r = runCli(['status', '--json'], { env: homeEnv(home), cwd: repo.path });
      assert.equal(r.code, 3, `${remote}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /s3cr3t-token/);
    }
  });

  it('lets a remote that matches no pattern, and a repository with no remote, run under a personal profile', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', ACME);
    const elsewhere = scratchRepo('https://github.example.com/other/tool.git');
    const none = scratchRepo();
    assert.equal(runCli(['status', '--json'], { env: homeEnv(home), cwd: elsewhere.path }).code, 0);
    assert.equal(runCli(['status', '--json'], { env: homeEnv(home), cwd: none.path }).code, 0);
  });

  it('lets the enterprise profile itself run the repository and bind it', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', ACME);
    const repo = scratchRepo('https://github.example.com/acme/tool.git');
    const r = runCli(['repo', 'add', '--profile', 'enterprise-acme', repo.path], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readBindingFile(home).bindings[0]?.profile, 'enterprise-acme');
  });

  it('refuses when an enterprise config cannot be trusted, rather than assuming the repository is personal', () => {
    const home = tempDir('avarice-home-');
    writeEnterpriseConfig(home, 'acme', 'github.example.com/acme/*');
    const repo = scratchRepo('https://github.example.com/other/tool.git');
    const r = runCli(['status', '--json'], { env: homeEnv(home), cwd: repo.path });
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /enterprise-acme/);
    assert.match(r.stderr, /remotePatterns/);
  });
});
