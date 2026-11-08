// Budgets across a kill and a resume (plan 02-17; CON-13, FR-7): the budget rows live in the ledger, so they survive the kill of the supervisor. Nothing is
// refunded: an invocation that was killed was charged (its count, and at least its cost reservation), the limits are the contract's and do not move, and a
// resume that finds no room left for the one retry stops with a decision instead of spending past the limit. The fake run host plays the unit; every kill is a
// real SIGKILL of the detached supervisor. No test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, resumeRunCli, rows, runRunWithFault, runSurvivorPidFile, sleepSync } from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
const survivors: number[] = [];

after(() => {
  for (const pid of survivors) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
const NAMES = ['invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs', 'costUsd'] as const;

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

interface Budget {
  used: number;
  reserved: number;
  limit: number;
}
function budgetsOf(f: Fixture, runId: string): Record<string, Budget> {
  const out: Record<string, Budget> = {};
  for (const r of rows<{ name: string; used: number; reserved: number; limit_value: number }>(f.roots, 'SELECT name, used, reserved, limit_value FROM budgets WHERE run_id = ?', runId)) {
    out[r.name] = { used: r.used, reserved: r.reserved, limit: r.limit_value };
  }
  return out;
}
const need = (b: Record<string, Budget>, name: string): Budget => b[name] as Budget;

const contractOf = (f: Fixture, runId: string): { budgets: { invocations: number; costUsd: { perRun: number; perInvocation: number } } } =>
  JSON.parse(readFileSync(join(f.roots.AVARICE_DATA_ROOT, 'runs', runId, 'contract-v1.json'), 'utf8')) as ReturnType<typeof contractOf>;

describe('a kill inside the unit: the killed invocation is charged, nothing is refunded, the limits do not move (CON-13)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'mid-invocation:run', FIX);
  survivors.push(Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim()));
  const atKill = budgetsOf(f, runId);

  it('at the kill the invocation is reserved and not yet spent, and the hook\'s tool calls before it are already counted', () => {
    assert.equal(need(atKill, 'invocations').reserved, 1);
    assert.equal(need(atKill, 'invocations').used, 0);
    assert.ok(need(atKill, 'toolCalls').used > 0, 'the unit made tool calls through the hook before it died');
  });

  it('after the resume: 2 invocations used, no reservation left, cost at least the killed invocation\'s reservation, every limit as the contract set it', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    const after = budgetsOf(f, runId);
    const contract = contractOf(f, runId);
    assert.equal(need(after, 'invocations').used, 2);
    assert.equal(need(after, 'invocations').reserved, 0);
    assert.ok(need(after, 'costUsd').used >= Math.min(contract.budgets.costUsd.perInvocation, contract.budgets.costUsd.perRun), 'the killed invocation\'s cost reservation stays charged');
    assert.equal(need(after, 'invocations').limit, contract.budgets.invocations);
    assert.equal(need(after, 'costUsd').limit, contract.budgets.costUsd.perRun);
    for (const name of NAMES) {
      assert.equal(need(after, name).limit, need(atKill, name).limit, `${name}: the limit did not move`);
      assert.ok(need(after, name).used >= need(atKill, name).used, `${name}: nothing was refunded`);
    }
    assert.ok(need(after, 'toolCalls').used > need(atKill, 'toolCalls').used, 'the retry\'s tool calls are added to the killed unit\'s');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'invocation.orphan-charged'", runId)[0]?.n, 1, 'the orphan is charged once');
  });
});

describe('a kill during verification: re-verifying spends no invocation and refunds nothing', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX);
  const atKill = budgetsOf(f, runId);

  it('every budget is exactly as it was before the kill, and the limits are unchanged', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.deepEqual(budgetsOf(f, runId), atKill);
    assert.equal(need(atKill, 'invocations').used, 1);
  });
});

describe('a resume with no invocation left for the retry stops with a decision and keeps the killed invocation charged (CON-13, S-15)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'mid-invocation:run', FIX, {}, ['--budget', 'invocations=1']);
  survivors.push(Number(readFileSync(runSurvivorPidFile(f.roots), 'utf8').trim()));

  it('ends blocked_on_decision (budget_exhausted), the invocation spent (not reserved), the limit still 1, and the unit\'s files left for the owner', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 3, resumed.stdout + resumed.stderr);
    assert.equal(resumed.stdout.trim().split('\n').at(-1), `run ${runId}: blocked_on_decision (budget_exhausted)`);
    const b = budgetsOf(f, runId);
    assert.equal(need(b, 'invocations').used, 1);
    assert.equal(need(b, 'invocations').reserved, 0);
    assert.equal(need(b, 'invocations').limit, 1);
    const decisions = rows<{ class: string; issue: string }>(f.roots, 'SELECT class, issue FROM decisions WHERE run_id = ?', runId);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]?.class, 'permission');
    assert.match(decisions[0]?.issue ?? '', /invocations/);
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM run_steps WHERE run_id = ? AND step = 'discard'", runId)[0]?.n, 0, 'nothing was discarded');
    assert.equal(rows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ?', runId)[0]?.n, 1, 'no second attempt');
  });
});
