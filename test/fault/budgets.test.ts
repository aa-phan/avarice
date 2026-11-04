// Budgets (ONB-8, CON-13, RC-5; S-35 adapted): the rows are created from the contract at contract_proposed,
// charged by the real hook entry per tool call and subagent and around each invocation, and survive kills and
// resumes: nothing refunds, resets or raises a budget. The fake host drives its simulated calls through the real
// hook against the profile's ledger; no model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import { reserveInvocation, settleInvocation } from '../../src/app/budget.ts';
import { completeInvocation, prepareInvocation } from '../../src/app/invocation.ts';
import type { PreparedInvocation } from '../../src/app/invocation.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { InvocationDetails, InvocationOutcome } from '../../src/ports/agent-host.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import type { BudgetRow } from '../../src/ports/ledger.ts';
import { chainIsIntact } from '../helpers/hook-fixture.ts';
import { EXPIRY_WAIT_MS, REPO_FILES, SHORT_TTL_MS, TEST_CLI, freshProfile, onboardingIdOf, resumeCli, rows, runWithFault, sleepSync } from '../helpers/fault-run.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { runCli } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = freshProfile();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions, ...flags: string[]): CliResult {
  return runCli(['onboard', '--policy', 'onboarding', ...flags, repo.path], {
    roots,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify(host), AVARICE_LEASE_TTL_MS: String(SHORT_TTL_MS) },
    timeoutMs: 180_000,
  });
}

interface BudgetDbRow {
  name: string;
  limit_value: number;
  used: number;
  reserved: number;
  exactness: string;
  contract_version: number;
}

function budgetsOf(roots: CliRoots): Record<string, BudgetDbRow> {
  const all = rows<BudgetDbRow>(roots, 'SELECT name, limit_value, used, reserved, exactness, contract_version FROM budgets ORDER BY name');
  return Object.fromEntries(all.map((r) => [r.name, r]));
}

const row = (roots: CliRoots, name: string): BudgetDbRow => {
  const found = budgetsOf(roots)[name];
  assert.ok(found, `a ${name} budget row`);
  return found;
};

function stateOf(roots: CliRoots): { state: string } {
  return rows<{ state: string }>(roots, 'SELECT state FROM onboardings')[0] as { state: string };
}

// The in-process budget tests are about reservations, not graphs: with no graphify the knowledge step starts no invocation
// and leaves invocations for the test to reserve itself.
function envFor(roots: CliRoots): NodeJS.ProcessEnv {
  return { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT, AVARICE_GRAPHIFY_BIN: '/nonexistent/avarice-test-graphify' };
}

// Whether the CLI runs below find a graphify (the onboard helper passes the ambient PATH).
function graphifyInstalled(): boolean {
  return (process.env['PATH'] ?? '').split(delimiter).some((dir) => dir !== '' && isAbsolute(dir) && existsSync(join(dir, 'graphify')));
}

// Runs one onboarding to a stop state in this process and hands the deps to the callback.
async function inProcess<T>(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions, fn: (deps: AppDeps, onboardingId: string) => T): Promise<T> {
  const composed = createDeps(envFor(roots), { host: new FakeAgentHost(host) });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding', mode: 'full' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok);
    return fn(composed.value.deps, started.value.onboardingId);
  } finally {
    composed.value.close();
  }
}

describe('budget rows come from the contract', () => {
  it('are created at contract_proposed with the contract limits, the contract version and the right exactness', () => {
    const { roots, repo } = fixture();
    runWithFault(roots, repo, 'after-transition:contract_proposed');
    const budgets = budgetsOf(roots);
    assert.deepEqual(Object.keys(budgets).sort(), ['costUsd', 'invocations', 'subagentsTotal', 'toolCalls', 'wallClockMs']);
    assert.equal(budgets['invocations']?.limit_value, 6, 'a full map with its retry and interruption relaunches (4), intel (1) and knowledge (1)');
    assert.equal(budgets['toolCalls']?.limit_value, 600);
    assert.equal(budgets['subagentsTotal']?.limit_value, 8, 'a full map (4) and its retry (4); the knowledge pass runs no subagent');
    assert.equal(budgets['wallClockMs']?.limit_value, 45 * 60_000);
    assert.equal(budgets['costUsd']?.limit_value, 12);
    assert.equal(budgets['costUsd']?.exactness, 'estimated');
    assert.equal(budgets['toolCalls']?.exactness, 'exact');
    for (const r of Object.values(budgets)) {
      assert.equal(r.contract_version, 1);
      assert.equal(r.used, 0);
      assert.equal(r.reserved, 0);
    }
    assert.equal(stateOf(roots).state, 'contract_proposed');
  });

  it('derive the subagent limit from the mapping mode: a fast map has 2 (the knowledge pass runs no subagent)', () => {
    const { roots, repo } = fixture();
    const fast = onboard(roots, repo, { files: ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'], stamp: false }, '--mode', 'fast');
    assert.equal(fast.code, 0, fast.stdout + fast.stderr);
    assert.equal(row(roots, 'subagentsTotal').limit_value, 2);
  });

  it('take a lower limit from --budget and refuse a higher one (RC-5)', () => {
    const { roots, repo } = fixture();
    const lowered = onboard(roots, repo, {}, '--budget', 'toolCalls=10', '--budget', 'subagentsTotal=2');
    assert.equal(lowered.code, 0, lowered.stdout + lowered.stderr);
    assert.equal(row(roots, 'toolCalls').limit_value, 10);
    assert.equal(row(roots, 'subagentsTotal').limit_value, 2);

    const aboveDerived = fixture();
    const tooMany = onboard(aboveDerived.roots, aboveDerived.repo, {}, '--budget', 'subagentsTotal=9');
    assert.notEqual(tooMany.code, 0);
    assert.match(tooMany.stdout + tooMany.stderr, /budgets can only be lowered: 9 is above the 8 derived for mapping mode full/);
    assert.equal(rows<{ n: number }>(aboveDerived.roots, 'SELECT count(*) AS n FROM budgets')[0]?.n, 0);

    const second = fixture();
    const raised = onboard(second.roots, second.repo, {}, '--budget', 'toolCalls=999999');
    assert.notEqual(raised.code, 0);
    assert.match(raised.stdout + raised.stderr, /budgets can only be lowered/);
    assert.equal(rows<{ n: number }>(second.roots, 'SELECT count(*) AS n FROM budgets')[0]?.n, 0);
  });

  it('rejects a malformed --budget before anything is registered', () => {
    const { roots, repo } = fixture();
    for (const flag of ['toolCalls', 'toolCalls=', 'toolCalls=lots', '=5']) {
      const result = onboard(roots, repo, {}, '--budget', flag);
      assert.equal(result.code, 64, flag);
      assert.match(result.stderr, /--budget/);
    }
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM projects')[0]?.n, 0);
  });

  it('are charged for the invocation that ran: one invocation, its duration and its estimated cost', () => {
    const { roots, repo } = fixture();
    const result = onboard(roots, repo, { costUsd: 0.25 });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const invocations = row(roots, 'invocations');
    // The map, and the intel invocation the index step asks for (plan 01-17), which the fake map host cannot serve:
    // it was reserved and started, so its unit is spent, at no cost. With graphify installed the knowledge step (plan
    // 01-18) is a third such invocation; without it the step starts none.
    assert.equal(invocations.used, graphifyInstalled() ? 3 : 2);
    assert.equal(invocations.reserved, 0);
    assert.equal(row(roots, 'costUsd').used, 0.25);
    assert.ok(row(roots, 'wallClockMs').used >= 0);
    assert.equal(row(roots, 'toolCalls').used, 0);
  });
});

describe('reservation and settlement', () => {
  it('blocks the onboarding with budget_exhausted before launching when no invocation is left', () => {
    const { roots, repo } = fixture();
    const result = onboard(roots, repo, {}, '--budget', 'invocations=0');
    assert.equal(result.code, 3, result.stdout + result.stderr);
    assert.match(result.stdout, /blocked \(budget_exhausted\)/);
    assert.equal(rows<{ n: number }>(roots, "SELECT count(*) AS n FROM onboarding_steps WHERE step = 'launch:map'")[0]?.n, 0);
    assert.equal(row(roots, 'invocations').used, 0);
    assert.equal(row(roots, 'invocations').reserved, 0);
  });

  it('gives the invocation the smaller of its purpose share and what is left of the wall clock and the cost', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const current = deps.ledger.getOnboarding(onboardingId);
      assert.ok(current.ok);
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(contract.ok && contract.value !== null);
      const runId = contract.value.runId;

      const first = reserveInvocation(deps, current.value, 'map');
      assert.ok(first.ok && first.value.granted);
      assert.equal(first.value.reservation.wallClockMs, 20 * 60_000);
      assert.equal(first.value.reservation.costCapUsd, 3);
      assert.ok(settleInvocation(deps, first.value.reservation, { durationMs: 0, costUsd: 0 }).ok);

      assert.ok(deps.ledger.chargeBudget(runId, 'wallClockMs', 44 * 60_000, { fromReserved: false }).ok);
      assert.ok(deps.ledger.chargeBudget(runId, 'costUsd', 11.5, { fromReserved: false }).ok);
      const second = reserveInvocation(deps, current.value, 'map');
      assert.ok(second.ok && second.value.granted);
      assert.ok(second.value.reservation.wallClockMs < 60_000, String(second.value.reservation.wallClockMs));
      assert.ok(second.value.reservation.wallClockMs > 0);
      assert.equal(second.value.reservation.costCapUsd, 0.5);
    });
  });

  it('refuses to reserve when the wall clock or the cost is spent, and names the budget', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const current = deps.ledger.getOnboarding(onboardingId);
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(current.ok && contract.ok && contract.value !== null);
      const runId = contract.value.runId;
      assert.ok(deps.ledger.chargeBudget(runId, 'costUsd', 12, { fromReserved: false }).ok);
      const noCost = reserveInvocation(deps, current.value, 'map');
      assert.ok(noCost.ok);
      assert.deepEqual(noCost.value, { granted: false, budget: 'costUsd' });
      assert.ok(deps.ledger.chargeBudget(runId, 'wallClockMs', 45 * 60_000, { fromReserved: false }).ok);
      const noClock = reserveInvocation(deps, current.value, 'map');
      assert.ok(noClock.ok);
      assert.deepEqual(noClock.value, { granted: false, budget: 'wallClockMs' });
    });
  });

  it('refuses to reserve when exactly nothing is left of the cost or the wall clock (the boundary, not only overspending)', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const current = deps.ledger.getOnboarding(onboardingId);
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(current.ok && contract.ok && contract.value !== null);
      const runId = contract.value.runId;
      const left = (name: string): number => {
        const budgets = deps.ledger.getBudgets(runId);
        assert.ok(budgets.ok);
        const found = budgets.value.find((b: BudgetRow) => b.name === name) as BudgetRow;
        return found.limit - found.used - found.reserved;
      };
      assert.ok(deps.ledger.chargeBudget(runId, 'costUsd', left('costUsd'), { fromReserved: false }).ok);
      assert.equal(left('costUsd'), 0);
      const noCost = reserveInvocation(deps, current.value, 'map');
      assert.ok(noCost.ok);
      assert.deepEqual(noCost.value, { granted: false, budget: 'costUsd' });
      assert.ok(deps.ledger.chargeBudget(runId, 'wallClockMs', left('wallClockMs'), { fromReserved: false }).ok);
      assert.equal(left('wallClockMs'), 0);
      const noClock = reserveInvocation(deps, current.value, 'map');
      assert.ok(noClock.ok);
      assert.deepEqual(noClock.value, { granted: false, budget: 'wallClockMs' });
    });
  });

  it('settles the measured duration and the host cost, and releases the reservation', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const current = deps.ledger.getOnboarding(onboardingId);
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(current.ok && contract.ok && contract.value !== null);
      const runId = contract.value.runId;
      const before = deps.ledger.getBudgets(runId);
      assert.ok(before.ok);
      const usedBefore = (name: string): number => (before.value.find((b: BudgetRow) => b.name === name) as BudgetRow).used;

      const reserved = reserveInvocation(deps, current.value, 'map');
      assert.ok(reserved.ok && reserved.value.granted);
      const mid = deps.ledger.getBudgets(runId);
      assert.ok(mid.ok);
      assert.equal((mid.value.find((b: BudgetRow) => b.name === 'invocations') as BudgetRow).reserved, 1);
      assert.ok(settleInvocation(deps, reserved.value.reservation, { durationMs: 1234, costUsd: 0.4 }).ok);
      const after = deps.ledger.getBudgets(runId);
      assert.ok(after.ok);
      const get = (name: string): BudgetRow => after.value.find((b: BudgetRow) => b.name === name) as BudgetRow;
      assert.equal(get('invocations').reserved, 0);
      assert.equal(get('invocations').used, usedBefore('invocations') + 1);
      assert.equal(get('wallClockMs').used, usedBefore('wallClockMs') + 1234);
      assert.ok(Math.abs(get('costUsd').used - (usedBefore('costUsd') + 0.4)) < 1e-9);
    });
  });

  it('never refunds, resets or raises: createBudgets keeps existing rows and a reservation stops at the limit', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(contract.ok && contract.value !== null);
      const runId = contract.value.runId;
      assert.ok(deps.ledger.chargeBudget(runId, 'toolCalls', 5, { fromReserved: false }).ok);
      const again = deps.ledger.createBudgets(runId, 1, [{ name: 'toolCalls', limit: 99_999, exactness: 'exact' }]);
      assert.ok(again.ok);
      const toolCalls = again.value.find((b: BudgetRow) => b.name === 'toolCalls') as BudgetRow;
      assert.equal(toolCalls.limit, 600);
      assert.equal(toolCalls.used, 5);

      // The subagent limit of a full map: 4 x 2 (deferred item 11; the knowledge pass runs no subagent).
      const fits = deps.ledger.reserveBudget(runId, 'subagentsTotal', 8);
      assert.ok(fits.ok && fits.value.granted);
      const over = deps.ledger.reserveBudget(runId, 'subagentsTotal', 1);
      assert.ok(over.ok);
      assert.equal(over.value.granted, false);
      assert.equal(over.value.budget.reserved, 8);
      assert.equal(deps.ledger.reserveBudget(runId, 'nope', 1).ok, false);
    });
  });
});

describe('S-35 adapted: mapping budgets persist across kills and resumes', () => {
  it('killed at 200 tool calls and resumed twice, the 301st call and the fifth subagent are denied and the onboarding ends blocked (budget_exhausted)', { timeout: 600_000 }, () => {
    const { roots, repo } = fixture();
    const budgetFlags = ['--budget', 'toolCalls=300', '--budget', 'subagentsTotal=4'];

    // Run 1: three subagents and 200 calls, then SIGKILL.
    const first = onboard(roots, repo, { hookPolicy: true, subagents: 3, toolCalls: 400, killAfterToolCalls: 200 }, ...budgetFlags);
    assert.equal(first.signal, 'SIGKILL', first.stdout + first.stderr);
    assert.equal(row(roots, 'toolCalls').used, 200);
    assert.equal(row(roots, 'subagentsTotal').used, 3);
    assert.equal(row(roots, 'toolCalls').limit_value, 300);
    assert.equal(stateOf(roots).state, 'mapping');
    const onboardingId = onboardingIdOf(roots);

    // Resume 1: the charged count carries over; 50 more calls, then killed again.
    sleepSync(EXPIRY_WAIT_MS);
    const second = resumeCli(roots, onboardingId, { hookPolicy: true, toolCalls: 100, killAfterToolCalls: 50 });
    assert.equal(second.signal, 'SIGKILL', second.stdout + second.stderr);
    assert.equal(row(roots, 'toolCalls').used, 250);
    assert.equal(row(roots, 'toolCalls').limit_value, 300);
    // The first run's reservation was spent by the kill, not refunded.
    assert.equal(row(roots, 'invocations').used, 1);

    // Resume 2: calls 251 to 300 are allowed, the 301st on is denied; subagent 4 is allowed, subagent 5 is denied.
    sleepSync(EXPIRY_WAIT_MS);
    const third = resumeCli(roots, onboardingId, { hookPolicy: true, subagents: 2, toolCalls: 60 });
    assert.equal(third.code, 3, third.stdout + third.stderr);
    assert.match(third.stdout, /blocked \(budget_exhausted\)/);

    assert.equal(row(roots, 'toolCalls').used, 300);
    assert.equal(row(roots, 'toolCalls').limit_value, 300);
    assert.equal(row(roots, 'subagentsTotal').used, 4);
    assert.equal(row(roots, 'subagentsTotal').limit_value, 4);
    assert.equal(row(roots, 'invocations').used, 3);
    assert.equal(row(roots, 'invocations').reserved, 0);
    assert.equal(stateOf(roots).state, 'blocked');

    const denials = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'hook.decision' ORDER BY seq")
      .map((r) => JSON.parse(r.data_json) as { tool: string; decision: string; rule: string; budget?: string })
      .filter((d) => d.decision === 'deny');
    assert.equal(denials.filter((d) => d.tool === 'Agent' && d.rule === 'budget_exhausted').length, 1);
    assert.equal(denials.filter((d) => d.tool === 'Read' && d.rule === 'budget_exhausted').length, 10);
    assert.ok(chainIsIntact(join(roots.AVARICE_DATA_ROOT, 'state.db')));

    // A finished onboarding is not resumed into more budget.
    const again = resumeCli(roots, onboardingId, { hookPolicy: true, toolCalls: 5 });
    assert.equal(again.code, 3);
    assert.equal(row(roots, 'toolCalls').used, 300);
  });

  it('denies the fifth subagent of a limit of four and ends blocked (budget_exhausted)', { timeout: 120_000 }, () => {
    const { roots, repo } = fixture();
    const result = onboard(roots, repo, { hookPolicy: true, subagents: 5 }, '--budget', 'subagentsTotal=4');
    assert.equal(result.code, 3, result.stdout + result.stderr);
    assert.match(result.stdout, /blocked \(budget_exhausted\)/);
    assert.equal(row(roots, 'subagentsTotal').used, 4);
    assert.equal(row(roots, 'toolCalls').used, 0);
  });
});


// Item C (owner decision 2026-11-03): a killed or interrupted invocation is charged its full cost reservation instead of 0. The
// charge is conservative, the safe direction for a cap; a cost the host did report is recorded beside it and the larger counts.
describe('a killed or interrupted invocation is charged its cost reservation', () => {
  const costUsed = (deps: AppDeps, runId: string): number => {
    const found = deps.ledger.getBudgets(runId);
    assert.ok(found.ok);
    return (found.value.find((b: BudgetRow) => b.name === 'costUsd') as BudgetRow).used;
  };
  const outcomeOf = (over: Omit<Partial<InvocationOutcome>, 'details'> & { details?: Partial<InvocationDetails> }): InvocationOutcome => ({
    sessionId: 'sess',
    kind: 'inconclusive',
    permissionDenials: [],
    costUsd: 0,
    durationMs: 10,
    headBefore: 'a'.repeat(40),
    headAfter: 'a'.repeat(40),
    ...over,
    details: { exitCode: null, signal: null, timedOut: false, headMoved: false, transcriptBytes: 0, hookDenies: 0, hookBudgetDenies: 0, numTurns: 0, ...over.details },
  });

  // Prepares one more map invocation on a finished onboarding and returns it with the run's id.
  function prepare(deps: AppDeps, onboardingId: string): { prepared: PreparedInvocation; runId: string } {
    const row = deps.ledger.getOnboarding(onboardingId);
    assert.ok(row.ok);
    const prepared = prepareInvocation(deps, row.value, 'map', 'map the repository', { expectedFiles: [] });
    assert.ok(prepared.ok && prepared.value.granted, 'a granted invocation');
    return { prepared: prepared.value.prepared, runId: prepared.value.prepared.request.runId };
  }

  it('charges the reservation (the per-invocation cap) when the host ended by a signal or the wall clock and reported no cost', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      for (const details of [{ timedOut: true }, { signal: 'SIGKILL' }]) {
        const { prepared, runId } = prepare(deps, onboardingId);
        const before = costUsed(deps, runId);
        const done = completeInvocation(deps, prepared, ok(outcomeOf({ costUsd: 0, details })));
        assert.ok(done.ok);
        assert.ok(Math.abs(costUsed(deps, runId) - (before + 3)) < 1e-9, `charged ${costUsed(deps, runId) - before} for ${JSON.stringify(details)}`);
      }
    });
    const finished = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'invocation.finished' ORDER BY seq DESC LIMIT 2").map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
    for (const data of finished) {
      assert.equal(data['costUsd'], 0, 'the reported cost stays visible');
      assert.equal(data['costChargedUsd'], 3);
      assert.equal(data['costBasis'], 'reservation');
    }
  });

  it('charges the larger of the reported cost and the reservation, and records both', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const { prepared, runId } = prepare(deps, onboardingId);
      const before = costUsed(deps, runId);
      const done = completeInvocation(deps, prepared, ok(outcomeOf({ costUsd: 3.4, details: { timedOut: true } })));
      assert.ok(done.ok);
      assert.ok(Math.abs(costUsed(deps, runId) - (before + 3.4)) < 1e-9, 'the cap logic never charges below what it reserved, and never below what was reported');
      const second = prepare(deps, onboardingId);
      const mid = costUsed(deps, runId);
      assert.ok(completeInvocation(deps, second.prepared, ok(outcomeOf({ costUsd: 0.2, details: { signal: 'SIGTERM' } }))).ok);
      assert.ok(Math.abs(costUsed(deps, runId) - (mid + 3)) < 1e-9, 'a small reported cost does not lower the charge below the reservation');
    });
    const finished = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'invocation.finished' ORDER BY seq DESC LIMIT 2").map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
    assert.deepEqual(finished.map((d) => [d['costUsd'], d['costChargedUsd'], d['costBasis']]), [[0.2, 3, 'reservation'], [3.4, 3.4, 'reported']]);
  });

  it('still charges exactly the reported cost for a run that finished on its own', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const { prepared, runId } = prepare(deps, onboardingId);
      const before = costUsed(deps, runId);
      assert.ok(completeInvocation(deps, prepared, ok(outcomeOf({ kind: 'progressed', costUsd: 0.12 }))).ok);
      assert.ok(Math.abs(costUsed(deps, runId) - (before + 0.12)) < 1e-9);
    });
  });

  it('charges the reservation when the host error says the process may have run (a timeout or an unknown cancel), and nothing when it never started', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const cases: Array<[Parameters<typeof err>[0], number]> = [
        [{ kind: 'timeout', afterMs: 5, sideEffect: 'unknown' }, 3],
        [{ kind: 'cancelled', sideEffect: 'unknown' }, 3],
        [{ kind: 'cancelled', sideEffect: 'none' }, 0],
        [{ kind: 'unavailable', cause: 'cannot start the host: ENOENT' }, 0],
      ];
      for (const [error, charged] of cases) {
        const { prepared, runId } = prepare(deps, onboardingId);
        const before = costUsed(deps, runId);
        const done = completeInvocation(deps, prepared, err(error));
        assert.equal(done.ok, false);
        assert.ok(Math.abs(costUsed(deps, runId) - (before + charged)) < 1e-9, `${JSON.stringify(error)} charged ${costUsed(deps, runId) - before}`);
      }
    });
  });

  it('charges a reservation the supervisor died holding (a kill -9) at the next reservation, and says so', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const row = deps.ledger.getOnboarding(onboardingId);
      assert.ok(row.ok);
      const first = reserveInvocation(deps, row.value, 'map');
      assert.ok(first.ok && first.value.granted);
      const runId = first.value.reservation.runId;
      const before = costUsed(deps, runId);
      // The first holder never settles. The next reservation spends its invocation and its cost reservation.
      const second = reserveInvocation(deps, row.value, 'map');
      assert.ok(second.ok && second.value.granted);
      assert.ok(Math.abs(costUsed(deps, runId) - (before + 3)) < 1e-9, `charged ${costUsed(deps, runId) - before}`);
      assert.ok(Math.abs(second.value.reservation.costCapUsd - 3) < 1e-9);
    });
    const orphan = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'invocation.orphan-charged'").map((r) => JSON.parse(r.data_json) as Record<string, unknown>);
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0]?.['invocations'], 1);
    assert.equal(orphan[0]?.['costChargedUsd'], 3);
  });

  it('charges the cost that was left when less than the per-invocation cap was reserved (the cap the host really ran under)', async () => {
    const { roots, repo } = fixture();
    await inProcess(roots, repo, {}, (deps, onboardingId) => {
      const row = deps.ledger.getOnboarding(onboardingId);
      const contract = deps.ledger.getContract(onboardingId);
      assert.ok(row.ok && contract.ok && contract.value !== null);
      const runId = contract.value.runId;
      // Leave 1.5 USD of the run's cost budget: the reservation the cap logic makes is 1.5, not 3.
      const found = deps.ledger.getBudgets(runId);
      assert.ok(found.ok);
      const cost = found.value.find((b: BudgetRow) => b.name === 'costUsd') as BudgetRow;
      assert.ok(deps.ledger.chargeBudget(runId, 'costUsd', cost.limit - cost.used - 1.5, { fromReserved: false }).ok);
      const first = reserveInvocation(deps, row.value, 'map');
      assert.ok(first.ok && first.value.granted);
      assert.ok(Math.abs(first.value.reservation.costCapUsd - 1.5) < 1e-9);
      const before = costUsed(deps, runId);
      // The orphan is settled by the next reservation, which then finds no cost budget left.
      const second = reserveInvocation(deps, row.value, 'map');
      assert.ok(second.ok);
      assert.ok(Math.abs(costUsed(deps, runId) - (before + 1.5)) < 1e-9);
      assert.deepEqual(second.value, { granted: false, budget: 'costUsd' });
    });
  });
});
