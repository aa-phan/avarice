// Path-reference extraction and resolution against a real haiku fast map (plan 01-16 deferred item 1). The live
// T3 case 14 ended `blocked (decision)` because validation `path-references` counted names that are not path
// references: a bare extension, `name@version`, a dotted identifier, anything a sentence says is absent or
// ignored, and AVARICE's own staging files. The fixture under test/fixtures/live-fast-map is the map the host
// actually wrote on that run, with the tracked paths of its repository at the stamped revision.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { danglingShare, extractPathReferences } from '../../src/domain/path-references.ts';
import { AVARICE_TRACKED_WRITABLE, AVARICE_WRITE_SET, VALIDATION_LIMITS, validateMapArtifacts } from '../../src/domain/validation.ts';
import type { MapArtifactFacts, MapFileFact } from '../../src/domain/validation.ts';
import { FAST_MAP_FILES } from '../../src/domain/mapping.ts';
import { matchesAny } from '../../src/domain/glob.ts';
import { findSecrets } from '../../src/domain/secret-patterns.ts';

const FIXTURE = new URL('../fixtures/live-fast-map/', import.meta.url);
const tracked = readFileSync(new URL('tracked-paths.txt', FIXTURE), 'utf8').split('\n').filter((l) => l !== '');
const mapNames = ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'];
const mapText = (name: string): string => readFileSync(new URL(name, FIXTURE), 'utf8');

const refs = (md: string): string[] => extractPathReferences(md);
const line = (text: string): string => `# Doc\n\n${text}\n`;

describe('extractPathReferences: names that are not path references', () => {
  it('a bare extension token is not a reference', () => {
    assert.deepEqual(refs(line('Modules import each other via explicit `.ts` paths; config is `.json` or `.yml`, and `.md` files.')), []);
  });

  it('a dotenv file name is still a reference', () => {
    assert.deepEqual(refs(line('Settings live in `.env` at the root.')), ['.env']);
  });

  it('a name@version token is not a reference', () => {
    assert.deepEqual(refs(line('Steps: `actions/checkout@v4`, then `actions/setup-node@v4.1.0` and `pkg@1.2.3`.')), []);
  });

  it('a scoped npm path under a real directory is not turned into a version token', () => {
    assert.deepEqual(refs(line('Types come from `node_modules/@types/node`.')), ['node_modules/@types/node']);
  });

  it('a dotted identifier that is not path-shaped is not a reference', () => {
    assert.deepEqual(refs(line('Reads `process.env`, `import.meta.env`, `foo.bar.baz`, `res.json` and `response.json`.')), []);
  });

  it('a file with an ordinary name and extension is still a reference', () => {
    assert.deepEqual(refs(line('See `package.json`, `tsconfig.base.json` and `missing.ts`.')), ['package.json', 'tsconfig.base.json', 'missing.ts']);
  });

  for (const sentence of [
    'There is no legacy module at `src/legacy/old.ts` in the repository.',
    'This package contains no directory src/gen/ yet.',
    'The `pkg/` directory was not found.',
    'The `config/prod.yml` copy is not committed.',
    'The `config/dev.yml` copy is not tracked.',
    'No `node_modules/` present.',
    'The file `.github/workflows/deploy.yml` does not exist.',
    'The directory `legacy/` is not present.',
    'CI is not configured: no `.gitlab-ci.yml` and no `.github/workflows` for deploys.',
    'The service runs without a .env file or `config/local.yml`.',
    'A `vendor/` directory is absent.',
    "The `build/` directory doesn't exist until the first build.",
    'The `.env` file is untracked.',
    'The `dist/` directory is ignored by git.',
    'Generated output in `out/` is excluded from the repository.',
  ]) {
    it(`a path inside a sentence that states it is absent is not a reference: ${sentence}`, () => {
      assert.deepEqual(refs(line(sentence)), []);
    });
  }

  it('a path a sentence says is ignored by git is not a reference', () => {
    assert.deepEqual(refs(line('`.gitignore` excludes `node_modules` and `.env`.\n\nThe file `.env` is git-ignored; its contents were not read.')), []);
  });

  it('an absence clause does not hide a real reference in another sentence or clause of the same line', () => {
    assert.deepEqual(refs(line('There is no `node_modules` here; see `src/real.ts`. Entry is `src/index.ts`.')), ['src/real.ts', 'src/index.ts']);
    assert.deepEqual(refs(line('There is no legacy module at `src/old.ts`. Entry is `src/index.ts`.')), ['src/index.ts']);
  });

  it('a genuinely missing path in a neutral sentence is still a reference, and then dangles', () => {
    const found = refs(line('Handlers live in `src/missing.ts` and the helpers in `lib/nope/`.'));
    assert.deepEqual(found, ['src/missing.ts', 'lib/nope']);
    const r = danglingShare(found, ['src/index.ts', 'src/util/strings.ts']);
    assert.deepEqual(r.dangling, ['src/missing.ts', 'lib/nope']);
    assert.equal(r.share, 1);
  });
});

describe('danglingShare: AVARICE own staging files and directory names', () => {
  it('a reference under an own tree glob resolves, and so does the tree itself', () => {
    const r = danglingShare(['.planning/graphs', '.planning/graphs/graph.json', 'graphify-out/GRAPH_REPORT.md', 'graphify-outer/x.md'], ['src/a.ts'], ['.planning/graphs/**', 'graphify-out/**']);
    assert.deepEqual(r.dangling, ['graphify-outer/x.md']);
  });

  it('a slashless directory name resolves against a directory anywhere in the tree', () => {
    const r = danglingShare(['codebase', 'nowhere'], ['.planning/codebase/STACK.md']);
    assert.deepEqual(r.dangling, ['nowhere']);
  });

  it('a path with a slash must match exactly: a directory basename is not enough', () => {
    const r = danglingShare(['lib/codebase'], ['.planning/codebase/STACK.md']);
    assert.deepEqual(r.dangling, ['lib/codebase']);
  });
});

describe('validateMapArtifacts: path references over AVARICE own staging files', () => {
  const file = (path: string, extra: string): MapFileFact => {
    const text = `---\nlast_mapped_commit: ${'a'.repeat(40)}\n---\n# Doc\n\n## Languages\n## Runtime\n## Frameworks\n## Key Dependencies\n## Configuration\n## Platform Requirements\n## Pattern Overview\n## Layers\n## Data Flow\n## Key Abstractions\n## Entry Points\n## Error Handling\n## Cross-Cutting Concerns\n\n${extra}\n`;
    return { path, lastMappedCommit: 'a'.repeat(40), text, bytes: text.length };
  };
  const facts = (extra: string, known: readonly string[]): MapArtifactFacts => ({
    stagingHead: 'a'.repeat(40),
    files: FAST_MAP_FILES.map((p) => file(p, p.endsWith('STRUCTURE.md') ? extra : '')),
    changes: { modified: [], added: [], deleted: [] },
    allowedWrite: [...AVARICE_WRITE_SET, '.planning/codebase/**'],
    trackedWritable: ['.planning/config.json', '.planning/codebase/**'],
    knownPaths: known,
  });
  const pathCheck = (extra: string, known: readonly string[]) =>
    validateMapArtifacts(facts(extra, known), { mode: 'fast' }).checks.find((c) => c.name === 'path-references');

  it('counts `.planning/config.json`, which is in staging but untracked at the stamped revision, as known', () => {
    const known = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
    const extra = ['`src/a.ts`', '`src/b.ts`', '`src/c.ts`', '`src/d.ts`', '`src/e.ts`', '`.planning/config.json`', '`config.json`'].map((s) => `- ${s}`).join('\n');
    const check = pathCheck(extra, known);
    assert.equal(check?.passed, true, check?.detail);
    assert.match(check?.detail ?? '', /0 of 7 named path/);
  });

  it('counts the paths of the AVARICE write set and the tracked-writable set as known', () => {
    const own = ['.planning/graphs/graph.json', '.avarice-knowledge/notes.md', 'graphify-out/GRAPH_REPORT.md', '.planning/graphs'];
    assert.ok(own.every((p) => matchesAny(p, [...AVARICE_WRITE_SET, ...AVARICE_TRACKED_WRITABLE])), 'the sample paths are not in the own sets');
    const check = pathCheck(own.map((p) => `- \`${p}\``).join('\n'), ['src/a.ts']);
    assert.equal(check?.passed, true, check?.detail);
  });

  it('counts the git metadata directory and the host scaffold directory that exist in staging as known', () => {
    const check = pathCheck('- `.git/`\n- `.claude/`\n- `.claude/.cc-writes`', ['src/a.ts']);
    assert.equal(check?.passed, true, check?.detail);
  });

  it('still fails a genuinely invented path next to the own files', () => {
    const known = ['src/a.ts'];
    const check = pathCheck('- `.planning/config.json`\n- `src/invented/one.ts`\n- `src/invented/two.ts`', known);
    assert.equal(check?.passed, false);
    assert.match(check?.detail ?? '', /src\/invented\/one\.ts/);
  });
});

describe('the real haiku fast map of the live T3 run (plan 01-16, case 14)', () => {
  const real = (): MapFileFact[] =>
    mapNames.map((name) => {
      const text = mapText(name);
      return { path: `.planning/codebase/${name}`, lastMappedCommit: '41879bed6e93c1c65cce57e3120db26dae739e5c', text, bytes: new TextEncoder().encode(text).length };
    });
  const judge = (files: MapFileFact[]) =>
    validateMapArtifacts(
      {
        stagingHead: '41879bed6e93c1c65cce57e3120db26dae739e5c',
        files,
        changes: { modified: [], added: ['.planning/codebase/STACK.md', '.planning/config.json'], deleted: [] },
        allowedWrite: [...AVARICE_WRITE_SET, '.planning/codebase/**'],
        trackedWritable: ['.planning/config.json', '.planning/codebase/**'],
        knownPaths: tracked,
      },
      { mode: 'fast' },
    );

  it('the fixture carries no secret pattern', () => {
    for (const name of mapNames) assert.deepEqual(findSecrets(mapText(name)), [], name);
    assert.deepEqual(findSecrets(tracked.join('\n')), []);
  });

  it('stays under the 5% limit with the unchanged limit', () => {
    assert.equal(VALIDATION_LIMITS.danglingShare, 0.05);
    const v = judge(real());
    const check = v.checks.find((c) => c.name === 'path-references');
    assert.equal(check?.passed, true, check?.detail);
    const all = real().flatMap((f) => extractPathReferences(f.text));
    const r = danglingShare(all, [...tracked, ...real().map((f) => f.path), '.planning/config.json', '.git', '.claude/.cc-writes'], [...AVARICE_WRITE_SET]);
    assert.ok(r.total >= 30, `only ${r.total} references were read: the extractor is too narrow to mean anything`);
    assert.ok(r.share <= VALIDATION_LIMITS.danglingShare, r.dangling.join(', '));
  });

  it('every real tracked path the map names is still counted as a reference', () => {
    const all = real().flatMap((f) => extractPathReferences(f.text));
    for (const expected of ['src/index.ts', 'test/inventory.test.ts', '.github/workflows/ci.yml', 'tsconfig.json', 'package.json']) {
      assert.ok(all.includes(expected), `${expected} is no longer extracted`);
    }
  });

  it('a deliberately broken copy with invented paths exceeds 5%', () => {
    const files = real().map((f) =>
      f.path.endsWith('STRUCTURE.md')
        ? {
            ...f,
            text: `${f.text}\n## Invented\n\n${['src/features/ghost/handler.ts', 'src/features/ghost/types.ts', 'src/core/engine.ts', 'src/core/loop.ts', 'lib/nope/', 'config/app.yml', 'src/missing.ts', 'scripts/deploy.sh'].map((p) => `- \`${p}\``).join('\n')}\n`,
          }
        : f,
    );
    const v = judge(files);
    const check = v.checks.find((c) => c.name === 'path-references');
    assert.equal(check?.passed, false, check?.detail);
    assert.match(check?.detail ?? '', /^8 of \d+ named path\(s\) dangling/, 'exactly the eight invented paths dangle');
    assert.match(check?.detail ?? '', /src\/features\/ghost\/handler\.ts/);
    assert.equal(v.accepted, false);
  });
});
