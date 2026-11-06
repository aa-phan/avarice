// S-20 (plan 02-16; CON-9, T-02-55): through a run that fails its gate, a run that crashes and is retried, and a run a hook loop limit stops, the
// user's checkout is byte-identical, and the supervisor never ran a reset, clean, checkout, restore or stash with the source as its working
// directory. The checkout is compared as one digest (HEAD, index state, working tree with untracked files, config, every ref except the run
// branch a run hands over) plus the bytes of every ignored file. A git shim first on PATH logs the working directory and arguments of every
// git call of the CLI process and of the detached supervisor, so the claim is about what ran, not about what the code says. The fake run host
// plays the unit through the real hook entry; no test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutDigest, RUN_REF_GLOB } from '../../scripts/checkout-digest.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { TEST_CLI } from '../helpers/offline.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import { git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FORBIDDEN = ['reset', 'clean', 'checkout', 'restore', 'stash'] as const;
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

// The user's own state in the source: a tracked file with an uncommitted change, an untracked file, and an ignored file.
const DIRT = {
  tracked: { path: '.planning/PROJECT.md', text: '# Slugger\n\nA tiny slug library.\n\nMy own uncommitted note about this project.\n' },
  untracked: { path: 'scratch/todo.txt', text: 'local only, never committed\n' },
  ignored: { path: 'ignored.log', text: 'a build log the user keeps\n' },
} as const;

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  shimDir: string;
  log: string;
}

// A git that records where it was run and what it was asked, then runs the real one.
function writeShim(dir: string, log: string): void {
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  mkdirSync(dir, { recursive: true });
  const script = ['#!/bin/sh', `{ printf '%s' "$(pwd -P)"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> ${JSON.stringify(log)}`, `exec ${JSON.stringify(real)} "$@"`, ''].join('\n');
  writeFileSync(join(dir, 'git'), script);
  chmodSync(join(dir, 'git'), 0o755);
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ '.gitignore': 'ignored.log\n' });
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  // The user's work in progress, after everything that is committed.
  writeFileSync(join(repo.path, DIRT.tracked.path), DIRT.tracked.text);
  mkdirSync(join(repo.path, 'scratch'), { recursive: true });
  writeFileSync(join(repo.path, DIRT.untracked.path), DIRT.untracked.text);
  writeFileSync(join(repo.path, DIRT.ignored.path), DIRT.ignored.text);
  const shimDir = join(roots.base, 'shim');
  const log = join(roots.base, 'git-shim.log');
  writeShim(shimDir, log);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), shimDir, log };
}

// Everything the user could notice: the digest of the checkout (HEAD, status, tracked and untracked bytes, refs except the run branch, linked
// worktrees), the config file, and the bytes of every ignored file.
function userState(repo: ScratchRepo): Record<string, unknown> {
  const ignored = git(repo.path, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter((p) => p !== '').sort();
  const bytes = createHash('sha256');
  for (const rel of ignored) bytes.update(rel).update('\0').update(readFileSync(join(repo.path, rel))).update('\0');
  // `counts.refsAllowed` is how many run branches the source has, which is the one thing a handed-off run is allowed to change.
  const { counts, ...digest } = checkoutDigest(repo.path, [RUN_REF_GLOB]);
  return {
    digest,
    counts: { tracked: counts.tracked, untracked: counts.untracked, statusEntries: counts.statusEntries, refs: counts.refs },
    config: readFileSync(join(repo.path, '.git', 'config'), 'utf8'),
    index: createHash('sha256').update(readFileSync(join(repo.path, '.git', 'index'))).digest('hex'),
    ignored,
    ignoredBytes: bytes.digest('hex'),
  };
}

function startWithShim(f: Fixture, run: FakeRunOptions): CliResult {
  return runCli(['start', '--brief', f.brief, '--policy', 'routine', '--wait'], {
    roots: f.roots,
    cwd: f.repo.path,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify({ run }), PATH: `${f.shimDir}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, AVARICE_GIT_SHIM_LOG: f.log },
    timeoutMs: 300_000,
  });
}

interface GitCall {
  cwd: string;
  args: string[];
  // The git subcommand: the first argument that is not an option or an option's value.
  subcommand: string;
}

function gitCalls(f: Fixture): GitCall[] {
  if (!existsSync(f.log)) return [];
  return readFileSync(f.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [cwd, ...args] = line.split('\t') as [string, ...string[]];
      let subcommand = '';
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i] as string;
        if (arg === '-c' || arg === '-C') {
          i += 1;
          continue;
        }
        if (arg.startsWith('-')) continue;
        subcommand = arg;
        break;
      }
      return { cwd, args, subcommand };
    });
}

const runIdOf = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
};
const lastLine = (stdout: string): string => stdout.trim().split('\n').at(-1) as string;
const cloneOf = (f: Fixture, runId: string): string => realpathSync((ledgerRows<{ workspace_path: string }>(f.roots, 'SELECT workspace_path FROM runs WHERE run_id = ?', runId)[0] as { workspace_path: string }).workspace_path);

// One scenario: the state of the source before and after, the run's ending, and what git was asked.
function scenario(run: FakeRunOptions): { f: Fixture; runId: string; result: CliResult; before: Record<string, unknown>; after: Record<string, unknown>; calls: GitCall[]; source: string; clone: string } {
  const f = fixture();
  const before = userState(f.repo);
  const result = startWithShim(f, run);
  const runId = runIdOf(result.stdout);
  const after = userState(f.repo);
  return { f, runId, result, before, after, calls: gitCalls(f), source: realpathSync(f.repo.path), clone: cloneOf(f, runId) };
}

function assertSourceUntouched(s: ReturnType<typeof scenario>): void {
  assert.deepEqual(s.after, s.before, 'the source checkout is byte-identical');
  assert.equal(readFileSync(join(s.f.repo.path, DIRT.tracked.path), 'utf8'), DIRT.tracked.text, 'the uncommitted change to the tracked file is still there');
  assert.equal(readFileSync(join(s.f.repo.path, DIRT.untracked.path), 'utf8'), DIRT.untracked.text);
  assert.equal(readFileSync(join(s.f.repo.path, DIRT.ignored.path), 'utf8'), DIRT.ignored.text);
  assert.ok(existsSync(s.clone), 'the run clone still exists');
  assert.ok(existsSync(join(s.clone, '.git')), 'and is still a repository');
  const inSource = s.calls.filter((c) => c.cwd === s.source);
  assert.ok(inSource.length > 0, 'the shim was exercised: git ran with the source as its working directory');
  const forbidden = inSource.filter((c) => (FORBIDDEN as readonly string[]).includes(c.subcommand));
  assert.deepEqual(forbidden, [], 'no reset, clean, checkout, restore or stash ran in the source');
  // A git whose cwd is the source but whose own -C or --git-dir points elsewhere would be invisible to the line above; none of the five may name it either.
  const aimed = s.calls.filter((c) => (FORBIDDEN as readonly string[]).includes(c.subcommand) && c.args.some((a) => a === s.source || a.startsWith(`${s.source}/`)));
  assert.deepEqual(aimed, [], 'and none was aimed at the source by an argument');
}

describe('the user checkout is byte-identical through a failed, a crashed-and-retried and a blocked run (S-20)', () => {
  it('(a) a run whose fix fails its gate: blocked, and the source is as it was', () => {
    const s = scenario({ ...FIX, brokenFix: true });
    assert.equal(s.result.code, 3, s.result.stderr + s.result.stdout);
    assert.equal(lastLine(s.result.stdout), `run ${s.runId}: blocked_on_decision (decision)`);
    assertSourceUntouched(s);
    assert.equal(sourceRefsOf(s.f).length, 0, 'no run branch in the source');
  });

  it('(b) a crash and a retry: the discard restores in the clone, never in the source, and the run branch is the only new ref', () => {
    const s = scenario({ perAttempt: [{ crash: { afterFiles: ['src/slug.ts', 'src/extra.ts'] } }, FIX] });
    assert.equal(s.result.code, 0, s.result.stderr + s.result.stdout);
    assert.equal(lastLine(s.result.stdout), `run ${s.runId}: ready_for_review`);
    assertSourceUntouched(s);
    const restored = s.calls.filter((c) => c.subcommand === 'restore' && c.cwd === s.clone);
    assert.ok(restored.length > 0, 'the discard ran `git restore` in the run clone');
    assert.deepEqual(sourceRefsOf(s.f), [`refs/heads/avarice/${s.runId}`], 'the hand-off is the one new ref');
  });

  it('(c) a run a loop limit stops: blocked, and the source is as it was', () => {
    const s = scenario({ denyLoop: 3 });
    assert.equal(s.result.code, 3, s.result.stderr + s.result.stdout);
    assert.equal(lastLine(s.result.stdout), `run ${s.runId}: blocked_on_decision (decision)`);
    assertSourceUntouched(s);
    assert.equal(sourceRefsOf(s.f).length, 0);
  });

  it('the shim sees the clone\'s git calls too, so an empty list for the source is a fact and not a blind spot', () => {
    const s = scenario({ perAttempt: [{ crash: { afterFiles: ['src/extra.ts'] } }, FIX] });
    assert.ok(s.calls.some((c) => c.cwd === s.clone), 'git ran in the clone');
    assert.ok(readdirSync(s.f.shimDir).includes('git'));
  });
});

function sourceRefsOf(f: Fixture): string[] {
  return git(f.repo.path, ['for-each-ref', '--format=%(refname)', 'refs/heads/avarice/']).split('\n').filter((line) => line !== '');
}
