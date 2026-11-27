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
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { GitFilesContext } from '../../src/adapters/context/git-files.ts';
import { findWithin } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { RetrievalGuard } from '../../src/app/retrieval-guard.ts';
import { RETRIEVAL_CAPS } from '../../src/domain/retrieval-rules.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextSource } from '../../src/ports/context-source.ts';
import { budgetsOf, onboardedContext, startedRun } from '../helpers/retrieval-fixtures.ts';
import type { StartedRun as Started } from '../helpers/retrieval-fixtures.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const started = (frontmatter: readonly string[] = [], budgetOverrides: Readonly<Record<string, number>> = {}): Started => startedRun(cleanup, frontmatter, budgetOverrides);

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

// ---- Task 2: every step stops at its cap (CON-11, S-16, T-04-77) ------------------------------------------------------------------------------------------------

const nowMs = (): number => Date.parse('2026-11-17T00:00:00Z');

function gitQuery(repo: ScratchRepo, term: string, extra: Partial<ContextQuery> = {}): ContextQuery {
  return { term, workspace: { stagingPath: repo.path, repoPath: repo.path }, indexRevision: `git:${repo.head}`, ...extra };
}

describe('git-files stops at its hit cap and says so (CON-11)', () => {
  const manyFiles = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`d/f${String(i).padStart(3, '0')}.txt`, 'a needle here\n']));

  it('returns at most 200 hits and records truncated: true when more exist', async () => {
    const repo = makeScratchRepo({ files: manyFiles(250) });
    cleanup.push(repo.base);
    const stats = { truncated: false };
    const found = await new GitFilesContext({ nowMs }).find(gitQuery(repo, 'needle', { limits: { ...RETRIEVAL_CAPS }, stats }), 4000);
    assert.ok(found.ok, JSON.stringify(found));
    assert.equal(found.value.length, 200);
    assert.equal(stats.truncated, true);
  });

  it('does not record truncated when the hits are exactly the cap, and honors a cap the query lowers', async () => {
    const repo = makeScratchRepo({ files: manyFiles(200) });
    cleanup.push(repo.base);
    const exact = { truncated: false };
    const all = await new GitFilesContext({ nowMs }).find(gitQuery(repo, 'needle', { limits: { ...RETRIEVAL_CAPS }, stats: exact }), 4000);
    assert.ok(all.ok);
    assert.equal(all.value.length, 200);
    assert.equal(exact.truncated, false);
    const lowered = { truncated: false };
    const few = await new GitFilesContext({ nowMs }).find(gitQuery(repo, 'needle', { limits: { ...RETRIEVAL_CAPS, searchHits: 3 }, stats: lowered }), 4000);
    assert.ok(few.ok);
    assert.equal(few.value.length, 3);
    assert.equal(lowered.truncated, true);
  });

  it('refuses an unscoped query, one whose read scope names no path, as denied retrieval:unscoped-query', async () => {
    const repo = makeScratchRepo({ files: manyFiles(3) });
    cleanup.push(repo.base);
    const found = await new GitFilesContext({ nowMs }).find(gitQuery(repo, 'needle', { readScope: { read: [], readExclude: [], secretGlobs: [] } }), 4000);
    assert.equal(found.ok, false);
    if (!found.ok) assert.deepEqual(found.error, { kind: 'denied', rule: 'retrieval:unscoped-query', enforcer: 'avarice' });
  });

  it('answers cancelled with no side effect for a query whose signal is already aborted', async () => {
    const repo = makeScratchRepo({ files: manyFiles(3) });
    cleanup.push(repo.base);
    const controller = new AbortController();
    controller.abort();
    const found = await new GitFilesContext({ nowMs }).find(gitQuery(repo, 'needle', { signal: controller.signal }), 4000);
    assert.equal(found.ok, false);
    if (!found.ok) assert.deepEqual(found.error, { kind: 'cancelled', sideEffect: 'none' });
  });
});

describe('a slow search is aborted through the AbortSignal and answers timeout with no side effect (CON-11)', () => {
  it('findWithin aborts the signal the source was given and returns timeout', async () => {
    let signalSeen: AbortSignal | undefined;
    const slow: ContextSource = {
      descriptor: { port: 'context-source', adapter: 'fake-slow', version: '1', capabilities: { find: true, read: true, refresh: false }, offline: true },
      find: (query) =>
        new Promise((resolve) => {
          signalSeen = query.signal;
          query.signal?.addEventListener('abort', () => resolve({ ok: false, error: { kind: 'cancelled', sideEffect: 'none' } }), { once: true });
          // A source that never notices: it answers after 3 s, long after the 60 ms the query is given.
          setTimeout(() => resolve({ ok: true, value: [] }), 3000).unref();
        }),
      read: async () => ({ ok: true, value: [] }),
      refresh: async (ref) => ({ ok: true, value: ref }),
    };
    const query: ContextQuery = { term: 'x', workspace: { stagingPath: '/s', repoPath: '/r' }, indexRevision: 'git:abc' };
    const started = Date.now();
    const result = await findWithin(slow, query, 100, { ...RETRIEVAL_CAPS, queryTimeoutMs: 60 });
    assert.deepEqual(result, { ok: false, error: { kind: 'timeout', afterMs: 60, sideEffect: 'none' } });
    assert.equal(signalSeen?.aborted, true, 'the source was told to stop');
    assert.ok(Date.now() - started < 5000, 'the query did not wait for the source');
  });
});

describe('the assembler enforces the caps on what any source returns (CON-11, S-16)', () => {
  const files: Record<string, string> = { 'README.md': '# scratch\n', ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`src/m${String(i).padStart(2, '0')}.ts`, `export const needle${i} = ${i}; // needle\n`])) };
  let o: Awaited<ReturnType<typeof onboardedContext>>;
  const fake = (name: string, over: Partial<ContextSource> & { paged?: boolean } = {}): ContextSource => {
    const { paged, ...rest } = over;
    return {
      descriptor: { port: 'context-source', adapter: `fake-${name}`, version: '1', capabilities: { find: true, read: true, refresh: false, ...(paged === true ? { paged: true } : {}) }, offline: true },
      find: async () => ({ ok: true, value: [] }),
      read: async () => ({ ok: true, value: [] }),
      refresh: async (ref) => ({ ok: true, value: ref }),
      ...rest,
    };
  };
  const handle = (id: string, estTokens = 10): ContextHandle => ({
    ref: { provider: 'gsd-graph', kind: 'graph-node', id, revision: 'git:0123456789abcdef', retrievedAt: '2026-11-17T00:00:00.000Z', scope: `src/${id}.ts`, freshness: 'fresh' },
    title: `title of ${id}`,
    estTokens,
    reason: `matched ${id}`,
  });
  const itemOf = (h: ContextHandle, excerpt: string): ContextItem => ({ ref: h.ref, title: h.title, excerpt, estTokens: h.estTokens, reason: h.reason });

  it('setup: a repository with forty files that hold the term, onboarded', async () => {
    o = await onboardedContext(cleanup, files);
  });

  it('reads at most 30 snippets and lists the others as omitted with a note', async () => {
    const result = await queryContext(o.deps, { term: 'needle', budget: 100_000 });
    assert.ok(result.ok, JSON.stringify(result));
    const snippets = result.value.items.filter((i) => i.source === 'git-files');
    assert.equal(snippets.length, 30);
    assert.equal(result.value.omitted.filter((x) => x.source === 'git-files').length, 10);
    assert.ok(result.value.notes.some((n) => /30 snippets/.test(n)), JSON.stringify(result.value.notes));
  });

  it('cuts a 10 MiB excerpt at the returned-byte cap with a marker', async () => {
    const h = handle('huge');
    const graph = fake('graph', { find: async () => ({ ok: true, value: [h] }), read: async (hs) => ({ ok: true, value: hs.map((x) => itemOf(x, 'a'.repeat(10 * 1024 * 1024))) }) });
    const result = await queryContext({ ...o.deps, context: { ...o.deps.context, graph } }, { term: 'huge', budget: 4000 });
    assert.ok(result.ok, JSON.stringify(result));
    const item = result.value.items.find((i) => i.ref.id === 'huge');
    assert.ok(item, 'the item is in the pack');
    assert.ok(Buffer.byteLength(item.excerpt) <= RETRIEVAL_CAPS.returnedBytes + 200, `the excerpt is ${Buffer.byteLength(item.excerpt)} bytes`);
    assert.match(item.excerpt, /\[excerpt cut at the 65536-byte limit\]/);
  });

  it('stops a paged source at 5 pages when asked for 50, with a note', async () => {
    const pages: number[] = [];
    const graph = fake('graph', {
      paged: true,
      find: async (query) => {
        pages.push(query.page ?? 0);
        return { ok: true, value: [handle(`p${query.page}-a`), handle(`p${query.page}-b`)] };
      },
    });
    const result = await queryContext({ ...o.deps, context: { ...o.deps.context, graph } }, { term: 'paged', budget: 4000 });
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(pages, [1, 2, 3, 4, 5]);
    assert.ok(result.value.notes.some((n) => /5 pages/.test(n)), JSON.stringify(result.value.notes));
  });

  it('stops at the entry cap of a source that returns 2500 handles', async () => {
    const graph = fake('graph', {
      find: async () => ({ ok: true, value: Array.from({ length: 2500 }, (_, i) => handle(`n${i}`, 1)) }),
      read: async (hs) => ({ ok: true, value: hs.map((x) => itemOf(x, 'x')) }),
    });
    const result = await queryContext({ ...o.deps, context: { ...o.deps.context, graph } }, { term: 'many', budget: 100_000 });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.items.filter((i) => i.source === 'gsd-graph').length, 2000);
    assert.ok(result.value.notes.some((n) => /2000 entries/.test(n)), JSON.stringify(result.value.notes));
  });

  it('a profile that lowers queryTimeoutMs aborts a slow source and the pack goes on without it', async () => {
    let aborted = false;
    const graph = fake('graph', {
      find: (query) =>
        new Promise((resolve) => {
          query.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ ok: false, error: { kind: 'cancelled', sideEffect: 'none' } });
          });
          // A source that never notices: it answers after 3 s, long after the 50 ms the query is given.
          setTimeout(() => resolve({ ok: true, value: [] }), 3000).unref();
        }),
    });
    const deps: AppDeps = { ...o.deps, context: { ...o.deps.context, graph }, profile: { ...o.deps.profile, config: { ...o.deps.profile.config, sections: { ...o.deps.profile.config.sections, retrieval: { queryTimeoutMs: 50 } } } } };
    const result = await queryContext(deps, { term: 'slow', budget: 4000 });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(aborted, true);
    assert.ok(result.value.notes.some((n) => /timeout/.test(n)), JSON.stringify(result.value.notes));
  });

  it('teardown', () => {
    o.close();
  });
});

describe('the counters of a run stop at their limits and a refusal changes nothing (CON-11, CS-16)', () => {
  it('beginSearch spends one search each and refuses retrieval:searches-spent at the limit; beginRead refuses a read past its files or bytes', () => {
    const s = started([], { 'retrieval.searches': 2, 'retrieval.fullReads': 3, 'retrieval.fullReadBytes': 1000 });
    try {
      const made = RetrievalGuard.forRun(s.deps, s.runId);
      assert.ok(made.ok, JSON.stringify(made));
      const guard = made.value;
      const verdicts = [guard.beginSearch('scoped'), guard.beginSearch('scoped'), guard.beginSearch('scoped')].map((v) => (v.ok ? v.value : v.error));
      assert.deepEqual(verdicts, [{ granted: true }, { granted: true }, { granted: false, rule: 'retrieval:searches-spent' }]);
      assert.equal(budgetsOf(s)['retrieval.searches']?.used, 2);
      const reads = [guard.beginRead(2, 400), guard.beginRead(2, 100), guard.beginRead(1, 700), guard.beginRead(1, 600)].map((v) => (v.ok ? v.value : v.error));
      assert.deepEqual(reads, [{ granted: true }, { granted: false, rule: 'retrieval:fullReads-spent' }, { granted: false, rule: 'retrieval:fullReadBytes-spent' }, { granted: true }]);
      const rows = budgetsOf(s);
      assert.equal(rows['retrieval.fullReads']?.used, 3, 'a refused read spent nothing, the two granted ones spent 2 + 1');
      assert.equal(rows['retrieval.fullReadBytes']?.used, 1000);
      assert.equal(guard.beginSnippets(45).count, 30);
    } finally {
      s.close();
    }
  });
});
