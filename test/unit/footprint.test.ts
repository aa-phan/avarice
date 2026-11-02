// NFR-1: nothing to install and nothing left running. package.json declares no runtime dependencies, no
// source file imports a network module or starts a detached process, no AVARICE command leaves a process behind
// after it exits, and no command listens on a socket while it runs. AC-1's script installs nothing and never
// asks for admin rights (T-01-SC).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import { TEST_CLI } from '../helpers/offline.ts';

const run = promisify(execFile);
const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const REPO_FILES = { 'README.md': '# scratch\n', 'src/index.ts': 'export const answer = 42;\n' };

describe('package.json declares no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('has no dependencies, optional, peer or bundled dependencies', () => {
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
      assert.equal(key in pkg, false, key);
    }
  });

  it('has no install lifecycle script and pins every dev dependency exactly', () => {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>;
    for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) assert.equal(name in scripts, false, name);
    for (const [name, version] of Object.entries((pkg['devDependencies'] ?? {}) as Record<string, string>)) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly`);
    }
  });
});

function sourceFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as Array<{ name: string; parentPath: string; isFile(): boolean }>)
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
}

describe('no source file reaches the network or starts a background process', () => {
  const files = [...sourceFiles(join(REPO_ROOT, 'src')), PRODUCTION_ENTRY];

  it('imports no network module', () => {
    assert.ok(files.length > 20, 'the scan found the source tree');
    const banned = /(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"](?:node:)?(?:net|http|https|http2|dgram|tls|dns|dns\/promises|cluster|inspector)['"]/;
    const offenders = files.filter((f) => banned.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, []);
  });

  it('never calls fetch, opens a listener or detaches a child', () => {
    const banned = /\bfetch\s*\(|\.listen\s*\(|detached\s*:\s*true|\bnew\s+WebSocket\b|\bXMLHttpRequest\b/;
    const offenders = files.filter((f) => banned.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, []);
  });
});

// Processes that mention any of these unique temp names, or hold a file open under them, belong to this test.
async function lingering(tokens: readonly string[], dirs: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const token of tokens) {
    try {
      const r = await run('/usr/bin/pgrep', ['-f', token]);
      if (r.stdout.trim() !== '') found.push(`pgrep ${token}: ${r.stdout.trim()}`);
    } catch (e) {
      if ((e as { code?: unknown }).code !== 1) throw e;
    }
  }
  for (const dir of dirs) {
    try {
      const r = await run('lsof', ['-nP', '+D', dir]);
      if (r.stdout.trim() !== '') found.push(`lsof ${dir}: ${r.stdout.trim()}`);
    } catch (e) {
      const err = e as { code?: unknown; stdout?: string };
      if (err.code !== 1 || (err.stdout ?? '').trim() !== '') throw e;
    }
  }
  return found;
}

describe('no command leaves a process running after it exits', () => {
  it('init, onboard (fake host), status and resume leave nothing behind', async () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);
    const hostEnv = { AVARICE_FAKE_HOST: '{}' };
    assert.equal(runCli(['init'], { roots }).code, 0);
    const onboarded = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: hostEnv });
    assert.equal(onboarded.code, 0, onboarded.stderr);
    assert.equal(runCli(['status', '--json'], { roots }).code, 0);
    const id = /onboarding (onb_[0-9A-Z]{26})/.exec(onboarded.stdout)?.[1] ?? '';
    assert.notEqual(id, '');
    assert.equal(runCli(['resume', id], { roots, entry: TEST_CLI, env: hostEnv }).code, 0);

    const left = await lingering([basename(roots.base), basename(repo.base)], [roots.base, repo.base]);
    assert.deepEqual(left, []);
  });

  it('detects a lingering process (control)', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-linger-')));
    cleanup.push(base);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', basename(base)], { cwd: base, stdio: 'ignore' });
    try {
      const left = await lingering([basename(base)], [base]);
      assert.ok(left.some((l) => l.startsWith('pgrep')), JSON.stringify(left));
      assert.ok(left.some((l) => l.startsWith('lsof')), JSON.stringify(left));
    } finally {
      child.kill('SIGKILL');
    }
  });
});

// TCP listeners owned by a process, from lsof.
async function listeners(pid: number): Promise<string> {
  try {
    return (await run('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'])).stdout.trim();
  } catch (e) {
    if ((e as { code?: unknown }).code === 1) return '';
    throw e;
  }
}

// Polls lsof for the child's listeners until it exits; returns every non-empty sample and how many samples ran.
async function watchListeners(child: ReturnType<typeof spawn>, windowMs: number): Promise<{ samples: number; seen: string[] }> {
  let exited = false;
  child.on('close', () => (exited = true));
  const seen: string[] = [];
  let samples = 0;
  const deadline = Date.now() + windowMs;
  while (!exited && Date.now() < deadline) {
    if (child.pid !== undefined) {
      const l = await listeners(child.pid);
      samples += 1;
      if (l !== '') seen.push(l);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { samples, seen };
}

function cliChild(roots: CliRoots, entry: string, argv: readonly string[], env: Record<string, string>): ReturnType<typeof spawn> {
  const childEnv: Record<string, string | undefined> = { ...process.env, ...roots, ...env };
  delete childEnv['NODE_TEST_CONTEXT'];
  return spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry, ...argv], { env: childEnv as NodeJS.ProcessEnv, stdio: 'ignore' });
}

describe('no command opens a listening socket while it runs', () => {
  it('sees a listener when there is one (control)', async () => {
    const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(0, '127.0.0.1'); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
    try {
      let seen = '';
      for (let i = 0; i < 50 && seen === ''; i++) {
        seen = child.pid === undefined ? '' : await listeners(child.pid);
        if (seen === '') await new Promise((r) => setTimeout(r, 40));
      }
      assert.match(seen, /LISTEN/);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('status and a slowed onboard (about 2 s) never listen', async () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);

    // Warm profile so `status` finds the store.
    assert.equal(runCli(['init'], { roots }).code, 0);
    const status = await watchListeners(cliChild(roots, PRODUCTION_ENTRY, ['status'], {}), 2000);
    assert.deepEqual(status.seen, []);

    const slow = await watchListeners(
      cliChild(roots, TEST_CLI, ['onboard', '--policy', 'onboarding', repo.path], { AVARICE_FAKE_HOST: JSON.stringify({ sleepMs: 1500 }) }),
      15_000,
    );
    assert.ok(slow.samples >= 10, `the onboarding ran long enough to be sampled (${slow.samples} samples)`);
    assert.deepEqual(slow.seen, []);
  });
});

describe('scripts/ac1-timing.sh', () => {
  const script = join(REPO_ROOT, 'scripts', 'ac1-timing.sh');
  const text = readFileSync(script, 'utf8');

  it('asks for no admin rights and installs nothing', () => {
    assert.equal(/\bsudo\b|\bdoas\b|\bnpm\s+(?:i|install|ci)\b|\bpip3?\s+install\b|\bcargo\s+(?:add|install)\b|\bbrew\s+install\b/.test(text), false);
  });

  it('refuses a scratch directory under ~/.claude* before creating anything', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-ac1-home-')));
    cleanup.push(home);
    const tmp = join(home, '.claude-work', 'tmp');
    mkdirSync(tmp, { recursive: true });
    const r = spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, TMPDIR: tmp }, timeout: 30_000 });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /AC-1 refused/);
    assert.deepEqual(readdirSync(tmp), []);
  });
});
