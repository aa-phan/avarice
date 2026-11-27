// Plan 04-06 Task 2 (FR-17, FR-18): extension names are `<provider>.<feature>` and never keys of a core capabilities map; the context
// adapters keep a provider's identifier byte for byte in ExternalRef.id; and planning initialization stays unsupported but names the
// manual equivalent instead of a phase number.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createDeps } from '../../src/cli/composition.ts';
import { descriptorsOf } from '../../src/app/capabilities.ts';
import { STEP_REQUIREMENTS, isNamespacedExtension } from '../../src/domain/capability-requirements.ts';
import { GsdOnboardingAdapter } from '../../src/adapters/gsd/gsd-onboarding.ts';
import { GsdGraphContext } from '../../src/adapters/context/gsd-graph.ts';
import { GsdIntelContext } from '../../src/adapters/context/gsd-intel.ts';
import { GraphifyTool } from '../../src/adapters/graph/graphify.ts';
import { LocalNotifier } from '../../src/adapters/notify/local-notifier.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import type { CommandExecutor } from '../../src/ports/command-executor.ts';
import type { ContextQuery } from '../../src/ports/context-source.ts';
import type { GsdGraphQueryResult, GsdIntelQueryResult, GsdOnboarding } from '../../src/ports/gsd-onboarding.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// What is wrong with a descriptor's extensions: a name that is not `<provider>.<feature>`, or one that is also a key of a capabilities map.
function extensionProblems(descriptor: CapabilityDescriptor, allCapabilityKeys: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const name of descriptor.extensions ?? []) {
    if (!isNamespacedExtension(name)) problems.push(`${descriptor.adapter}: extension ${JSON.stringify(name)} is not <provider>.<feature>`);
    if (allCapabilityKeys.has(name)) problems.push(`${descriptor.adapter}: extension ${JSON.stringify(name)} is also a core capability key`);
  }
  return problems;
}

const stubExecutor = { descriptor: { port: 'executor', adapter: 'stub', version: '0', capabilities: {}, offline: true } } as unknown as CommandExecutor;

function realGsd(): GsdOnboardingAdapter {
  return new GsdOnboardingAdapter({ gsdCoreDir: '/nonexistent/gsd-core', version: '1.17.0', packageName: '@opengsd/gsd-core' }, { executor: stubExecutor, dataRoot: '/nonexistent/data', home: '/nonexistent/home' });
}

describe('isNamespacedExtension (FR-17)', () => {
  it('accepts <provider>.<feature>', () => {
    for (const name of ['github.draftPr', 'gsd-intel.refreshHint', 'a.b', 'jira.issue.link']) assert.equal(isNamespacedExtension(name), true, name);
  });

  it('refuses a bare name, a missing provider or feature, and anything with space or case in the provider', () => {
    for (const name of ['draftPr', '.x', 'github.', '', 'GitHub.draftPr', 'github.draft Pr', 'github..x', 'github.1x', '.']) assert.equal(isNamespacedExtension(name), false, JSON.stringify(name));
  });
});

describe('descriptors the production adapters publish (FR-17)', () => {
  it('every extension is namespaced and none is a key of any core capabilities map; no core capability key looks like an extension', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const composed = createDeps(profileEnv(roots));
    assert.ok(composed.ok, 'composition');
    try {
      const intel = { descriptor: new GsdIntelContext(realGsd(), { nowMs: () => 0 }).descriptor };
      const graph = { descriptor: new GsdGraphContext(realGsd(), { nowMs: () => 0 }).descriptor };
      const own: CapabilityDescriptor[] = [
        ...descriptorsOf(composed.value.deps),
        realGsd().descriptor,
        intel.descriptor,
        graph.descriptor,
        new GraphifyTool(stubExecutor, { dataRoot: '/nonexistent/data', home: '/nonexistent/home', env: {} }).descriptor,
        new LocalNotifier({ osascriptPath: '/nonexistent/osascript' }).descriptor,
      ];
      assert.ok(own.length >= 7, 'the host, executor, gsd, both context sources, graph tool and notifier are covered');
      const keys = new Set(own.flatMap((d) => Object.keys(d.capabilities)));
      for (const d of own) assert.deepEqual(extensionProblems(d, keys), [], d.adapter);
      for (const key of keys) assert.equal(isNamespacedExtension(key), false, `core capability key ${key} looks like an extension`);
      for (const rows of Object.values(STEP_REQUIREMENTS)) for (const row of rows) assert.equal(isNamespacedExtension(row.capability), false, row.capability);
    } finally {
      composed.value.close();
    }
  });

  it('the checker fails a non-namespaced extension, one that is a core key, and passes a namespaced one (control)', () => {
    const base: CapabilityDescriptor = { port: 'p', adapter: 'a', version: '1', capabilities: { find: true }, offline: true };
    const keys = new Set(['find', 'read']);
    assert.deepEqual(extensionProblems({ ...base, extensions: ['github.draftPr'] }, keys), []);
    assert.equal(extensionProblems({ ...base, extensions: ['draftPr'] }, keys).length, 1);
    assert.equal(extensionProblems({ ...base, extensions: ['find'] }, keys).length, 2, 'bare and a core key');
  });
});

const IDS = ['src/a.ts#Foo::bar', 'node 1', 'x:y/z', ' padded ', 'a#b#c', 'ünï:cödé/ß'];

const query: ContextQuery = {
  term: 'x',
  // A repository path that is read-only here (`git rev-parse` only); an index revision that is not its HEAD makes every item `stale`.
  workspace: { stagingPath: '/nonexistent/staging', repoPath: process.cwd() },
  indexRevision: `git:${'0'.repeat(40)}`,
};

describe('ExternalRef.id is the provider identifier byte for byte (FR-18)', () => {
  it('gsd-intel keeps the intel file and the entry key verbatim, including ":", "#", "/" and spaces, and read answers for the same ID', async () => {
    const answer: GsdIntelQueryResult = { disabled: false, matches: [{ source: 'file-roles.json', entries: IDS.map((key) => ({ key, value: { role: 'r' } })) }], total: IDS.length, truncated: false };
    const gsd = { intelQuery: () => Promise.resolve({ ok: true, value: answer }) } as unknown as GsdOnboarding;
    const source = new GsdIntelContext(gsd, { nowMs: () => 0 });
    const found = await source.find(query, 1000);
    assert.ok(found.ok);
    assert.deepEqual(found.value.map((h) => h.ref.id), IDS.map((key) => `file-roles.json#${key}`));
    assert.deepEqual(found.value.map((h) => h.title), IDS);
    const read = await source.read(found.value, 1000);
    assert.ok(read.ok);
    assert.deepEqual(read.value.map((i) => i.ref.id), found.value.map((h) => h.ref.id));
  });

  it('gsd-graph keeps the node id verbatim, including ":", "#", "/" and spaces, and read answers for the same ID', async () => {
    const answer: GsdGraphQueryResult = {
      disabled: false,
      nodes: IDS.map((id) => ({ id, label: `label of ${id}`, fileType: 'code', sourceFile: null, description: null })),
      edges: [],
      trimmed: null,
      budgetMet: null,
      budgetEstimate: null,
    };
    const gsd = { graphifyQuery: () => Promise.resolve({ ok: true, value: answer }) } as unknown as GsdOnboarding;
    const source = new GsdGraphContext(gsd, { nowMs: () => 0 });
    const found = await source.find(query, 1000);
    assert.ok(found.ok);
    assert.deepEqual(found.value.map((h) => h.ref.id).sort(), [...IDS].sort());
    const read = await source.read(found.value, 1000);
    assert.ok(read.ok);
    assert.deepEqual(read.value.map((i) => i.ref.id), found.value.map((h) => h.ref.id));
  });
});

describe('initPlanning (RESEARCH open question 7)', () => {
  it('returns unsupported and names /gsd-new-project, not a phase number', () => {
    const refused = realGsd().initPlanning();
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok);
    assert.equal(refused.error.kind, 'unsupported');
    assert.ok(refused.error.kind === 'unsupported');
    assert.equal(refused.error.capability, 'init-planning');
    assert.equal(refused.error.reducedMode, 'initialize planning attended with /gsd-new-project; AVARICE records the result');
    assert.doesNotMatch(refused.error.reducedMode ?? '', /phase/i);
  });

  it('the capability stays false: the descriptor does not claim ingest-docs', () => {
    assert.equal(realGsd().descriptor.capabilities['ingest-docs'], false);
  });
});
