// Full validation of a map artifact set (docs/repository-onboarding.md "Validation"): scope of writes, path
// references, secrets, size and structure, coverage label. Pure domain code: facts in, verdict out.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VALIDATION_LIMITS, validateMapArtifacts } from '../../src/domain/validation.ts';
import type { MapArtifactFacts, MapFileFact } from '../../src/domain/validation.ts';
import { FAST_MAP_FILES, FULL_MAP_FILES } from '../../src/domain/mapping.ts';
import { extractPathReferences, danglingShare } from '../../src/domain/path-references.ts';
import { AVARICE_SECRET_PATTERNS, GSD_SECRET_REGEX, findSecrets, redactSecrets } from '../../src/domain/secret-patterns.ts';

const HEAD = 'a'.repeat(40);
const TEMPLATE: Record<string, string[]> = {
  'STACK.md': ['Languages', 'Runtime', 'Frameworks', 'Key Dependencies', 'Configuration', 'Platform Requirements'],
  'ARCHITECTURE.md': ['Pattern Overview', 'Layers', 'Data Flow', 'Key Abstractions', 'Entry Points', 'Error Handling', 'Cross-Cutting Concerns'],
};

function doc(path: string, extra = ''): MapFileFact {
  const name = path.split('/').pop() ?? '';
  const text = ['---', `last_mapped_commit: ${HEAD}`, '---', '# Doc', '', ...(TEMPLATE[name] ?? []).map((h) => `## ${h}\n`), extra].join('\n');
  return { path, lastMappedCommit: HEAD, text, bytes: new TextEncoder().encode(text).length };
}

const KNOWN = ['package.json', 'src/index.ts', 'src/util/strings.ts', 'README.md'];

function facts(overrides: Partial<MapArtifactFacts> = {}, paths: readonly string[] = FULL_MAP_FILES): MapArtifactFacts {
  return {
    stagingHead: HEAD,
    files: paths.map((p) => doc(p)),
    changes: { modified: [], added: [], deleted: [] },
    allowedWrite: ['.planning/codebase/**', '.planning/config.json', '.planning/graphs/**', '.avarice-knowledge/**'],
    trackedWritable: ['.planning/config.json', '.planning/codebase/**'],
    knownPaths: KNOWN,
    ...overrides,
  };
}

const check = (v: ReturnType<typeof validateMapArtifacts>, name: string) => v.checks.find((c) => c.name === name);

describe('validateMapArtifacts: the checks run in order and all must hold', () => {
  it('accepts a clean, stamped, in-scope, secret-free, well-formed full map with seven passing checks', () => {
    const v = validateMapArtifacts(facts(), { mode: 'full' });
    assert.equal(v.accepted, true);
    assert.deepEqual(
      v.checks.map((c) => c.name),
      ['presence', 'stamp', 'scope-of-writes', 'path-references', 'secrets', 'size-and-structure', 'coverage'],
    );
    assert.ok(v.checks.every((c) => c.passed));
    assert.equal(v.block, false);
  });

  it('exposes the documented limits: 5% dangling references and 256 KiB', () => {
    assert.equal(VALIDATION_LIMITS.danglingShare, 0.05);
    assert.equal(VALIDATION_LIMITS.maxBytes, 262144);
  });
});

describe('scope of writes', () => {
  const run = (changes: Partial<MapArtifactFacts['changes']>) =>
    validateMapArtifacts(facts({ changes: { modified: [], added: [], deleted: [], ...changes } }), { mode: 'full' });

  it('fails an untracked file the agent had no write set for, and lists it', () => {
    const v = run({ added: ['src/evil.ts'] });
    assert.equal(v.accepted, false);
    assert.equal(check(v, 'scope-of-writes')?.passed, false);
    assert.deepEqual(v.scopeViolations, ['src/evil.ts']);
    assert.match(check(v, 'scope-of-writes')?.detail ?? '', /src\/evil\.ts/);
  });

  it('fails a modified tracked file outside the write sets', () => {
    const v = run({ modified: ['package.json'] });
    assert.equal(check(v, 'scope-of-writes')?.passed, false);
    assert.deepEqual(v.scopeViolations, ['package.json']);
  });

  it('fails a deleted tracked file', () => {
    const v = run({ deleted: ['src/index.ts'] });
    assert.equal(check(v, 'scope-of-writes')?.passed, false);
  });

  it('accepts a change to .planning/config.json, tracked or not', () => {
    assert.equal(check(run({ modified: ['.planning/config.json'] }), 'scope-of-writes')?.passed, true);
    assert.equal(check(run({ added: ['.planning/config.json'] }), 'scope-of-writes')?.passed, true);
  });

  it('accepts untracked files under the AVARICE write set and the map write set', () => {
    const v = run({ added: ['.planning/graphs/x.json', '.avarice-knowledge/manifest.json', '.planning/codebase/NOTES.md'] });
    assert.equal(check(v, 'scope-of-writes')?.passed, true);
  });

  it('fails an untracked file at the staging root', () => {
    const v = run({ added: ['newroot.txt'] });
    assert.equal(check(v, 'scope-of-writes')?.passed, false);
  });

  it('lets a Refresh regenerate a tracked map file inside the agent write set, but not a tracked file under the AVARICE-only set', () => {
    assert.equal(check(run({ modified: ['.planning/codebase/STACK.md'] }), 'scope-of-writes')?.passed, true);
    assert.equal(check(run({ modified: ['.planning/graphs/graph.json'] }), 'scope-of-writes')?.passed, false);
  });

  it('refuses a path that merely starts with an allowed directory name', () => {
    assert.equal(check(run({ added: ['.planning/codebase-evil/x.md'] }), 'scope-of-writes')?.passed, false);
    assert.equal(check(run({ added: ['.planning/configXjson'] }), 'scope-of-writes')?.passed, false);
  });
});

describe('path references', () => {
  const known = Array.from({ length: 30 }, (_, i) => `lib/f${String(i).padStart(2, '0')}.ts`);
  const refsLine = (paths: readonly string[]) => paths.map((p) => `- \`${p}\``).join('\n');
  const run = (paths: readonly string[]) =>
    validateMapArtifacts(
      facts({ files: FULL_MAP_FILES.map((p) => (p.endsWith('STRUCTURE.md') ? doc(p, refsLine(paths)) : doc(p))), knownPaths: known }),
      { mode: 'full' },
    );

  it('fails when 2 of 20 named paths do not exist at the pin (10%)', () => {
    const paths = [...known.slice(0, 18), 'lib/missing-a.ts', 'lib/missing-b.ts'];
    const v = run(paths);
    assert.equal(v.accepted, false);
    assert.equal(check(v, 'path-references')?.passed, false);
    assert.match(check(v, 'path-references')?.detail ?? '', /lib\/missing-a\.ts/);
  });

  it('passes with 1 of 20 dangling (5%)', () => {
    const v = run([...known.slice(0, 19), 'lib/missing-a.ts']);
    assert.equal(check(v, 'path-references')?.passed, true);
    assert.equal(v.accepted, true);
  });

  it('counts a directory that exists as resolved', () => {
    const v = run([...known.slice(0, 5), 'lib/', 'lib']);
    assert.equal(check(v, 'path-references')?.passed, true);
  });

  it('reads nothing as dangling when a document names no paths', () => {
    assert.equal(check(validateMapArtifacts(facts(), { mode: 'full' }), 'path-references')?.passed, true);
  });
});

describe('extractPathReferences and danglingShare', () => {
  it('reads backticked paths and bare paths with a slash and an extension, and ignores URLs, globs, MIME types, scopes and prose', () => {
    const md = [
      'See `src/app/main.ts` and src/domain/x.ts, also `docs/`.',
      'Link https://example.com/a/b.ts and `src/**/*.ts` and `application/json` and `@types/node` and and/or client/server.',
      'Config in `package.json`, written by Node.js and `Node.js`.',
      'Line ref `src/app/main.ts:42` and `src/app/main.ts#L10`.',
    ].join('\n');
    assert.deepEqual(extractPathReferences(md).sort(), ['docs', 'package.json', 'src/app/main.ts', 'src/domain/x.ts']);
  });

  it('skips fenced code blocks and the frontmatter', () => {
    const md = ['---', 'x: `a/b.ts`', '---', '```', 'src/in/fence.ts', '```', 'ok `src/real.ts`'].join('\n');
    assert.deepEqual(extractPathReferences(md), ['src/real.ts']);
  });

  it('danglingShare resolves files, directories and bare file names and reports the share', () => {
    const r = danglingShare(['src/a.ts', 'src', 'index.ts', 'src/gone.ts'], ['src/a.ts', 'lib/index.ts']);
    assert.deepEqual(r.dangling, ['src/gone.ts']);
    assert.equal(r.total, 4);
    assert.equal(r.share, 0.25);
    assert.equal(danglingShare([], []).share, 0);
  });
});

describe('secrets', () => {
  const tokens: Array<[string, string]> = [
    ['github token', `ghp_${'a1B2'.repeat(9)}`],
    ['AWS key id', 'AKIAABCDEFGHIJKLMNOP'],
    ['private key header', '-----BEGIN RSA PRIVATE KEY-----'],
    ['JWT', `eyJ${'h'.repeat(12)}.eyJ${'p'.repeat(12)}.${'s'.repeat(12)}`],
    ['stripe live key', `sk_live_${'z'.repeat(16)}`],
    ['URL userinfo', 'postgres://admin:hunter2pass@db.internal/app'],
    ['authorization header', `Authorization: Bearer ${'t'.repeat(24)}`],
  ];

  for (const [name, token] of tokens) {
    it(`blocks a document containing a ${name} without a retry, and names no text`, () => {
      const files = FULL_MAP_FILES.map((p) => (p.endsWith('CONCERNS.md') ? doc(p, `leaked: ${token}`) : doc(p)));
      const v = validateMapArtifacts(facts({ files }), { mode: 'full' });
      assert.equal(v.accepted, false);
      assert.equal(v.block, true);
      assert.equal(check(v, 'secrets')?.passed, false);
      assert.equal(v.secretHits.length >= 1, true);
      assert.equal(v.secretHits[0]?.path, '.planning/codebase/CONCERNS.md');
      assert.equal(typeof v.secretHits[0]?.line, 'number');
      assert.equal(JSON.stringify(v).includes(token), false, 'the verdict never carries the matched text');
    });
  }

  it('does not block ordinary prose or a short Authorization header placeholder', () => {
    const text = 'The task-runner reads Authorization: Bearer ${token} and uses the AKIA prefix in examples.';
    assert.deepEqual(findSecrets(text), []);
  });

  it('findSecrets reports pattern names and 1-based line numbers only', () => {
    const hits = findSecrets(['clean', `key ${tokens[0]?.[1] ?? ''}`, 'clean'].join('\n'));
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.line, 2);
    assert.equal(typeof hits[0]?.pattern, 'string');
    assert.equal(JSON.stringify(hits).includes('ghp_'), false);
  });

  it('keeps the GSD scan_for_secrets regex verbatim', () => {
    assert.match(GSD_SECRET_REGEX.source, /sk_live_\[a-zA-Z0-9\]\+/);
    assert.match(GSD_SECRET_REGEX.source, /glpat-\[a-zA-Z0-9_-\]\+/);
    assert.match(GSD_SECRET_REGEX.source, /xox\[baprs\]-\[a-zA-Z0-9-\]\+/);
    assert.equal(AVARICE_SECRET_PATTERNS.length >= 6, true);
  });

  it('redactSecrets replaces each match with [REDACTED:kind] and leaves the rest', () => {
    const out = redactSecrets(`before ${tokens[0]?.[1] ?? ''} after\nAuthorization: Bearer ${'t'.repeat(24)}`);
    assert.match(out, /^before \[REDACTED:[a-z-]+\] after\n/);
    assert.doesNotMatch(out, /ghp_/);
    assert.doesNotMatch(out, /t{24}/);
    assert.equal(redactSecrets('nothing to see'), 'nothing to see');
  });

  it('redacts a whole private key block, body included', () => {
    const block = ['-----BEGIN PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '-----END PRIVATE KEY-----'].join('\n');
    const out = redactSecrets(`x\n${block}\ny`);
    assert.doesNotMatch(out, /MIIEvQ/);
    assert.match(out, /^x\n\[REDACTED:private-key\]\ny$/);
  });
});

describe('size and structure', () => {
  const run = (path: string, file: Partial<MapFileFact> & { text: string }) => {
    const base = doc(path);
    const replaced: MapFileFact = { ...base, ...file, bytes: file.bytes ?? new TextEncoder().encode(file.text).length };
    return validateMapArtifacts(facts({ files: FULL_MAP_FILES.map((p) => (p === path ? replaced : doc(p))) }), { mode: 'full' });
  };

  it('fails an empty file', () => {
    const v = run('.planning/codebase/TESTING.md', { text: '', bytes: 0 });
    assert.equal(check(v, 'size-and-structure')?.passed, false);
    assert.match(check(v, 'size-and-structure')?.detail ?? '', /TESTING\.md.*empty/);
  });

  it('fails a file above 256 KiB and one flagged oversize', () => {
    assert.equal(check(run('.planning/codebase/TESTING.md', { text: '# T\n', bytes: 262145 }), 'size-and-structure')?.passed, false);
    assert.equal(check(run('.planning/codebase/TESTING.md', { text: '', bytes: 0, oversize: true }), 'size-and-structure')?.passed, false);
    assert.equal(check(run('.planning/codebase/TESTING.md', { text: '# T\n', bytes: 262144 }), 'size-and-structure')?.passed, true);
  });

  it('fails a file with no Markdown heading', () => {
    const v = run('.planning/codebase/CONVENTIONS.md', { text: `---\nlast_mapped_commit: ${HEAD}\n---\nplain prose only\n` });
    assert.equal(check(v, 'size-and-structure')?.passed, false);
    assert.match(check(v, 'size-and-structure')?.detail ?? '', /CONVENTIONS\.md.*heading/);
  });

  it('accepts a document whose only heading is an H2', () => {
    const v = run('.planning/codebase/CONVENTIONS.md', { text: '## Naming\nx\n' });
    assert.equal(check(v, 'size-and-structure')?.passed, true);
  });

  it('fails STACK.md and ARCHITECTURE.md that lack a template H2, naming the heading', () => {
    const stack = run('.planning/codebase/STACK.md', { text: '# Technology Stack\n\n## Languages\n\n## Runtime\n' });
    assert.equal(check(stack, 'size-and-structure')?.passed, false);
    assert.match(check(stack, 'size-and-structure')?.detail ?? '', /STACK\.md.*Frameworks/);
    const arch = run('.planning/codebase/ARCHITECTURE.md', { text: '# Architecture\n\n## Layers\n' });
    assert.equal(check(arch, 'size-and-structure')?.passed, false);
    assert.match(check(arch, 'size-and-structure')?.detail ?? '', /ARCHITECTURE\.md.*Data Flow/);
  });

  it('does not require template headings of the other five documents', () => {
    assert.equal(check(run('.planning/codebase/INTEGRATIONS.md', { text: '# Integrations\n' }), 'size-and-structure')?.passed, true);
  });
});

describe('coverage label', () => {
  it('labels a fast map partial with the four files as scope', () => {
    const v = validateMapArtifacts(facts({}, FAST_MAP_FILES), { mode: 'fast' });
    assert.equal(v.accepted, true);
    assert.equal(v.completeness, 'partial');
    assert.deepEqual(v.scope, [...FAST_MAP_FILES]);
    assert.equal(check(v, 'coverage')?.passed, true);
  });

  it('labels a full map complete with the whole repository as scope', () => {
    const v = validateMapArtifacts(facts(), { mode: 'full' });
    assert.equal(v.completeness, 'complete');
    assert.deepEqual(v.scope, ['.']);
  });

  it('labels a skipped map none with no scope', () => {
    const v = validateMapArtifacts(facts({ files: [] }), { mode: 'skip' });
    assert.equal(v.accepted, true);
    assert.equal(v.completeness, 'none');
    assert.deepEqual(v.scope, []);
  });
});
