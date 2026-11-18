// Plan 04-35, owner ruling 2 (2026-11-18, "A"): the knowledge corpus is capped by cost. One knowledge invocation has to fit its per-invocation cost cap, so the
// corpus keeps the documents of the existing priority order (map, planning documents, ADRs, documents, GSD phase files) up to a chunk limit derived from that cap,
// and says what it left out. Pure: paths and sizes arrive as arguments.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE_COST, knowledgeCandidates, knowledgeChunkLimit, selectKnowledgeCorpus } from '../../src/domain/knowledge-corpus.ts';
import type { KnowledgeCorpusInput, KnowledgeManifest } from '../../src/domain/knowledge-corpus.ts';
import { CHUNK_LIMITS, planExtractionChunks } from '../../src/domain/knowledge-extraction.ts';

const PIN = 'a'.repeat(40);
const ROOT = '/w/onb_X/staging/.avarice-knowledge';
const MAP = ['STACK', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'INTEGRATIONS', 'CONCERNS'].map((n) => `.planning/codebase/${n}.md`);
const DOC_GLOBS = ['docs/**/*.md'];
// A document of 40 KiB is a chunk of its own (a chunk holds at most 64 KiB).
const LARGE = 40 * 1024;
// The portfolio corpus of the AC-14 run was 53 chunks: with these documents that is 52 phase files.
const PORTFOLIO_PHASES = 52;

// A repository shaped like the portfolio of the AC-14 run: a map, the planning documents, two ADRs, a few documents and `phaseFiles` GSD phase files that are
// each a chunk of their own.
function corpus(phaseFiles: number): { input: Omit<KnowledgeCorpusInput, 'limits'>; priority: string[] } {
  const phases = Array.from({ length: phaseFiles }, (_, i) => `.planning/phases/${String(i + 1).padStart(2, '0')}-x/${String(i + 1).padStart(2, '0')}-01-PLAN.md`);
  const tracked = ['.planning/PROJECT.md', '.planning/REQUIREMENTS.md', '.planning/ROADMAP.md', '.planning/STATE.md', 'docs/decisions/ADR-001.md', 'docs/decisions/ADR-002.md', 'docs/guide.md', 'docs/usage.md', ...phases];
  const sizes: Record<string, number> = {};
  for (const path of [...MAP, ...tracked]) sizes[path] = 1000;
  for (const path of phases) sizes[path] = LARGE;
  const input = { trackedPaths: tracked, sizes, mapFiles: MAP, adrDirs: ['docs/decisions'], documentGlobs: DOC_GLOBS };
  return { input, priority: knowledgeCandidates(input) };
}

function manifestOf(paths: readonly string[]): KnowledgeManifest {
  return { schema: 1, revision: `git:${PIN}`, entries: paths.map((p) => ({ copyPath: `.avarice-knowledge/${p}`, sourcePath: p, revision: `git:${PIN}`, sha256: 'f'.repeat(64) })), excluded: [] };
}

// The chunks the stage plans for `paths`: the planner the invocation uses.
const chunksOf = (paths: readonly string[], sizes: Readonly<Record<string, number>>): number => planExtractionChunks(manifestOf(paths), sizes, ROOT).chunks.length;

describe('knowledgeChunkLimit: the chunks one knowledge invocation fits under its cost cap (ruling 2, option A)', () => {
  it('states the measured cost of a chunk and the share of the cap the corpus may plan for', () => {
    // The measured run (portfolio, 2026-11-18): one session read and wrote 6 chunks for 0.30 USD, its setup included.
    assert.equal(KNOWLEDGE_COST.chunkUsd, 0.05, '0.30 USD over 6 chunks');
    assert.equal(KNOWLEDGE_COST.capShare, 0.75);
  });

  it('is floor(cap x share / cost of a chunk): 12 chunks at the 0.8 USD cap of the AC-14 authorization', () => {
    assert.equal(knowledgeChunkLimit(0.8), 12);
  });

  it('grows with the cap: a cap of 1.6 USD fits twice the chunks, and the 3.0 USD default of the onboarding contract 45', () => {
    assert.equal(knowledgeChunkLimit(1.6), 24);
    assert.equal(knowledgeChunkLimit(3), 45);
    assert.ok(knowledgeChunkLimit(1.6) > knowledgeChunkLimit(0.8));
  });

  it('is at least one chunk for any positive cap, so a small cap still reads the map', () => {
    assert.equal(knowledgeChunkLimit(0.01), 1);
    assert.equal(knowledgeChunkLimit(0.05), 1);
  });
});

describe('selectKnowledgeCorpus with a chunk limit: the corpus that fits one invocation', () => {
  it('a 53-chunk corpus at the 0.8 USD cap keeps the top-priority documents that fit 12 chunks, in priority order, and drops the rest as cost-cap', () => {
    const { input, priority } = corpus(PORTFOLIO_PHASES);
    assert.equal(chunksOf(priority, input.sizes), 53, 'the whole corpus is 53 chunks (the map and the documents are three)');
    const limit = knowledgeChunkLimit(0.8);
    const picked = selectKnowledgeCorpus({ ...input, limits: { maxChunks: limit } });

    assert.ok(chunksOf(picked.paths, input.sizes) <= limit, 'the kept documents plan to no more chunks than the limit');
    // The kept documents are a prefix of the priority order: the map, the planning documents, the ADRs and the documents come before every phase file.
    const prefix = priority.slice(0, picked.paths.length);
    assert.deepEqual(picked.paths, [...prefix].sort());
    assert.ok(picked.paths.length > 0 && picked.paths.length < priority.length);
    assert.equal(chunksOf(priority.slice(0, picked.paths.length + 1), input.sizes) > limit, true, 'one more document would pass the limit');
    for (const path of [...MAP, '.planning/PROJECT.md', '.planning/REQUIREMENTS.md', '.planning/ROADMAP.md', 'docs/decisions/ADR-001.md', 'docs/decisions/ADR-002.md', 'docs/guide.md', 'docs/usage.md']) assert.ok(picked.paths.includes(path), `${path} is kept`);

    const omitted = picked.dropped.filter((d) => d.reason === 'cost-cap');
    assert.deepEqual(omitted.map((d) => d.path), priority.slice(picked.paths.length), 'the omitted documents are the rest of the priority order, in that order');
    assert.equal(omitted.length + picked.paths.length, priority.length, 'every candidate is either kept or omitted');
    assert.equal(picked.dropped.length, omitted.length, 'nothing else was dropped');
  });

  it('puts STATE.md and the phase files last: the phase files are what a small cap gives up first', () => {
    const { input } = corpus(PORTFOLIO_PHASES);
    const picked = selectKnowledgeCorpus({ ...input, limits: { maxChunks: 6 } });
    assert.ok(picked.paths.includes('docs/guide.md'));
    assert.ok(picked.dropped.some((d) => d.path === '.planning/phases/52-x/52-01-PLAN.md' && d.reason === 'cost-cap'));
    const phases = picked.paths.filter((p) => p.startsWith('.planning/phases/'));
    assert.ok(phases.length > 0 && phases.length <= 6, `${phases.length} phase files fit 6 chunks beside the documents`);
    assert.deepEqual(phases, corpus(PORTFOLIO_PHASES).priority.filter((p) => p.startsWith('.planning/phases/')).slice(0, phases.length).sort(), 'the first phase files of the priority order');
  });

  it('a corpus under the limit is identical to the corpus with no limit', () => {
    const { input } = corpus(3);
    const unlimited = selectKnowledgeCorpus({ ...input });
    const limited = selectKnowledgeCorpus({ ...input, limits: { maxChunks: knowledgeChunkLimit(0.8) } });
    assert.deepEqual(limited, unlimited);
    assert.equal(limited.dropped.some((d) => d.reason === 'cost-cap'), false);
  });

  it('a higher cap keeps more, and everything the lower cap kept', () => {
    const { input } = corpus(PORTFOLIO_PHASES);
    const low =selectKnowledgeCorpus({ ...input, limits: { maxChunks: knowledgeChunkLimit(0.8) } });
    const high = selectKnowledgeCorpus({ ...input, limits: { maxChunks: knowledgeChunkLimit(1.6) } });
    assert.ok(high.paths.length > low.paths.length);
    for (const path of low.paths) assert.ok(high.paths.includes(path), `${path} stays when the cap rises`);
    assert.ok(chunksOf(high.paths, input.sizes) <= knowledgeChunkLimit(1.6));
  });

  it('a limit the corpus never reaches changes nothing, and so does no limit at all', () => {
    const { input } = corpus(PORTFOLIO_PHASES);
    const none =selectKnowledgeCorpus({ ...input });
    const huge = selectKnowledgeCorpus({ ...input, limits: { maxChunks: 1000 } });
    assert.deepEqual(huge, none);
  });

  it('keeps the other reasons for the documents the cap does not decide: too large, secret and missing stay what they were', () => {
    const { input } = corpus(PORTFOLIO_PHASES);
    const sizes ={ ...input.sizes, 'docs/usage.md': 300 * 1024 };
    const picked = selectKnowledgeCorpus({ ...input, sizes, limits: { maxChunks: 12 } });
    assert.deepEqual(picked.dropped.find((d) => d.path === 'docs/usage.md'), { path: 'docs/usage.md', reason: 'too-large' });
  });

  it('the limit counts what the planner builds: the same documents the chunk size rules pack more tightly fit more of them', () => {
    // 100 documents of 1000 bytes: eight to a chunk, so 13 chunks; a limit of 12 keeps 96 of them.
    const paths = Array.from({ length: 100 }, (_, i) => `docs/n${String(i).padStart(3, '0')}.md`);
    const sizes = Object.fromEntries(paths.map((p) => [p, 1000]));
    const picked = selectKnowledgeCorpus({ trackedPaths: paths, sizes, mapFiles: [], adrDirs: [], documentGlobs: DOC_GLOBS, limits: { maxChunks: 12 } });
    assert.equal(picked.paths.length, 12 * CHUNK_LIMITS.maxFiles);
    assert.equal(picked.dropped.length, 4);
    assert.ok(picked.dropped.every((d) => d.reason === 'cost-cap'));
  });
});
