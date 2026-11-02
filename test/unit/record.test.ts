// Plan 01-10 Task 2: proposal narrowing (ONB-9), the complete project record body, digest stability and the
// durability of the content-addressed artifact store.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { narrowProposals } from '../../src/domain/policy-narrowing.ts';
import type { PolicyPaths } from '../../src/domain/policy-narrowing.ts';
import { buildProjectRecord, recordDigest } from '../../src/domain/project-record.ts';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';

const POLICY: PolicyPaths = {
  paths: { read: ['**'], write: [], protected: ['.avarice/**', '.github/**'], generated: [], artifacts: [] },
};

describe('narrowProposals: a proposal can only narrow authority (ONB-9)', () => {
  it('rejects a write path the policy does not grant, with reason widens, and accepts nothing for it', () => {
    const r = narrowProposals(POLICY, { paths: { write: ['**'] } });
    assert.deepEqual(r.rejected.map((x) => [x.field, x.reason]), [['paths.write', 'widens']]);
    assert.equal(r.accepted.paths.write, undefined);
  });

  it('accepts additions to paths.protected, which only add protection', () => {
    const r = narrowProposals(POLICY, { paths: { protected: ['.github/**', 'migrations/**'] } });
    assert.deepEqual(r.rejected, []);
    assert.deepEqual(r.accepted.paths.protected, ['.github/**', 'migrations/**']);
  });

  it('accepts a write entry inside a granted glob and rejects the one outside it', () => {
    const policy: PolicyPaths = { paths: { ...POLICY.paths, write: ['src/**'] } };
    const r = narrowProposals(policy, { paths: { write: ['src/app/**', 'test/**', 'src'] } });
    assert.deepEqual(r.accepted.paths.write, ['src/app/**', 'src']);
    assert.deepEqual(r.rejected.map((x) => [x.field, x.value, x.reason]), [['paths.write', 'test/**', 'widens']]);
  });

  it('accepts a narrower read scope and rejects a wider one', () => {
    assert.deepEqual(narrowProposals(POLICY, { paths: { read: ['src/**'] } }).accepted.paths.read, ['src/**']);
    const narrow: PolicyPaths = { paths: { ...POLICY.paths, read: ['src/**'] } };
    assert.equal(narrowProposals(narrow, { paths: { read: ['**'] } }).rejected[0]?.reason, 'widens');
  });

  it('treats generated and artifacts like write: a policy of none grants none', () => {
    const r = narrowProposals(POLICY, { paths: { generated: ['dist/**'], artifacts: ['coverage/**'] } });
    assert.deepEqual(r.rejected.map((x) => [x.field, x.reason]), [['paths.generated', 'widens'], ['paths.artifacts', 'widens']]);
  });

  it('accepts commands only as inactive, whatever status the repository claims for them', () => {
    const r = narrowProposals(POLICY, {
      commands: [
        { name: 'unit', argv: ['npm', 'test'] },
        { name: 'lint', argv: ['npm', 'run', 'lint'], status: 'inactive' },
        { name: 'deploy', argv: ['make', 'deploy'], status: 'validated' },
      ],
    });
    assert.deepEqual(r.accepted.commands, [
      { name: 'unit', argv: ['npm', 'test'], provenance: '.avarice/config.json', status: 'inactive' },
      { name: 'lint', argv: ['npm', 'run', 'lint'], provenance: '.avarice/config.json', status: 'inactive' },
    ]);
    assert.deepEqual(r.rejected.map((x) => [x.field, x.reason]), [['commands[2].status', 'widens']]);
  });

  it('rejects a malformed command', () => {
    const r = narrowProposals(POLICY, { commands: [{ name: 'bad name!', argv: ['x'] }, { name: 'ok', argv: 'npm test' }, 'npm test'] });
    assert.deepEqual(r.accepted.commands, []);
    assert.deepEqual(r.rejected.map((x) => x.reason), ['invalid', 'invalid', 'invalid']);
  });

  it('rejects unknown keys, at the top and under paths, and marks verificationByChangeType unsupported', () => {
    const r = narrowProposals(POLICY, {
      execution: { endpoints: ['example.com'] },
      paths: { bogus: ['x'] },
      verificationByChangeType: { code: ['unit'] },
    });
    assert.deepEqual(
      r.rejected.map((x) => [x.field, x.reason]),
      [['execution', 'unknown'], ['paths.bogus', 'unknown'], ['verificationByChangeType', 'unsupported']],
    );
  });

  it('rejects an absolute, parent-relative or non-string entry as invalid and a non-object proposal', () => {
    const r = narrowProposals(POLICY, { paths: { protected: ['/etc/**', '../x', 7, ''] } });
    assert.deepEqual(r.accepted.paths.protected, undefined);
    assert.deepEqual(r.rejected.map((x) => x.reason), ['invalid', 'invalid', 'invalid', 'invalid']);
    assert.equal(narrowProposals(POLICY, ['paths']).rejected[0]?.reason, 'invalid');
    assert.equal(narrowProposals(POLICY, null).rejected[0]?.reason, 'invalid');
  });

  it('clips the recorded value and leaves the inputs untouched', () => {
    const proposal = { paths: { write: ['x'.repeat(5000)] } };
    const before = JSON.stringify(proposal);
    const policyBefore = JSON.stringify(POLICY);
    const r = narrowProposals(POLICY, proposal);
    assert.ok((r.rejected[0]?.value.length ?? 0) <= 200);
    assert.equal(JSON.stringify(proposal), before);
    assert.equal(JSON.stringify(POLICY), policyBefore);
  });
});

function recordInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj_test',
    recordVersion: 1,
    repository: { rootCommit: 'git:0a1b2c3', remote: null, defaultBranch: 'main' },
    onboardedAt: 'git:4f2c9e1',
    profile: 'personal-local',
    stagingPath: '/work/onb_01/staging',
    codebase: [{ path: '.planning/codebase/STACK.md', digest: 'sha256:91fe', lastMappedCommit: 'git:4f2c9e1' }],
    snapshot: 'sha256:5d0a',
    mapping: { mode: 'full' as const, scope: ['.'], mappedAt: '2026-11-02T00:00:00Z' },
    notMapped: [],
    ...overrides,
  };
}

describe('buildProjectRecord: the complete body', () => {
  it('fills gsd, existingState, instructionFiles, findings and contract from its input', () => {
    const r = buildProjectRecord(
      recordInput({
        gsdVersion: '1.17.0',
        gsd: { config: { commit_docs: false }, capabilities: ['init-onboard', 'map-full'] },
        existingState: { planningExists: true, codebaseMap: 'unstamped' },
        instructionFiles: ['CLAUDE.md'],
        findings: [{ source: 'narrowing', field: 'paths.write', reason: 'widens', detail: '**' }],
        contract: { runId: 'run_1', version: 1, digest: 'sha256:abc' },
      }),
    );
    assert.deepEqual(r.gsd, { version: '1.17.0', runtime: 'claude', adapter: 'gsd-onboarding@1.17', config: { commit_docs: false }, capabilities: ['init-onboard', 'map-full'] });
    assert.deepEqual(r.existingState, { planningExists: true, codebaseMap: 'unstamped' });
    assert.deepEqual(r.instructionFiles, ['CLAUDE.md']);
    assert.deepEqual(r.findings, [{ source: 'narrowing', field: 'paths.write', reason: 'widens', detail: '**' }]);
    assert.deepEqual(r.contract, { runId: 'run_1', version: 1, digest: 'sha256:abc' });
    assert.equal(r.promotion, 'none');
  });

  it('reports version unknown and empty lists when nothing was recorded', () => {
    const r = buildProjectRecord(recordInput());
    assert.equal(r.gsd.version, 'unknown');
    assert.deepEqual(r.gsd.config, {});
    assert.deepEqual(r.gsd.capabilities, []);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.instructionFiles, []);
    assert.equal(r.contract, null);
  });

  it('starts from the profile policy paths and merges accepted proposals: protected is a union, write stays empty', () => {
    const r = buildProjectRecord(
      recordInput({
        paths: { protected: ['migrations/**', '.github/**'] },
        commands: [{ name: 'unit', argv: ['npm', 'test'], provenance: '.avarice/config.json', status: 'inactive' }],
      }),
    );
    assert.deepEqual(r.paths.read, ['**']);
    assert.deepEqual(r.paths.write, []);
    assert.deepEqual(r.paths.protected, ['.avarice/**', '.github/**', 'migrations/**']);
    assert.deepEqual(r.paths.generated, []);
    assert.deepEqual(r.paths.artifacts, []);
    assert.equal(r.commands[0]?.status, 'inactive');
  });

  it('digests the same whatever the key order and differently when a finding is added', () => {
    const r = buildProjectRecord(recordInput({ gsd: { config: { b: 1, a: 2 } } }));
    const reverse = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverse) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
    const shuffled = reverse(r);
    assert.equal(recordDigest(r), recordDigest(shuffled));
    const withFinding = buildProjectRecord(recordInput({ gsd: { config: { b: 1, a: 2 } }, findings: [{ source: 'validation', field: 'x', reason: 'y' }] }));
    assert.notEqual(recordDigest(r), recordDigest(withFinding));
  });
});

describe('LocalArtifactStore: durable, content-addressed, idempotent', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const root = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'avarice-art-'));
    dirs.push(d);
    return d;
  };
  const sha = (b: Uint8Array): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const filesUnder = (d: string): string[] => {
    try {
      return readdirSync(d, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
    } catch {
      return [];
    }
  };
  const BYTES = new TextEncoder().encode('map document body');

  it('leaves nothing under the digest path or beside it when the rename never happens', () => {
    const base = root();
    const store = new LocalArtifactStore(base, { renameSync: () => { throw Object.assign(new Error('killed'), { code: 'EIO' }); } });
    const put = store.put(BYTES, { kind: 'map-document' });
    assert.equal(put.ok, false);
    assert.deepEqual(filesUnder(join(base, 'artifacts')), [], 'no blob and no temp file');
    assert.deepEqual(new LocalArtifactStore(base).has(sha(BYTES)), { ok: true, value: false });
  });

  it('leaves nothing when fsync of the temp file fails', () => {
    const base = root();
    const store = new LocalArtifactStore(base, { fsyncSync: () => { throw Object.assign(new Error('no'), { code: 'EIO' }); } });
    assert.equal(store.put(BYTES, { kind: 'map-document' }).ok, false);
    assert.deepEqual(filesUnder(join(base, 'artifacts')), []);
  });

  it('fsyncs the temp file and then the parent directory', () => {
    const base = root();
    let calls = 0;
    const store = new LocalArtifactStore(base, { fsyncSync: () => { calls += 1; } });
    assert.equal(store.put(BYTES, { kind: 'map-document' }).ok, true);
    assert.equal(calls, 2);
  });

  it('is a no-op to put the same bytes again and returns the same digest without rewriting the blob', () => {
    const store = new LocalArtifactStore(root());
    const first = store.put(BYTES, { kind: 'map-document' });
    assert.ok(first.ok);
    const file = filesUnder(join(dirs.at(-1) as string, 'artifacts'))[0] as string;
    const before = statSync(file);
    const second = store.put(BYTES, { kind: 'map-snapshot' });
    assert.deepEqual(second, first);
    const after = statSync(file);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

  it('heals a blob that was corrupted to the same size: get refuses it, put restores it', () => {
    const base = root();
    const store = new LocalArtifactStore(base);
    const put = store.put(BYTES, { kind: 'map-document' });
    assert.ok(put.ok);
    const file = filesUnder(join(base, 'artifacts'))[0] as string;
    writeFileSync(file, 'x'.repeat(BYTES.length));
    assert.equal(store.get(put.value.digest).ok, false);
    assert.equal(store.put(BYTES, { kind: 'map-document' }).ok, true);
    const got = store.get(put.value.digest);
    assert.ok(got.ok);
    assert.equal(Buffer.from(got.value).toString('utf8'), 'map document body');
    assert.equal(readFileSync(file, 'utf8'), 'map document body');
  });

  it('ignores a stale temp file from a crashed writer and still stores the blob', () => {
    const base = root();
    const store = new LocalArtifactStore(base);
    const digest = sha(BYTES);
    const dir = join(base, 'artifacts', digest.slice('sha256:'.length, 'sha256:'.length + 2));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.tmp-crashed'), 'partial');
    assert.deepEqual(store.has(digest), { ok: true, value: false });
    assert.ok(store.put(BYTES, { kind: 'map-document' }).ok);
    assert.deepEqual(store.has(digest), { ok: true, value: true });
  });

  it('refuses a malformed digest and reports an unknown one as not found', () => {
    const store = new LocalArtifactStore(root());
    assert.equal(store.get('sha256:xyz').ok, false);
    assert.equal(store.has('nope').ok, false);
    const missing = store.get(`sha256:${'0'.repeat(64)}`);
    assert.ok(!missing.ok && missing.error.kind === 'not_found');
  });
});
