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
  deps = { home, profile: { dataRoot: own.dataRoot, workRoot: own.workRoot } } as unknown as AppDeps;
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

  it('documented limit: a profile whose roots sit outside the default parents is not covered', async () => {
    const custom = { ...deps, profile: { dataRoot: join(outside, 'custom-data'), workRoot: join(outside, 'custom-work') } } as unknown as AppDeps;
    mkdirSync(join(outside, 'custom-data'), { recursive: true });
    mkdirSync(join(outside, 'custom-work/run_A/clone'), { recursive: true });
    writeFileSync(join(outside, 'other-profile-custom-data'), 'a profile placed elsewhere by AVARICE_DATA_ROOT');
    const sandbox = sandboxSetup(custom, run, join(outside, 'custom-work/run_A/clone'));
    assert.ok(sandbox.ok);
    assert.equal(sandbox.value.denyReadPaths.includes(join(outside, 'other-profile-custom-data')), false);
    const result = await new SandboxedExecutor().run({ ...command(['/bin/cat', join(outside, 'other-profile-custom-data')]), denyReadPaths: sandbox.value.denyReadPaths, allowReadPaths: sandbox.value.allowReadPaths, cwd: join(outside, 'custom-work/run_A/clone') });
    assert.ok(result.ok);
    assert.equal(result.value.exitCode, 0, 'outside the default parents and the own roots: readable, as documented');
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
