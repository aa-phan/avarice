// Plan 04-35 (AC-14, owner ruling 2026-11-18 "fix all, retry (i)"): the live map of auto_search_workflow was rejected at 9 of 115 named paths dangling (7.8%,
// limit 5%) because it named model ids (`openai/gpt-oss-120b`), a language construct (`try/finally`), an IANA zone (`America/Chicago`) and a bare file name
// (`lock.json`, the leaf of the ignored `state/lock.json`). Only a token that plausibly names a repository path counts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { danglingShare, explicitReferencesOf } from '../../src/domain/path-references.ts';
import { validateMapArtifacts } from '../../src/domain/validation.ts';
import type { MapFileFact } from '../../src/domain/validation.ts';
import { FAST_MAP_FILES } from '../../src/domain/mapping.ts';

const line = (text: string): string => `# Doc\n\n${text}\n`;

describe('only a token that plausibly names a repository path counts (plan 04-35)', () => {
  const tree = ['src/app.ts', 'src/lib/util.ts', 'tests/test_pipeline.py', 'docs/guide.md', 'README.md'];
  const NOT_PATHS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'try/finally', 'America/Chicago'];

  it('a model id, a language construct and an IANA zone are not counted: neither named nor dangling', () => {
    const r = danglingShare([...NOT_PATHS, 'src/app.ts'], tree);
    assert.deepEqual(r.dangling, []);
    assert.deepEqual(r.nonPaths, NOT_PATHS);
    assert.equal(r.total, 1);
    assert.equal(r.share, 0);
  });

  it('a first segment that is a real top-level entry of the tree makes a slash path a repository path', () => {
    const r = danglingShare(['src/gone/deep', 'docs/missing', 'tests/test_gone', ...NOT_PATHS], tree);
    assert.deepEqual(r.dangling, ['src/gone/deep', 'docs/missing', 'tests/test_gone']);
    assert.equal(r.total, 3);
  });

  it('a file extension makes a slash path a repository path whatever its first segment', () => {
    const r = danglingShare(['packages/api/src/index.ts', 'vendor/model.json', 'openai/config.yaml'], tree);
    assert.deepEqual(r.dangling, ['packages/api/src/index.ts', 'vendor/model.json', 'openai/config.yaml']);
    assert.deepEqual(r.nonPaths, []);
  });

  it('an explicit directory or relative form is a repository path even when no top-level entry has that name', () => {
    const r = danglingShare(['packages/api', 'try/finally'], tree, [], [], { explicit: ['packages/api'] });
    assert.deepEqual(r.dangling, ['packages/api']);
    assert.deepEqual(r.nonPaths, ['try/finally']);
  });

  it('explicitReferencesOf reports the references written with a trailing slash or a ./ prefix, and no other', () => {
    const doc = line('Packages live in `packages/api/`, run `./tools/build`, fall back on `try/finally` and read `src/app.ts`.');
    assert.deepEqual(explicitReferencesOf([doc]).sort(), ['packages/api', 'tools/build']);
    assert.deepEqual(explicitReferencesOf([line('Nothing explicit: `src/app.ts` and `docs/guide.md`.')]), []);
  });

  it('a path that starts with a host name is a URL, not a repository path, and so is the bare file name it ends in', () => {
    const r = danglingShare(['api.smartrecruiters.com/robots.txt', 'robots.txt', 'src/gone.ts'], tree);
    assert.deepEqual(r.nonPaths, ['api.smartrecruiters.com/robots.txt', 'robots.txt']);
    assert.deepEqual(r.dangling, ['src/gone.ts']);
  });

  it('a bare file name that is the leaf of an ignored reference is known, as that reference is', () => {
    const r = danglingShare(['state/lock.json', 'lock.json', 'other.json'], tree, [], ['state/lock.json']);
    assert.deepEqual(r.ignored, ['state/lock.json', 'lock.json']);
    assert.deepEqual(r.dangling, ['other.json']);
  });

  it('validation passes the live map that named the false positives, says what it did not count, and keeps the 5% limit', () => {
    const HEAD = 'a'.repeat(40);
    const known = Array.from({ length: 30 }, (_, i) => `lib/f${String(i).padStart(2, '0')}.ts`);
    const stamped = (path: string, extra: string): MapFileFact => {
      const text = ['---', `last_mapped_commit: ${HEAD}`, '---', '# Doc', '', extra, ''].join('\n');
      return { path, lastMappedCommit: HEAD, text, bytes: text.length };
    };
    const judge = (named: readonly string[]) =>
      validateMapArtifacts(
        {
          stagingHead: HEAD,
          files: FAST_MAP_FILES.map((path) => stamped(path, path.endsWith('STRUCTURE.md') ? named.map((p) => `- \`${p}\``).join('\n') : '')),
          changes: { modified: [], added: [], deleted: [] },
          allowedWrite: ['.planning/codebase/**'],
          trackedWritable: ['.planning/codebase/**'],
          knownPaths: known,
          ignoredReferences: ['state/lock.json'],
        },
        { mode: 'fast' },
      ).checks.find((c) => c.name === 'path-references');
    const named = [...known.slice(0, 12), ...NOT_PATHS, 'state/lock.json', 'lock.json'];
    const verdict = judge(named);
    assert.equal(verdict?.passed, true, verdict?.detail);
    assert.match(verdict?.detail ?? '', /^0 of 14 named path\(s\) dangling/);
    assert.match(verdict?.detail ?? '', /4 token\(s\) that do not name a repository path/);
    assert.match(verdict?.detail ?? '', /openai\/gpt-oss-120b/);
    const broken = judge([...named, 'lib/missing-a.ts', 'lib/missing-b.ts', 'lib/missing-c.ts']);
    assert.equal(broken?.passed, false, broken?.detail);
    assert.match(broken?.detail ?? '', /lib\/missing-a\.ts/);
  });
});
