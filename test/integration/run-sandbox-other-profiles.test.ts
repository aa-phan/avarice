// Plan 02-20 finding cs7-other-profile-sandbox (CON-1): a command a run declares (a check, a validation, the baseline, `npm ci`) runs in the
// SandboxedExecutor with the sandbox sandboxSetup describes. The live run found it could read another profile's data root: the deny list
// named this run's data root and the credential directories only. The owner chose to deny the default parents of every profile's roots
// (the data parent, the config home, the work parent) and to re-allow this run's own clone (the command's cwd) and scratch. These cases
// run real commands through the real executor on a temporary home; a profile whose roots sit outside the default parents is the
// documented limit (docs/containment.md), pinned here so a change to it is a decision.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { sandboxSetup } from '../../src/app/checks.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { RunRow } from '../../src/ports/ledger.ts';
import type { CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import { TEST_PATH } from '../helpers/sandbox.ts';

const SANDBOX_AVAILABLE = existsSync('/usr/bin/sandbox-exec');

let base = '';
let home = '';
let outside = '';
let own: { dataRoot: string; workRoot: string; clone: string; scratch: string };
let deps: AppDeps;
const run = { runId: 'run_A' } as unknown as RunRow;

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-other-profiles-')));
  home = join(base, 'home');
  outside = join(base, 'elsewhere');
  const dirs = {
    ownData: join(home, '.local/share/avarice/mine'),
    otherData: join(home, '.local/share/avarice/other'),
    ownWork: join(home, '.local/share/avarice-work/mine'),
    otherWork: join(home, '.local/share/avarice-work/other'),
    config: join(home, '.config/avarice'),
  };
  for (const dir of [dirs.ownData, dirs.otherData, dirs.config, join(dirs.ownWork, 'run_A/clone/src'), join(dirs.ownWork, 'run_A/scratch'), join(dirs.ownWork, 'run_B/clone'), join(dirs.otherWork, 'run_C/clone/src'), outside]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(dirs.ownData, 'state.db'), 'own data');
  writeFileSync(join(dirs.otherData, 'state.db'), 'other data');
  writeFileSync(join(dirs.config, 'profiles.json'), 'config');
  writeFileSync(join(dirs.ownWork, 'run_A/clone/src/a.ts'), 'own clone');
  writeFileSync(join(dirs.ownWork, 'run_A/scratch/note'), 'own scratch');
  writeFileSync(join(dirs.ownWork, 'run_B/clone/b.ts'), 'sibling run clone, same profile');
  writeFileSync(join(dirs.otherWork, 'run_C/clone/src/c.ts'), 'other profile clone');
  writeFileSync(join(outside, 'canary'), 'outside the default parents');
  own = { dataRoot: dirs.ownData, workRoot: dirs.ownWork, clone: join(dirs.ownWork, 'run_A/clone'), scratch: join(dirs.ownWork, 'run_A/scratch') };
  deps = { home, profile: { dataRoot: own.dataRoot, workRoot: own.workRoot, otherRoots: [] } } as unknown as AppDeps;
});
after(() => rmSync(base, { recursive: true, force: true }));

function command(argv: readonly string[], cwd: string = own.clone, env: Record<string, string> = {}): CommandSpec {
  const sandbox = sandboxSetup(deps, run, cwd);
  assert.ok(sandbox.ok, JSON.stringify(sandbox));
  return {
    argv,
    cwd,
    env: { ...sandbox.value.env, PATH: TEST_PATH, ...env },
    timeoutMs: 20_000,
    invocationId: 'test',
    writePaths: [sandbox.value.scratch],
    denyReadPaths: sandbox.value.denyReadPaths,
    allowReadPaths: sandbox.value.allowReadPaths,
  };
}

async function exec(argv: readonly string[], cwd?: string, env?: Record<string, string>): Promise<CommandResult> {
  const result = await new SandboxedExecutor().run(command(argv, cwd, env));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

const readable = async (path: string): Promise<boolean> => (await exec(['/bin/cat', path])).exitCode === 0;
const listable = async (path: string): Promise<boolean> => (await exec(['/bin/ls', path])).exitCode === 0;

describe('the sandbox of a run command denies the default AVARICE parents (cs7-other-profile-sandbox)', { skip: !SANDBOX_AVAILABLE }, () => {
  it('describes the default parents as denied and the cwd and scratch as re-allowed, symlink-resolved', () => {
    const sandbox = sandboxSetup(deps, run, own.clone);
    assert.ok(sandbox.ok);
    for (const parent of ['.local/share/avarice', '.config/avarice', '.local/share/avarice-work']) assert.ok(sandbox.value.denyReadPaths.includes(join(home, parent)), parent);
    assert.deepEqual(sandbox.value.allowReadPaths, [own.clone, own.scratch]);
  });

  it('cannot read or list another profile data root, its work root, or the config home', async () => {
    assert.equal(await readable(join(home, '.local/share/avarice/other/state.db')), false);
    assert.equal(await listable(join(home, '.local/share/avarice/other')), false);
    assert.equal(await readable(join(home, '.local/share/avarice-work/other/run_C/clone/src/c.ts')), false);
    assert.equal(await listable(join(home, '.local/share/avarice-work/other')), false);
    assert.equal(await readable(join(home, '.config/avarice/profiles.json')), false);
  });

  it('cannot read this run own data root (it stays denied) or the clone of another run of the same profile', async () => {
    assert.equal(await readable(join(own.dataRoot, 'state.db')), false);
    assert.equal(await readable(join(own.workRoot, 'run_B/clone/b.ts')), false);
    assert.equal(await listable(own.workRoot), false);
  });

  it('still reads and lists its own clone and scratch, with the clone as the working directory', async () => {
    assert.equal(await readable(join(own.clone, 'src/a.ts')), true);
    assert.equal(await listable(own.clone), true);
    assert.equal(await readable(join(own.scratch, 'note')), true);
    const pwd = await exec(['/bin/pwd']);
    assert.equal(pwd.exitCode, 0, pwd.stderr);
    assert.equal(pwd.stdout.trim(), own.clone);
    const relative = await exec(['/bin/cat', 'src/a.ts']);
    assert.equal(relative.stdout, 'own clone');
  });

  // Plan 02-21 finding (the dry run on the default profile): node resolves the real path of its main script with an lstat of every directory
  // above it, and the denied parent is one of them, so every npm script of the default profile died with `EPERM: lstat
  // ~/.local/share/avarice-work`. Only the metadata of the directories on the way to the clone is given back, never their contents.
  it('runs a node script that lives in its own clone, and resolves the real path of its main file through the denied parents', async () => {
    writeFileSync(join(own.clone, 'src/hello.mjs'), 'process.stdout.write("hello " + process.cwd())');
    const direct = await exec([process.execPath, 'src/hello.mjs']);
    assert.equal(direct.exitCode, 0, direct.stderr);
    assert.equal(direct.stdout, `hello ${own.clone}`);
    const absolute = await exec([process.execPath, join(own.clone, 'src/hello.mjs')]);
    assert.equal(absolute.exitCode, 0, absolute.stderr);
    const resolved = await exec([process.execPath, '-e', 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))', join(own.clone, 'src/a.ts')]);
    assert.equal(resolved.exitCode, 0, resolved.stderr);
    assert.equal(resolved.stdout, join(own.clone, 'src/a.ts'));
  });

  it('gives back the metadata of the directories above the clone and nothing more: no listing, no read of a sibling, no read through them', async () => {
    const stat = await exec(['/usr/bin/stat', '-f', '%HT', own.workRoot]);
    assert.equal(stat.exitCode, 0, stat.stderr);
    assert.equal(stat.stdout.trim(), 'Directory');
    assert.equal(await listable(own.workRoot), false);
    assert.equal(await listable(join(home, '.local/share/avarice-work')), false);
    assert.equal(await readable(join(own.workRoot, 'run_B/clone/b.ts')), false);
    assert.equal(await listable(join(own.workRoot, 'run_B/clone')), false);
    assert.equal(await readable(join(home, '.local/share/avarice-work/other/run_C/clone/src/c.ts')), false);
    // The data root and the other profile data root are not on the way to the clone, so not even their metadata is given back.
    assert.notEqual((await exec(['/usr/bin/stat', '-f', '%HT', join(home, '.local/share/avarice/other')])).exitCode, 0);
  });

  it('keeps the carve-out narrow: a symlink inside the clone to another profile data root does not read through', async () => {
    symlinkSync(join(home, '.local/share/avarice/other'), join(own.clone, 'link-to-other'));
    assert.equal(await readable(join(own.clone, 'link-to-other/state.db')), false);
  });

  it('still reads what it could read before: a path outside the denied roots, and the interpreter', async () => {
    assert.equal(await readable(join(outside, 'canary')), true);
    const node = await exec([process.execPath, '-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', join(own.clone, 'src/a.ts')]);
    assert.equal(node.exitCode, 0, node.stderr);
    assert.equal(node.stdout, 'own clone');
  });

  // Plan 04-12 closed the limit for every profile whose config this one can read (the describe below). What stays open is a profile this one was
  // never told about: with no roots in deps.profile.otherRoots the sandbox cannot name it.
  it('residual: a profile whose config was never seen here, so named in no otherRoots, is not covered', async () => {
    const custom = { ...deps, profile: { dataRoot: join(outside, 'custom-data'), workRoot: join(outside, 'custom-work'), otherRoots: [] } } as unknown as AppDeps;
    mkdirSync(join(outside, 'custom-data'), { recursive: true });
    mkdirSync(join(outside, 'custom-work/run_A/clone'), { recursive: true });
    writeFileSync(join(outside, 'other-profile-custom-data'), 'a profile placed elsewhere by AVARICE_DATA_ROOT');
    const sandbox = sandboxSetup(custom, run, join(outside, 'custom-work/run_A/clone'));
    assert.ok(sandbox.ok);
    assert.equal(sandbox.value.denyReadPaths.includes(join(outside, 'other-profile-custom-data')), false);
    assert.deepEqual(custom.profile.otherRoots, []);
    const result = await new SandboxedExecutor().run({ ...command(['/bin/cat', join(outside, 'other-profile-custom-data')]), denyReadPaths: sandbox.value.denyReadPaths, allowReadPaths: sandbox.value.allowReadPaths, cwd: join(outside, 'custom-work/run_A/clone') });
    assert.ok(result.ok);
    assert.equal(result.value.exitCode, 0, 'outside the default parents, the own roots and every known profile: readable, as documented');
  });
});

// Plan 04-12 (D-19, T-04-30). A profile whose data root, work root or config home were moved by an environment variable is named only by its own config.json,
// which is written once with the roots in use. The composition reads those configs, and every sandbox a run's commands use denies what they name.
describe('composition and the sandbox setup deny the moved roots of every other profile (D-19, T-04-30)', () => {
  let moved = '';
  let acme: { data: string; work: string };
  let composedDefault: ReturnType<typeof createDeps> | undefined;
  let composedMoved: ReturnType<typeof createDeps> | undefined;
  let movedConfigHome = '';
  let defaultConfigHome = '';
  let homeDir = '';
  let rootBase = '';

  function envFor(extra: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir, CLAUDE_CONFIG_DIR: join(homeDir, '.claude'), AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude', ...extra };
    for (const name of ['AVARICE_CONFIG_HOME', 'AVARICE_DATA_ROOT', 'AVARICE_WORK_ROOT', 'AVARICE_PROFILE']) if (!(name in extra)) delete env[name];
    return env;
  }

  before(() => {
    rootBase = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-moved-roots-')));
    homeDir = join(rootBase, 'home');
    moved = join(rootBase, 'moved');
    acme = { data: join(moved, 'acme-data'), work: join(moved, 'acme-work') };
    defaultConfigHome = join(homeDir, '.config', 'avarice');
    movedConfigHome = join(rootBase, 'moved-config');
    mkdirSync(join(acme.work, 'run_Z/clone'), { recursive: true });
    mkdirSync(acme.data, { recursive: true });
    writeFileSync(join(acme.data, 'state.db'), 'CANARY-ACME-DATA');
    writeFileSync(join(acme.work, 'run_Z/clone/secret.txt'), 'CANARY-ACME-CLONE');
    mkdirSync(join(defaultConfigHome, 'profiles', 'enterprise-acme'), { recursive: true });
    writeFileSync(join(defaultConfigHome, 'profiles', 'enterprise-acme', 'config.json'), JSON.stringify({ schema: 1, profile: 'enterprise-acme', dataRoot: acme.data, workRoot: acme.work }));
    composedDefault = createDeps(envFor({}), {}, { profile: 'personal-local' });
    composedMoved = createDeps(
      envFor({ AVARICE_CONFIG_HOME: movedConfigHome, AVARICE_DATA_ROOT: join(rootBase, 'moved-own-data'), AVARICE_WORK_ROOT: join(rootBase, 'moved-own-work') }),
      {},
      { profile: 'personal-local' },
    );
  });
  after(() => {
    if (composedDefault?.ok === true) composedDefault.value.close();
    if (composedMoved?.ok === true) composedMoved.value.close();
    rmSync(rootBase, { recursive: true, force: true });
  });

  function depsOf(composed: ReturnType<typeof createDeps> | undefined): AppDeps {
    assert.ok(composed?.ok === true, composed?.ok === false ? composed.message : 'not composed');
    return composed.value.deps;
  }

  it('fills deps.profile.otherRoots with the moved roots of another profile and the config home, and none of its own data or work root', () => {
    const profile = depsOf(composedDefault).profile;
    assert.ok(profile.otherRoots.includes(acme.data), JSON.stringify(profile.otherRoots));
    assert.ok(profile.otherRoots.includes(acme.work), JSON.stringify(profile.otherRoots));
    assert.ok(profile.otherRoots.includes(defaultConfigHome));
    assert.equal(profile.otherRoots.includes(profile.dataRoot), false);
    assert.equal(profile.otherRoots.includes(profile.workRoot), false);
  });

  it('names this profile own config home and the default one when its own was moved, and still finds the other profile in the default one', () => {
    const profile = depsOf(composedMoved).profile;
    assert.ok(profile.otherRoots.includes(movedConfigHome), JSON.stringify(profile.otherRoots));
    assert.ok(profile.otherRoots.includes(defaultConfigHome));
    assert.ok(profile.otherRoots.includes(acme.data));
  });

  it('the sandbox of a declared check, a validation, the baseline and npm ci denies those roots, and re-allows only the run clone and scratch', () => {
    const d = depsOf(composedMoved);
    const clone = join(d.profile.workRoot, 'run_A', 'clone');
    mkdirSync(clone, { recursive: true });
    const sandbox = sandboxSetup(d, run, clone);
    assert.ok(sandbox.ok, JSON.stringify(sandbox));
    for (const path of [acme.data, acme.work, movedConfigHome, defaultConfigHome]) assert.ok(sandbox.value.denyReadPaths.includes(path), path);
    assert.deepEqual(sandbox.value.allowReadPaths, [realpathSync(clone), sandbox.value.scratch]);
  });

  // CS-7 (the live case of plan 02-20), for a profile moved off the default parents: a declared check, run in the real SandboxedExecutor with the deny
  // paths of the run, reads a file inside the other profile's moved data root. AC-6 needs 0 such reads.
  describe('through the real sandbox (CS-7, AC-6)', { skip: !SANDBOX_AVAILABLE }, () => {
    const READ = ['-e', 'try { process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8")); } catch (e) { process.stderr.write(String(e.code) + ": " + String(e.message)); process.exit(7); }'];
    let clone = '';
    let sandbox: ReturnType<typeof sandboxSetup>;

    before(() => {
      const d = depsOf(composedMoved);
      clone = join(d.profile.workRoot, 'run_A', 'clone');
      mkdirSync(join(clone, 'src'), { recursive: true });
      writeFileSync(join(clone, 'src', 'own.txt'), 'CANARY-OWN-CLONE');
      sandbox = sandboxSetup(d, run, clone);
    });

    async function check(argv: readonly string[]): Promise<CommandResult> {
      assert.ok(sandbox.ok, JSON.stringify(sandbox));
      const spec: CommandSpec = {
        argv,
        cwd: clone,
        env: { ...sandbox.value.env, PATH: TEST_PATH },
        timeoutMs: 20_000,
        invocationId: 'test',
        writePaths: [sandbox.value.scratch],
        denyReadPaths: sandbox.value.denyReadPaths,
        allowReadPaths: sandbox.value.allowReadPaths,
      };
      const result = await new SandboxedExecutor().run(spec);
      assert.ok(result.ok, JSON.stringify(result));
      return result.value;
    }

    // A denial is a command that ran to its end and failed on a permission error: not a timeout or a cancellation (exitCode null), not a program that is missing or broken
    // (a different message), and not a refusal that has nothing to do with the sandbox.
    async function denied(argv: readonly string[]): Promise<CommandResult> {
      const result = await check(argv);
      const label = argv.join(' ');
      assert.equal(result.status, 'failed', `${label}: the command ended as ${result.status}, not as a failure`);
      assert.notEqual(result.exitCode, 0, label);
      assert.match(result.stderr, /Operation not permitted|Permission denied/i, `${label}: the failure is a permission failure`);
      return result;
    }

    it('a check reading a file in another profile moved data root fails with a permission error and its output holds no content of the file', async () => {
      const result = await denied([process.execPath, ...READ, join(acme.data, 'state.db')]);
      assert.match(result.stderr, /EPERM|EACCES/);
      assert.equal(`${result.stdout}${result.stderr}`.includes('CANARY-ACME-DATA'), false);
    });

    it('the same holds for the moved work root, for listing either root, and for the config home that names them', async () => {
      const work = await denied([process.execPath, ...READ, join(acme.work, 'run_Z/clone/secret.txt')]);
      assert.equal(`${work.stdout}${work.stderr}`.includes('CANARY-ACME-CLONE'), false);
      await denied(['/bin/ls', acme.data]);
      await denied(['/bin/ls', acme.work]);
      await denied(['/bin/ls', join(defaultConfigHome, 'profiles')]);
      await denied(['/bin/cat', join(defaultConfigHome, 'profiles', 'enterprise-acme', 'config.json')]);
      await denied(['/bin/ls', movedConfigHome]);
    });

    it('a symbolic link in the clone to the moved data root does not read through', async () => {
      symlinkSync(acme.data, join(clone, 'link-to-acme'));
      const result = await denied([process.execPath, ...READ, join(clone, 'link-to-acme', 'state.db')]);
      assert.equal(`${result.stdout}${result.stderr}`.includes('CANARY-ACME-DATA'), false);
    });

    // The controls of the denial cases above: the same binaries run under the same sandbox and succeed on a path it allows, so the denials come from the deny list and not
    // from a sandbox that cannot run /bin/ls or /bin/cat at all.
    it('control: /bin/ls lists the run own clone and /bin/cat reads a file in it under the same sandbox', async () => {
      const listed = await check(['/bin/ls', clone]);
      assert.equal(listed.status, 'passed', listed.stderr);
      assert.equal(listed.exitCode, 0, listed.stderr);
      assert.match(listed.stdout, /\bsrc\b/);
      const read = await check(['/bin/cat', join(clone, 'src', 'own.txt')]);
      assert.equal(read.status, 'passed', read.stderr);
      assert.equal(read.exitCode, 0, read.stderr);
      assert.equal(read.stdout, 'CANARY-OWN-CLONE');
    });

    it('the same script reads a file inside the run own clone', async () => {
      const result = await check([process.execPath, ...READ, join(clone, 'src', 'own.txt')]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, 'CANARY-OWN-CLONE');
    });
  });
});

// Plan 02-33 finding R-WR-03: the command sandbox denied three credential directories and allowed every other read. The review reproduced a read
// of .gnupg, .netrc, .npmrc, .docker/config.json, .kube/config, .config/gcloud and Library/Keychains, and a copy of ~/.netrc into scratch.
const CREDENTIAL_SENTINELS: readonly string[] = [
  '.ssh/id_rsa',
  '.aws/credentials',
  '.config/gh/hosts.yml',
  '.gnupg/secring',
  '.netrc',
  '.npmrc',
  '.docker/config.json',
  '.kube/config',
  '.config/gcloud/credentials.db',
  'Library/Keychains/login.keychain-db',
  '.git-credentials',
  '.pgpass',
];
const SENTINEL_TEXT = 'SENTINEL-CREDENTIAL-CONTENT';
const NPM_AVAILABLE = TEST_PATH.split(':').some((dir) => existsSync(join(dir, 'npm')));

describe('credential locations are unreadable to run commands (R-WR-03)', { skip: !SANDBOX_AVAILABLE }, () => {
  before(() => {
    for (const rel of CREDENTIAL_SENTINELS) {
      mkdirSync(dirname(join(home, rel)), { recursive: true });
      writeFileSync(join(home, rel), SENTINEL_TEXT);
    }
  });

  for (const rel of CREDENTIAL_SENTINELS) {
    it(`cannot read ~/${rel}`, async () => {
      const result = await exec(['/bin/cat', join(home, rel)]);
      assert.equal(result.stdout.includes(SENTINEL_TEXT), false, `~/${rel} printed its content`);
      assert.notEqual(result.exitCode, 0, `~/${rel} was read`);
    });
  }

  it('cannot copy ~/.netrc into the scratch directory, where the next invocation could read it', async () => {
    const stolen = join(own.scratch, 'stolen');
    const result = await exec(['/bin/cp', join(home, '.netrc'), stolen]);
    assert.notEqual(result.exitCode, 0, 'the copy succeeded');
    assert.equal(existsSync(stolen), false);
  });

  it('npm still runs with its .npmrc read-denied: `npm config get registry` exits 0 with HOME set to the home', { skip: !NPM_AVAILABLE && 'npm is not on the test PATH' }, async () => {
    const result = await exec(['npm', 'config', 'get', 'registry'], own.clone, { HOME: home });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^https?:\/\//);
  });

  it('the sentinel at ~/.npmrc is readable outside the sandbox, so the denial above is the sandbox and not the file mode', () => {
    const plain = spawnSync('/bin/cat', [join(home, '.npmrc')], { encoding: 'utf8' });
    assert.equal(plain.stdout, SENTINEL_TEXT);
  });
});
