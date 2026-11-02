// Plan 01-10 Task 2: the record is complete, narrower than or equal to policy, immutable per version, and AVARICE
// holds references and a content-addressed snapshot, never a second copy of GSD's knowledge (ONB-2, S-27).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES: Record<string, string> = {
  'README.md': '# scratch\n',
  'CLAUDE.md': '# instructions\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
};
const SENTENCES = [
  'The quarterly ledger reconciliation walks the heron registry before dawn.',
  'Marmalade fixtures are provisioned by the cobalt scheduler on alternate Tuesdays.',
  'Every lantern handler retries with a sapphire backoff measured in fortnights.',
];

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string> = REPO_FILES): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboard(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}) {
  return runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
}

function db(roots: CliRoots, readOnly = true): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly });
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  const d = db(roots);
  try {
    return (d.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    d.close();
  }
}

function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

interface RecordBody {
  recordVersion: number;
  gsd: { version: string; runtime: string; adapter: string; config: Record<string, unknown>; capabilities: string[] };
  contract: { runId: string; version: number; digest: string };
  existingState: Record<string, unknown>;
  instructionFiles: string[];
  notMapped: string[];
  findings: Array<{ source: string; field: string; reason: string; detail?: string }>;
  paths: { read: string[]; write: string[]; protected: string[]; generated: string[]; artifacts: string[] };
  commands: Array<{ name: string; argv: string[]; provenance: string; status: string }>;
  promotion: string;
  artifacts: { snapshot: string; codebase: Array<{ path: string; digest: string }> };
}

function latestRecord(roots: CliRoots): RecordBody {
  const all = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version DESC');
  assert.ok(all[0], 'a project record exists');
  return JSON.parse(all[0].body_json) as RecordBody;
}

describe('no competing index (ONB-2, S-27)', () => {
  it('keeps map document text only in the artifact store: no table column and no file outside artifacts/ holds it', () => {
    const { roots, repo } = fixture();
    const r = onboard(roots, repo, { inject: SENTENCES.join('\n\n') });
    assert.equal(r.code, 0, r.stdout + r.stderr);

    // Positive control: the sentences are in the snapshot blobs.
    const blobs = filesUnder(join(roots.AVARICE_DATA_ROOT, 'artifacts')).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const sentence of SENTENCES) assert.ok(blobs.includes(sentence), `the artifact store holds: ${sentence}`);

    // Every text column of every table.
    const d = db(roots);
    try {
      const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
      assert.ok(tables.length > 5);
      for (const table of tables) {
        for (const row of d.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>) {
          for (const value of Object.values(row)) {
            if (typeof value !== 'string') continue;
            for (const sentence of SENTENCES) assert.equal(value.includes(sentence), false, `${table} holds a map sentence`);
          }
        }
      }
    } finally {
      d.close();
    }

    // Every file under the data root except artifacts/ (the database, its WAL and shared memory included).
    const outside = filesUnder(roots.AVARICE_DATA_ROOT).filter((f) => !f.startsWith(join(roots.AVARICE_DATA_ROOT, 'artifacts') + '/'));
    assert.ok(outside.some((f) => f.endsWith('state.db')), 'the scan covers the database file');
    for (const file of outside) {
      const text = readFileSync(file, 'latin1');
      for (const sentence of SENTENCES) assert.equal(text.includes(sentence), false, `${file} holds a map sentence`);
    }
  });

  it('stores each accepted document as a map-document artifact and a path-to-digest manifest as a map-snapshot, retention onboarding', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo).code, 0);
    const kinds = rows<{ kind: string; retention: string; n: number }>(roots, 'SELECT kind, retention, count(*) AS n FROM artifacts GROUP BY kind, retention ORDER BY kind');
    assert.deepEqual(kinds, [
      { kind: 'map-document', retention: 'onboarding', n: 7 },
      { kind: 'map-snapshot', retention: 'onboarding', n: 1 },
    ]);
    const record = latestRecord(roots);
    const store = new LocalArtifactStore(roots.AVARICE_DATA_ROOT);
    const manifest = store.get(record.artifacts.snapshot);
    assert.ok(manifest.ok);
    const body = JSON.parse(Buffer.from(manifest.value).toString('utf8')) as { files: Array<{ path: string; digest: string }> };
    assert.deepEqual(
      body.files.map((f) => [f.path, f.digest]).sort(),
      record.artifacts.codebase.map((c) => [c.path, c.digest]).sort(),
    );
    for (const c of record.artifacts.codebase) assert.ok(store.has(c.digest).ok && (store.has(c.digest) as { value: boolean }).value);
  });

  it('records gsd, the contract, existing state, instruction files and the mapped-not list from the facts that were gathered', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo).code, 0);
    const record = latestRecord(roots);
    assert.match(record.gsd.version, /^1\.17\./);
    assert.equal(record.gsd.runtime, 'claude');
    assert.equal(record.gsd.adapter, 'gsd-onboarding@1.17');
    assert.equal(record.gsd.config['commit_docs'], false);
    assert.equal(record.gsd.config['workflow.text_mode'], true);
    assert.ok(record.gsd.capabilities.includes('init-onboard'));
    assert.deepEqual(record.instructionFiles, ['CLAUDE.md']);
    assert.equal(record.existingState['codebaseMap'], 'none');
    assert.equal(record.promotion, 'none');
    const [contract] = rows<{ run_id: string; version: number; digest: string }>(roots, 'SELECT run_id, version, digest FROM contracts');
    assert.deepEqual(record.contract, { runId: contract?.run_id, version: contract?.version, digest: contract?.digest });
    assert.deepEqual(record.paths, { read: ['**'], write: [], protected: ['.avarice/**', '.github/**'], generated: [], artifacts: [] });
    assert.deepEqual(record.commands, []);
  });
});

describe('repository proposals only narrow (ONB-9, T-01-22)', () => {
  const PROPOSAL = {
    paths: { write: ['**'], protected: ['migrations/**'] },
    commands: [{ name: 'unit', argv: ['npm', 'test'] }],
    execution: { endpoints: ['example.com'] },
  };

  it('rejects a wider paths.write and records a finding, accepts a protected addition, keeps commands inactive', () => {
    const { roots, repo } = fixture({ ...REPO_FILES, '.avarice/config.json': JSON.stringify(PROPOSAL) });
    const r = onboard(roots, repo);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const record = latestRecord(roots);
    assert.deepEqual(record.paths.write, [], 'the proposal did not widen write');
    assert.deepEqual(record.paths.protected, ['.avarice/**', '.github/**', 'migrations/**']);
    assert.deepEqual(record.commands, [{ name: 'unit', argv: ['npm', 'test'], provenance: '.avarice/config.json', status: 'inactive' }]);
    const narrowing = record.findings.filter((f) => f.source === 'narrowing').map((f) => [f.field, f.reason]);
    assert.deepEqual(narrowing, [['paths.write', 'widens'], ['execution', 'unknown']]);
    const execution = (record as unknown as { execution: { endpoints: string[]; credentials: string[] } }).execution;
    assert.deepEqual(execution.endpoints, [], 'a rejected value never becomes authority');
    assert.deepEqual(execution.credentials, []);
  });

  it('records a finding, and still activates, for a config that is not JSON or is too large', () => {
    for (const content of ['{not json', JSON.stringify({ paths: { protected: ['x'.repeat(70_000)] } })]) {
      const { roots, repo } = fixture({ ...REPO_FILES, '.avarice/config.json': content });
      assert.equal(onboard(roots, repo).code, 0);
      const record = latestRecord(roots);
      assert.equal(record.findings.some((f) => f.source === 'narrowing' && f.field === '.avarice/config.json'), true);
      assert.deepEqual(record.paths.protected, ['.avarice/**', '.github/**']);
    }
  });

  it('accepts a repository without a config, with no narrowing finding', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo).code, 0);
    assert.deepEqual(latestRecord(roots).findings, []);
  });

  it('carries an earlier validation rejection into the findings of the record that finally activates', async () => {
    const { roots, repo } = fixture();
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const hosts = [new FakeAgentHost({ omit: ['TESTING.md'] }), new FakeAgentHost({})];
    let calls = 0;
    const host = { descriptor: hosts[0]!.descriptor, invoke: (req: never, signal: AbortSignal) => (hosts[Math.min(calls++, 1)] as FakeAgentHost).invoke(req, signal) };
    const composed = createDeps(env, { host });
    assert.ok(composed.ok);
    try {
      const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(started.ok);
      const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
      assert.ok(outcome.ok && outcome.value.state === 'active');
    } finally {
      composed.value.close();
    }
    const findings = latestRecord(roots).findings.filter((f) => f.source === 'validation');
    assert.deepEqual(findings.map((f) => f.field), ['presence']);
  });
});

describe('record versions are insert-only (ONB-9, T-01-24)', () => {
  it('rejects an UPDATE of body_json and of digest', () => {
    const { roots, repo } = fixture();
    assert.equal(onboard(roots, repo).code, 0);
    const d = db(roots, false);
    try {
      assert.throws(() => d.exec("UPDATE project_records SET body_json = '{}'"), /immutable/);
      assert.throws(() => d.exec("UPDATE project_records SET digest = 'sha256:x'"), /immutable/);
    } finally {
      d.close();
    }
  });

  it('a second activation of the same project creates version 2, sets superseded_at on version 1 and leaves version 1 intact', async () => {
    const { roots, repo } = fixture();
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const composed = createDeps(env, { host: new FakeAgentHost({}) });
    assert.ok(composed.ok);
    const deps = composed.value.deps;
    try {
      const first = startOnboarding(deps, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(first.ok);
      const one = await runOnboarding(deps, first.value.onboardingId);
      assert.ok(one.ok && one.value.state === 'active');
      const before = rows<{ body_json: string; digest: string }>(roots, 'SELECT body_json, digest FROM project_records WHERE version = 1')[0];

      // Preflight refuses to start a second onboarding of an active project (ONB-6); the ledger itself allows
      // one, which is how a later phase's re-onboarding will arrive.
      const row = deps.ledger.getOnboarding(first.value.onboardingId);
      assert.ok(row.ok);
      const second = deps.ledger.createOnboarding({
        onboardingId: deps.ids.next('onb_'),
        projectId: row.value.projectId,
        preflight: row.value.preflight as Record<string, unknown>,
        nowMs: deps.clock.nowMs(),
      });
      assert.ok(second.ok);
      const two = await runOnboarding(deps, second.value.onboardingId);
      assert.ok(two.ok && two.value.state === 'active', JSON.stringify(two));
      const active = deps.ledger.getActiveRecord(row.value.projectId);
      assert.ok(active.ok && active.value);
      assert.equal(active.value.version, 2);

      const versions = rows<{ version: number; state: string; superseded_at: string | null; body_json: string; digest: string }>(
        roots,
        'SELECT version, state, superseded_at, body_json, digest FROM project_records ORDER BY version',
      );
      assert.deepEqual(versions.map((v) => v.version), [1, 2]);
      assert.notEqual(versions[0]?.superseded_at, null, 'version 1 is superseded');
      assert.equal(versions[1]?.superseded_at, null, 'version 2 is the active one');
      assert.equal(versions[0]?.body_json, before?.body_json);
      assert.equal(versions[0]?.digest, before?.digest);
      assert.equal((JSON.parse(versions[1]?.body_json ?? '{}') as RecordBody).recordVersion, 2);
    } finally {
      composed.value.close();
    }
  });
});
