// Plan 04-28 task 3 (CON-12, T-04-79): nothing cached crosses a revocation, a scope change or a profile. The rule itself is pure (src/domain/cache-scope.ts); the pack
// built by queryContext stamps each item with its profile and access scope and leaves out the ref of a source that answered unauthenticated or denied, or whose reference the
// run recorded as access_revoked. The project is a real onboarded scratch repository (or a real run); the sources that must answer unauthenticated are fakes.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { queryContext } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { cacheMiss, mayReuse, reusablePack } from '../../src/domain/cache-scope.ts';
import { defaultContextReadScope } from '../../src/domain/context-adapters.ts';
import type { CacheEntry, CacheNow } from '../../src/domain/cache-scope.ts';
import { digestOf } from '../../src/domain/digest.ts';
import type { ContextHandle, GitFilesSource } from '../../src/ports/context-source.ts';
import { onboardedContext, startedRun } from '../helpers/retrieval-fixtures.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const entry = (over: Partial<CacheEntry> & { revision?: string; freshness?: string } = {}): CacheEntry => ({
  ref: { revision: over.revision ?? 'git:aaa', freshness: over.freshness ?? 'fresh' },
  profile: over.profile ?? 'personal-local',
  accessScope: over.accessScope ?? 'sha256:scope-a',
  format: over.format ?? 1,
  ...(over.answer !== undefined ? { answer: over.answer } : {}),
});
const NOW: CacheNow = { profile: 'personal-local', accessScope: 'sha256:scope-a', revision: 'git:aaa', format: 1 };
// An item built before pack items were stamped with a format: no `format` key at all.
const unstamped = (over: Parameters<typeof entry>[0] = {}): CacheEntry => {
  const { format: _dropped, ...rest } = entry(over);
  return rest;
};

describe('tracer: mayReuse is false across a profile, a scope, a revision and a revocation (CON-12)', () => {
  it('is true for an entry of the same profile, scope and revision whose source answered', () => {
    assert.equal(mayReuse(entry(), NOW), true);
    assert.equal(mayReuse(entry({ answer: 'ok', freshness: 'stale' }), NOW), true, 'a stale reference of the same revision is still the same text');
  });

  it('is false when the profiles differ', () => {
    assert.equal(mayReuse(entry({ profile: 'work' }), NOW), false);
  });

  it('is false when the access scope differs', () => {
    assert.equal(mayReuse(entry({ accessScope: 'sha256:scope-b' }), NOW), false);
  });

  it('is false when the source revision differs, and when the entry names none', () => {
    assert.equal(mayReuse(entry({ revision: 'git:bbb' }), NOW), false);
    assert.equal(mayReuse({ ref: { freshness: 'fresh' }, profile: NOW.profile, accessScope: NOW.accessScope, format: 1 }, NOW), false);
  });

  it('is false when the reference is access_revoked, or the source answered denied or unauthenticated', () => {
    assert.equal(mayReuse(entry({ freshness: 'access_revoked' }), NOW), false);
    assert.equal(mayReuse(entry({ answer: 'denied' }), NOW), false);
    assert.equal(mayReuse(entry({ answer: 'unauthenticated' }), NOW), false);
  });
});

describe('cacheMiss names the format when an entry was built by another adapter format (GIN-05, CON-12, T-04-159)', () => {
  it('is `format` for an entry with no format, format 0 or an older format, and null for the current one', () => {
    assert.equal(cacheMiss(unstamped(), NOW), 'format');
    assert.equal(cacheMiss(entry({ format: 0 }), NOW), 'format');
    assert.equal(cacheMiss(entry({ format: 1 }), { ...NOW, format: 2 }), 'format');
    assert.equal(cacheMiss(entry({ format: 1 }), NOW), null);
    assert.equal(mayReuse(unstamped(), NOW), false);
  });

  it('is judged after revocation, the profile and the access scope, and before the revision', () => {
    assert.equal(cacheMiss(unstamped({ profile: 'work' }), NOW), 'profile');
    assert.equal(cacheMiss(unstamped({ accessScope: 'sha256:scope-b' }), NOW), 'access-scope');
    assert.equal(cacheMiss(unstamped({ revision: 'git:bbb' }), NOW), 'format', 'an item of an older build is wrong whatever revision it was read at');
    assert.equal(cacheMiss(unstamped({ freshness: 'access_revoked' }), NOW), 'access_revoked');
    assert.equal(cacheMiss(unstamped({ answer: 'denied' }), NOW), 'access_revoked');
    assert.equal(cacheMiss(entry({ revision: 'git:bbb' }), NOW), 'revision');
  });
});

describe('reusablePack: what may be reused, and what is refetched and why', () => {
  it('splits a previous pack, keeping the order of each side and naming the reason of each refetch', () => {
    const a = entry();
    const b = entry({ profile: 'work' });
    const c = entry({ accessScope: 'sha256:scope-b' });
    const d = entry({ revision: 'git:bbb' });
    const e = entry({ freshness: 'access_revoked' });
    const f = entry({ answer: 'unauthenticated' });
    const g = entry({ revision: 'git:aaa' });
    const h = unstamped();
    const split = reusablePack([a, b, c, d, e, f, g, h], NOW);
    assert.deepEqual(split.reusable, [a, g]);
    assert.deepEqual(split.refetch, [
      { entry: b, reason: 'profile' },
      { entry: c, reason: 'access-scope' },
      { entry: d, reason: 'revision' },
      { entry: e, reason: 'access_revoked' },
      { entry: f, reason: 'access_revoked' },
      { entry: h, reason: 'format' },
    ]);
  });

  it('reuses nothing from an empty previous pack and refetches nothing', () => {
    assert.deepEqual(reusablePack([], NOW), { reusable: [], refetch: [] });
  });
});

// A git-files source that answers the one handle and fails the read as the test says.
function fakeGitFiles(read: GitFilesSource['read'], asked: string[] = []): GitFilesSource {
  const handle: ContextHandle = {
    ref: { provider: 'git-files', kind: 'snippet', id: 'src/secret.ts:1', revision: 'git:0123456789abcdef', retrievedAt: '2026-11-17T00:00:00.000Z', scope: 'src/secret.ts', freshness: 'fresh' },
    title: 'src/secret.ts:1',
    estTokens: 20,
    reason: 'matched X',
  };
  return {
    descriptor: { port: 'context-source', adapter: 'git-files', version: '1', capabilities: { find: true, read: true, refresh: true }, offline: true },
    find: async () => ({ ok: true, value: [handle] }),
    read: async (handles, budget) => {
      asked.push(...handles.map((h) => h.ref.id));
      return read(handles, budget);
    },
    refresh: async (ref) => ({ ok: true, value: ref }),
    pathExists: () => true,
  };
}

describe('a pack built after a source answered unauthenticated holds no excerpt of the ref and names it access_revoked (CON-12)', () => {
  const files = { 'README.md': '# scratch\n', 'src/index.ts': 'export const a = 1;\n' };

  it('unauthenticated on read: the ref is omitted with reason access_revoked and its text is not in the pack', async () => {
    const o = await onboardedContext(cleanup, files);
    try {
      const gitFiles = fakeGitFiles(async () => ({ ok: false, error: { kind: 'unauthenticated', credentialRef: 'cred', recovery: 'sign in' } }));
      const deps: AppDeps = { ...o.deps, context: { ...o.deps.context, gitFiles } };
      const result = await queryContext(deps, { term: 'X', budget: 4000 });
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.items.filter((i) => i.source === 'git-files').length, 0);
      assert.deepEqual(result.value.omitted.filter((x) => x.source === 'git-files'), [{ source: 'git-files', id: 'src/secret.ts:1', title: 'src/secret.ts:1', estTokens: 20, reason: 'access_revoked' }]);
      assert.ok(result.value.notes.some((n) => /unauthenticated/.test(n)), JSON.stringify(result.value.notes));
    } finally {
      o.close();
    }
  });

  it('denied on read is the same: omitted with reason access_revoked', async () => {
    const o = await onboardedContext(cleanup, files);
    try {
      const gitFiles = fakeGitFiles(async () => ({ ok: false, error: { kind: 'denied', rule: 'scope', enforcer: 'external-platform' } }));
      const result = await queryContext({ ...o.deps, context: { ...o.deps.context, gitFiles } }, { term: 'X', budget: 4000 });
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.omitted.filter((x) => x.reason === 'access_revoked').length, 1);
      assert.equal(result.value.items.filter((i) => i.source === 'git-files').length, 0);
    } finally {
      o.close();
    }
  });

  it('a ref the run recorded as access_revoked is purged from a new pack before it is read', async () => {
    const s = startedRun(cleanup);
    try {
      const recorded = s.deps.ledger.recordTaskRefs(s.runId, [
        { provider: 'git-files', kind: 'snippet', id: 'src/secret.ts:1', revision: 'git:0123456789abcdef', retrievedAt: '2026-11-17T00:00:00.000Z', scope: 'src/secret.ts', freshness: 'access_revoked' },
      ]);
      assert.ok(recorded.ok);
      const asked: string[] = [];
      const gitFiles = fakeGitFiles(async (handles) => ({ ok: true, value: handles.map((h) => ({ ref: h.ref, title: h.title, excerpt: 'SECRET TEXT', estTokens: h.estTokens, reason: h.reason })) }), asked);
      const result = await queryContext({ ...s.deps, context: { ...s.deps.context, gitFiles } }, { projectId: s.contract.workspace.projectId, term: 'X', budget: 4000, runId: s.runId });
      assert.ok(result.ok, JSON.stringify(result));
      assert.deepEqual(asked, [], 'the revoked ref was never read');
      assert.ok(!JSON.stringify(result.value).includes('SECRET TEXT'), 'no excerpt of it is in the pack');
      assert.equal(result.value.omitted.filter((x) => x.id === 'src/secret.ts:1' && x.reason === 'access_revoked').length, 1);
    } finally {
      s.close();
    }
  });
});

describe('pack items carry the profile and the access scope, appended at the end of the item (CON-12)', () => {
  it('stamps each item with the profile and the digest of the read scope it was built under, and the scope changes with the contract read list', async () => {
    const o = await onboardedContext(cleanup, { 'README.md': '# scratch\n', 'src/pay.ts': 'export function handleCheckout() {}\n', 'docs/pay.md': 'handleCheckout is described.\n' });
    try {
      const wide = await queryContext(o.deps, { term: 'handleCheckout', budget: 4000 });
      assert.ok(wide.ok, JSON.stringify(wide));
      const [first] = wide.value.items;
      assert.ok(first, 'a pack with an item');
      assert.equal(first.profile, o.deps.profile.profile);
      assert.equal(first.accessScope, digestOf(defaultContextReadScope()));
      assert.equal(first.format, 1, 'the first stamped format');
      assert.deepEqual(Object.keys(first).slice(-3), ['profile', 'accessScope', 'format'], 'appended after every key an item already had');
      const narrow = await queryContext(o.deps, { term: 'handleCheckout', budget: 4000, readScope: { read: ['src/**'], readExclude: [], secretGlobs: [] } });
      assert.ok(narrow.ok);
      const [other] = narrow.value.items;
      assert.ok(other);
      assert.notEqual(other.accessScope, first.accessScope, 'another read scope is another access scope');
    } finally {
      o.close();
    }
  });
});

describe('a reused pack item of an older format is read again and carries the current trust marks (GIN-05, CON-12, T-04-159)', () => {
  // A source standing in for the graph: its read returns the flags the current adapters set on a described code node.
  const flaggedSource = (reads: string[]): GitFilesSource =>
    fakeGitFiles(
      async (handles) => ({
        ok: true,
        value: handles.map((h) => ({ ref: h.ref, title: h.title, excerpt: 'a described code node', estTokens: h.estTokens, reason: h.reason, untrusted: true, codeNode: true })),
      }),
      reads,
    );
  const files = { 'README.md': '# scratch\n', 'src/index.ts': 'export const a = 1;\n' };

  it('refetches an item with no format, with reason `format`, and the item read again carries format 1, codeNode and untrusted', async () => {
    const o = await onboardedContext(cleanup, files);
    try {
      const reads: string[] = [];
      const deps: AppDeps = { ...o.deps, context: { ...o.deps.context, gitFiles: flaggedSource(reads) } };
      const first = await queryContext(deps, { term: 'X', budget: 4000 });
      assert.ok(first.ok, JSON.stringify(first));
      const [built] = first.value.items.filter((i) => i.source === 'git-files');
      assert.ok(built);
      assert.deepEqual([built.format, built.codeNode, built.untrusted], [1, true, true]);
      assert.equal(reads.length, 1);

      // The same item as an older build left it: no format, and none of the flags the current adapters set.
      const { format: _format, codeNode: _codeNode, untrusted: _untrusted, ...old } = built;
      const retry = await queryContext(deps, { term: 'X', budget: 4000, reuse: [old] });
      assert.ok(retry.ok, JSON.stringify(retry));
      assert.equal(reads.length, 2, 'the item was read again');
      assert.deepEqual(retry.value.reuse, { reused: 0, refetch: [{ source: 'git-files', id: 'src/secret.ts:1', reason: 'format' }] });
      const [again] = retry.value.items.filter((i) => i.source === 'git-files');
      assert.ok(again);
      assert.deepEqual([again.format, again.codeNode, again.untrusted], [1, true, true]);
    } finally {
      o.close();
    }
  });

  it('still reuses an item with format 1 and the same profile, access scope and revision, without a read', async () => {
    const o = await onboardedContext(cleanup, files);
    try {
      const reads: string[] = [];
      const deps: AppDeps = { ...o.deps, context: { ...o.deps.context, gitFiles: flaggedSource(reads) } };
      const first = await queryContext(deps, { term: 'X', budget: 4000 });
      assert.ok(first.ok, JSON.stringify(first));
      const retry = await queryContext(deps, { term: 'X', budget: 4000, reuse: first.value.items });
      assert.ok(retry.ok, JSON.stringify(retry));
      assert.equal(reads.length, 1, 'no second read');
      assert.deepEqual(retry.value.reuse, { reused: first.value.items.length, refetch: [] });
      assert.ok(first.value.items.every((i) => i.format === 1), 'every item of the pack is stamped');
    } finally {
      o.close();
    }
  });
});
