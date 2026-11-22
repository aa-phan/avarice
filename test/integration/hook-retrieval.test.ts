// The agent's own searches under a run's retrieval limits, through the real hook entry (src/hook/pre-tool-use.ts) against a temp
// ledger (plan 04-29; CON-10, CON-11, S-16, CS-16, T-04-80, T-04-81). Every Grep and Glob charges `retrieval.searches` in the
// same transaction as `toolCalls`; an unfiltered whole-repository search needs the contract's `retrieval.broadDiscovery`, and is
// allowed once. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { writeHookPolicy } from '../../src/adapters/host-claude/hook-policy.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { computeInvocationScope, computeRunScope } from '../../src/domain/invocation-scope.ts';
import type { RunScopeInput } from '../../src/domain/invocation-scope.ts';
import { compileOnboardingContract } from '../../src/domain/onboarding-contract.ts';
import { budgetUsed, chainIsIntact, eventRows, makeHookFixture, runHook, runHookAsync } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
const retrievalFixture = (searches: number, broadDiscovery: boolean, extra: Parameters<typeof makeHookFixture>[0] = {}): HookFixture => {
  const fx = makeHookFixture({
    ...extra,
    limits: { 'retrieval.searches': searches, 'retrieval.broadDiscovery': broadDiscovery ? 1 : 0, ...extra.limits },
    policy: { purpose: 'run', retrieval: { searches, broadDiscovery }, ...extra.policy },
  });
  fixtures.push(fx);
  return fx;
};
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

interface Deny {
  hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
}
// The rule a call was refused with, or 'allowed' when the hook printed nothing.
function outcome(stdout: string): string {
  if (stdout === '') return 'allowed';
  const out = (JSON.parse(stdout) as Deny).hookSpecificOutput;
  if (out.permissionDecision !== 'deny') return `explicit ${out.permissionDecision}`;
  const rule = /^avarice: (retrieval:[a-z-]+|budget:[A-Za-z.]+|[a-z_-]+)/.exec(out.permissionDecisionReason);
  return rule?.[1] ?? out.permissionDecisionReason;
}
const scoped = (fx: HookFixture) => ({ tool_name: 'Grep', tool_input: { pattern: 'needle', path: join(fx.staging, 'src'), glob: '*.ts' } });
const unfiltered = { tool_name: 'Grep', tool_input: { pattern: 'needle' } };

function decisions(fx: HookFixture): Array<{ tool: string; decision: string; rule: string; budget?: string }> {
  return eventRows(fx, 'hook.decision').map((r) => JSON.parse(r.data_json));
}

describe('tracer: a run Grep is charged to retrieval.searches and denied once the row is spent (CON-10, CON-11)', () => {
  it('allows three scoped searches and denies the fourth with budget:retrieval.searches; the row ends at used 3', () => {
    const fx = retrievalFixture(3, false);
    for (let n = 0; n < 3; n += 1) assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed', `search ${n + 1}`);
    const fourth = runHook(fx, 'pre', scoped(fx));
    assert.equal(fourth.code, 0, fourth.stderr);
    assert.equal(outcome(fourth.stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 3);
    assert.equal(budgetUsed(fx, 'toolCalls'), 3, 'a refused search charges nothing, not even a tool call');
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Grep', decision: 'deny', rule: 'budget:retrieval.searches', budget: 'retrieval.searches' });
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('charges a Glob the same way', () => {
    const fx = retrievalFixture(1, false);
    const glob = { tool_name: 'Glob', tool_input: { pattern: 'src/**/*.ts' } };
    assert.equal(outcome(runHook(fx, 'pre', glob).stdout), 'allowed');
    assert.equal(outcome(runHook(fx, 'pre', glob).stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
  });

  it('does not charge retrieval.searches for a Read', () => {
    const fx = retrievalFixture(3, false);
    assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } }).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
  });

  it('fails closed (exit 2) when the policy names retrieval limits and the ledger has no retrieval.searches row', () => {
    const fx = makeHookFixture({ policy: { purpose: 'run', retrieval: { searches: 3, broadDiscovery: false } } });
    fixtures.push(fx);
    const result = runHook(fx, 'pre', scoped(fx));
    assert.equal(result.code, 2);
    assert.match(result.stderr, /no retrieval\.searches budget/);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
  });
});

describe('broad discovery (CON-10, S-16, T-04-81)', () => {
  it('denies a Grep with no path and no filter as retrieval:broad-discovery-not-authorized, charging nothing', () => {
    const fx = retrievalFixture(3, false);
    const result = runHook(fx, 'pre', unfiltered);
    assert.equal(outcome(result.stdout), 'retrieval:broad-discovery-not-authorized');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats the clone root named as the path, with `.` or a trailing slash, as the same whole-repository search', () => {
    const fx = retrievalFixture(3, false);
    for (const path of [fx.staging, `${fx.staging}/`, `${fx.staging}/.`, '.']) {
      const out = outcome(runHook(fx, 'pre', { tool_name: 'Grep', tool_input: { pattern: 'x', path } }).stdout);
      assert.equal(out, 'retrieval:broad-discovery-not-authorized', path);
    }
  });

  it('treats a root search filtered by a glob, a type or a directory as scoped', () => {
    const fx = retrievalFixture(10, false);
    const scopedCalls = [
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', type: 'ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', path: join(fx.staging, 'src') } },
      { tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
    ];
    for (const call of scopedCalls) assert.equal(outcome(runHook(fx, 'pre', call).stdout), 'allowed', JSON.stringify(call));
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats a Glob that matches every file at the root as unfiltered', () => {
    const fx = retrievalFixture(10, false);
    for (const pattern of ['**/*', '*', '**']) {
      assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Glob', tool_input: { pattern } }).stdout), 'retrieval:broad-discovery-not-authorized', pattern);
    }
  });

  it('with broadDiscovery true allows the first unfiltered search once, charging searches and broadDiscovery, and denies the second as retrieval:broad-discovery-spent', () => {
    const fx = retrievalFixture(5, true);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'retrieval:broad-discovery-spent');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1, 'a refused broad search leaves the search count as it was');
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
    assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed', 'a scoped search is still allowed after the discovery is spent');
  });

  it('a broad search whose searches are spent is denied budget:retrieval.searches and does not spend the discovery', () => {
    const fx = retrievalFixture(1, true);
    assert.equal(outcome(runHook(fx, 'pre', scoped(fx)).stdout), 'allowed');
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'budget:retrieval.searches');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });
});

describe('tracer: a Grep whose glob matches every file is a broad discovery (WR-06, CON-10, T-04-131)', () => {
  const EVERY_FILE_GLOBS = ['*', '**', '**/*', '*.*', './**/*', '{*,.*}'];
  const rootGrep = (glob: string) => ({ tool_name: 'Grep', tool_input: { pattern: 'x', glob } });

  it('without broadDiscovery denies each every-file glob at the clone root as retrieval:broad-discovery-not-authorized, charging nothing', () => {
    const fx = retrievalFixture(10, false);
    for (const glob of EVERY_FILE_GLOBS) assert.equal(outcome(runHook(fx, 'pre', rootGrep(glob)).stdout), 'retrieval:broad-discovery-not-authorized', glob);
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 0);
    assert.equal(budgetUsed(fx, 'toolCalls'), 0);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('with broadDiscovery allows the first every-file Grep, charging searches and broadDiscovery, and denies the second as retrieval:broad-discovery-spent', () => {
    const fx = retrievalFixture(5, true);
    assert.equal(outcome(runHook(fx, 'pre', rootGrep('**/*')).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 1);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
    assert.equal(outcome(runHook(fx, 'pre', rootGrep('*')).stdout), 'retrieval:broad-discovery-spent');
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 1);
  });

  it('keeps a Grep with a real glob or a type a filtered search, charged to retrieval.searches only', () => {
    const fx = retrievalFixture(10, false);
    const filtered = [
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: '*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', glob: 'src/**/*.ts' } },
      { tool_name: 'Grep', tool_input: { pattern: 'x', type: 'ts' } },
    ];
    for (const call of filtered) assert.equal(outcome(runHook(fx, 'pre', call).stdout), 'allowed', JSON.stringify(call));
    assert.equal(budgetUsed(fx, 'retrieval.searches'), 3);
    assert.equal(budgetUsed(fx, 'retrieval.broadDiscovery'), 0);
  });

  it('treats a Glob whose pattern holds a brace group as unfiltered', () => {
    const fx = retrievalFixture(10, false);
    for (const pattern of ['{*,.*}', '**/*.{ts,js}']) {
      assert.equal(outcome(runHook(fx, 'pre', { tool_name: 'Glob', tool_input: { pattern } }).stdout), 'retrieval:broad-discovery-not-authorized', pattern);
    }
  });
});

describe('onboarding purposes keep their hook decisions (policy-gated rules)', () => {
  it('a policy without a retrieval block allows an unfiltered Grep and charges toolCalls only', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    assert.equal(outcome(runHook(fx, 'pre', unfiltered).stdout), 'allowed');
    assert.equal(budgetUsed(fx, 'toolCalls'), 1);
    assert.deepEqual(decisions(fx).at(-1), { onboardingId: 'onb_1', invocationId: 'inv_1', tool: 'Grep', decision: 'allow', rule: 'read-set', budget: 'toolCalls' });
  });
});

describe('the retrieval limits reach the policy file only for a run scope', () => {
  const runInput = (fx: HookFixture, retrieval?: { searches: number; fullReads: number; fullReadBytes: number; broadDiscovery: boolean }): RunScopeInput => ({
    contract: {
      files: { write: ['src/a.ts'], create: [], artifacts: [], protected: [], secretGlobs: [] },
      execution: { commands: [] },
      budgets: { subagentsTotal: 4, subagentsConcurrent: 2, ...(retrieval !== undefined ? { retrieval } : {}) },
    },
    clonePath: fx.staging,
    repoPath: fx.repo,
    dataRoot: join(fx.dir, 'data'),
    home: join(fx.dir, 'home'),
    workRoot: join(fx.dir, 'work'),
    profileRoots: [],
    scratchDir: join(fx.dir, 'work', 'scratch'),
    workspace: { topLevelEntries: ['src'], entriesByDir: { src: ['a.ts'] }, gitPaths: [], repoReadAllow: [] },
    readRoots: [],
  });
  const ids = { onboardingId: 'run_1', runId: 'run_1', invocationId: 'inv_1', subagentTypes: [] };
  const written = (fx: HookFixture, scope: ReturnType<typeof computeRunScope>): HookPolicy => {
    const result = writeHookPolicy(join(fx.dir, 'inv'), scope, ids, fx.ledgerPath);
    assert.ok(result.ok);
    return JSON.parse(readFileSync(result.value.file, 'utf8')) as HookPolicy;
  };

  it('writes the contract searches and broadDiscovery for a run, and nothing for a contract compiled before them', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    const policy = written(fx, computeRunScope(runInput(fx, { searches: 400, fullReads: 20, fullReadBytes: 262144, broadDiscovery: true })));
    assert.deepEqual(policy.retrieval, { searches: 400, broadDiscovery: true });
    assert.equal('retrieval' in written(fx, computeRunScope(runInput(fx))), false);
  });

  it('writes no retrieval block for an onboarding purpose', () => {
    const fx = makeHookFixture();
    fixtures.push(fx);
    const compiled = compileOnboardingContract({ onboardingId: 'onb_1', runId: 'run_1', projectId: 'prj_1', pin: 'a'.repeat(40), preflight: {}, request: {}, nowIso: '2026-11-02T00:00:00.000Z' });
    if (!compiled.ok) throw new Error('contract');
    const scope = computeInvocationScope({
      purpose: 'map',
      contract: compiled.value,
      stagingPath: fx.staging,
      repoPath: fx.repo,
      dataRoot: join(fx.dir, 'data'),
      home: join(fx.dir, 'home'),
      workRoot: join(fx.dir, 'work'),
      profileRoots: [],
      workspace: { topLevelEntries: ['src', '.planning'], planningEntries: ['codebase'], gitPaths: [], repoReadAllow: [] },
      readRoots: [],
    });
    assert.equal('retrieval' in written(fx, scope), false);
  });
});

// S-16 and CS-16 on the agent side: the retrieval counter is one row, spent inside the hook's BEGIN IMMEDIATE transaction, so parallel hook processes (a parent and its
// subagents each run their own) never spend more than the limit and the row's `used` equals the calls the hook allowed.
describe('parallel subagents share one exact counter (S-16, CS-16, T-04-80)', () => {
  const LIMIT = 10;
  const WORKERS = 6;
  const SEARCHES_EACH = 3;
  const ITERATIONS = 10;
  const raceFixture = (): HookFixture => retrievalFixture(LIMIT, false, { limits: { subagentsTotal: 20 }, policy: { subagentsConcurrent: 2, subagentTypes: ['gsd-codebase-mapper'] } });
  const agentCall = (n: number) => ({ tool_name: 'Agent', tool_use_id: `sub${n}`, tool_input: { subagent_type: 'gsd-codebase-mapper', prompt: 'x' } });

  it(`six processes issuing ${SEARCHES_EACH} scoped searches each against retrieval.searches ${LIMIT}: exactly ${LIMIT} allowed, ${WORKERS * SEARCHES_EACH - LIMIT} denied, used ${LIMIT}, over ${ITERATIONS} iterations`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const fx = retrievalFixture(LIMIT, false);
      const workers = Array.from({ length: WORKERS }, async (_, worker) => {
        const outcomes: string[] = [];
        for (let n = 0; n < SEARCHES_EACH; n += 1) {
          const result = await runHookAsync(fx, 'pre', { ...scoped(fx), agent_id: `agent${worker}` });
          assert.equal(result.code, 0, result.stderr);
          outcomes.push(outcome(result.stdout));
        }
        return outcomes;
      });
      const all = (await Promise.all(workers)).flat();
      const allowed = all.filter((o) => o === 'allowed').length;
      assert.equal(allowed, LIMIT, `iteration ${iteration}: ${all.join(' ')}`);
      assert.equal(all.filter((o) => o === 'budget:retrieval.searches').length, WORKERS * SEARCHES_EACH - LIMIT, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'retrieval.searches'), allowed, `iteration ${iteration}: used is the allowed count`);
      assert.equal(budgetUsed(fx, 'toolCalls'), allowed, `iteration ${iteration}: a refused search charges no tool call`);
      assert.equal(decisions(fx).filter((d) => d.decision === 'allow').length, allowed);
      assert.ok(chainIsIntact(fx.ledgerPath));
    }
  });

  it(`six subagents as Agent calls under subagentsConcurrent 2: two are admitted, and every search of all six draws on the same ${LIMIT}, over ${ITERATIONS} iterations`, async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const fx = raceFixture();
      const workers = Array.from({ length: WORKERS }, async (_, worker) => {
        const admitted = await runHookAsync(fx, 'pre', { ...agentCall(worker), agent_id: 'parent' });
        assert.equal(admitted.code, 0, admitted.stderr);
        const outcomes: string[] = [];
        for (let n = 0; n < SEARCHES_EACH; n += 1) {
          const result = await runHookAsync(fx, 'pre', { ...scoped(fx), agent_id: `sub${worker}` });
          assert.equal(result.code, 0, result.stderr);
          outcomes.push(outcome(result.stdout));
        }
        return { admitted: outcome(admitted.stdout), outcomes };
      });
      const results = await Promise.all(workers);
      assert.equal(results.filter((r) => r.admitted === 'allowed').length, 2, `iteration ${iteration}: at most two subagents in flight`);
      assert.equal(results.filter((r) => r.admitted === 'budget:subagentsConcurrent').length, WORKERS - 2, `iteration ${iteration}`);
      const searches = results.flatMap((r) => r.outcomes);
      const allowed = searches.filter((o) => o === 'allowed').length;
      assert.equal(allowed, LIMIT, `iteration ${iteration}: ${searches.join(' ')}`);
      assert.equal(budgetUsed(fx, 'retrieval.searches'), allowed, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'subagentsTotal'), 2, `iteration ${iteration}`);
      assert.equal(budgetUsed(fx, 'toolCalls'), allowed, `iteration ${iteration}: the Agent calls charge subagentsTotal, the searches toolCalls`);
      const searchers = new Set(decisions(fx).filter((d) => d.tool === 'Grep' && d.decision === 'allow').map((d) => (d as { agentId?: string }).agentId));
      assert.ok(searchers.size > 1, `iteration ${iteration}: the allowed searches came from more than one agent (${[...searchers].join(', ')})`);
      assert.ok(chainIsIntact(fx.ledgerPath));
    }
  });
});
