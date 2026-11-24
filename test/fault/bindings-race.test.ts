// Concurrent writers keep every binding (plan 04-43; WR-15, SEC-1, T-04-117). bindings.json routes a repository to its profile, so a lost entry lets a
// bound repository open under another profile. writeBinding reads the registry, adds one entry and renames a temporary file over it; without a lock two
// processes that read before either renames drop the earlier entry. Two processes released at one start time each bind 20 repositories in a tight loop,
// three times over, and the registry must hold all 40 each time. The lock file beside the registry is also shown: a lock left by a dead process does not
// block a writer, and a lock held by a live one stops writeBinding and backfillBindings after 2 seconds, naming the holder.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backfillBindings, bindingsPathFor, readBindings, writeBinding } from '../../src/adapters/fs/profile-bindings.ts';

const CHILD = join(import.meta.dirname, '..', 'helpers', 'bindings-race-child.ts');
const PER_PROCESS = 20;
const REPETITIONS = 3;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function freshHome(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-bindings-race-')));
  cleanup.push(base);
  const configHome = join(base, 'config');
  mkdirSync(configHome, { recursive: true });
  return configHome;
}

interface Line {
  label: string;
  index: number;
  ok: boolean;
  error?: unknown;
}

function runChild(configHome: string, label: string, startAtMs: number): Promise<Line[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, configHome, label, String(startAtMs), String(PER_PROCESS)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`child ${label} exited ${String(code)}: ${err}`));
      else resolve(out.trim().split('\n').map((l) => JSON.parse(l) as Line));
    });
  });
}

const lockPathFor = (configHome: string): string => `${bindingsPathFor(configHome)}.lock`;

// The identity of a repository the lock tests bind; a distinct commit per index.
const identity = (index: number): { gitRoot: string; rootCommit: string } => ({ gitRoot: `/lock/repo-${String(index)}`, rootCommit: index.toString(16).padStart(2, '0') + 'c'.repeat(38) });

describe('two processes binding different repositories at the same moment keep every binding (WR-15, T-04-117)', () => {
  for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
    it(`repetition ${String(repetition)}: after two writers each add ${String(PER_PROCESS)} bindings, bindings.json holds all ${String(2 * PER_PROCESS)}`, async () => {
      const configHome = freshHome();
      const startAtMs = Date.now() + 1500;
      const [a, b] = await Promise.all([runChild(configHome, 'A', startAtMs), runChild(configHome, 'B', startAtMs)]);
      for (const line of [...a, ...b]) assert.equal(line.ok, true, `every writeBinding call succeeds: ${JSON.stringify(line)}`);
      const all = readBindings(configHome);
      assert.ok(all.ok, all.ok ? '' : JSON.stringify(all.error));
      assert.equal(all.value.length, 2 * PER_PROCESS, `all ${String(2 * PER_PROCESS)} bindings are kept, found ${String(all.value.length)}`);
      assert.equal(new Set(all.value.map((x) => x.gitRoot)).size, 2 * PER_PROCESS, 'each binding once');
      for (const label of ['A', 'B']) assert.equal(all.value.filter((x) => x.gitRoot.startsWith(`/race/${label}/`)).length, PER_PROCESS, `process ${label} lost none`);
      assert.equal(existsSync(lockPathFor(configHome)), false, 'the lock is released');
      assert.deepEqual(readdirSync(configHome).filter((name) => name.endsWith('.tmp')), [], 'no temporary file is left');
    });
  }
});

describe('the bindings lock (WR-15, T-04-117)', () => {
  const holders: ChildProcess[] = [];
  after(() => {
    for (const holder of holders) holder.kill();
  });

  // A process that is alive for the length of a test, so its ID is a live holder.
  function liveHolder(): number {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    holders.push(child);
    assert.ok(child.pid !== undefined, 'the holder started');
    return child.pid;
  }

  // The ID of a process that has exited, so no process holds it.
  function deadPid(): number {
    const done = spawnSync(process.execPath, ['-e', '']);
    assert.ok(done.pid > 0);
    return done.pid;
  }

  function plantLock(configHome: string, pid: number): void {
    writeFileSync(lockPathFor(configHome), JSON.stringify({ pid, startedAt: new Date().toISOString() }));
  }

  it('takes over a lock whose holder is no longer alive and writes the binding', () => {
    const configHome = freshHome();
    plantLock(configHome, deadPid());
    const written = writeBinding(configHome, { ...identity(1), profile: 'personal-local', boundAt: '2026-11-22T00:00:00.000Z' });
    assert.ok(written.ok, written.ok ? '' : JSON.stringify(written.error));
    const all = readBindings(configHome);
    assert.ok(all.ok);
    assert.equal(all.value.length, 1);
    assert.equal(existsSync(lockPathFor(configHome)), false, 'the lock taken over is released');
  });

  // GWR-05 (T-04-155): a writer that crashed leaves its lock behind, and its process ID can be given to an unrelated process that is alive. The lock says it was
  // written an hour ago; the process now holding that ID started a moment ago, so it cannot be the writer, and the lock is taken over.
  it('takes over a lock whose process ID is held by a live process that started after the lock was written, within the wait', () => {
    const configHome = freshHome();
    const pid = liveHolder();
    writeFileSync(lockPathFor(configHome), JSON.stringify({ pid, startedAt: new Date(Date.now() - 3_600_000).toISOString() }));
    const started = Date.now();
    const written = writeBinding(configHome, { ...identity(3), profile: 'personal-local', boundAt: '2026-11-22T00:00:00.000Z' });
    const waited = Date.now() - started;
    assert.ok(written.ok, `the lock of a reused process ID is taken over, not waited on: ${written.ok ? '' : JSON.stringify(written.error)} after ${String(waited)} ms`);
    assert.ok(waited < 1900, `taken over without waiting out the 2 seconds, not after ${String(waited)} ms`);
    const all = readBindings(configHome);
    assert.ok(all.ok);
    assert.equal(all.value.length, 1, 'the binding is in the registry');
    assert.equal(existsSync(lockPathFor(configHome)), false, 'the lock is released');
  });

  it('returns unavailable naming the holder when a live process holds the lock for longer than 2 seconds, and writes nothing', () => {
    const configHome = freshHome();
    const pid = liveHolder();
    plantLock(configHome, pid);
    const started = Date.now();
    const written = writeBinding(configHome, { ...identity(2), profile: 'personal-local', boundAt: '2026-11-22T00:00:00.000Z' });
    const waited = Date.now() - started;
    assert.equal(written.ok, false);
    if (written.ok) return;
    assert.equal(written.error.kind, 'unavailable');
    assert.match(JSON.stringify(written.error), new RegExp(`\\b${String(pid)}\\b`), 'the error names the holding process');
    assert.ok(waited >= 1900, `waited for the lock about 2 seconds, not ${String(waited)} ms`);
    assert.ok(waited < 10_000, `gave up after a bounded wait, not ${String(waited)} ms`);
    const all = readBindings(configHome);
    assert.ok(all.ok);
    assert.equal(all.value.length, 0, 'nothing was written without the lock');
    assert.equal(existsSync(lockPathFor(configHome)), true, 'a lock the writer did not take is left alone');
  });

  it('is taken by backfillBindings too: a live holder stops it, and a free lock lets it write and is released', () => {
    const repo = join(freshHome(), '..', 'repo');
    mkdirSync(repo, { recursive: true });
    const configHome = freshHome();
    const projects = [{ rootCommit: 'd'.repeat(40), repoPath: repo }];
    const pid = liveHolder();
    plantLock(configHome, pid);
    const blocked = backfillBindings(configHome, 'personal-local', projects, Date.now());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.error.kind, 'unavailable');
      assert.match(JSON.stringify(blocked.error), new RegExp(`\\b${String(pid)}\\b`));
    }
    rmSync(lockPathFor(configHome));
    const added = backfillBindings(configHome, 'personal-local', projects, Date.now());
    assert.ok(added.ok, added.ok ? '' : JSON.stringify(added.error));
    assert.equal(added.value, 1);
    assert.equal(existsSync(lockPathFor(configHome)), false, 'the lock is released');
  });
});
