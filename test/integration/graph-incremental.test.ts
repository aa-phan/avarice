// Plan 04-17 (ONB-11, D-11): an incremental refresh updates the code graph from the changed paths. The real graphify extracts, through AVARICE's own
// pipeline (`extract --code-only`, never `update`); the spike S4-B found that a path-subset extraction loses the edges that leave the extracted set, so
// the whole tree is extracted again and the node-level diff against the previous graph is checked against the changed paths. Real gsd-core, real graphify
// (the tests skip with a reason when it is absent), scratch repositories, the fake host.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { findGraphifyBinary } from '../../src/adapters/graph/graphify.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { git } from '../helpers/scratch-repo.ts';
import { makeStampedMapRepo } from '../helpers/stamped-map-fixture.ts';
import type { StampedMapRepo } from '../helpers/stamped-map-fixture.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const GRAPHIFY = findGraphifyBinary(process.env);
const SKIP = GRAPHIFY === undefined ? 'graphify is not installed: the incremental code graph needs the real extraction' : false;

type Json = Record<string, unknown>;

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function stepOf<T>(roots: CliRoots, onboardingId: string, name: string): T | null {
  const [row] = rows<{ result_json: string }>(roots, 'SELECT result_json FROM onboarding_steps WHERE onboarding_id = ? AND step = ? ORDER BY attempt DESC', onboardingId, name);
  return row === undefined ? null : (JSON.parse(row.result_json) as T);
}

// A `graphify` that logs each call's first argument and then runs the real one, so a test can see which verbs a refresh used.
function loggingGraphify(real: string): { bin: string; calls: () => string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-graphify-log-'));
  cleanup.push(dir);
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'graphify');
  writeFileSync(bin, `#!/bin/sh\necho "$1" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
  chmodSync(bin, 0o755);
  return { bin, calls: () => (readFileSync(log, 'utf8').split('\n').filter((l) => l !== '')) };
}

interface CodeGraphStep {
  index: string;
  status: string;
  reason?: string;
  result?: {
    refresh?: {
      mode: string;
      strategy: string;
      changedPathCount: number;
      deletedPathCount: number;
      extractedFileCount: number;
      delta: { nodesAdded: number; nodesRemoved: number; edgesAdded: number; edgesRemoved: number; boundaryEdgesAdded: number; boundaryEdgesRemoved: number; nodesKept: number; outside: number };
    };
    nodes: Record<string, number>;
  };
}

async function onboard(roots: CliRoots, repo: StampedMapRepo, bin: string) {
  const host = new FakeAgentHost({});
  const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT, AVARICE_GRAPHIFY_BIN: bin };
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings WHERE onboarding_id = ?', started.value.onboardingId);
    return { outcome: outcome.value, onboardingId: started.value.onboardingId, staging: onboarding?.staging_worktree as string };
  } finally {
    composed.value.close();
  }
}

function commitFiles(repo: StampedMapRepo, files: Readonly<Record<string, string | null>>, message: string): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    if (content === null) {
      rmSync(target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
}

const graphOf = (staging: string): Json => JSON.parse(readFileSync(join(staging, '.planning', 'graphs', 'code-graph.json'), 'utf8')) as Json;
const nodesOf = (graph: Json): Json[] => graph['nodes'] as Json[];
const edgesOf = (graph: Json): Json[] => (graph['links'] ?? graph['edges']) as Json[];

// graphify's clustering writes `community` and `community_name` from the whole graph; what a file's nodes say is the rest.
const DERIVED = new Set(['community', 'community_name']);
const plain = (value: Json): Json => Object.fromEntries(Object.entries(value).filter(([key]) => !DERIVED.has(key)));
const nodeKey = (node: Json): string => JSON.stringify(Object.entries(plain(node)).sort(([a], [b]) => (a < b ? -1 : 1)));
const edgeKey = (edge: Json): string => JSON.stringify(Object.entries(plain(edge)).sort(([a], [b]) => (a < b ? -1 : 1)));
const sortedNodes = (graph: Json, keep: (node: Json) => boolean = () => true): string[] => nodesOf(graph).filter(keep).map(nodeKey).sort();
const sortedEdges = (graph: Json): string[] => edgesOf(graph).map(edgeKey).sort();

// A full extraction of the repository at its HEAD, made by hand with the real tool in a fresh clone: what a full rebuild at the same commit gives.
function fullRebuild(repo: StampedMapRepo, real: string): Json {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-full-rebuild-'));
  cleanup.push(dir);
  git(dir, ['clone', '-q', repo.path, 'tree']);
  const out = join(dir, 'out');
  execFileSync(real, ['extract', join(dir, 'tree'), '--code-only', '--out', out, '--max-workers', '1'], { stdio: 'ignore' });
  execFileSync(real, ['cluster-only', out, '--no-label', '--no-viz'], { stdio: 'ignore' });
  return JSON.parse(readFileSync(join(out, 'graphify-out', 'graph.json'), 'utf8')) as Json;
}

const SHOUT = "import { upper } from './util/strings';\nexport function shout(text: string): string {\n  return upper(text);\n}\n";

describe('tracer: an incremental refresh of one changed file updates the code graph and equals a full rebuild for it (ONB-11, D-11)', { skip: SKIP }, () => {
  it('extracts with extract only (never update), reports the delta, keeps the other files\' nodes and edges, and loses no edge across the boundary', async () => {
    const real = GRAPHIFY as string;
    const logged = loggingGraphify(real);
    const roots = makeRoots();
    const repo = makeStampedMapRepo();
    cleanup.push(roots.base, repo.base);
    const first = await onboard(roots, repo, logged.bin);
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    const previous = graphOf(first.staging);
    const callsBefore = logged.calls().length;

    // One changed file that now imports another one: its new edges end outside the changed set.
    commitFiles(repo, { 'src/index.ts': SHOUT }, 'src/index.ts imports the string helpers');
    const second = await onboard(roots, repo, logged.bin);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');

    const plan = stepOf<{ refresh?: { mode: string; changedPaths: string[] } }>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.refresh?.mode, 'incremental');
    assert.deepEqual(plan?.refresh?.changedPaths, ['src/index.ts']);

    const verbs = logged.calls().slice(callsBefore);
    assert.ok(verbs.includes('extract'), 'the code was extracted');
    assert.equal(verbs.includes('update'), false, 'graphify update is never invoked (D-11)');

    const step = stepOf<CodeGraphStep>(roots, second.onboardingId, 'index:code-graph');
    assert.equal(step?.status, 'present', step?.reason ?? '');
    const refresh = step?.result?.refresh;
    assert.equal(refresh?.mode, 'incremental');
    assert.equal(refresh?.strategy, 'full-extraction-node-diff');
    assert.equal(refresh?.changedPathCount, 1);
    assert.equal(refresh?.deletedPathCount, 0);
    assert.ok((refresh?.delta.nodesAdded ?? 0) >= 1, 'the new function is a node added');
    assert.ok((refresh?.delta.boundaryEdgesAdded ?? 0) >= 1, 'the import of the other file is an edge across the boundary');
    assert.equal(refresh?.delta.outside, 0, 'nothing changed outside the changed path');

    const current = graphOf(second.staging);
    const rebuild = fullRebuild(repo, real);
    assert.deepEqual(sortedNodes(current), sortedNodes(rebuild), 'the node set equals a full rebuild at the same commit');
    assert.deepEqual(sortedEdges(current), sortedEdges(rebuild), 'the edge set equals a full rebuild at the same commit, the edges across the boundary included');
    const edgeTargets = edgesOf(current).filter((edge) => String(edge['source']).startsWith('src_index_')).map((edge) => String(edge['target']));
    assert.ok(edgeTargets.some((target) => target.startsWith('src_util_strings')), 'an edge from the changed file reaches the unchanged file');

    const unchanged = (node: Json): boolean => node['source_file'] !== 'src/index.ts';
    assert.deepEqual(sortedNodes(current, unchanged), sortedNodes(previous, unchanged), 'the nodes of the unchanged files are the previous graph\'s');
    const ids = nodesOf(current).map((node) => String(node['id']));
    assert.equal(new Set(ids).size, ids.length, 'no node ID is duplicated');
    assert.deepEqual(graphOf(first.staging), previous, 'the previous graph is left as it was');
  });

  it('removes the nodes of a deleted file and the edges that ended at them', async () => {
    const real = GRAPHIFY as string;
    const logged = loggingGraphify(real);
    const roots = makeRoots();
    const repo = makeStampedMapRepo();
    cleanup.push(roots.base, repo.base);
    const base = await onboard(roots, repo, logged.bin);
    assert.equal(base.outcome.state, 'active', base.outcome.message ?? '');

    // A new file the map does not name, imported by src/index.ts: refreshed once so that the previous graph holds its nodes.
    commitFiles(repo, { 'src/extra.ts': 'export function extra(): number {\n  return 1;\n}\n', 'src/index.ts': "import { extra } from './extra';\nexport const answer = extra();\n" }, 'add src/extra.ts');
    const first = await onboard(roots, repo, logged.bin);
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    const previous = graphOf(first.staging);
    assert.ok(nodesOf(previous).some((node) => node['source_file'] === 'src/extra.ts'), 'the new file has nodes');

    commitFiles(repo, { 'src/extra.ts': null, 'src/index.ts': 'export const answer = 42;\n' }, 'drop src/extra.ts');
    const second = await onboard(roots, repo, logged.bin);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    const plan = stepOf<{ refresh?: { mode: string } }>(roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.refresh?.mode, 'incremental');

    const step = stepOf<CodeGraphStep>(roots, second.onboardingId, 'index:code-graph');
    assert.equal(step?.result?.refresh?.mode, 'incremental');
    assert.equal(step?.result?.refresh?.deletedPathCount, 1);
    assert.ok((step?.result?.refresh?.delta.nodesRemoved ?? 0) >= 1);
    assert.ok((step?.result?.refresh?.delta.edgesRemoved ?? 0) >= 1, 'the edges to the deleted file are gone');
    const current = graphOf(second.staging);
    assert.equal(nodesOf(current).some((node) => node['source_file'] === 'src/extra.ts'), false, 'the deleted file has no node');
    const ids = new Set(nodesOf(current).map((node) => String(node['id'])));
    for (const edge of edgesOf(current)) {
      assert.ok(ids.has(String(edge['source'])) && ids.has(String(edge['target'])), `an edge ends at a node that is gone: ${String(edge['source'])} -> ${String(edge['target'])}`);
    }
    assert.deepEqual(sortedNodes(current), sortedNodes(fullRebuild(repo, real)));
    assert.deepEqual(sortedEdges(current), sortedEdges(fullRebuild(repo, real)));
  });
});
