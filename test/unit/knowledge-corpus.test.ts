// Plan 01-18 Task 1: which documents the knowledge pass may read (selectKnowledgeCorpus) and how they are copied into
// the corpus directory with a manifest (materializeCorpus). Temp directories only.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { sha256Hex } from '../../src/domain/digest.ts';
import { CORPUS_LIMITS, corpusSummary, knowledgeCandidates, selectKnowledgeCorpus } from '../../src/domain/knowledge-corpus.ts';
import type { KnowledgeManifest } from '../../src/domain/knowledge-corpus.ts';
import { fileSizes, materializeCorpus } from '../../src/adapters/graph/knowledge-corpus.ts';

const PIN = 'a'.repeat(40);
const MAP = ['STACK', 'ARCHITECTURE', 'STRUCTURE', 'CONVENTIONS', 'TESTING', 'INTEGRATIONS', 'CONCERNS'].map((n) => `.planning/codebase/${n}.md`);
const DEFAULT_GLOBS = ['docs/**/*.md', 'docs/decisions/**/*.md'];
const SECRET_GLOBS = ['**/*.key', '**/*.pem', '**/.env', '**/.env.*'];

const roots: string[] = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-corpus-')));
  roots.push(dir);
  return dir;
}

function put(root: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full));
  }
  return out.sort();
}

describe('selectKnowledgeCorpus (ONB-14, S-45 corpus rule)', () => {
  const tracked = [
    '.planning/PROJECT.md',
    '.planning/STATE.md',
    '.planning/phases/01-x/01-01-PLAN.md',
    'docs/decisions/ADR-001-storage.md',
    'docs/guide.md',
    'docs/big.md',
    '.env.example',
    'src/index.ts',
  ];
  const sizes: Record<string, number> = { ...Object.fromEntries(MAP.map((p) => [p, 1000])), '.planning/PROJECT.md': 200, 'docs/decisions/ADR-001-storage.md': 300, 'docs/guide.md': 400, 'docs/big.md': 300 * 1024 };

  it('takes the map, PROJECT.md, the ADR and the documents; leaves STATE.md, the phase plan, the oversized file and .env.example out', () => {
    const picked = selectKnowledgeCorpus({ trackedPaths: tracked, sizes, mapFiles: MAP, adrDirs: ['docs/decisions'], documentGlobs: DEFAULT_GLOBS, secretGlobs: SECRET_GLOBS });
    assert.deepEqual(picked.paths, [...MAP, '.planning/PROJECT.md', 'docs/decisions/ADR-001-storage.md', 'docs/guide.md'].sort());
    assert.deepEqual(picked.dropped, [{ path: 'docs/big.md', reason: 'too-large' }]);
    for (const absent of ['.planning/STATE.md', '.planning/phases/01-x/01-01-PLAN.md', 'docs/big.md', '.env.example', 'src/index.ts']) {
      assert.equal(picked.paths.includes(absent), false, `${absent} is not in the corpus`);
    }
  });

  it('refuses a phase file and STATE.md even when a document glob names them, and says why', () => {
    const picked = selectKnowledgeCorpus({
      trackedPaths: tracked,
      sizes: { ...sizes, '.planning/STATE.md': 10, '.planning/phases/01-x/01-01-PLAN.md': 10 },
      mapFiles: [],
      adrDirs: [],
      documentGlobs: ['**/*.md'],
      secretGlobs: SECRET_GLOBS,
    });
    assert.equal(picked.paths.includes('.planning/STATE.md'), false);
    assert.equal(picked.paths.includes('.planning/phases/01-x/01-01-PLAN.md'), false);
    assert.deepEqual(picked.dropped.filter((d) => d.reason === 'phase-file' || d.reason === 'state-file').map((d) => `${d.path}:${d.reason}`).sort(), [
      '.planning/STATE.md:state-file',
      '.planning/phases/01-x/01-01-PLAN.md:phase-file',
    ]);
  });

  it('drops a secret-bearing path, an oversized file and a file that is not there, each with its reason', () => {
    const picked = selectKnowledgeCorpus({
      trackedPaths: ['docs/.env.local', 'docs/ok.md', 'docs/huge.md', 'docs/gone.md'],
      sizes: { 'docs/.env.local': 5, 'docs/ok.md': 5, 'docs/huge.md': CORPUS_LIMITS.maxFileBytes + 1 },
      mapFiles: [],
      adrDirs: [],
      documentGlobs: ['docs/**'],
      secretGlobs: SECRET_GLOBS,
    });
    assert.deepEqual(picked.paths, ['docs/ok.md']);
    assert.deepEqual(
      picked.dropped.map((d) => `${d.path}:${d.reason}`).sort(),
      ['docs/.env.local:secret-path', 'docs/gone.md:missing', 'docs/huge.md:too-large'],
    );
    // The cap is the size limit itself: a file of exactly that size stays.
    const edge = selectKnowledgeCorpus({ trackedPaths: ['docs/edge.md'], sizes: { 'docs/edge.md': CORPUS_LIMITS.maxFileBytes }, mapFiles: [], adrDirs: [], documentGlobs: ['docs/**/*.md'] });
    assert.deepEqual(edge.paths, ['docs/edge.md']);
  });

  it('caps the corpus at 200 files, keeps the map, planning documents and ADRs first, and records what it dropped', () => {
    const docs = Array.from({ length: 250 }, (_, i) => `docs/d${String(i).padStart(3, '0')}.md`);
    const adr = Array.from({ length: 5 }, (_, i) => `docs/decisions/ADR-00${i}.md`);
    const all = [...docs, ...adr, '.planning/PROJECT.md'];
    const picked = selectKnowledgeCorpus({
      trackedPaths: all,
      sizes: Object.fromEntries([...all, ...MAP].map((p) => [p, 100])),
      mapFiles: MAP,
      adrDirs: ['docs/decisions'],
      documentGlobs: ['docs/**/*.md'],
    });
    assert.equal(picked.paths.length, 200);
    for (const must of [...MAP, '.planning/PROJECT.md', ...adr]) assert.ok(picked.paths.includes(must), `${must} survives the cap`);
    const capped = picked.dropped.filter((d) => d.reason === 'cap');
    assert.equal(capped.length, 250 + 5 + 1 + 7 - 200);
    // The lowest-priority documents go: the highest-numbered plain documents.
    assert.ok(capped.some((d) => d.path === 'docs/d249.md'));
    assert.equal(picked.paths.includes('docs/d249.md'), false);
    assert.deepEqual([...picked.paths], [...picked.paths].sort(), 'the result is sorted');
  });

  it('adds PROJECT.md, REQUIREMENTS.md and ROADMAP.md only when the repository tracks them, and only Markdown under an ADR directory', () => {
    const candidates = knowledgeCandidates({
      trackedPaths: ['.planning/ROADMAP.md', 'adr/0001-x.md', 'adr/diagram.png', 'adr/sub/0002-y.md', 'docs/guide.md'],
      mapFiles: [],
      adrDirs: ['adr'],
      documentGlobs: ['docs/**/*.md'],
    });
    assert.deepEqual(candidates, ['.planning/ROADMAP.md', 'adr/0001-x.md', 'adr/sub/0002-y.md', 'docs/guide.md']);
    assert.deepEqual(corpusSummary([...MAP, '.planning/PROJECT.md', 'docs/decisions/ADR-001.md', 'docs/decisions/ADR-002.md', 'docs/guide.md', 'README.md']), [
      '.planning/PROJECT.md',
      '.planning/codebase/',
      'README.md',
      'docs/',
      'docs/decisions/',
    ]);
  });
});

describe('materializeCorpus: the copy, the .graphifyignore and the manifest', () => {
  it('copies each file to the corpus directory at its repository-relative path and writes only the copies and .graphifyignore into it', () => {
    const staging = scratch();
    const data = scratch();
    put(staging, { 'docs/guide.md': '# guide\n', 'docs/decisions/ADR-001.md': '# adr\n', '.planning/PROJECT.md': '# p\n', 'src/index.ts': 'x\n' });
    const manifestFile = join(data, 'onboard', 'onb_1', 'knowledge', 'manifest.json');
    const done = materializeCorpus(staging, ['docs/guide.md', 'docs/decisions/ADR-001.md', '.planning/PROJECT.md'], manifestFile, PIN);
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepEqual(walk(join(staging, '.avarice-knowledge')), ['.graphifyignore', '.planning/PROJECT.md', 'docs/decisions/ADR-001.md', 'docs/guide.md']);
    assert.equal(readFileSync(join(staging, '.avarice-knowledge', 'docs', 'guide.md'), 'utf8'), '# guide\n');
    assert.match(readFileSync(join(staging, '.avarice-knowledge', '.graphifyignore'), 'utf8'), /^graphify-out\/$/m);
    assert.equal(existsSync(join(staging, 'src', 'index.ts')), true, 'the source tree is untouched');
  });

  it('writes the manifest with the copy path, source path, revision and SHA-256 of each file, mode 0600, outside the corpus', () => {
    const staging = scratch();
    const data = scratch();
    put(staging, { 'docs/guide.md': '# guide\n', 'docs/decisions/ADR-001.md': '# adr\n' });
    const manifestFile = join(data, 'onboard', 'onb_1', 'knowledge', 'manifest.json');
    const done = materializeCorpus(staging, ['docs/decisions/ADR-001.md', 'docs/guide.md'], manifestFile, PIN, [{ path: 'docs/big.md', reason: 'too-large' }]);
    assert.ok(done.ok);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as KnowledgeManifest;
    assert.deepEqual(done.value.manifest, manifest);
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.revision, `git:${PIN}`);
    assert.deepEqual(manifest.entries, [
      { copyPath: '.avarice-knowledge/docs/decisions/ADR-001.md', sourcePath: 'docs/decisions/ADR-001.md', revision: `git:${PIN}`, sha256: sha256Hex('# adr\n') },
      { copyPath: '.avarice-knowledge/docs/guide.md', sourcePath: 'docs/guide.md', revision: `git:${PIN}`, sha256: sha256Hex('# guide\n') },
    ]);
    assert.deepEqual(manifest.excluded, [{ path: 'docs/big.md', reason: 'too-large' }]);
    assert.equal(lstatSync(manifestFile).mode & 0o777, 0o600);
    assert.equal(manifestFile.startsWith(staging), false, 'the manifest is not in staging');
    assert.equal(walk(join(staging, '.avarice-knowledge')).some((p) => p.includes('manifest')), false, 'and not in the corpus');
  });

  it('replaces a corpus left by an earlier attempt, including its graphify-out, and leaves a file that holds a secret out', () => {
    const staging = scratch();
    const data = scratch();
    put(staging, {
      'docs/ok.md': '# ok\n',
      'docs/leak.md': `# leak\n\nkey: ghp_${'a'.repeat(36)}\n`,
      '.avarice-knowledge/stale.md': 'stale\n',
      '.avarice-knowledge/graphify-out/graph.json': '{"nodes":[],"links":[]}',
    });
    const done = materializeCorpus(staging, ['docs/ok.md', 'docs/leak.md'], join(data, 'm.json'), PIN);
    assert.ok(done.ok);
    assert.deepEqual(walk(join(staging, '.avarice-knowledge')), ['.graphifyignore', 'docs/ok.md']);
    assert.deepEqual(done.value.manifest.entries.map((e) => e.sourcePath), ['docs/ok.md']);
    assert.deepEqual(done.value.manifest.excluded, [{ path: 'docs/leak.md', reason: 'secret-content' }]);
  });

  it('never copies through a symlink, and refuses a path outside the staging tree', () => {
    const staging = scratch();
    const outside = scratch();
    const data = scratch();
    put(staging, { 'docs/ok.md': '# ok\n' });
    put(outside, { 'secret.md': '# outside\n' });
    mkdirSync(join(staging, 'docs'), { recursive: true });
    symlinkSync(join(outside, 'secret.md'), join(staging, 'docs', 'link.md'));
    const done = materializeCorpus(staging, ['docs/ok.md', 'docs/link.md'], join(data, 'm.json'), PIN);
    assert.ok(done.ok);
    assert.deepEqual(walk(join(staging, '.avarice-knowledge')), ['.graphifyignore', 'docs/ok.md']);
    assert.deepEqual(done.value.manifest.excluded, [{ path: 'docs/link.md', reason: 'missing' }]);
    for (const bad of ['../outside.md', '/etc/passwd', 'docs/../../x.md']) {
      const refused = materializeCorpus(staging, [bad], join(data, 'm2.json'), PIN);
      assert.equal(refused.ok, false, `${bad} is refused`);
    }
    assert.equal(materializeCorpus(staging, ['docs/ok.md'], join(data, 'm3.json'), 'not-a-sha').ok, false, 'a full commit is required');
  });

  it('reports the size of the regular files only (fileSizes)', () => {
    const staging = scratch();
    const outside = scratch();
    put(staging, { 'docs/a.md': 'abcd', 'docs/é.md': 'éé' });
    put(outside, { 'x.md': 'x' });
    symlinkSync(join(outside, 'x.md'), join(staging, 'docs', 'l.md'));
    const sizes = fileSizes(staging, ['docs/a.md', 'docs/é.md', 'docs/l.md', 'docs/none.md']);
    assert.ok(sizes.ok);
    assert.deepEqual(sizes.value, { 'docs/a.md': 4, 'docs/é.md': 4 });
  });
});
