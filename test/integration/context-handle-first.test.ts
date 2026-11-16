// Plan 04-09 Task 1 (FR-22, FR-3, S-54): the context assembler finds handles from every source first, deduplicates and
// ranks them, picks first-fit within the token budget, and only then reads what it picked. The sources are recording
// fakes, so the test asserts the exact calls the assembler makes; the project is a real onboarded scratch repository.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { queryContext } from '../../src/app/context.ts';
import type { ContextReport } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import type { ContextConfidence, ContextHandle, ContextItem, ContextSource } from '../../src/ports/context-source.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Recorded {
  // Every find and read, across both sources, in call order.
  calls: string[];
  reads: { intel: string[][]; graph: string[][] };
}

interface Spec {
  provider?: string;
  kind?: string;
  id: string;
  estTokens: number;
  confidence?: ContextConfidence;
}

function handleOf(spec: Spec): ContextHandle {
  return {
    ref: {
      provider: spec.provider ?? 'gsd-graph',
      kind: spec.kind ?? 'graph-node',
      id: spec.id,
      revision: 'git:0123456789abcdef',
      retrievedAt: '2026-11-16T00:00:00.000Z',
      scope: `src/${spec.id}.ts`,
      freshness: 'fresh',
    },
    title: `title of ${spec.id}`,
    estTokens: spec.estTokens,
    reason: `matched ${spec.id}`,
    ...(spec.confidence !== undefined ? { confidence: spec.confidence } : {}),
  };
}

function fakeSource(name: 'intel' | 'graph', specs: readonly Spec[], recorded: Recorded): ContextSource {
  return {
    descriptor: { port: 'context-source', adapter: `fake-${name}`, version: '1', capabilities: { find: true, read: true, refresh: false }, offline: true },
    find: async () => {
      recorded.calls.push(`find:${name}`);
      return { ok: true, value: specs.map(handleOf) };
    },
    read: async (handles) => {
      recorded.calls.push(`read:${name}`);
      recorded.reads[name].push(handles.map((h) => h.ref.id));
      const items: ContextItem[] = handles.map((h) => ({ ref: h.ref, title: h.title, excerpt: `body of ${h.ref.id}`, estTokens: h.estTokens, reason: h.reason }));
      return { ok: true, value: items };
    },
  };
}

async function onboardedDeps(): Promise<{ deps: AppDeps; close: () => void }> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n', 'src/index.ts': 'export const a = 1;\n' } });
  const bins = mkdtempSync(join(tmpdir(), 'avarice-handle-first-'));
  cleanup.push(roots.base, repo.base, bins);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(bins, 'ok'),
  };
  const onboarding = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
  assert.ok(onboarding.ok, 'composition');
  try {
    const started = startOnboarding(onboarding.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(onboarding.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok && outcome.value.state === 'active', 'the repository is onboarded');
  } finally {
    onboarding.value.close();
  }
  const composed = createDeps(env, {}, { readOnly: true, gsd: true });
  assert.ok(composed.ok);
  return { deps: composed.value.deps, close: composed.value.close };
}

interface Asked {
  report: ContextReport;
  recorded: Recorded;
}

async function ask(intel: readonly Spec[], graph: readonly Spec[], budget: number): Promise<Asked> {
  const { deps, close } = await onboardedDeps();
  try {
    const recorded: Recorded = { calls: [], reads: { intel: [], graph: [] } };
    const withFakes: AppDeps = { ...deps, context: { intel: fakeSource('intel', intel, recorded), graph: fakeSource('graph', graph, recorded) } };
    const result = await queryContext(withFakes, { term: 'anything', budget });
    assert.ok(result.ok, JSON.stringify(result));
    return { report: result.value, recorded };
  } finally {
    close();
  }
}

const idsOf = (report: ContextReport): string[] => report.items.map((i) => i.ref.id);

describe('S-54: the assembler finds everywhere, picks first-fit, reads only what it picked', () => {
  it('reads the 3000 and 800 handles, not the 2500 one, and lists the 2500 one as omitted with its estimate', async () => {
    const { report, recorded } = await ask([], [{ id: 'big', estTokens: 3000 }, { id: 'mid', estTokens: 2500 }, { id: 'small', estTokens: 800 }], 4000);
    // The exact read-call arguments: one read, with the picked handles only, in rank order.
    assert.deepEqual(recorded.reads.graph, [['big', 'small']]);
    assert.deepEqual(recorded.reads.intel, [], 'intel picked nothing, so intel is not read');
    assert.deepEqual(idsOf(report), ['big', 'small']);
    assert.equal(report.usedTokens, 3800);
    assert.ok(report.usedTokens <= 4000);
    assert.deepEqual(report.omitted, [{ source: 'gsd-graph', id: 'mid', title: 'title of mid', estTokens: 2500 }]);
  });

  it('does the same across two sources, with every find before any read', async () => {
    const { report, recorded } = await ask([{ provider: 'gsd-intel', kind: 'intel-entry', id: 'note', estTokens: 150 }], [{ id: 'big', estTokens: 3000 }, { id: 'mid', estTokens: 2500 }, { id: 'small', estTokens: 800 }], 4000);
    assert.deepEqual(recorded.calls, ['find:intel', 'find:graph', 'read:intel', 'read:graph']);
    assert.deepEqual(recorded.reads, { intel: [['note']], graph: [['big', 'small']] });
    assert.deepEqual(idsOf(report), ['note', 'big', 'small']);
    assert.equal(report.usedTokens, 3950);
    assert.deepEqual(report.omitted.map((o) => [o.id, o.estTokens]), [['mid', 2500]]);
  });

  it('keeps intel to half of the budget: a 3000 intel handle at budget 4000 is left out and the graph handles are read', async () => {
    const { report, recorded } = await ask([{ provider: 'gsd-intel', kind: 'intel-entry', id: 'huge', estTokens: 3000 }], [{ id: 'mid', estTokens: 2500 }, { id: 'small', estTokens: 800 }], 4000);
    assert.deepEqual(recorded.reads, { intel: [], graph: [['mid', 'small']] });
    assert.deepEqual(report.omitted, [{ source: 'gsd-intel', id: 'huge', title: 'title of huge', estTokens: 3000 }]);
    assert.equal(report.usedTokens, 3300);
  });

  it('keeps provider, kind, id, revision, retrievedAt and scope of every handle in its pack item', async () => {
    const { report } = await ask([], [{ id: 'one', estTokens: 10 }], 4000);
    const [item] = report.items;
    assert.ok(item);
    assert.deepEqual(item.ref, handleOf({ id: 'one', estTokens: 10 }).ref);
    assert.equal(item.source, 'gsd-graph');
  });
});

describe('merging, emptiness and order', () => {
  it('merges two handles with the same provider, kind and id into the first-ranked copy', async () => {
    const { report, recorded } = await ask([{ provider: 'gsd-graph', kind: 'graph-node', id: 'shared', estTokens: 100 }], [{ id: 'shared', estTokens: 100 }, { id: 'other', estTokens: 100 }], 4000);
    assert.deepEqual(idsOf(report), ['shared', 'other']);
    assert.equal(report.items[0]?.source, 'gsd-intel', 'the first-ranked copy (intel, ranked before the graph) is the one kept');
    assert.deepEqual(recorded.reads, { intel: [['shared']], graph: [['other']] });
    assert.equal(report.usedTokens, 200);
    assert.deepEqual(report.omitted, []);
  });

  it('keeps a handle that differs only in kind', async () => {
    const { report } = await ask([], [{ id: 'same', kind: 'graph-node', estTokens: 10 }, { id: 'same', kind: 'graph-edge', estTokens: 10 }], 4000);
    assert.equal(report.items.length, 2);
  });

  it('with no handle from any source makes no read call and returns an empty pack', async () => {
    const { report, recorded } = await ask([], [], 4000);
    assert.deepEqual(recorded.calls, ['find:intel', 'find:graph']);
    assert.deepEqual(report.items, []);
    assert.deepEqual(report.omitted, []);
    assert.equal(report.usedTokens, 0);
  });

  it('keeps equal-rank handles in source order, then the order the source returned them', async () => {
    const { report } = await ask(
      [{ provider: 'gsd-intel', kind: 'intel-entry', id: 'i1', estTokens: 10 }, { provider: 'gsd-intel', kind: 'intel-entry', id: 'i2', estTokens: 10 }],
      [{ id: 'g2', estTokens: 10 }, { id: 'g1', estTokens: 10 }, { id: 'g3', estTokens: 10 }],
      4000,
    );
    assert.deepEqual(idsOf(report), ['i1', 'i2', 'g2', 'g1', 'g3']);
  });

  it('ranks a more reliable edge tier first inside one source', async () => {
    const { report, recorded } = await ask([], [{ id: 'guess', estTokens: 600, confidence: 'INFERRED' }, { id: 'code', estTokens: 600, confidence: 'EXTRACTED' }], 700);
    assert.deepEqual(recorded.reads.graph, [['code']]);
    assert.deepEqual(report.omitted.map((o) => o.id), ['guess']);
  });
});
