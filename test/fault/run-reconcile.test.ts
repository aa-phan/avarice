// A resume that is itself killed while it reconciles (plan 03-26; FR-7, NFR-6, AC-3; RECONCILE_KILL_POINTS). The `paused` stage writes one checkpoint, `reconcile`: the
// supervisor that `resume` starts puts the interrupted run `paused` around the reconcile of the item (or the verification) that was in flight, and commits it before it
// acts. The kill suite of RUN_KILL_POINTS starts a run once, so it never reaches this point; this suite kills a run, resumes it with the point armed (the resume's
// supervisor dies the instant `reconcile` is committed, no cleanup), and resumes it again, and what the run ends as is compared with an uninterrupted run of the same brief
// in a second profile. Two interruptions lead here: a unit that was in flight (`mid-invocation:run`, whose host process the second resume must still reap) and a
// verification that was in flight (`mid-verify`).
//
// The fake run host is the only host; no model is called.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { RECONCILE_KILL_POINTS, RUN_EXPIRY_WAIT_MS, normalizeRunResult, openRaw, resumeRunCli, rows, runIdFromOutput, runRunWithFault, runSurvivorPidFile, sleepSync } from '../helpers/fault-run.ts';
import type { RunResult } from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import { checkoutSnapshot } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
const survivors: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

after(() => {
  for (const pid of survivors) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const LINT_CHECK = { name: 'lint', argv: ['node', 'scripts/lint-ok.mjs'], timeoutSec: 60, required: true } as const;
const TWO_CHECKS = { ...RUN_CONVENTIONS, checks: [...RUN_CONVENTIONS.checks, LINT_CHECK], agentCommands: ['npm test'] };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  before: ReturnType<typeof checkoutSnapshot>;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo({ 'scripts/lint-ok.mjs': 'process.exit(0);\n' });
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, TWO_CHECKS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), before: checkoutSnapshot(repo.path) };
}

let reference: RunResult;

before(() => {
  const f = fixture();
  const ran = startWithFakeRunHost(f.roots, f.repo, f.brief, FIX as Record<string, unknown>);
  assert.equal(ran.code, 0, ran.stdout + ran.stderr);
  reference = normalizeRunResult(f.roots, runIdFromOutput(ran.stdout));
});

// The interruptions that make the resume reconcile, and what the ledger says about the run after the first kill.
const INTERRUPTIONS = [
  { name: 'a unit in flight', point: 'mid-invocation:run', state: 'running', attempts: 2, invocations: 2 },
  { name: 'a verification in flight', point: 'mid-verify', state: 'verifying', attempts: 1, invocations: 1 },
] as const;

describe('a resume killed at the reconcile checkpoint is resumed again to the result of an uninterrupted run', () => {
  it('lists the reconcile checkpoint as the point of this suite', () => {
    assert.deepEqual([...RECONCILE_KILL_POINTS], ['after-checkpoint:reconcile']);
  });

  for (const interruption of INTERRUPTIONS) {
    for (const point of RECONCILE_KILL_POINTS) {
      it(`${point} after ${interruption.name}`, () => {
        const f = fixture();
        const killed = runRunWithFault(f.roots, f.repo, f.brief, interruption.point, FIX);
        const { runId } = killed;
        let survivor: number | undefined;
        if (interruption.point === 'mid-invocation:run') {
          survivor = Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim());
          survivors.push(survivor);
          assert.ok(isAlive(survivor), 'the host of the interrupted unit outlived its supervisor');
        }

        // The first resume dies as soon as it has paused the run and committed `reconcile`.
        sleepSync(RUN_EXPIRY_WAIT_MS);
        const dying = resumeRunCli(f.roots, runId, FIX, { AVARICE_FAULT: point });
        assert.equal(dying.code, 3, `the resume was killed at ${point}: ${dying.stdout}${dying.stderr}`);
        const [paused] = rows<{ state: string; reason: string | null }>(f.roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId);
        assert.equal(paused?.state, 'paused', 'the run is paused around its reconcile');
        const last = rows<{ next_action: string }>(f.roots, "SELECT next_action FROM checkpoints WHERE run_id = ? AND next_action != 'none' ORDER BY seq DESC", runId)[0];
        assert.equal(last?.next_action, 'reconcile', 'the ledger names the reconcile the kill interrupted');
        const db = openRaw(f.roots);
        try {
          assert.deepEqual({ ...(db.prepare('PRAGMA integrity_check').get() as object) }, { integrity_check: 'ok' });
          assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);
        } finally {
          db.close();
        }

        // The second resume takes the paused run back to where the first interruption left it and finishes.
        sleepSync(RUN_EXPIRY_WAIT_MS);
        const resumed = resumeRunCli(f.roots, runId, FIX);
        assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
        assert.equal(resumed.stdout.trim().split('\n').at(-1), `run ${runId}: ready_for_review`);
        assert.deepEqual(normalizeRunResult(f.roots, runId), reference, 'the twice-resumed run has the committed tree, evidence statuses and gate verdicts of an uninterrupted run');
        assert.deepEqual(checkoutSnapshot(f.repo.path), f.before, 'the user checkout is byte-identical');

        assert.deepEqual(rows(f.roots, "SELECT step FROM run_steps WHERE run_id = ? AND status = 'started'", runId), [], 'no step is left in flight');
        const ready = rows<{ data_json: string }>(f.roots, "SELECT data_json FROM events WHERE run_id = ? AND type = 'run.transition'", runId).filter((e) => (JSON.parse(e.data_json) as { to: string }).to === 'ready_for_review');
        assert.equal(ready.length, 1, 'ready_for_review once');
        const attempts = rows<{ outcome: string | null }>(f.roots, 'SELECT outcome FROM attempts WHERE run_id = ? ORDER BY ordinal', runId);
        assert.equal(attempts.length, interruption.attempts, 'the interrupted unit was retried once, and a verification is not a new attempt');
        assert.equal(attempts.at(-1)?.outcome, 'handed-off');
        assert.deepEqual(
          rows<{ used: number; reserved: number }>(f.roots, "SELECT used, reserved FROM budgets WHERE run_id = ? AND name = 'invocations'", runId)[0],
          { used: interruption.invocations, reserved: 0 },
          'the budgets count what was spent and nothing is reserved',
        );
        if (survivor !== undefined) {
          assert.equal(isAlive(survivor), false, 'the resume ended the host that carried the interrupted session ID');
          assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'invocation.reaped'", runId)[0]?.n, 1, 'exactly one invocation.reaped event');
        }
      });
    }
  }
});
