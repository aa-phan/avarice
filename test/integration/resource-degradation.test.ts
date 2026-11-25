// Plan 04-30 (OPS-5, D-13, CON-12): every resource bound is read from the profile config's `limits` section and degrades as documented: the context pack is cut to fit
// (lowest-ranked items dropped and listed), a run past the active-run bound is refused, checks queue, check output is truncated, new artifacts past the quota are refused,
// debug events past the event bound are refused and counted, and a retry reuses only the pack items the cache rule allows. Real scratch repositories, the real ledger, the
// real sandboxed checks and the fake run host; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { configPathFor } from '../../src/adapters/fs/profile-config.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { cancelRun } from '../../src/app/cancel.ts';
import { queryContext } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { RunStartResult } from '../../src/app/run-start.ts';
import { RUN_PROMPT_MAX_BYTES, runPromptRoom } from '../../src/app/run-gsd-config.ts';
import type { RunPromptContract } from '../../src/app/run-gsd-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { effectivePackBudget } from '../../src/domain/resource-bounds.ts';
import type { ContextHandle, GitFilesSource } from '../../src/ports/context-source.ts';
import { doctor, doctorFixture, initStore, reportOf, statePath, writeProfileConfig } from '../helpers/doctor-fixtures.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import { chainIsIntact, eventRows, makeHookFixture } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';
import { onboardedContext, startedRun } from '../helpers/retrieval-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { FIXED_SLUG, RUN_BRIEF, RUN_CONVENTIONS, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, onboardRunRepoWithIndexes, profileEnv, runInProcess, writeBrief } from '../helpers/run-fixtures.ts';

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
    "import { appendFileSync, existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    'const [name, ms, gate] = process.argv.slice(2);',
    "const log = join(process.env.TMPDIR ?? '.', 'timeline.log');",
    "const count = (prefix) => (existsSync(log) ? readFileSync(log, 'utf8').split('\\n').filter((line) => line.startsWith(prefix)).length : 0);",
    'appendFileSync(log, `start ${name} ${Date.now()}\\n`);',
    '// A gated check waits (at most 20 s) until the check it names has ended as often as this one has started, so an overlap does not depend on how fast a loaded machine starts a process.',
    'if (gate !== undefined) {',
    '  const ordinal = count(`start ${name} `);',
    '  const limit = Date.now() + 20_000;',
    '  while (count(`end ${gate} `) < ordinal && Date.now() < limit) await new Promise((resolve) => setTimeout(resolve, 25));',
    '}',
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

  // The same checks with c1 gated on c2's end (see SLOW_SCRIPT): with two at a time c1 cannot end before c2 has started and ended.
  const GATED_CONVENTIONS = {
    ...CONVENTIONS,
    checks: CONVENTIONS.checks.map((c) => (c.name === 'c1' ? { ...c, argv: ['node', 'scripts/slow.mjs', 'c1', '100', 'c2'] } : c)),
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

  async function runWith(limits: unknown, conventions: unknown = CONVENTIONS) {
    const f = runFixture(limits, { 'scripts/slow.mjs': SLOW_SCRIPT }, conventions);
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
    const { all, evidence } = await runWith({ maxConcurrentChecks: 2 }, GATED_CONVENTIONS);
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

// ---- task 3: the artifact quota, the event bound, the doctor report and pack reuse on retry -------------------------------------------------------------------------

describe('limits.artifactQuotaMiB: a new artifact past the quota is refused with a message naming the quota (OPS-5, T-04-82)', () => {
  const KIB = 1024;
  const blob = (kib: number, fill: number): Uint8Array => new Uint8Array(kib * KIB).fill(fill);
  const dirOf = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-quota-'));
    cleanup.push(dir);
    return dir;
  };

  it('with a quota of 1 MiB and 900 KiB stored, a 200 KiB put is unavailable naming the quota and the profile, and a smaller one that fits is stored', () => {
    const dir = dirOf();
    const quota = { mib: 1, profile: 'personal-local' };
    const first = new LocalArtifactStore(dir, {}, quota);
    const stored = first.put(blob(900, 1), { kind: 'check-output' });
    assert.ok(stored.ok);
    // A second store over the same directory counts what is on disk, not what it wrote itself.
    const again = new LocalArtifactStore(dir, {}, quota);
    const refused = again.put(blob(200, 2), { kind: 'check-output' });
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'unavailable');
    assert.equal((refused.error as { cause: string }).cause, 'artifact quota of 1 MiB reached for profile personal-local');
    assert.equal(again.has(`sha256:${createHash('sha256').update(blob(200, 2)).digest('hex')}`).ok, true);
    assert.deepEqual(again.has(`sha256:${createHash('sha256').update(blob(200, 2)).digest('hex')}`), { ok: true, value: false }, 'the refused blob was not stored');
    const fits = again.put(blob(100, 3), { kind: 'check-output' });
    assert.ok(fits.ok, 'the quota is passed only by a put that would exceed it: 900 + 100 KiB is 1000 of 1024');
  });

  it('a put that lands exactly on the quota is stored, and the next new byte is refused (the boundary pair)', () => {
    const dir = dirOf();
    const store = new LocalArtifactStore(dir, {}, { mib: 1, profile: 'personal-local' });
    assert.ok(store.put(blob(512, 1), { kind: 'check-output' }).ok);
    assert.ok(store.put(blob(512, 2), { kind: 'check-output' }).ok, '1024 KiB is the quota, not past it');
    const over = store.put(new Uint8Array([1]), { kind: 'check-output' });
    assert.ok(!over.ok);
    assert.equal(over.error.kind, 'unavailable');
  });

  it('content that is already stored is a no-op past the quota: the same digest is returned and nothing is refused', () => {
    const dir = dirOf();
    const store = new LocalArtifactStore(dir, {}, { mib: 1, profile: 'personal-local' });
    const first = store.put(blob(1024, 7), { kind: 'check-output' });
    assert.ok(first.ok);
    const again = store.put(blob(1024, 7), { kind: 'check-output' });
    assert.deepEqual(again, first);
  });

  it('without a quota nothing is refused for size', () => {
    const dir = dirOf();
    const store = new LocalArtifactStore(dir);
    assert.ok(store.put(blob(2048, 9), { kind: 'check-output' }).ok);
  });
});

describe('a check whose output cannot be stored fails the check stage with the quota message and leaves no evidence row without its output (T-04-83)', () => {
  const CONVENTIONS = {
    ...RUN_CONVENTIONS_WITH_COMMANDS,
    checks: [
      { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
      { name: 'noisy', argv: ['node', 'scripts/noisy.mjs'], timeoutSec: 60, required: true },
    ],
  };

  it('stops with an unavailable error naming the 1 MiB quota; the check that could not be stored has no evidence, and no check evidence lacks its output', async () => {
    const roots = makeRoots();
    const repo = makeRunRepo({ 'scripts/noisy.mjs': "process.stdout.write('x'.repeat(1.5 * 1024 * 1024));\n" });
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, CONVENTIONS);
    setLimits(roots, { artifactQuotaMiB: 1 });
    const composed = createDeps(profileEnv(roots), { host: new FakeRunHost(FIX) });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: writeBrief(join(roots.base, 'briefs'), RUN_BRIEF), policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runSupervisor(composed.value.deps, started.value.runId);
      assert.ok(!outcome.ok, 'the run does not go on over evidence it could not store');
      assert.equal(outcome.error.kind, 'unavailable');
      assert.equal((outcome.error as { cause: string }).cause, 'artifact quota of 1 MiB reached for profile personal-local');
    } finally {
      composed.value.close();
    }
    const noisy = ledgerRows<{ n: number }>(roots, "SELECT count(*) AS n FROM evidence WHERE name = 'noisy'")[0]?.n;
    assert.equal(noisy, 0, 'no evidence row for the check whose output was refused');
    const outputless = ledgerRows<{ n: number }>(roots, "SELECT count(*) AS n FROM evidence WHERE kind = 'check' AND (artifact_digest IS NULL OR artifact_digest = '')")[0]?.n;
    assert.equal(outputless, 0, 'every check evidence row has its output');
  });
});

describe('limits.maxEventRows: debug events past the bound are refused and counted, and nothing above debug is ever dropped (OPS-5, T-04-84)', () => {
  const fixtures: HookFixture[] = [];
  after(() => {
    for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
  });
  const rowsOf = (fx: HookFixture): number => eventRows(fx).length;
  const metaDropped = (fx: HookFixture): string | undefined => {
    const db = new DatabaseSync(fx.ledgerPath, { readOnly: true });
    try {
      return (db.prepare("SELECT value FROM meta WHERE key = 'events_dropped_debug'").get() as { value: string } | undefined)?.value;
    } finally {
      db.close();
    }
  };
  // A ledger over the fixture store with the bound set, and the number of rows to append so the table holds exactly `rows`.
  function boundedLedger(rows: number, bound: number): { fx: HookFixture; ledger: SqliteLedger; close: () => void } {
    const fx = makeHookFixture();
    fixtures.push(fx);
    const opened = openDb(fx.ledgerPath);
    assert.ok(opened.ok);
    const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}x`, { maxEventRows: bound });
    for (let i = rowsOf(fx); i < rows; i += 1) assert.ok(ledger.appendEvent({ type: 'filler', data: { i }, nowMs: 1_000 + i }).ok);
    return { fx, ledger, close: () => opened.value.close() };
  }

  it('with 50 rows and a bound of 50 a debug event is refused and counted, an info event is still written, and the chain holds', () => {
    const { fx, ledger, close } = boundedLedger(50, 50);
    try {
      const refused = ledger.appendEvent({ type: 'probe.debug', level: 'debug', data: { n: 1 }, nowMs: 5_000 });
      assert.ok(refused.ok, 'a refused debug event is not an error for the caller');
      assert.equal((refused.value as { dropped?: boolean }).dropped, true);
      assert.equal(rowsOf(fx), 50);
      assert.equal(metaDropped(fx), '1');
      const info = ledger.appendEvent({ type: 'probe.info', data: { n: 2 }, nowMs: 5_001 });
      assert.ok(info.ok);
      assert.equal((info.value as { dropped?: boolean }).dropped, undefined);
      for (const level of ['warn', 'error'] as const) assert.ok(ledger.appendEvent({ type: `probe.${level}`, level, data: {}, nowMs: 5_002 }).ok);
      assert.equal(eventRows(fx, 'probe.debug').length, 0, 'the debug event is not in the table');
      assert.equal(eventRows(fx, 'probe.info').length, 1, 'the info event is');
      assert.equal(rowsOf(fx), 53, 'info, warn and error go past the bound');
      assert.ok(ledger.appendEvent({ type: 'probe.debug', level: 'debug', data: { n: 3 }, nowMs: 5_003 }).ok);
      assert.equal(metaDropped(fx), '2', 'each refused debug event is counted');
      assert.ok(chainIsIntact(fx.ledgerPath));
    } finally {
      close();
    }
  });

  it('with 49 rows and a bound of 50 a debug event is written: the bound is reached at 50, not before', () => {
    const { fx, ledger, close } = boundedLedger(49, 50);
    try {
      const written = ledger.appendEvent({ type: 'probe.debug', level: 'debug', data: {}, nowMs: 5_000 });
      assert.ok(written.ok);
      assert.equal((written.value as { dropped?: boolean }).dropped, undefined);
      assert.equal(eventRows(fx, 'probe.debug').length, 1);
      assert.equal(metaDropped(fx), undefined, 'nothing was dropped');
      assert.equal(rowsOf(fx), 50);
    } finally {
      close();
    }
  });
});

describe('doctor reports the events table: its rows, the bound and the debug events dropped (OPS-5)', () => {
  const EVENT_KEYS = ['read', 'rows', 'bound', 'droppedDebug'];

  it('shows the rows, the configured bound and the dropped count after debug events were refused', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { limits: { maxEventRows: 5 } });
    initStore(f);
    const opened = openDb(statePath(f));
    assert.ok(opened.ok);
    const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}x`, { maxEventRows: 5 });
    for (let i = 0; i < 6; i += 1) assert.ok(ledger.appendEvent({ type: 'filler', data: { i }, nowMs: 1_000 + i }).ok);
    for (let i = 0; i < 2; i += 1) assert.ok(ledger.appendEvent({ type: 'probe.debug', level: 'debug', data: {}, nowMs: 2_000 + i }).ok);
    const rows = (opened.value.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n;
    opened.value.close();
    const r = doctor(f, ['--json']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const events = (reportOf(r) as unknown as { events?: Record<string, unknown> }).events;
    assert.ok(events, 'the report has an events section');
    assert.deepEqual(Object.keys(events), EVENT_KEYS);
    assert.deepEqual(events, { read: true, rows, bound: 5, droppedDebug: 2 });
  });

  it('shows the default bound of 500,000 and no drops for a profile with no limits section', () => {
    const f = doctorFixture();
    initStore(f);
    const r = doctor(f, ['--json']);
    const events = (reportOf(r) as unknown as { events?: { read: boolean; bound: number; droppedDebug: number } }).events;
    assert.ok(events);
    assert.equal(events.read, true);
    assert.equal(events.bound, 500000);
    assert.equal(events.droppedDebug, 0);
  });

  it('says the section was not read when there is no store, and names a limits section that cannot be used as an error with a fix', () => {
    const f = doctorFixture();
    writeProfileConfig(f, 'personal-local', { limits: { maxConcurrentChecks: 3 } });
    const r = doctor(f, ['--json']);
    const rep = reportOf(r) as unknown as { events?: { read: boolean }; findings: Array<{ level: string; area: string; message: string; fix: string }> };
    assert.equal(rep.events?.read, false);
    const finding = rep.findings.find((x) => x.area === 'limits');
    assert.ok(finding, JSON.stringify(rep.findings));
    assert.equal(finding.level, 'error');
    assert.match(finding.message, /limits\.maxConcurrentChecks/);
    assert.ok(finding.fix.length > 0);
    assert.equal(r.code, 3);
  });
});

// A git-files source with two handles that counts the handles it is asked to read and says what revision it is at.
function countingGitFiles(state: { revision: string; reads: string[] }): GitFilesSource {
  const handle = (id: string): ContextHandle => ({
    ref: { provider: 'git-files', kind: 'snippet', id, revision: state.revision, retrievedAt: '2026-11-17T00:00:00.000Z', scope: id.split(':')[0] as string, freshness: 'fresh' },
    title: id,
    estTokens: 20,
    reason: 'matched X',
  });
  return {
    descriptor: { port: 'context-source', adapter: 'git-files', version: '1', capabilities: { find: true, read: true, refresh: true }, offline: true },
    find: async () => ({ ok: true, value: [handle('src/a.ts:1'), handle('src/b.ts:1')] }),
    read: async (handles) => {
      state.reads.push(...handles.map((h) => h.ref.id));
      return { ok: true, value: handles.map((h) => ({ ref: h.ref, title: h.title, excerpt: `text of ${h.ref.id} at ${h.ref.revision ?? '?'}`, estTokens: h.estTokens, reason: h.reason })) };
    },
    refresh: async (ref) => ({ ok: true, value: ref }),
    pathExists: () => true,
  };
}

describe('a pack budget of 0 (no room left in the prompt) gives an empty pack with every handle listed as omitted, and nothing is read (the precision edge, D-13)', () => {
  it('lists both handles as omitted and reads none of them', async () => {
    const s = startedRun(cleanup);
    try {
      const state = { revision: 'git:0123456789abcdef', reads: [] as string[] };
      const deps: AppDeps = { ...s.deps, context: { ...s.deps.context, gitFiles: countingGitFiles(state) } };
      const result = await queryContext(deps, { projectId: s.contract.workspace.projectId, term: 'X', budget: 0, runId: s.runId });
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.items.filter((i) => i.source === 'git-files').length, 0);
      assert.deepEqual(result.value.omitted.filter((o) => o.source === 'git-files').map((o) => o.id).sort(), ['src/a.ts:1', 'src/b.ts:1']);
      assert.deepEqual(state.reads, []);
      assert.equal(result.value.usedTokens, 0);
    } finally {
      s.close();
    }
  });
});

describe('a retried item reuses the previous pack items the cache rule allows and fetches the rest again (CON-12)', () => {
  const only = (items: readonly { source: string }[], source: string): number => items.filter((i) => i.source === source).length;

  it('reuses both items of an unchanged pack without reading them again, and says so', async () => {
    const s = startedRun(cleanup);
    try {
      const state = { revision: 'git:0123456789abcdef', reads: [] as string[] };
      const deps: AppDeps = { ...s.deps, context: { ...s.deps.context, gitFiles: countingGitFiles(state) } };
      const request = { projectId: s.contract.workspace.projectId, term: 'X', budget: 4000, runId: s.runId };
      const first = await queryContext(deps, request);
      assert.ok(first.ok, JSON.stringify(first));
      assert.equal(only(first.value.items, 'git-files'), 2);
      assert.equal(state.reads.length, 2);
      assert.equal(first.value.reuse, undefined, 'a first pack asks for no reuse and reports none');

      const retry = await queryContext(deps, { ...request, reuse: first.value.items });
      assert.ok(retry.ok, JSON.stringify(retry));
      assert.equal(state.reads.length, 2, 'no item was read again');
      assert.deepEqual(retry.value.items, first.value.items, 'the pack is the same');
      assert.deepEqual(retry.value.reuse, { reused: 2, refetch: [] });
      assert.equal(retry.value.usedTokens, first.value.usedTokens, 'the reused items still count against the budget');
    } finally {
      s.close();
    }
  });

  it('fetches an item again when the source is at another revision, and an item whose scope or profile differs', async () => {
    const s = startedRun(cleanup);
    try {
      const state = { revision: 'git:0123456789abcdef', reads: [] as string[] };
      const deps: AppDeps = { ...s.deps, context: { ...s.deps.context, gitFiles: countingGitFiles(state) } };
      const request = { projectId: s.contract.workspace.projectId, term: 'X', budget: 4000, runId: s.runId };
      const first = await queryContext(deps, request);
      assert.ok(first.ok);
      state.reads.length = 0;
      state.revision = 'git:fedcba9876543210';
      const moved = await queryContext(deps, { ...request, reuse: first.value.items });
      assert.ok(moved.ok);
      assert.deepEqual(state.reads.sort(), ['src/a.ts:1', 'src/b.ts:1'], 'both were read again at the new revision');
      assert.deepEqual(moved.value.reuse, { reused: 0, refetch: [{ source: 'git-files', id: 'src/a.ts:1', reason: 'revision' }, { source: 'git-files', id: 'src/b.ts:1', reason: 'revision' }] });
      assert.ok(moved.value.items.every((i) => i.excerpt.includes('fedcba9876543210')));

      // One item of another profile and one under another access scope are not reused either; the one that matches is.
      state.reads.length = 0;
      state.revision = 'git:0123456789abcdef';
      const [a, b] = first.value.items.filter((i) => i.source === 'git-files');
      assert.ok(a && b);
      const stale = [{ ...a, profile: 'work' }, { ...b }];
      const mixed = await queryContext(deps, { ...request, reuse: stale });
      assert.ok(mixed.ok);
      assert.deepEqual(state.reads, ['src/a.ts:1']);
      assert.deepEqual(mixed.value.reuse, { reused: 1, refetch: [{ source: 'git-files', id: 'src/a.ts:1', reason: 'profile' }] });
      state.reads.length = 0;
      const scoped = await queryContext(deps, { ...request, reuse: first.value.items, readScope: { read: ['src/**'], readExclude: [], secretGlobs: [] } });
      assert.ok(scoped.ok);
      assert.deepEqual(scoped.value.reuse?.refetch.map((r) => r.reason), ['access-scope', 'access-scope']);
    } finally {
      s.close();
    }
  });

  it('never reuses an item whose reference the run recorded as access_revoked: it is not read and not in the pack, and the other is reused', async () => {
    const s = startedRun(cleanup);
    try {
      const state = { revision: 'git:0123456789abcdef', reads: [] as string[] };
      const deps: AppDeps = { ...s.deps, context: { ...s.deps.context, gitFiles: countingGitFiles(state) } };
      const request = { projectId: s.contract.workspace.projectId, term: 'X', budget: 4000, runId: s.runId };
      const first = await queryContext(deps, request);
      assert.ok(first.ok);
      state.reads.length = 0;
      const recorded = s.deps.ledger.recordTaskRefs(s.runId, [
        { provider: 'git-files', kind: 'snippet', id: 'src/b.ts:1', revision: state.revision, retrievedAt: '2026-11-17T00:00:00.000Z', scope: 'src/b.ts', freshness: 'access_revoked' },
      ]);
      assert.ok(recorded.ok);
      const retry = await queryContext(deps, { ...request, reuse: first.value.items });
      assert.ok(retry.ok);
      assert.deepEqual(state.reads, [], 'the revoked item is not fetched and the other is reused');
      assert.ok(!JSON.stringify(retry.value.items).includes('src/b.ts:1'), 'no text of the revoked item');
      assert.deepEqual(retry.value.omitted.filter((o) => o.reason === 'access_revoked').map((o) => o.id), ['src/b.ts:1']);
      assert.deepEqual(retry.value.reuse, { reused: 1, refetch: [{ source: 'git-files', id: 'src/b.ts:1', reason: 'access_revoked' }] });
    } finally {
      s.close();
    }
  });

  it('a run that crashes and is retried builds its second context:pack from the first pack: every item of the first is reused', async () => {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    await onboardRunRepoWithIndexes(roots, repo, 'answer');
    commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
    const brief = writeBrief(join(roots.base, 'briefs'), ['---', 'title: answer', '---', '## Behavior', 'A slug never contains two dashes in a row.', '', '## Acceptance criteria', '- AC1: Repeated separators collapse to one dash | verifiedBy: check:test', '', '## Write', '- src/**', '- test/**', '', '## Target checks', '- test', ''].join('\n'));
    const ran = await runInProcess(roots, repo, brief, { perAttempt: [{ crash: { afterFiles: ['src/slug.ts', 'src/extra.ts'] } }, FIX] });
    assert.equal(ran.state, 'ready_for_review', `${ran.state} ${String(ran.reason)}`);
    const steps = ledgerRows<{ result_json: string }>(roots, "SELECT result_json FROM run_steps WHERE run_id = ? AND step = 'context:pack' ORDER BY rowid", ran.runId).map((r) => JSON.parse(r.result_json) as { items: unknown[]; reuse?: { reused: number; refetch: unknown[] } });
    assert.equal(steps.length, 2, 'the pack was built for the first attempt and again for the retry');
    const [first, second] = steps;
    assert.ok(first && second);
    assert.ok(first.items.length > 0, 'the first pack has items from the indexes');
    assert.equal(first.reuse, undefined, 'the first attempt reuses nothing');
    assert.deepEqual(second.reuse, { reused: first.items.length, refetch: [] });
    assert.equal(second.items.length, first.items.length);
  });
});
