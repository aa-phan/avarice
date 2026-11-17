// Plan 04-30 (OPS-5, D-13, CON-12): every resource bound is read from the profile config's `limits` section and degrades as documented: the context pack is cut to fit
// (lowest-ranked items dropped and listed), a run past the active-run bound is refused, checks queue, check output is truncated, new artifacts past the quota are refused,
// debug events past the event bound are refused and counted, and a retry reuses only the pack items the cache rule allows. Real scratch repositories, the real ledger, the
// real sandboxed checks and the fake run host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPathFor } from '../../src/adapters/fs/profile-config.ts';
import { cancelRun } from '../../src/app/cancel.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { RunStartResult } from '../../src/app/run-start.ts';
import { RUN_PROMPT_MAX_BYTES, runPromptRoom } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { effectivePackBudget } from '../../src/domain/resource-bounds.ts';
import { onboardedContext } from '../helpers/retrieval-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// The profile config with a `limits` section (merged into the file the first command wrote).
function setLimits(roots: CliRoots, limits: unknown): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  let current: Record<string, unknown> = { schema: 1 };
  try {
    current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    mkdirSync(dirname(path), { recursive: true });
  }
  writeFileSync(path, JSON.stringify({ ...current, limits }, null, 2));
}

const FIX = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' as const };

interface RunFixture {
  roots: CliRoots;
  brief: string;
  repo: ReturnType<typeof makeRunRepo>;
}

function runFixture(limits?: unknown, extraFiles: Readonly<Record<string, string>> = {}, conventions: unknown = RUN_CONVENTIONS_WITH_COMMANDS): RunFixture {
  const roots = makeRoots();
  const repo = makeRunRepo(extraFiles);
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, conventions);
  if (limits !== undefined) setLimits(roots, limits);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF) };
}

describe('tracer: a run\'s pack budget is the smaller of limits.contextTokens and the room left in the prompt, and the step records both (D-13, FR-3)', () => {
  it('records the ceiling and the effective budget in the context:pack step', async () => {
    const f = runFixture({ contextTokens: 24000 });
    const promptFile = join(f.roots.base, 'prompt.json');
    const ran = await runInProcess(f.roots, f.repo, f.brief, { ...FIX, recordTo: promptFile });
    assert.equal(ran.state, 'ready_for_review');
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step, 'the pack step was recorded');
    const pack = JSON.parse(step.result_json) as { ceiling?: number; effective?: number; usedTokens: number };
    assert.equal(pack.ceiling, 24000);

    // The room is measured from the contract as the unit prompt states it; the prompt the host was given proves the measure (no pack means the prompt is the contract text).
    const [stored] = ledgerRows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ? ORDER BY version LIMIT 1', ran.runId);
    assert.ok(stored);
    const room = runPromptRoom(JSON.parse(stored.body_json) as RunPromptContract);
    const prompt = (JSON.parse(readFileSync(promptFile, 'utf8')) as { prompt: string }).prompt;
    if (!prompt.includes('--- begin untrusted context data')) assert.equal(Buffer.byteLength(prompt), room.contractBytes, 'the measure is the size of the prompt the builder made');
    assert.equal(pack.effective, effectivePackBudget(24000, RUN_PROMPT_MAX_BYTES, room.contractBytes, room.overhead));
    assert.ok((pack.effective ?? 0) > 0 && (pack.effective ?? 0) < 8192, `inside the 32 KiB prompt the pack is under 8192 tokens, got ${String(pack.effective)}`);
    assert.ok(pack.usedTokens <= (pack.effective ?? 0));
  });

  it('a lower limits.contextTokens is the budget: ceiling and effective are both 100', async () => {
    const f = runFixture({ contextTokens: 100 });
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step);
    const pack = JSON.parse(step.result_json) as { ceiling?: number; effective?: number };
    assert.deepEqual([pack.ceiling, pack.effective], [100, 100]);
  });

  it('a missing limits section gives the 24,000 ceiling', async () => {
    const f = runFixture();
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    const [step] = ledgerRows<{ result_json: string }>(f.roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack'", ran.runId);
    assert.ok(step);
    assert.equal((JSON.parse(step.result_json) as { ceiling?: number }).ceiling, 24000);
  });
});

describe('`avarice context` takes its default budget from limits.contextTokens, and --budget overrides it (D-13)', () => {
  const FILES = { 'README.md': '# scratch\n', 'src/index.ts': 'export function answer(): number {\n  return 42;\n}\n' };

  async function budgetOf(o: Awaited<ReturnType<typeof onboardedContext>>, argv: readonly string[]): Promise<number> {
    let out = '';
    const env = { ...process.env, AVARICE_CONFIG_HOME: o.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: o.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: o.roots.AVARICE_WORK_ROOT };
    const code = await main(['context', 'answer', '--json', ...argv], { env, io: { out: (t) => void (out += t), err: () => undefined } });
    assert.equal(code, 0, out);
    return (JSON.parse(out) as { budget: number }).budget;
  }

  it('uses 24000 with no limits section and no --budget', async () => {
    const o = await onboardedContext(cleanup, FILES);
    try {
      assert.equal(await budgetOf(o, []), 24000);
    } finally {
      o.close();
    }
  });

  it('uses limits.contextTokens when the profile sets it, and --budget 500 wins over both', async () => {
    const o = await onboardedContext(cleanup, FILES);
    try {
      setLimits(o.roots, { contextTokens: 9000 });
      assert.equal(await budgetOf(o, []), 9000);
      assert.equal(await budgetOf(o, ['--budget', '500']), 500);
    } finally {
      o.close();
    }
  });
});

// ---- task 2: active runs, concurrent checks and check output ----------------------------------------------------------------------------------------------------------

describe('limits.maxActiveRuns: `start` is refused at the limit, naming the runs to close, and starts one run below it (OPS-5)', () => {
  function startFixture(limits: unknown) {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS);
    if (limits !== undefined) setLimits(roots, limits);
    const brief = writeBrief(join(roots.base, 'briefs'), RUN_BRIEF);
    const composed = createDeps(profileEnv(roots), {}, { gsd: true });
    assert.ok(composed.ok, 'composition');
    const start = (): RunStartResult => startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
    const runCount = (): number => ledgerRows<{ n: number }>(roots, "SELECT count(*) AS n FROM runs WHERE state <> 'onboarding'")[0]?.n ?? -1;
    return { roots, deps: composed.value.deps, close: composed.value.close, start, runCount };
  }

  it('starts at limit minus one and is refused at the limit, naming both runs, `avarice cancel` and `avarice status`, and writes nothing', () => {
    const f = startFixture({ maxActiveRuns: 2 });
    try {
      const first = f.start();
      assert.ok(first.ok, JSON.stringify(first));
      const second = f.start();
      assert.ok(second.ok, `one non-terminal run is one below the limit of 2: ${JSON.stringify(second)}`);
      const before = f.runCount();
      assert.equal(before, 2);
      const third = f.start();
      assert.ok(!third.ok, 'two non-terminal runs are the limit');
      assert.equal(third.failure.kind, 'refused');
      const message = third.failure.message;
      assert.match(message, /limits\.maxActiveRuns/);
      assert.ok(message.includes(first.value.runId) && message.includes(second.value.runId), message);
      assert.match(message, /avarice cancel/);
      assert.match(message, /avarice status/);
      assert.equal(f.runCount(), before, 'a refusal creates nothing');
    } finally {
      f.close();
    }
  });

  it('a run that ended no longer counts: after one is cancelled the next start goes through', async () => {
    const f = startFixture({ maxActiveRuns: 1 });
    try {
      const first = f.start();
      assert.ok(first.ok, JSON.stringify(first));
      assert.ok(!f.start().ok, 'one non-terminal run is the limit of 1');
      const cancelled = await cancelRun(f.deps, first.value.runId, 'test', f.deps.clock.nowMs());
      assert.ok(cancelled.ok, JSON.stringify(cancelled));
      const again = f.start();
      assert.ok(again.ok, JSON.stringify(again));
    } finally {
      f.close();
    }
  });

  it('refuses a limits section it cannot read, naming the key, and creates nothing', () => {
    const f = startFixture({ maxActiveRuns: -3 });
    try {
      const refused = f.start();
      assert.ok(!refused.ok);
      assert.equal(refused.failure.kind, 'usage');
      assert.match(refused.failure.message, /limits\.maxActiveRuns/);
      assert.equal(f.runCount(), 0);
    } finally {
      f.close();
    }
  });

  it('starts several runs with no limits section: the default is 20, not 2', () => {
    const f = startFixture(undefined);
    try {
      for (let i = 0; i < 3; i += 1) assert.ok(f.start().ok);
      assert.equal(f.runCount(), 3);
    } finally {
      f.close();
    }
  });
});

describe('limits.maxConcurrentChecks: checks start in declared order, at most that many at once, and are recorded in declared order (OPS-5)', () => {
  // Writes `start <name> <ms>` and `end <name> <ms>` lines to the run's scratch directory (TMPDIR), sleeping for the time the declaration gives it.
  const SLOW_SCRIPT = [
    "import { appendFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const [name, ms] = process.argv.slice(2);',
    "const log = join(process.env.TMPDIR ?? '.', 'timeline.log');",
    'appendFileSync(log, `start ${name} ${Date.now()}\\n`);',
    'await new Promise((resolve) => setTimeout(resolve, Number(ms)));',
    'appendFileSync(log, `end ${name} ${Date.now()}\\n`);',
    '',
  ].join('\n');

  // `test` (the brief's target), then c1 (slow), c2 (fast) and c3: declared in this order.
  const CONVENTIONS = {
    ...RUN_CONVENTIONS_WITH_COMMANDS,
    checks: [
      { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
      { name: 'c1', argv: ['node', 'scripts/slow.mjs', 'c1', '900'], timeoutSec: 60, required: true },
      { name: 'c2', argv: ['node', 'scripts/slow.mjs', 'c2', '200'], timeoutSec: 60, required: true },
      { name: 'c3', argv: ['node', 'scripts/slow.mjs', 'c3', '200'], timeoutSec: 60, required: true },
    ],
  };

  interface Mark {
    kind: 'start' | 'end';
    name: string;
    ms: number;
  }
  const marks = (roots: CliRoots, runId: string): Mark[] => {
    const log = join(roots.AVARICE_WORK_ROOT, runId, 'scratch', 'timeline.log');
    assert.ok(existsSync(log), 'the checks wrote their timeline');
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [kind, name, ms] = line.split(' ');
        return { kind: kind as Mark['kind'], name: name as string, ms: Number(ms) };
      })
      .sort((a, b) => a.ms - b.ms || (a.kind === 'end' ? -1 : 1));
  };
  const peak = (all: readonly Mark[]): number => {
    let open = 0;
    let most = 0;
    for (const mark of all) {
      open += mark.kind === 'start' ? 1 : -1;
      most = Math.max(most, open);
    }
    return most;
  };

  async function runWith(limits: unknown) {
    const f = runFixture(limits, { 'scripts/slow.mjs': SLOW_SCRIPT }, CONVENTIONS);
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    assert.equal(ran.state, 'ready_for_review', `${ran.state} ${String(ran.reason)}`);
    const all = marks(f.roots, ran.runId);
    const evidence = ledgerRows<{ name: string }>(f.roots, "SELECT name FROM evidence WHERE attempt_id IN (SELECT attempt_id FROM attempts WHERE run_id = ?) AND kind = 'check' ORDER BY rowid", ran.runId);
    return { all, evidence };
  }
  const declared = ['test', 'c1', 'c2', 'c3'];
  const startOrder = (all: readonly Mark[]): string[] => all.filter((m) => m.kind === 'start').map((m) => m.name);

  it('with one at a time (the default) the checks never overlap and start c1, c2, c3 in order', async () => {
    const { all, evidence } = await runWith(undefined);
    assert.equal(peak(all), 1);
    assert.deepEqual(startOrder(all).slice(0, 3), ['c1', 'c2', 'c3']);
    assert.deepEqual(evidence.map((e) => e.name).slice(0, 4), declared, 'the first pass records its results in declared order');
  });

  it('with maxConcurrentChecks 2 two run at once, never three, starts stay in declared order and evidence is recorded in declared order though c2 ends before c1', async () => {
    const { all, evidence } = await runWith({ maxConcurrentChecks: 2 });
    assert.equal(peak(all), 2, 'two overlapped, and never more');
    assert.deepEqual(startOrder(all).slice(0, 3), ['c1', 'c2', 'c3']);
    // Some pass (the checks run more than once: the validation clone, the baseline, the gates) ran c1 and c2 together, and in it c2 ended first.
    const passes = all.filter((m) => m.name === 'c1' && m.kind === 'start').map((first) => {
      const after = (kind: Mark['kind'], name: string): number => (all.find((m) => m.kind === kind && m.name === name && m.ms >= first.ms) as Mark).ms;
      return { c2Start: after('start', 'c2'), c1End: after('end', 'c1'), c2End: after('end', 'c2') };
    });
    assert.ok(passes.some((p) => p.c2Start < p.c1End && p.c2End < p.c1End), `c2 started while c1 ran and ended before it: ${JSON.stringify(passes)}`);
    assert.deepEqual(evidence.map((e) => e.name).slice(0, 4), declared, 'recorded in declared order');
  });

  it('refuses maxConcurrentChecks 3 at start, naming the key', () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS);
    setLimits(roots, { maxConcurrentChecks: 3 });
    const composed = createDeps(profileEnv(roots), {}, { gsd: true });
    assert.ok(composed.ok);
    try {
      const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF), policy: 'routine', budgetOverrides: {} });
      assert.ok(!started.ok);
      assert.match(started.failure.message, /limits\.maxConcurrentChecks/);
    } finally {
      composed.value.close();
    }
  });
});

describe("limits.checkOutputBytes: a check's output stream is cut at the cap with a marker and the real exit status is kept (OPS-5)", () => {
  // The process ends by itself after the write (no process.exit, which could cut a pipe's pending output): exit status 0.
  const NOISY = (write: string): string => [`process.stdout.write(${write});`, ''].join('\n');
  const CONVENTIONS = {
    ...RUN_CONVENTIONS_WITH_COMMANDS,
    checks: [
      { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
      { name: 'noisy', argv: ['node', 'scripts/noisy.mjs'], timeoutSec: 60, required: true },
    ],
  };
  const MARKER = '\n[avarice: output truncated]\n';
  // The part of the stored output between the stdout and stderr headers.
  const stdoutOf = (stored: string): string => stored.slice(stored.indexOf('--- stdout ---\n') + '--- stdout ---\n'.length, stored.indexOf('\n--- stderr ---'));

  async function noisyOutput(limits: unknown, script: string): Promise<{ stored: string; exitCode: number | null; truncated: unknown }> {
    const f = runFixture(limits, { 'scripts/noisy.mjs': script }, CONVENTIONS);
    const ran = await runInProcess(f.roots, f.repo, f.brief, FIX);
    assert.equal(ran.state, 'ready_for_review', `${ran.state} ${String(ran.reason)}`);
    const [row] = ledgerRows<{ artifact_digest: string; exit_code: number | null; environment_json: string }>(
      f.roots,
      "SELECT artifact_digest, exit_code, environment_json FROM evidence WHERE name = 'noisy' AND attempt_id IN (SELECT attempt_id FROM attempts WHERE run_id = ?) ORDER BY rowid DESC LIMIT 1",
      ran.runId,
    );
    assert.ok(row, 'the check left evidence');
    const hex = row.artifact_digest.replace('sha256:', '');
    const stored = readFileSync(join(f.roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
    return { stored, exitCode: row.exit_code, truncated: (JSON.parse(row.environment_json) as { truncated?: unknown }).truncated };
  }

  it('a check that prints 6 MiB with the default cap stores 5 MiB of it, then the truncation marker, and the exit status 0', async () => {
    const out = await noisyOutput(undefined, NOISY("'x'.repeat(6 * 1024 * 1024)"));
    const stdout = stdoutOf(out.stored);
    assert.ok(stdout.endsWith(MARKER), 'the marker ends the stream');
    assert.equal(stdout.slice(0, -MARKER.length).length, 5 * 1024 * 1024);
    assert.equal(out.exitCode, 0);
    assert.equal(out.truncated, true);
  });

  it('limits.checkOutputBytes sets the cap, in bytes: 1000 bytes of é (two bytes each) keep 500 characters, not 1000', async () => {
    const out = await noisyOutput({ checkOutputBytes: 1000 }, NOISY("'é'.repeat(600)"));
    const stdout = stdoutOf(out.stored);
    assert.ok(stdout.endsWith(MARKER), 'the marker ends the stream');
    const kept = stdout.slice(0, -MARKER.length);
    assert.equal(Buffer.byteLength(kept), 1000, 'the cap counts UTF-8 bytes');
    assert.equal(kept.length, 500);
    assert.equal(out.truncated, true);
    assert.equal(out.exitCode, 0);
  });

  it('output within the cap is stored whole with no marker and truncated false', async () => {
    const out = await noisyOutput({ checkOutputBytes: 1000 }, NOISY("'ok'.repeat(100)"));
    assert.ok(!out.stored.includes('output truncated'));
    assert.equal(out.truncated, false);
  });
});
