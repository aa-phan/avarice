// Plan 04-17 (ONB-15, S-47): the knowledge pass of a refresh. Only the documents whose content digest changed, or that are new, go to the model; the others are
// cache hits and keep their document nodes from the previous graph. GSD's own phase files and STATE.md are documents of the corpus, so a new phase plan
// becomes a document node that cites its path and revision. A fake graphify (a fixed code graph), the fake knowledge host (one extraction per chunk, no model),
// real gsd-core and a scratch repository with a committed map, so that the second onboarding is an incremental refresh.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { ExtractionPlan } from '../../src/domain/knowledge-extraction.ts';
import { err } from '../../src/domain/result.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeKnowledgeHost } from '../helpers/fake-knowledge-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { git } from '../helpers/scratch-repo.ts';
import { makeStampedMapRepo } from '../helpers/stamped-map-fixture.ts';
import type { StampedMapRepo } from '../helpers/stamped-map-fixture.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

const ADR_001 = '# ADR-001: Storage\n\nStatus: accepted\n\nWe store state in SQLite, one database per profile.\n';
const ADR_002 = '# ADR-002: Hosting\n\nStatus: accepted\n\nThe service runs on one machine.\n';
const GUIDE = '# Guide\n\nRun the tool with `avarice onboard`. See ADR-001 for where the state lives.\n';
const STATE = '---\nstatus: executing\n---\n# State\n\nPhase 1 is under way.\n';
const PLAN_01 = '# Plan 01\n\nThe first phase plan.\n';
const SOURCE_DOCS: Readonly<Record<string, string>> = {
  'docs/guide.md': GUIDE,
  'docs/decisions/ADR-001-storage.md': ADR_001,
  'docs/decisions/ADR-002-hosting.md': ADR_002,
  '.planning/STATE.md': STATE,
  '.planning/phases/01-x/01-01-PLAN.md': PLAN_01,
};

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

// One document node per file of every chunk, and one INFERRED edge from each to the code node `a` of the fake graphify.
function perDocumentChunks(plan: ExtractionPlan): Record<number, unknown> {
  const out: Record<number, unknown> = {};
  for (const chunk of plan.chunks) {
    out[chunk.n] = {
      nodes: chunk.files.map((file) => ({ id: file.stem, label: file.path, file_type: 'document', source_file: file.path, source_location: 'L1' })),
      edges: chunk.files.map((file) => ({ source: file.stem, target: 'a', relation: 'documents', confidence: 'INFERRED', confidence_score: 0.7, source_file: file.path })),
    };
  }
  return out;
}

const pathsOf = (plan: ExtractionPlan | undefined): string[] => (plan?.chunks.flatMap((chunk) => chunk.files.map((file) => file.path)) ?? []).sort();

interface Refresh {
  mode: string;
  reason?: string;
  changed?: string[];
  cacheHits?: number;
  retainedNodes?: number;
}

interface KnowledgeStep {
  status: string;
  reason?: string;
  result?: { knowledge: { documentNodes: number; documentsExpected: number; manifestDigest?: string }; refresh?: Refresh };
}

interface Fixture {
  roots: CliRoots;
  repo: StampedMapRepo;
  graphify: string;
}

function fixture(sourceFiles: Readonly<Record<string, string>> = SOURCE_DOCS): Fixture {
  const roots = makeRoots();
  const repo = makeStampedMapRepo({ sourceFiles });
  const dir = mkdtempSync(join(tmpdir(), 'avarice-fake-graphify-'));
  cleanup.push(roots.base, repo.base, dir);
  return { roots, repo, graphify: writeFakeGraphify(dir, 'ok') };
}

// One onboarding in process: the production composition with a fake knowledge host. `wrap` replaces parts of the dependencies after composition.
async function onboard(f: Fixture, host: FakeKnowledgeHost, wrap?: (deps: AppDeps) => AppDeps, resume?: string) {
  const env = { ...process.env, AVARICE_CONFIG_HOME: f.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: f.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: f.roots.AVARICE_WORK_ROOT, AVARICE_GRAPHIFY_BIN: f.graphify };
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const deps = wrap?.(composed.value.deps) ?? composed.value.deps;
    let onboardingId = resume;
    if (onboardingId === undefined) {
      const started = startOnboarding(deps, { repoPath: f.repo.path, policy: 'onboarding' });
      assert.ok(started.ok, JSON.stringify(started));
      onboardingId = started.value.onboardingId;
    }
    const outcome = await runOnboarding(deps, onboardingId);
    const [row] = rows<{ staging_worktree: string }>(f.roots, 'SELECT staging_worktree FROM onboardings WHERE onboarding_id = ?', onboardingId);
    return { outcome, onboardingId, staging: row?.staging_worktree as string };
  } finally {
    composed.value.close();
  }
}

const freshHost = (): FakeKnowledgeHost => new FakeKnowledgeHost(new FakeAgentHost(), { chunks: (plan) => perDocumentChunks(plan) });

function commitFiles(repo: StampedMapRepo, files: Readonly<Record<string, string>>, message: string): string {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
  return git(repo.path, ['rev-parse', 'HEAD']).trim();
}

const graphOf = (staging: string): { nodes: Json[]; links: Json[] } => JSON.parse(readFileSync(join(staging, '.planning', 'graphs', 'graph.json'), 'utf8')) as { nodes: Json[]; links: Json[] };
const documentNodes = (staging: string): Json[] => graphOf(staging).nodes.filter((node) => node['_avarice_origin'] === 'knowledge-pass' && node['file_type'] === 'document');

describe('the knowledge pass of an incremental refresh (ONB-15, S-47)', () => {
  it('S-47: a changed ADR and a new phase plan are the only documents handed to the model; the others are cache hits and the new plan is a document node citing its path and revision', async () => {
    const f = fixture();
    const firstHost = freshHost();
    const first = await onboard(f, firstHost);
    assert.ok(first.outcome.ok);
    assert.equal(first.outcome.value.state, 'active', first.outcome.value.message ?? '');
    const corpus = pathsOf(firstHost.plans[0]);
    assert.ok(corpus.includes('.planning/STATE.md'), 'STATE.md is a document of the corpus');
    assert.ok(corpus.includes('.planning/phases/01-x/01-01-PLAN.md'), 'a phase plan is a document of the corpus');
    const total = corpus.length;

    const head = commitFiles(f.repo, { 'docs/decisions/ADR-001-storage.md': `${ADR_001}\nWe also keep a write-ahead log.\n`, '.planning/phases/02-x/02-01-PLAN.md': '# Plan 02-01\n\nThe second phase plan.\n' }, 'change an ADR and plan phase 2');
    const secondHost = freshHost();
    const second = await onboard(f, secondHost);
    assert.ok(second.outcome.ok);
    assert.equal(second.outcome.value.state, 'active', second.outcome.value.message ?? '');
    const plan = stepOf<{ refresh?: { mode: string } }>(f.roots, second.onboardingId, 'mapping:plan');
    assert.equal(plan?.refresh?.mode, 'incremental');

    assert.equal(secondHost.calls.length, 1, 'one knowledge invocation');
    const handed = pathsOf(secondHost.plans[0]);
    assert.equal(handed.length, 2, 'exactly two documents are handed to the model');
    assert.deepEqual(handed, ['.planning/phases/02-x/02-01-PLAN.md', 'docs/decisions/ADR-001-storage.md']);
    const seen = secondHost.seen[0]?.files ?? [];
    assert.equal(seen.includes('docs/guide.md'), false, 'a cache hit is not even copied into the corpus');

    const step = stepOf<KnowledgeStep>(f.roots, second.onboardingId, 'index:knowledge');
    assert.equal(step?.status, 'present', step?.reason ?? '');
    assert.equal(step?.result?.refresh?.mode, 'incremental');
    assert.deepEqual([...(step?.result?.refresh?.changed ?? [])].sort(), handed);
    assert.equal(step?.result?.refresh?.cacheHits, total - 1, 'every other document of the corpus is a cache hit');
    assert.equal(step?.result?.knowledge.documentsExpected, total + 1);
    assert.equal(step?.result?.knowledge.documentNodes, total + 1);

    const documents = documentNodes(second.staging);
    assert.equal(documents.length, total + 1);
    const added = documents.find((node) => node['source_file'] === '.planning/phases/02-x/02-01-PLAN.md');
    assert.ok(added, 'the new phase plan is a document node');
    assert.equal(added['source_revision'], `git:${head}`, 'it cites the new revision');
    const kept = documents.find((node) => node['source_file'] === 'docs/guide.md');
    assert.ok(kept, 'a document that was not re-extracted keeps its node');
    assert.ok(
      graphOf(second.staging).links.some((edge) => edge['source'] === 'docs_guide' && edge['target'] === 'a'),
      'and its edge to the code graph',
    );
  });

  it('a refresh that changes no document runs no knowledge invocation and keeps every document node', async () => {
    const f = fixture();
    const first = await onboard(f, freshHost());
    assert.ok(first.outcome.ok && first.outcome.value.state === 'active');
    const before = documentNodes(first.staging).map((node) => String(node['id'])).sort();

    commitFiles(f.repo, {}, 'an empty commit');
    const host = freshHost();
    const second = await onboard(f, host);
    assert.ok(second.outcome.ok);
    assert.equal(second.outcome.value.state, 'active', second.outcome.value.message ?? '');
    assert.equal(host.calls.length, 0, 'no knowledge invocation');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM onboarding_steps WHERE onboarding_id = ? AND step = 'launch:knowledge'", second.onboardingId)[0]?.n, 0, 'none was reserved either');
    const step = stepOf<KnowledgeStep>(f.roots, second.onboardingId, 'index:knowledge');
    assert.equal(step?.status, 'present', step?.reason ?? '');
    assert.deepEqual(step?.result?.refresh?.changed, []);
    assert.equal(step?.result?.refresh?.cacheHits, before.length);
    assert.deepEqual(documentNodes(second.staging).map((node) => String(node['id'])).sort(), before);
  });

  it('a project with no active record is a first pass: every document goes to the model and the step says nothing of a refresh', async () => {
    const f = fixture();
    const host = freshHost();
    const first = await onboard(f, host);
    assert.ok(first.outcome.ok && first.outcome.value.state === 'active');
    assert.equal(stepOf<KnowledgeStep>(f.roots, first.onboardingId, 'index:knowledge')?.result?.refresh, undefined);
    assert.equal(pathsOf(host.plans[0]).length, documentNodes(first.staging).length);
  });

  it('STATE.md is part of the corpus when the repository tracks it and absent from it when it does not', async () => {
    const without = fixture({ 'docs/guide.md': GUIDE, 'docs/decisions/ADR-001-storage.md': ADR_001 });
    const host = freshHost();
    const run = await onboard(without, host);
    assert.ok(run.outcome.ok && run.outcome.value.state === 'active');
    assert.equal(pathsOf(host.plans[0]).some((p) => p.includes('STATE.md')), false);
    assert.equal(pathsOf(host.plans[0]).includes('docs/guide.md'), true);
  });
});

// The wrapper that makes the onboarding stop where the supervisor would have died: the step's result cannot be recorded, so the step is not complete and
// a resume runs it again. Everything the host wrote before that stays in staging, as after a kill.
function failRecording(step: string): (deps: AppDeps) => AppDeps {
  return (deps) => {
    const ledger = new Proxy(deps.ledger, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'recordStepResult' || typeof value !== 'function') return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        return (id: string, input: { step: string }) => (input.step === step ? err({ kind: 'internal', cause: 'the supervisor was killed' }) : (value as (...args: unknown[]) => unknown).call(target, id, input));
      },
    });
    return { ...deps, ledger };
  };
}

const BIG = (title: string): string => `# ${title}\n\n${'A sentence of the document that makes it large enough for a chunk of its own.\n'.repeat(500)}`;

describe('an interrupted knowledge refresh resumes with the documents it had not extracted (ONB-15)', () => {
  it('re-extracts only the document not yet extracted, and the merged graph equals an uninterrupted refresh\'s (sorted nodes and edges)', async () => {
    // Two changed documents of 40 KiB each: one chunk each (a chunk holds at most 64 KiB).
    const changed = { 'docs/decisions/ADR-001-storage.md': BIG('ADR-001 changed'), '.planning/phases/02-x/02-01-PLAN.md': BIG('Plan 02-01') };

    // The uninterrupted refresh is the reference.
    const reference = fixture();
    assert.ok((await onboard(reference, freshHost())).outcome.ok);
    commitFiles(reference.repo, changed, 'two large changed documents');
    const referenceHost = freshHost();
    const uninterrupted = await onboard(reference, referenceHost);
    assert.ok(uninterrupted.outcome.ok);
    assert.equal(uninterrupted.outcome.value.state, 'active', uninterrupted.outcome.value.message ?? '');
    assert.equal(referenceHost.plans[0]?.chunks.length, 2, 'the two changed documents are two chunks');

    // The interrupted one: the host writes the first chunk only, then the supervisor is gone before the step is recorded.
    const f = fixture();
    assert.ok((await onboard(f, freshHost())).outcome.ok);
    commitFiles(f.repo, changed, 'two large changed documents');
    const killedHost = new FakeKnowledgeHost(new FakeAgentHost(), { chunks: (plan) => ({ 1: perDocumentChunks(plan)[1] }) });
    const killed = await onboard(f, killedHost, failRecording('index:knowledge'));
    assert.equal(killed.outcome.ok, false, 'the refresh was cut short');
    assert.equal(stepOf(f.roots, killed.onboardingId, 'index:knowledge'), null, 'the step has no result');
    assert.equal(killedHost.calls.length, 1);
    const firstDocument = pathsOf(killedHost.plans[0]);
    assert.equal(firstDocument.length, 2);

    // Resumed: only the document of the chunk that was not written goes to the model.
    const resumedHost = freshHost();
    const resumed = await onboard(f, resumedHost, undefined, killed.onboardingId);
    assert.ok(resumed.outcome.ok);
    assert.equal(resumed.outcome.value.state, 'active', resumed.outcome.value.message ?? '');
    assert.equal(resumedHost.calls.length, 1);
    const remaining = pathsOf(resumedHost.plans[0]);
    assert.equal(remaining.length, 1, 'one document is left to extract');
    assert.equal(firstDocument.includes(remaining[0] as string), true);
    const written = pathsOf({ ...(killedHost.plans[0] as ExtractionPlan), chunks: (killedHost.plans[0] as ExtractionPlan).chunks.slice(0, 1) });
    assert.deepEqual(written.concat(remaining).sort(), firstDocument, 'the document the killed attempt extracted is not extracted again');

    const step = stepOf<KnowledgeStep>(f.roots, killed.onboardingId, 'index:knowledge');
    assert.equal(step?.status, 'present', step?.reason ?? '');
    assert.deepEqual([...(step?.result?.refresh?.changed ?? [])].sort(), firstDocument);

    // The two repositories are two scratch repositories, so their commits differ: the revision a node cites is left out, the rest is compared.
    const derived = new Set(['community', 'community_name', 'source_revision']);
    const key = (value: Json): string => JSON.stringify(Object.entries(value).filter(([k]) => !derived.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));
    const expected = graphOf(uninterrupted.staging);
    const actual = graphOf(resumed.staging);
    assert.deepEqual(actual.nodes.map(key).sort(), expected.nodes.map(key).sort(), 'the node lists are equal');
    assert.deepEqual(actual.links.map(key).sort(), expected.links.map(key).sort(), 'the edge lists are equal');
  });
});
