// Plan 04-35, owner ruling 2 (2026-11-18, "A"): the knowledge corpus is capped by the cost of one invocation. The stage derives the chunk limit from the
// onboarding contract's per-invocation cost cap, keeps the documents of the priority order that fit it, records the omission in the step, and keeps the manifest
// (and its digest) to exactly the documents sent. Plan 04-17's incremental refresh works over the capped set. A fake graphify, the fake knowledge host (one
// extraction per document, no model), real gsd-core and a scratch repository with a committed map.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { knowledgeChunkLimit } from '../../src/domain/knowledge-corpus.ts';
import type { KnowledgeManifest } from '../../src/domain/knowledge-corpus.ts';
import type { ExtractionPlan } from '../../src/domain/knowledge-extraction.ts';
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

// A 40 KiB document is a chunk of its own (a chunk holds at most 64 KiB).
const BIG = (title: string): string => `# ${title}\n\n${'A sentence of the document that makes it large enough for a chunk of its own.\n'.repeat(500)}`;
const GUIDE = '# Guide\n\nRun the tool with `avarice onboard`.\n';
const ADR = '# ADR-001: Storage\n\nStatus: accepted\n\nWe store state in SQLite.\n';
const PHASES = [1, 2, 3, 4, 5, 6].map((n) => `.planning/phases/0${n}-x/0${n}-01-PLAN.md`);
const SOURCE_DOCS: Readonly<Record<string, string>> = {
  'docs/guide.md': GUIDE,
  'docs/decisions/ADR-001-storage.md': ADR,
  '.planning/STATE.md': '---\nstatus: executing\n---\n# State\n',
  ...Object.fromEntries(PHASES.map((path, i) => [path, BIG(`Plan ${i + 1}`)])),
};
// The per-invocation cost cap of the onboardings below: a limit of three chunks (knowledgeChunkLimit(0.2) = floor((0.2 x 2/3 / 0.0255)^(1/1.376)) = 3).
const CAP_USD = 0.2;
const LIMIT = knowledgeChunkLimit(CAP_USD);

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface KnowledgeStep {
  status: string;
  reason?: string;
  result?: {
    knowledge: { documentNodes: number; documentsExpected: number; manifestDigest: string; corpusCap?: { perInvocationCapUsd: number; chunkLimit: number; chunks: number; documentsKept: number; documentsOmitted: number; omitted: string[] } };
    refresh?: { mode: string; changed?: string[]; cacheHits?: number };
  };
}

function stepOf(roots: CliRoots, onboardingId: string): KnowledgeStep | null {
  const [row] = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE onboarding_id = ? AND step = 'index:knowledge' ORDER BY attempt DESC", onboardingId);
  return row === undefined ? null : (JSON.parse(row.result_json) as KnowledgeStep);
}

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

interface Fixture {
  roots: CliRoots;
  repo: StampedMapRepo;
  graphify: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeStampedMapRepo({ sourceFiles: SOURCE_DOCS });
  const dir = mkdtempSync(join(tmpdir(), 'avarice-fake-graphify-'));
  cleanup.push(roots.base, repo.base, dir);
  return { roots, repo, graphify: writeFakeGraphify(dir, 'ok') };
}

async function onboard(f: Fixture, capUsd: number, host: FakeKnowledgeHost) {
  const env = { ...process.env, AVARICE_CONFIG_HOME: f.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: f.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: f.roots.AVARICE_WORK_ROOT, AVARICE_GRAPHIFY_BIN: f.graphify };
  const composed = createDeps(env, { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: f.repo.path, policy: 'onboarding', budgetOverrides: { costUsdPerInvocation: capUsd } });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok);
    return { outcome: outcome.value, onboardingId: started.value.onboardingId };
  } finally {
    composed.value.close();
  }
}

const freshHost = (): FakeKnowledgeHost => new FakeKnowledgeHost(new FakeAgentHost(), { chunks: (plan) => perDocumentChunks(plan) });

function commitFiles(repo: StampedMapRepo, files: Readonly<Record<string, string>>, message: string): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(repo.path, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo.path, ['add', '-A']);
  git(repo.path, ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);
}

const manifestExists = (roots: CliRoots, onboardingId: string): boolean => existsSync(join(roots.AVARICE_DATA_ROOT, 'onboard', onboardingId, 'knowledge', 'manifest.json'));

const manifestOf = (roots: CliRoots, onboardingId: string, name = 'manifest.json'): { text: string; manifest: KnowledgeManifest } => {
  const text = readFileSync(join(roots.AVARICE_DATA_ROOT, 'onboard', onboardingId, 'knowledge', name), 'utf8');
  return { text, manifest: JSON.parse(text) as KnowledgeManifest };
};

describe('the knowledge corpus is capped by the cost of one invocation (ruling 2, option A)', () => {
  it('hands the model only the documents that fit the limit, in priority order, and records what the cap left out', async () => {
    const f = fixture();
    const host = freshHost();
    const run = await onboard(f, CAP_USD, host);
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    assert.equal(host.calls.length, 1, 'one knowledge invocation');
    assert.equal(host.calls[0]?.costCapUsd, CAP_USD, 'under the per-invocation cap the limit was derived from');

    const plan = host.plans[0] as ExtractionPlan;
    assert.ok(plan.chunks.length <= LIMIT, `the plan has ${plan.chunks.length} chunks, at most ${LIMIT}`);
    const sent = pathsOf(plan);
    // The documents come before the phase files: the guide, the ADR and STATE.md are kept (a prefix of the priority order), and the later phase files are not.
    assert.ok(sent.includes('docs/guide.md') && sent.includes('docs/decisions/ADR-001-storage.md'));
    assert.equal(sent.includes(PHASES[5] as string), false, 'the last phase file did not fit');

    const step = stepOf(f.roots, run.onboardingId);
    assert.equal(step?.status, 'present', step?.reason ?? '');
    const cap = step?.result?.knowledge.corpusCap;
    assert.ok(cap, 'the step records the cap');
    assert.equal(cap.perInvocationCapUsd, CAP_USD);
    assert.equal(cap.chunkLimit, LIMIT);
    assert.equal(cap.documentsKept, sent.length);
    // The corpus before the cap: the seven map files, the guide, the ADR, STATE.md and the six phase files.
    assert.equal(cap.documentsKept + cap.documentsOmitted, 7 + 1 + 1 + 1 + PHASES.length, 'every document is either sent or counted as omitted');
    assert.ok(cap.documentsOmitted > 0);
    assert.ok(cap.omitted.length > 0, 'and which areas were left out');
    assert.equal(step?.result?.knowledge.documentsExpected, sent.length, 'the record expects the documents sent, not the documents left out');
  });

  it('keeps the manifest, and so its digest, to exactly what was sent: the left-out documents are in its excluded list as cost-cap', async () => {
    const f = fixture();
    const host = freshHost();
    const run = await onboard(f, CAP_USD, host);
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    const { text, manifest } = manifestOf(f.roots, run.onboardingId);
    assert.deepEqual(manifest.entries.map((e) => e.sourcePath).sort(), pathsOf(host.plans[0]));
    const omitted = manifest.excluded.filter((e) => e.reason === 'cost-cap').map((e) => e.path);
    assert.ok(omitted.length > 0);
    for (const path of omitted) assert.equal(pathsOf(host.plans[0]).includes(path), false, `${path} was not sent`);
    const step = stepOf(f.roots, run.onboardingId);
    assert.equal(step?.result?.knowledge.manifestDigest, `sha256:${sha256Hex(Buffer.from(text, 'utf8'))}`);
    assert.equal(step?.result?.knowledge.corpusCap?.documentsOmitted, omitted.length);
  });

  it('a cap that fits the corpus leaves the record as it was: no corpusCap and every document sent', async () => {
    const f = fixture();
    const host = freshHost();
    const run = await onboard(f, 3, host);
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    const step = stepOf(f.roots, run.onboardingId);
    assert.equal(step?.status, 'present', step?.reason ?? '');
    assert.equal(step?.result?.knowledge.corpusCap, undefined);
    assert.ok(pathsOf(host.plans[0]).includes(PHASES[5] as string), 'the last phase file is sent');
    assert.equal(manifestOf(f.roots, run.onboardingId).manifest.excluded.some((e) => e.reason === 'cost-cap'), false);
  });

  it('a higher cap keeps more documents', async () => {
    const low = fixture();
    const lowHost = freshHost();
    assert.equal((await onboard(low, CAP_USD, lowHost)).outcome.state, 'active');
    const high = fixture();
    const highHost = freshHost();
    assert.equal((await onboard(high, 0.4, highHost)).outcome.state, 'active');
    assert.ok(pathsOf(highHost.plans[0]).length > pathsOf(lowHost.plans[0]).length);
  });
});

describe('an onboarding with no cost cap left starts no knowledge invocation (WR-05, OPS-5, T-04-132)', () => {
  // The run's cost row is overrun before the pass, so the cap the knowledge invocation would be granted (the smaller of the contract's and what is left) is negative.
  async function onboardOverrun(f: Fixture, host: FakeKnowledgeHost) {
    const env = { ...process.env, AVARICE_CONFIG_HOME: f.roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: f.roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: f.roots.AVARICE_WORK_ROOT, AVARICE_GRAPHIFY_BIN: f.graphify };
    const composed = createDeps(env, { host });
    assert.ok(composed.ok, 'composition');
    try {
      const started = startOnboarding(composed.value.deps, { repoPath: f.repo.path, policy: 'onboarding', budgetOverrides: { costUsdPerInvocation: CAP_USD } });
      assert.ok(started.ok, JSON.stringify(started));
      const db = new DatabaseSync(join(f.roots.AVARICE_DATA_ROOT, 'state.db'));
      try {
        db.prepare("UPDATE budgets SET used = limit_value + 1 WHERE name = 'costUsd'").run();
      } finally {
        db.close();
      }
      const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
      assert.ok(outcome.ok);
      return { outcome: outcome.value, onboardingId: started.value.onboardingId };
    } finally {
      composed.value.close();
    }
  }

  it('starts no knowledge invocation, builds no corpus, and the knowledge index step names the budget', async () => {
    const f = fixture();
    const host = freshHost();
    const run = await onboardOverrun(f, host);
    assert.equal(host.calls.length, 0, 'the fake knowledge host was never called');
    const step = stepOf(f.roots, run.onboardingId);
    assert.equal(step?.status, 'absent', JSON.stringify(step));
    assert.equal(step?.reason, 'budget_exhausted');
    assert.equal(manifestExists(f.roots, run.onboardingId), false, 'no corpus manifest was written');
  });
});

describe('the incremental refresh over a capped corpus (plan 04-17, ONB-15)', () => {
  it('re-extracts only the changed documents among the kept ones; a changed document the cap left out stays out, and the others are cache hits', async () => {
    const f = fixture();
    const first = await onboard(f, CAP_USD, freshHost());
    assert.equal(first.outcome.state, 'active', first.outcome.message ?? '');
    const kept = manifestOf(f.roots, first.onboardingId).manifest.entries.map((e) => e.sourcePath).sort();
    const left = manifestOf(f.roots, first.onboardingId).manifest.excluded.filter((e) => e.reason === 'cost-cap').map((e) => e.path);
    assert.ok(kept.includes('docs/guide.md') && left.length > 0);

    commitFiles(f.repo, { 'docs/guide.md': `${GUIDE}\nIt also has a second command.\n`, [left[0] as string]: BIG('A left-out plan, changed') }, 'change a kept and a left-out document');
    const host = freshHost();
    const second = await onboard(f, CAP_USD, host);
    assert.equal(second.outcome.state, 'active', second.outcome.message ?? '');
    assert.deepEqual(pathsOf(host.plans[0]), ['docs/guide.md'], 'only the changed document among the kept ones goes to the model');

    const step = stepOf(f.roots, second.onboardingId);
    assert.equal(step?.status, 'present', step?.reason ?? '');
    assert.equal(step?.result?.refresh?.mode, 'incremental');
    assert.deepEqual(step?.result?.refresh?.changed, ['docs/guide.md']);
    assert.equal(step?.result?.refresh?.cacheHits, kept.length - 1);
    assert.equal(step?.result?.knowledge.documentsExpected, kept.length, 'the same documents are kept');
    assert.ok((step?.result?.knowledge.corpusCap?.documentsOmitted ?? 0) > 0, 'the omission is still recorded');
    assert.equal(manifestOf(f.roots, second.onboardingId).manifest.excluded.some((e) => e.path === left[0] && e.reason === 'cost-cap'), true);
  });
});
