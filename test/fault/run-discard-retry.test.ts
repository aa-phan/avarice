// CON-16 / S-42 (plan 02-16): a unit that crashes or is killed by the wall clock, with no side effect outside the machine, is discarded to its
// pre-launch snapshot and retried once from the item's last checkpoint. The discard is limited to paths the unit changed after the snapshot,
// so what was in the clone before it (the configure step's `.planning/config.json`, a file the user placed) is untouched. A second failure,
// a unit that did make progress or ask for a decision, a moved HEAD and a spent invocations budget are never retried. The fake run host plays
// the unit through the real hook entry; git, the ledger, the supervisor and the gates are real. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSupervisor } from '../../src/app/run-service.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { RunWorkspace } from '../../src/ports/run-workspace.ts';
import { FakeRunHost } from '../helpers/fake-run-host.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import {
  FIXED_SLUG,
  RUN_CONVENTIONS_WITH_COMMANDS,
  RUN_REPO_FILES,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  profileEnv,
  startWithFakeRunHost,
  writeBrief,
} from '../helpers/run-fixtures.ts';
import { checkoutSnapshot, git } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  pin: string;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  const pin = onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, pin, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const TWO_FILES = ['src/slug.ts', 'src/extra.ts'] as const;

function start(f: Fixture, run: FakeRunOptions, extraArgs: readonly string[] = []): CliResult {
  return startWithFakeRunHost(f.roots, f.repo, f.brief, run as Record<string, unknown>, extraArgs);
}

const runIdOf = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
};
const lastLine = (stdout: string): string => stdout.trim().split('\n').at(-1) as string;

interface AttemptDb {
  attempt_id: string;
  ordinal: number;
  reason: string;
  outcome: string | null;
}
const attemptsOf = (f: Fixture, runId: string): AttemptDb[] => ledgerRows<AttemptDb>(f.roots, 'SELECT attempt_id, ordinal, reason, outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);
const stepsNamed = (f: Fixture, runId: string, name: string): Array<Record<string, unknown>> =>
  ledgerRows<{ result_json: string }>(f.roots, 'SELECT result_json FROM run_steps WHERE run_id = ? AND step = ? ORDER BY rowid', runId, name).map((r) => JSON.parse(r.result_json) as Record<string, unknown>);
const checkpointsOf = (f: Fixture, runId: string): string[] => ledgerRows<{ next_action: string }>(f.roots, 'SELECT next_action FROM checkpoints WHERE run_id = ? ORDER BY seq', runId).map((r) => r.next_action);
const runOf = (f: Fixture, runId: string): { state: string; reason: string | null; workspace_path: string } =>
  ledgerRows<{ state: string; reason: string | null; workspace_path: string }>(f.roots, 'SELECT state, reason, workspace_path FROM runs WHERE run_id = ?', runId)[0] as { state: string; reason: string | null; workspace_path: string };
const budgetOf = (f: Fixture, runId: string, name: string): { used: number; limit_value: number } =>
  ledgerRows<{ used: number; limit_value: number }>(f.roots, 'SELECT used, limit_value FROM budgets WHERE run_id = ? AND name = ?', runId, name)[0] as { used: number; limit_value: number };
const decisionsOf = (f: Fixture, runId: string): Array<{ class: string; issue: string }> => ledgerRows<{ class: string; issue: string }>(f.roots, 'SELECT class, issue FROM decisions WHERE run_id = ? ORDER BY rowid', runId);

describe('a crashed unit is discarded to its snapshot and retried once (CON-16, S-42; tracer)', () => {
  const f = fixture();
  const one = join(f.roots.base, 'attempt-1.json');
  const two = join(f.roots.base, 'attempt-2.json');
  const OBSERVE = ['src/slug.ts', 'src/extra.ts', '.planning/config.json'];
  const result = start(f, {
    perAttempt: [
      { crash: { afterFiles: TWO_FILES }, recordTo: one, observe: OBSERVE },
      { ...FIX, recordTo: two, observe: OBSERVE },
    ],
  });
  const runId = runIdOf(result.stdout);

  it('the retry reaches ready_for_review: attempt 1 is `discarded`, attempt 2 is the retry and is handed off', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(lastLine(result.stdout), `run ${runId}: ready_for_review`);
    assert.deepEqual(attemptsOf(f, runId).map((a) => [a.ordinal, a.reason, a.outcome]), [
      [1, 'initial', 'discarded'],
      [2, 'con16-retry', 'handed-off'],
    ]);
  });

  it('the discard step names what was restored and what was removed, with `sideEffect: none` and the basis for it', () => {
    const attempt1 = attemptsOf(f, runId)[0] as AttemptDb;
    const steps = stepsNamed(f, runId, 'discard');
    assert.equal(steps.length, 1, 'one discard in the whole run');
    const step = steps[0] as Record<string, unknown>;
    assert.equal(step['attemptId'], attempt1.attempt_id);
    assert.deepEqual(step['restored'], ['src/slug.ts']);
    assert.deepEqual(step['removed'], ['src/extra.ts']);
    assert.deepEqual(step['ignoredLeft'], []);
    assert.equal(step['sideEffect'], 'none');
    assert.match(String(step['basis']), /no network, push or change request/);
  });

  it('the retry begins from the snapshot content: the changed file has its bytes again, the added file is gone, what was there before is untouched', () => {
    const first = JSON.parse(readFileSync(one, 'utf8')) as { observed: Record<string, string | null> };
    const second = JSON.parse(readFileSync(two, 'utf8')) as { observed: Record<string, string | null> };
    assert.equal(first.observed['src/slug.ts'], RUN_REPO_FILES['src/slug.ts'], 'attempt 1 began from the pin');
    assert.equal(second.observed['src/slug.ts'], RUN_REPO_FILES['src/slug.ts'], 'attempt 2 began from the same bytes: the crashed unit\'s edit is undone');
    assert.equal(second.observed['src/extra.ts'], null, 'the file the crashed unit created is gone');
    assert.ok((first.observed['.planning/config.json'] ?? '') !== '', 'the configure step\'s settings were in the clone before the unit');
    assert.equal(second.observed['.planning/config.json'], first.observed['.planning/config.json'], 'a file that was in the clone before the snapshot is byte-identical after the discard');
  });

  it('commits only the retry\'s fix, and the crashed unit\'s extra file is in no commit and not in the clone', () => {
    const run = runOf(f, runId);
    assert.deepEqual(git(run.workspace_path, ['diff', '--name-only', f.pin, 'HEAD']).trim().split('\n'), ['src/slug.ts']);
    assert.equal(readFileSync(join(run.workspace_path, 'src', 'slug.ts'), 'utf8'), FIXED_SLUG);
    assert.equal(existsSync(join(run.workspace_path, 'src', 'extra.ts')), false);
    assert.deepEqual(checkoutSnapshot(f.repo.path), f.before, 'the source checkout is unchanged');
  });

  it('orders the checkpoints classify, discard-attempt, launch:run, and records the discard before the retry launches (ordering edge)', () => {
    const marks = checkpointsOf(f, runId);
    const at = marks.indexOf('discard-attempt');
    assert.ok(at > 0, 'a discard-attempt checkpoint');
    assert.deepEqual(marks.slice(at - 1, at + 2), ['classify', 'discard-attempt', 'launch:run']);
    assert.equal(marks.filter((m) => m === 'discard-attempt').length, 1);
    assert.equal(marks.filter((m) => m === 'launch:run').length, 2, 'one launch per attempt');
    const stamps = ledgerRows<{ next_action: string; created_at: string }>(f.roots, 'SELECT next_action, created_at FROM checkpoints WHERE run_id = ? ORDER BY seq', runId);
    const discardMark = stamps.find((s) => s.next_action === 'discard-attempt') as { created_at: string };
    const retryLaunch = stamps.filter((s) => s.next_action === 'launch:run')[1] as { created_at: string };
    const discarded = ledgerRows<{ started_at: string; completed_at: string }>(f.roots, "SELECT started_at, completed_at FROM run_steps WHERE run_id = ? AND step = 'discard'", runId)[0] as { started_at: string; completed_at: string };
    assert.ok(discardMark.created_at <= discarded.completed_at, 'the checkpoint was committed before the discard step completed');
    assert.ok(discarded.completed_at <= retryLaunch.created_at, 'the discard step was recorded completed before the retry\'s launch:run checkpoint');
  });

  it('charges both invocations to the budget and ends attempt 1 with an attempt.ended event', () => {
    assert.equal(budgetOf(f, runId, 'invocations').used, 2);
    const ended = ledgerRows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'attempt.ended' ORDER BY seq", runId).map((r) => (JSON.parse(r.data_json) as { outcome: string }).outcome);
    assert.deepEqual(ended, ['discarded', 'handed-off']);
  });
});

describe('a unit killed by the wall clock is discarded and retried the same way (S-42)', () => {
  const f = fixture();
  const result = start(f, { perAttempt: [{ crash: { afterFiles: TWO_FILES }, timeoutMs: 40 }, FIX] });
  const runId = runIdOf(result.stdout);

  it('attempt 1 classifies inconclusive with timedOut set, is discarded, and the retry reaches ready_for_review', () => {
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const classify = stepsNamed(f, runId, 'classify');
    assert.equal(classify.length, 2);
    assert.deepEqual([classify[0]?.['kind'], classify[0]?.['timedOut'], classify[0]?.['signal']], ['inconclusive', true, 'SIGKILL']);
    assert.deepEqual(attemptsOf(f, runId).map((a) => a.outcome), ['discarded', 'handed-off']);
    assert.deepEqual(stepsNamed(f, runId, 'discard')[0]?.['removed'], ['src/extra.ts']);
  });

  it('charges the killed invocation its reservation (a kill\'s cost is not known) and keeps it charged', () => {
    assert.ok(budgetOf(f, runId, 'costUsd').used > 0, 'cost charged for the killed attempt');
    assert.ok(budgetOf(f, runId, 'wallClockMs').used >= 40);
    assert.equal(budgetOf(f, runId, 'invocations').used, 2);
  });
});

describe('a second failure is a decision, not a second retry (FR-4: no competing retry loop)', () => {
  const f = fixture();
  const result = start(f, { crash: { afterFiles: TWO_FILES, costUsd: 0.01 } });
  const runId = runIdOf(result.stdout);

  it('ends blocked_on_decision (decision) with one repeated_failure decision naming both attempts and their outcome kinds', () => {
    assert.equal(result.code, 3, result.stderr + result.stdout);
    assert.equal(lastLine(result.stdout), `run ${runId}: blocked_on_decision (decision)`);
    const attempts = attemptsOf(f, runId);
    assert.equal(attempts.length, 2, 'the original and one retry, never a third');
    const decisions = decisionsOf(f, runId);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.class, 'repeated_failure');
    for (const attempt of attempts) assert.ok(decisions[0]?.issue.includes(attempt.attempt_id), `the issue names ${attempt.attempt_id}`);
    assert.equal((decisions[0]?.issue.match(/inconclusive/g) ?? []).length, 2, 'both outcome kinds are named');
    assert.deepEqual(attempts.map((a) => a.outcome), ['discarded', 'blocked:decision']);
    assert.equal(stepsNamed(f, runId, 'discard').length, 1, 'the second failure was not discarded');
  });

  it('keeps the budgets already charged: 2 invocations and, for the two crashes that sent no result, the cost reservation of each (R-WR-04)', () => {
    assert.equal(budgetOf(f, runId, 'invocations').used, 2);
    // Each crashed attempt reported 0.01 but ended without a result, so it is charged its reservation: the routine preset's per-invocation cap of 2.
    assert.ok(Math.abs(budgetOf(f, runId, 'costUsd').used - 4) < 1e-9, `costUsd ${budgetOf(f, runId, 'costUsd').used}`);
    assert.deepEqual(checkoutSnapshot(f.repo.path), f.before);
  });
});

describe('what is never retried (CON-16, FR-4)', () => {
  it('a crash after the clone HEAD moved is not discarded: blocked (enforcement_failure), one attempt, no discard step', () => {
    const f = fixture();
    const result = start(f, { perAttempt: [{ crash: { afterFiles: TWO_FILES }, commitAttempt: true }, FIX] });
    const runId = runIdOf(result.stdout);
    assert.equal(lastLine(result.stdout), `run ${runId}: blocked_on_decision (enforcement_failure)`);
    assert.equal(attemptsOf(f, runId).length, 1);
    assert.equal(stepsNamed(f, runId, 'discard').length, 0);
    assert.equal(checkpointsOf(f, runId).includes('discard-attempt'), false);
  });

  it('a unit that made no progress, a paused one and a host error each end in a decision after one attempt', () => {
    for (const [name, run] of [
      ['no progress', { summary: false }],
      ['a pause', { question: 'Which approach?\n1. a\n2. b', summary: false }],
      ['a host error', { refuse: 'internal' }],
    ] as const) {
      const f = fixture();
      const result = start(f, { ...run, perAttempt: [{}, FIX] } as FakeRunOptions);
      const runId = runIdOf(result.stdout);
      assert.equal(runOf(f, runId).state, 'blocked_on_decision', name);
      assert.equal(attemptsOf(f, runId).length, 1, `${name}: one attempt`);
      assert.equal(stepsNamed(f, runId, 'discard').length, 0, `${name}: nothing discarded`);
    }
  });

  it('an invocations budget with no room left for a second invocation blocks (budget_exhausted) without discarding anything', () => {
    const f = fixture();
    const result = start(f, { perAttempt: [{ crash: { afterFiles: TWO_FILES } }, FIX] }, ['--budget', 'invocations=1']);
    const runId = runIdOf(result.stdout);
    assert.equal(lastLine(result.stdout), `run ${runId}: blocked_on_decision (budget_exhausted)`);
    assert.equal(decisionsOf(f, runId)[0]?.class, 'budget');
    assert.match(decisionsOf(f, runId)[0]?.issue ?? '', /invocations/);
    assert.equal(attemptsOf(f, runId).length, 1);
    assert.equal(stepsNamed(f, runId, 'discard').length, 0, 'the crashed unit\'s files are left in the clone for the owner to see');
    assert.equal(budgetOf(f, runId, 'invocations').used, 1);
  });
});

describe('a file the user placed in the clone before the snapshot survives the discard (CON-9, T-02-53)', () => {
  it('notes.txt is byte-identical when the retry starts and when the run ends', async () => {
    const f = fixture();
    const two = join(f.roots.base, 'attempt-2.json');
    // The supervisor runs in this process so the test can act between the clone's preparation and the unit's snapshot: the workspace
    // adapter is wrapped so that the user's file is in the clone when the snapshot is taken.
    const host = new FakeRunHost({ perAttempt: [{ crash: { afterFiles: TWO_FILES } }, { summary: false, recordTo: two, observe: ['notes.txt', 'src/extra.ts'] }] });
    const composed = createDeps(profileEnv(f.roots), { host });
    assert.ok(composed.ok, 'composition');
    const deps = composed.value.deps as { runWorkspace: RunWorkspace | undefined };
    const real = deps.runWorkspace as RunWorkspace;
    const USER_TEXT = 'my own notes, not the run\'s\n';
    deps.runWorkspace = new Proxy(real, {
      get(target, prop) {
        const member = Reflect.get(target, prop) as unknown;
        if (prop === 'snapshot') {
          return (path: string) => {
            if (path.endsWith('/clone') && !existsSync(join(path, 'notes.txt'))) {
              mkdirSync(path, { recursive: true });
              writeFileSync(join(path, 'notes.txt'), USER_TEXT);
            }
            return target.snapshot(path);
          };
        }
        return typeof member === 'function' ? (member as (...args: unknown[]) => unknown).bind(target) : member;
      },
    });
    try {
      const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const outcome = await runSupervisor(composed.value.deps, started.value.runId);
      assert.ok(outcome.ok, JSON.stringify(outcome));
      const runId = started.value.runId;
      assert.deepEqual(attemptsOf(f, runId).map((a) => a.outcome), ['discarded', 'blocked:decision'], 'attempt 1 was discarded, attempt 2 (no progress) ended in a decision');
      const seen = JSON.parse(readFileSync(two, 'utf8')) as { observed: Record<string, string | null> };
      assert.equal(seen.observed['notes.txt'], USER_TEXT, 'the user\'s file was there, unchanged, when the retry began');
      assert.equal(seen.observed['src/extra.ts'], null, 'while the file the unit created was removed');
      const step = stepsNamed(f, runId, 'discard')[0] as Record<string, unknown>;
      assert.deepEqual(step['removed'], ['src/extra.ts'], 'notes.txt is not in the discard\'s lists');
      assert.deepEqual(step['restored'], ['src/slug.ts']);
      assert.equal(readFileSync(join(runOf(f, runId).workspace_path, 'notes.txt'), 'utf8'), USER_TEXT, 'and it is there at the end');
    } finally {
      composed.value.close();
    }
  });
});
