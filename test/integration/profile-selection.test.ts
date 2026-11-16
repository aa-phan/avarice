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
import { createDeps } from '../../src/cli/composition.ts';
import { evaluatePolicy, parsedAs } from '../../src/domain/policy.ts';
import type { PolicySources } from '../../src/domain/policy.ts';
import type { Result } from '../../src/domain/result.ts';
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

// The bindings a store's existing projects get on the first command that may write (D-18).
describe('binding backfill for projects already in a store (D-18)', () => {
  function bindings(home: string): Array<{ gitRoot: string; rootCommit: string; profile: string }> {
    return readBindingFile(home).bindings;
  }

  it('binds the existing project too on the first non-read-only command, and writes nothing for a read-only one', () => {
    const home = tempDir('avarice-home-');
    const first = scratchRepo();
    const second = scratchRepo();
    assert.equal(runCli(['repo', 'add', first.path], { env: homeEnv(home) }).code, 0);
    assert.equal(existsSync(bindingsPath(home)), false, 'nothing was in the store when that command opened it');

    const status = runCli(['status', '--json'], { env: homeEnv(home) });
    assert.equal(status.code, 0, status.stderr);
    assert.equal(existsSync(bindingsPath(home)), false, 'status is read-only and writes no bindings file');

    const added = runCli(['repo', 'add', '--profile', 'personal-local', second.path], { env: homeEnv(home) });
    assert.equal(added.code, 0, added.stderr);
    const all = bindings(home);
    assert.deepEqual(all.map((b) => [b.gitRoot, b.rootCommit, b.profile]).sort(), [
      [first.path, first.shas[0], 'personal-local'],
      [second.path, second.shas[0], 'personal-local'],
    ].sort());
    assert.equal(statSync(bindingsPath(home)).mode & 0o777, 0o600);
  });

  it('refuses the existing project under another profile afterwards, exit 3 with the binding named', () => {
    const home = tempDir('avarice-home-');
    const first = scratchRepo();
    const second = scratchRepo();
    assert.equal(runCli(['repo', 'add', first.path], { env: homeEnv(home) }).code, 0);
    assert.equal(runCli(['repo', 'add', second.path], { env: homeEnv(home) }).code, 0);
    assert.equal(bindings(home).length, 1, 'the second command bound the project the first one registered');

    const refused = runCli(['status', '--profile', 'personal-extended'], { env: homeEnv(home), cwd: first.path });
    assert.equal(refused.code, 3, refused.stderr);
    assert.match(refused.stderr, /repository bound to personal-local/);
    assert.equal(existsSync(dataRootOf(home, 'personal-extended')), false);
  });

  it('leaves a binding it finds for the same profile as it was', () => {
    const home = tempDir('avarice-home-');
    const repo = scratchRepo();
    assert.equal(runCli(['repo', 'add', '--profile', 'personal-local', repo.path], { env: homeEnv(home) }).code, 0);
    const before = readFileSync(bindingsPath(home), 'utf8');
    assert.equal(runCli(['repo', 'add', '--profile', 'personal-local', scratchRepo().path], { env: homeEnv(home) }).code, 0);
    const after = bindings(home);
    assert.equal(after.length, 2);
    assert.ok(readFileSync(bindingsPath(home), 'utf8').startsWith(before.slice(0, before.indexOf('"bindings"'))), 'the registry keeps its shape');
    assert.deepEqual(after.filter((b) => b.gitRoot === repo.path).length, 1);
  });

  it('fails composition, naming the other profile, when the store holds a project that is bound to another profile', () => {
    const home = tempDir('avarice-home-');
    const first = scratchRepo();
    assert.equal(runCli(['repo', 'add', first.path], { env: homeEnv(home) }).code, 0);
    mkdirSync(join(home, '.config', 'avarice'), { recursive: true });
    writeFileSync(bindingsPath(home), JSON.stringify({ schema: 1, bindings: [{ gitRoot: first.path, rootCommit: first.shas[0], profile: 'personal-extended', boundAt: '2026-11-16T00:00:00.000Z' }] }));
    const before = readFileSync(bindingsPath(home), 'utf8');
    const r = runCli(['repo', 'add', scratchRepo().path], { env: homeEnv(home), cwd: home });
    assert.equal(r.code, 70, r.stderr);
    assert.match(r.stderr, /bound to personal-extended/);
    assert.equal(readFileSync(bindingsPath(home), 'utf8'), before);
  });

  it('skips a project whose repository is no longer on disk instead of failing the command', () => {
    const home = tempDir('avarice-home-');
    const dir = dataRootOf(home, 'personal-local');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    copyFileSync(join(import.meta.dirname, '..', 'fixtures', 'db', 'schema-v1.sqlite'), join(dir, 'state.db'));
    const r = runCli(['init'], { env: homeEnv(home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(bindingsPath(home)), false);
  });
});

const ORG_FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'org-acme');

function composeFor(home: string, profile: string): ReturnType<typeof createDeps> {
  return createDeps({ ...process.env, ...homeEnv(home) } as NodeJS.ProcessEnv, {}, { readOnly: true, profile });
}

function installAcme(home: string, patch: (config: Record<string, unknown>) => void = () => undefined): string {
  const dir = join(home, '.config', 'avarice', 'profiles', 'enterprise-acme');
  mkdirSync(dir, { recursive: true });
  const config = JSON.parse(readFileSync(join(ORG_FIXTURE, 'config.json'), 'utf8')) as Record<string, unknown>;
  patch(config);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
  copyFileSync(join(ORG_FIXTURE, 'policy.json'), join(dir, 'policy.json'));
  return dir;
}

function sources(result: Result<PolicySources>): PolicySources {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

describe('AppDeps.policy: the policy sources of a profile (SEC-4, D-17)', () => {
  it('returns an absent organization file under personal-local and no repository file without a repository', () => {
    const home = tempDir('avarice-home-');
    const composed = composeFor(home, 'personal-local');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const got = sources(composed.value.deps.policy());
      assert.equal(got.profileClass, 'personal');
      assert.equal(got.organization, 'absent');
      assert.equal(got.user, undefined);
      assert.equal(got.repository, undefined);
    } finally {
      composed.value.close();
    }
  });

  it('returns the fixture organization file under enterprise-acme as a rank-1 source that denies a protected push', () => {
    const home = tempDir('avarice-home-');
    installAcme(home);
    const composed = composeFor(home, 'enterprise-acme');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const got = sources(composed.value.deps.policy());
      assert.equal(got.profileClass, 'enterprise');
      const organization = got.organization;
      assert.ok(organization !== undefined && organization !== 'absent' && organization.ok);
      assert.equal(organization.value.rules.length, 3);
      assert.equal(parsedAs(organization.value), 'organization');
      assert.deepEqual(evaluatePolicy(got, 'git.push', { branch: 'protected' }), { effect: 'deny', ruleId: 'org.no-push-protected', rank: 1 });
    } finally {
      composed.value.close();
    }
  });

  it('reads the organization file only for an enterprise profile: a personal profile that names one ignores it', () => {
    const home = tempDir('avarice-home-');
    const dir = join(home, '.config', 'avarice', 'profiles', 'personal-local');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(ORG_FIXTURE, 'policy.json'), join(dir, 'policy.json'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ schema: 1, profile: 'personal-local', policy: { organizationFile: 'policy.json' } }));
    const composed = composeFor(home, 'personal-local');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      assert.equal(sources(composed.value.deps.policy()).organization, 'absent');
    } finally {
      composed.value.close();
    }
  });

  it('is absent under an enterprise profile that names no file, and the invalid or missing file denies privileged actions', () => {
    const home = tempDir('avarice-home-');
    installAcme(home, (config) => {
      delete config['policy'];
    });
    const none = composeFor(home, 'enterprise-acme');
    assert.ok(none.ok, none.ok ? '' : none.message);
    try {
      const got = sources(none.value.deps.policy());
      assert.equal(got.organization, 'absent');
      assert.equal(evaluatePolicy(got, 'git.push', {}).effect, 'deny');
    } finally {
      none.value.close();
    }

    const home2 = tempDir('avarice-home-');
    const dir = installAcme(home2);
    copyFileSync(join(ORG_FIXTURE, 'policy-invalid.json'), join(dir, 'policy.json'));
    const invalid = composeFor(home2, 'enterprise-acme');
    assert.ok(invalid.ok, invalid.ok ? '' : invalid.message);
    try {
      const got = sources(invalid.value.deps.policy());
      assert.ok(got.organization !== undefined && got.organization !== 'absent' && !got.organization.ok);
      assert.deepEqual(evaluatePolicy(got, 'git.push', {}), { effect: 'deny', ruleId: 'org.invalid-or-missing', rank: 1 });
    } finally {
      invalid.value.close();
    }

    const home3 = tempDir('avarice-home-');
    const dir3 = installAcme(home3);
    rmSync(join(dir3, 'policy.json'));
    const missing = composeFor(home3, 'enterprise-acme');
    assert.ok(missing.ok, missing.ok ? '' : missing.message);
    try {
      assert.equal(sources(missing.value.deps.policy()).organization, 'absent');
    } finally {
      missing.value.close();
    }
  });

  it('parses the profile\'s own policy section as the user source, apart from organizationFile', () => {
    const home = tempDir('avarice-home-');
    installAcme(home, (config) => {
      config['policy'] = { organizationFile: 'policy.json', schema: 1, rules: [{ id: 'user.pr-denied', action: 'scm.pr.create', effect: 'deny' }] };
    });
    const composed = composeFor(home, 'enterprise-acme');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const got = sources(composed.value.deps.policy());
      assert.equal(got.user?.rules.length, 1);
      assert.equal(parsedAs(got.user as never), 'user');
      // The organization requires approval for a pull request; the user may only restrict further under an enterprise profile.
      assert.deepEqual(evaluatePolicy(got, 'scm.pr.create', {}), { effect: 'deny', ruleId: 'user.pr-denied', rank: 3 });
    } finally {
      composed.value.close();
    }
  });

  it('refuses a policy section that does not parse, as an invalid result and not as a composition failure', () => {
    const home = tempDir('avarice-home-');
    installAcme(home, (config) => {
      config['policy'] = { organizationFile: 'policy.json', schema: 1, rules: 'nope' };
    });
    const composed = composeFor(home, 'enterprise-acme');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const result = composed.value.deps.policy();
      assert.ok(!result.ok);
      assert.equal(result.error.kind, 'invalid');
    } finally {
      composed.value.close();
    }
  });

  it('adds the repository policy read at the pin, and ignores the working tree', () => {
    const home = tempDir('avarice-home-');
    const policy = { schema: 1, rules: [{ id: 'repo.no-push', action: 'git.push', effect: 'deny' }] };
    const repo = scratchRepo();
    const pinned = makeRepoWithPolicy(policy);
    const composed = composeFor(home, 'personal-local');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const got = sources(composed.value.deps.policy({ path: pinned.path, pin: pinned.head }));
      assert.equal(parsedAs(got.repository as never), 'repository');
      assert.deepEqual(evaluatePolicy(got, 'git.push', {}), { effect: 'deny', ruleId: 'repo.no-push', rank: 4 });
      // An uncommitted edit of the file does not change the answer at the pin.
      writeFileSync(join(pinned.path, '.avarice', 'policy.json'), JSON.stringify({ schema: 1, rules: [] }));
      const again = sources(composed.value.deps.policy({ path: pinned.path, pin: pinned.head }));
      assert.equal(evaluatePolicy(again, 'git.push', {}).effect, 'deny');
      // A pin the repository does not contain is an error result, not a silently absent file.
      assert.ok(!composed.value.deps.policy({ path: pinned.path, pin: 'f'.repeat(40) }).ok);
      // A repository without the file adds nothing.
      assert.equal(sources(composed.value.deps.policy({ path: repo.path, pin: repo.head })).repository, undefined);
    } finally {
      composed.value.close();
    }
  });

  it('reads the organization file once per command: an edit made after the first answer applies from the next command', () => {
    const home = tempDir('avarice-home-');
    const dir = installAcme(home);
    const composed = composeFor(home, 'enterprise-acme');
    assert.ok(composed.ok, composed.ok ? '' : composed.message);
    try {
      const first = sources(composed.value.deps.policy());
      writeFileSync(join(dir, 'policy.json'), JSON.stringify({ schema: 1, rules: [] }));
      const second = sources(composed.value.deps.policy());
      assert.equal(evaluatePolicy(second, 'git.push', { branch: 'protected' }).ruleId, evaluatePolicy(first, 'git.push', { branch: 'protected' }).ruleId);
      assert.equal(evaluatePolicy(second, 'git.push', { branch: 'protected' }).ruleId, 'org.no-push-protected');
    } finally {
      composed.value.close();
    }
    const next = composeFor(home, 'enterprise-acme');
    assert.ok(next.ok, next.ok ? '' : next.message);
    try {
      assert.equal(evaluatePolicy(sources(next.value.deps.policy()), 'git.push', { branch: 'protected' }).ruleId, 'builtin.privileged-needs-approval');
    } finally {
      next.value.close();
    }
  });
});

function makeRepoWithPolicy(policy: unknown): ScratchRepo {
  const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n', '.avarice/policy.json': JSON.stringify(policy) } });
  cleanup.push(repo.base);
  return repo;
}
