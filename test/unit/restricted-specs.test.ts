// The GSD specs a restricted fast map needs (plan 04-34, owner ruling (a) after the second D-04 stop): the restricted host confines the file tools to the
// working directory, so AVARICE stages the specs into the staging copy. This is the pure part: the seeds, how a file names the files it references, and the
// closure of those references with its caps. No file is read here; a map stands in for the gsd-core directory.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPEC_BYTES, MAX_SPEC_FILES, RESTRICTED_SPEC_DIR, RESTRICTED_SPEC_SEEDS, specClosure, specReferences } from '../../src/domain/restricted-specs.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';

const reader = (files: Record<string, string>) => (rel: string): Result<string | null> => ok(files[rel] ?? null);

describe('the staged spec directory and its seeds', () => {
  it('stages under .claude/gsd-core, where the map skill looks first for a project-local spec', () => {
    assert.equal(RESTRICTED_SPEC_DIR, '.claude/gsd-core');
  });

  it('seeds the map workflow, the fast scan workflow and the reference the mapper agent loads', () => {
    assert.deepEqual([...RESTRICTED_SPEC_SEEDS], ['workflows/map-codebase.md', 'workflows/scan.md', 'references/agent-skills-bootstrap.md']);
  });
});

describe('specReferences', () => {
  it('finds a file named by an @ reference, a home-directory path, a $HOME path or a bare gsd-core path, by its path under gsd-core', () => {
    const text = [
      '@~/.claude/gsd-core/references/a.md',
      'read $HOME/.claude/gsd-core/workflows/b.md first',
      'see @gsd-core/references/c.md and gsd-core/templates/codebase/d.md.',
    ].join('\n');
    assert.deepEqual(specReferences(text), ['references/a.md', 'references/c.md', 'templates/codebase/d.md', 'workflows/b.md']);
  });

  it('lists each file once, sorted', () => {
    assert.deepEqual(specReferences('gsd-core/references/z.md gsd-core/references/a.md gsd-core/references/z.md'), ['references/a.md', 'references/z.md']);
  });

  it('ignores a path that leaves its directory, a file that is not Markdown and a directory gsd-core does not stage from', () => {
    const text = 'gsd-core/references/../../etc/x.md gsd-core/bin/gsd-tools.cjs gsd-core/agents/y.md gsd-core/references//z.md gsd-core/references/.hidden.md';
    assert.deepEqual(specReferences(text), []);
  });
});

describe('specClosure', () => {
  it('returns the seeds and every file they name, transitively, each once, in a stable order', () => {
    const files = {
      'workflows/map-codebase.md': 'gsd-core/references/a.md and gsd-core/references/b.md',
      'workflows/scan.md': 'gsd-core/references/a.md',
      'references/a.md': 'gsd-core/references/c.md',
      'references/b.md': 'gsd-core/workflows/map-codebase.md',
      'references/c.md': 'nothing more',
    };
    const closure = specClosure(['workflows/map-codebase.md', 'workflows/scan.md'], reader(files));
    assert.ok(closure.ok, JSON.stringify(closure));
    assert.deepEqual(closure.value.map((f) => f.path), ['references/a.md', 'references/b.md', 'references/c.md', 'workflows/map-codebase.md', 'workflows/scan.md']);
    assert.equal(closure.value.find((f) => f.path === 'references/c.md')?.text, 'nothing more');
  });

  it('skips a referenced file that is absent (a reference in prose) but refuses a seed that is absent', () => {
    const present = specClosure(['workflows/scan.md'], reader({ 'workflows/scan.md': 'gsd-core/references/missing.md' }));
    assert.ok(present.ok);
    assert.deepEqual(present.value.map((f) => f.path), ['workflows/scan.md']);
    const absent = specClosure(['workflows/scan.md', 'workflows/map-codebase.md'], reader({ 'workflows/scan.md': 'x' }));
    assert.ok(!absent.ok);
    assert.equal(absent.error.kind, 'not_found');
  });

  it('refuses a closure of more than the file cap, and names nothing partial', () => {
    const files: Record<string, string> = { 'workflows/scan.md': Array.from({ length: MAX_SPEC_FILES + 1 }, (_, i) => `gsd-core/references/r${String(i)}.md`).join(' ') };
    for (let i = 0; i <= MAX_SPEC_FILES; i++) files[`references/r${String(i)}.md`] = 'x';
    const closure = specClosure(['workflows/scan.md'], reader(files));
    assert.ok(!closure.ok);
    assert.equal(closure.error.kind, 'invalid');
  });

  it('refuses a closure of more than the byte cap', () => {
    const closure = specClosure(['workflows/scan.md'], reader({ 'workflows/scan.md': 'x'.repeat(MAX_SPEC_BYTES + 1) }));
    assert.ok(!closure.ok);
    assert.equal(closure.error.kind, 'invalid');
  });

  it('passes a read failure on up unchanged', () => {
    const closure = specClosure(['workflows/scan.md'], () => ({ ok: false, error: { kind: 'denied', rule: 'staging-reads-stay-inside-staging', enforcer: 'avarice' } }));
    assert.ok(!closure.ok);
    assert.equal(closure.error.kind, 'denied');
  });
});
