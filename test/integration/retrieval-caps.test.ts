// Plan 04-28 (CON-10, CON-11; S-16, CS-16): retrieval is capped per step and counted in budget rows. Task 1: a run contract carries the retrieval budgets and a
// broad search is refused unless the contract authorizes it, then allowed once. The runs are real: an onboarded scratch repository, `startRun` in this
// process, the production composition and `queryContext`. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { applyAmendment } from '../../src/domain/amendment.ts';
import { budgetRowsOfRun } from '../../src/app/budget.ts';
import { queryContext } from '../../src/app/context.ts';
import type { ContextRequest } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_BRIEF, RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Started {
  roots: CliRoots;
  repo: ScratchRepo;
  deps: AppDeps;
  close: () => void;
  runId: string;
  contract: RunContract;
}

// A run stored from RUN_BRIEF (one work item, so toolCalls 400), optionally with extra brief frontmatter lines.
function started(frontmatter: readonly string[] = [], budgetOverrides: Readonly<Record<string, number>> = {}): Started {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  const text = frontmatter.length === 0 ? RUN_BRIEF : RUN_BRIEF.replace('title: Collapse repeated dashes in slugs\n', `title: Collapse repeated dashes in slugs\n${frontmatter.join('\n')}\n`);
  const brief = writeBrief(join(roots.base, 'briefs'), text);
  const composed = createDeps(profileEnv(roots), {}, { gsd: true });
  assert.ok(composed.ok, 'composition');
  const result = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides });
  assert.ok(result.ok, JSON.stringify(result));
  return { roots, repo, deps: composed.value.deps, close: composed.value.close, runId: result.value.runId, contract: result.value.contract };
}

interface BudgetDb {
  name: string;
  limit_value: number;
  used: number;
  reserved: number;
}
const budgetsOf = (s: Started): Record<string, BudgetDb> =>
  Object.fromEntries(ledgerRows<BudgetDb>(s.roots, 'SELECT name, limit_value, used, reserved FROM budgets WHERE run_id = ? ORDER BY name', s.runId).map((r) => [r.name, r]));

function ask(s: Started, extra: Partial<ContextRequest>): ReturnType<typeof queryContext> {
  return queryContext(s.deps, { projectId: s.contract.workspace.projectId, term: 'slugify', budget: 4000, runId: s.runId, ...extra });
}

describe('tracer: a broad search is refused without the contract flag and allowed once with it, counted in a budget row (CON-10, S-16)', () => {
  it('a compiled run contract carries budgets.retrieval and the four retrieval budget rows', () => {
    const s = started();
    try {
      assert.deepEqual(s.contract.budgets.retrieval, { searches: 400, fullReads: 20, fullReadBytes: 262144, broadDiscovery: false });
      const rows = budgetsOf(s);
      assert.equal(rows['retrieval.searches']?.limit_value, 400);
      assert.equal(rows['retrieval.fullReads']?.limit_value, 20);
      assert.equal(rows['retrieval.fullReadBytes']?.limit_value, 262144);
      assert.equal(rows['retrieval.broadDiscovery']?.limit_value, 0);
      assert.equal(rows['retrieval.searches']?.used, 0);
    } finally {
      s.close();
    }
  });

  it('a broad query without the flag is refused retrieval:broad-discovery-not-authorized and no counter moves', async () => {
    const s = started();
    try {
      const before = budgetsOf(s);
      const refused = await ask(s, { broad: true });
      assert.equal(refused.ok, false, 'the broad query is refused');
      if (refused.ok) return;
      assert.deepEqual(refused.error, { kind: 'denied', rule: 'retrieval:broad-discovery-not-authorized', enforcer: 'avarice' });
      assert.deepEqual(budgetsOf(s), before, 'a refusal leaves every counter as it was');
    } finally {
      s.close();
    }
  });

  it('with broadDiscovery true in the contract the first broad query runs and the second is refused retrieval:broad-discovery-spent', async () => {
    const s = started(['broadDiscovery: true']);
    try {
      assert.equal(s.contract.budgets.retrieval?.broadDiscovery, true);
      assert.equal(budgetsOf(s)['retrieval.broadDiscovery']?.limit_value, 1);
      const first = await ask(s, { broad: true });
      assert.ok(first.ok, JSON.stringify(first));
      const afterFirst = budgetsOf(s);
      assert.equal(afterFirst['retrieval.broadDiscovery']?.used, 1);
      const second = await ask(s, { broad: true });
      assert.equal(second.ok, false);
      if (second.ok) return;
      assert.deepEqual(second.error, { kind: 'denied', rule: 'retrieval:broad-discovery-spent', enforcer: 'avarice' });
      assert.deepEqual(budgetsOf(s), afterFirst, 'the refused second query changes nothing');
      // A scoped query is not broad: it runs whatever the broad counter says.
      const scoped = await ask(s, {});
      assert.ok(scoped.ok, JSON.stringify(scoped));
    } finally {
      s.close();
    }
  });

  it('an empty term is a whole-repository query: it counts as broad', async () => {
    const s = started();
    try {
      const refused = await ask(s, { term: '' });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.error.kind === 'denied' ? refused.error.rule : refused.error.kind, 'retrieval:broad-discovery-not-authorized');
    } finally {
      s.close();
    }
  });

  it('a start override can lower retrieval.searches and cannot raise anything', () => {
    const lowered = started([], { 'retrieval.searches': 10 });
    try {
      assert.equal(lowered.contract.budgets.retrieval?.searches, 10);
      assert.equal(budgetsOf(lowered)['retrieval.searches']?.limit_value, 10);
    } finally {
      lowered.close();
    }
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS);
    const brief = writeBrief(join(roots.base, 'briefs'));
    const composed = createDeps(profileEnv(roots), {}, { gsd: true });
    assert.ok(composed.ok);
    try {
      for (const [name, value] of [['retrieval.searches', 401], ['retrieval.fullReads', 21], ['retrieval.fullReadBytes', 262145]] as const) {
        const raised = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: { [name]: value } });
        assert.equal(raised.ok, false, `${name} cannot be raised to ${value}`);
        if (!raised.ok) assert.match(JSON.stringify(raised.failure), /can only be lowered/);
      }
    } finally {
      composed.value.close();
    }
  });
});

describe('contracts compiled before the retrieval budgets read back unchanged (RC-5)', () => {
  it('budgetRowsOfRun gives the five original rows for a contract with no retrieval block, and amend still accepts an amendment on it', () => {
    const s = started();
    try {
      const old: RunContract = structuredClone(s.contract);
      delete old.budgets.retrieval;
      assert.deepEqual(budgetRowsOfRun(old).map((r) => r.name), ['invocations', 'toolCalls', 'subagentsTotal', 'wallClockMs', 'costUsd']);
      const amended = applyAmendment(old, { budgets: { costUsdPerRun: 12 }, reason: 'room' }, { conventionsWrite: [], nowIso: new Date(0).toISOString() });
      assert.ok(amended.ok, JSON.stringify(amended));
      if (amended.ok) assert.equal(amended.value.contract.budgets.retrieval, undefined, 'an amendment does not invent the block');
    } finally {
      s.close();
    }
  });
});
