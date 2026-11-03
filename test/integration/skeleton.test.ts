// The walking skeleton (SKELETON.md "Capability Proven End-to-End"): a scratch repository goes from
// unregistered to an active, immutable record through the real CLI, ledger, staging and artifact layers
// with the fake AgentHost, and `status` reads it offline. Later plans re-run this file.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { ArtifactStore } from '../../src/ports/artifact-store.ts';
import type { Ledger } from '../../src/ports/ledger.ts';
import type { StagingChanges } from '../../src/ports/staging-workspace.ts';
import type { Result } from '../../src/domain/result.ts';
import { PRODUCTION_ENTRY, REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FAKE_DOCUMENT_MARKER, FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function fixture(): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function onboardWithFake(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}, extra: readonly string[] = []): CliResult {
  return runCli(['onboard', '--policy', 'onboarding', ...extra, repo.path], {
    roots,
    entry: TEST_CLI,
    env: { AVARICE_FAKE_HOST: JSON.stringify(host) },
  });
}

function rawDb(roots: CliRoots): DatabaseSync {
  return new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = rawDb(roots);
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function stagingOf(roots: CliRoots): string {
  const [onboarding] = rows<{ staging_worktree: string | null }>(roots, 'SELECT staging_worktree FROM onboardings');
  assert.ok(onboarding?.staging_worktree, 'the onboarding records its staging worktree');
  return onboarding.staging_worktree;
}

describe('onboard with the fake host, then status (tracer)', () => {
  it('takes a scratch repository to an active project record version 1', () => {
    const { roots, repo } = fixture();
    const r = onboardWithFake(roots, repo);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /onboarding onb_[0-9A-Z]{26}: active/);

    const records = rows<{ project_id: string; version: number; state: string; onboarded_revision: string; completeness: string; mapping_mode: string }>(
      roots,
      'SELECT project_id, version, state, onboarded_revision, completeness, mapping_mode FROM project_records',
    );
    assert.equal(records.length, 1);
    assert.equal(records[0]?.version, 1);
    assert.equal(records[0]?.state, 'active');
    assert.equal(records[0]?.onboarded_revision, `git:${repo.head}`, 'the revision recorded at registration');
    assert.equal(records[0]?.mapping_mode, 'full');
    assert.equal(records[0]?.completeness, 'complete');

    const [onboarding] = rows<{ state: string; lease_holder: string | null }>(roots, 'SELECT state, lease_holder FROM onboardings');
    assert.equal(onboarding?.state, 'active');
    assert.equal(onboarding?.lease_holder, null, 'the lease is released');
  });

  it('is read back by `bin/avarice status --json` with no host and no network', () => {
    const { roots, repo } = fixture();
    assert.equal(onboardWithFake(roots, repo).code, 0);
    // Where the macOS sandbox is available, read it back with the network denied (NFR-2).
    const sandbox = '/usr/bin/sandbox-exec';
    const wrap = existsSync(sandbox) ? [sandbox, '-p', '(version 1)(allow default)(deny network*)'] : undefined;
    const status = runCli(['status', '--json'], { roots, ...(wrap ? { wrap } : {}) });
    assert.equal(status.code, 0, status.stderr);
    const entries = JSON.parse(status.stdout) as Array<{ repoPath: string; state: string; recordVersion: number; onboardedRevision: string; mapping: { mode: string; completeness: string } }>;
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.repoPath, repo.path);
    assert.equal(entries[0]?.state, 'active');
    assert.equal(entries[0]?.recordVersion, 1);
    assert.equal(entries[0]?.onboardedRevision, `git:${repo.head}`);
    assert.equal(entries[0]?.mapping.completeness, 'complete');
    assert.equal(entries[0]?.mapping.mode, 'full');
  });

  it('walks discovered, contract_proposed, mapping, validating, planning_ready, active with one event per checkpoint', () => {
    const { roots, repo } = fixture();
    assert.equal(onboardWithFake(roots, repo).code, 0);

    const transitions = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'onboarding.transition' ORDER BY seq").map(
      (e) => JSON.parse(e.data_json) as { to: string; from: string; checkpointId: string },
    );
    assert.deepEqual(
      transitions.map((t) => t.to),
      ['discovered', 'contract_proposed', 'mapping', 'validating', 'planning_ready', 'active'],
    );

    const checkpoints = rows<{ checkpoint_id: string; next_action: string }>(roots, 'SELECT checkpoint_id, next_action FROM checkpoints ORDER BY seq');
    assert.deepEqual(
      checkpoints.map((c) => c.next_action),
      [
        'compile-contract',
        'prepare-workspace', // the contract_proposed transition
        'prepare-workspace', // the stage, before it adds the worktree
        'configure-gsd',
        'verify-enforcement',
        'launch:map',
        'validate',
        'index:code-graph', // the planning_ready transition
        'index:code-graph', // the index stage, before the step runs
        'index:intel',
        'index:knowledge',
        'activate', // the index stage, before the record is built
        'none', // active
      ],
    );
    const eventIds = new Set(
      rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type IN ('onboarding.transition', 'onboarding.checkpoint')").map(
        (e) => (JSON.parse(e.data_json) as { checkpointId: string }).checkpointId,
      ),
    );
    for (const c of checkpoints) assert.ok(eventIds.has(c.checkpoint_id), `checkpoint ${c.checkpoint_id} has an event`);
  });

  it('leaves the user checkout byte-identical and writes every generated file into staging', () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES, modified: { 'README.md': '# scratch, edited\n' }, untracked: { 'notes.txt': 'draft\n', '.env': 'TOKEN=abc\n' } });
    cleanup.push(roots.base, repo.base);
    const before = checkoutSnapshot(repo.path);

    const r = onboardWithFake(roots, repo);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.deepEqual(checkoutSnapshot(repo.path), before);
    assert.equal(existsSync(join(repo.path, '.planning')), false, 'nothing is written to the checkout');

    const staging = stagingOf(roots);
    assert.ok(staging.startsWith(roots.AVARICE_WORK_ROOT), 'staging lives under the work root');
    assert.deepEqual(readdirSync(join(staging, '.planning', 'codebase')).sort(), [
      'ARCHITECTURE.md', 'CONCERNS.md', 'CONVENTIONS.md', 'INTEGRATIONS.md', 'STACK.md', 'STRUCTURE.md', 'TESTING.md',
    ]);
    // The uncommitted names are recorded as not mapped; their contents never are.
    const [onboarding] = rows<{ preflight_json: string }>(roots, 'SELECT preflight_json FROM onboardings');
    const preflight = JSON.parse(onboarding?.preflight_json ?? '{}') as { notMapped: string[] };
    assert.deepEqual(preflight.notMapped, ['.env', 'README.md', 'notes.txt']);
  });
});

// A host that checks, at the moment of each side effect, which checkpoint the ledger already holds.
describe('stage ordering: the checkpoint is committed before the side effect it names', () => {
  it('has the matching checkpoint in the ledger when the worktree, the invocation and the artifact store are touched', async () => {
    const { roots, repo } = fixture();
    const env = { ...process.env, AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME, AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT, AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT };
    const observed: string[] = [];
    let onboardingId = '';
    let ledger: Ledger | undefined;
    const latest = (): string => {
      const c = ledger?.latestCheckpoint(onboardingId);
      return c?.ok && c.value ? c.value.nextAction : 'none-yet';
    };
    const stepsStarted = (): string[] => {
      const s = ledger?.getStepResults(onboardingId);
      // Invocation steps only: the gsd:* steps (plan 01-09) are AVARICE's own GSD calls, not host invocations.
      return s?.ok ? s.value.map((x) => x.step).filter((step) => step.startsWith('launch:')) : [];
    };

    class SpyHost extends FakeAgentHost {
      override invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
        observed.push(`invoke after ${latest()} with steps [${stepsStarted().join(',')}]`);
        return super.invoke(req, signal);
      }
    }
    const composed = createDeps(env, { host: new SpyHost() });
    assert.ok(composed.ok, 'composition');
    const real = composed.value.deps;
    ledger = real.ledger;
    const spyStaging: typeof real.staging = {
      prepare: (input) => {
        observed.push(`prepare after ${latest()}`);
        return real.staging.prepare(input);
      },
      head: (p) => real.staging.head(p),
      changes: (p, pin) => real.staging.changes(p, pin),
      describe: (p, pin) => real.staging.describe(p, pin),
      listTracked: (p, pin) => real.staging.listTracked(p, pin),
      read: (p, rel, max) => real.staging.read(p, rel, max),
      ensureDir: (p, rel) => {
        observed.push(`ensureDir after ${latest()}`);
        return real.staging.ensureDir(p, rel);
      },
      inspectRepo: (p) => real.staging.inspectRepo(p),
    };
    const spyArtifacts: ArtifactStore = {
      put: (bytes, meta) => {
        if (!observed.some((o) => o.startsWith('put '))) observed.push(`put after ${latest()}`);
        return real.artifacts.put(bytes, meta);
      },
      get: (d) => real.artifacts.get(d),
      has: (d) => real.artifacts.has(d),
    };
    const deps = { ...real, staging: spyStaging, artifacts: spyArtifacts };
    try {
      const started = startOnboarding(deps, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(started.ok);
      onboardingId = started.value.onboardingId;
      const outcome = await runOnboarding(deps, onboardingId);
      assert.ok(outcome.ok);
      assert.equal(outcome.value.state, 'active');
    } finally {
      composed.value.close();
    }
    assert.deepEqual(observed, [
      'prepare after prepare-workspace',
      'ensureDir after launch:map',
      'invoke after launch:map with steps [launch:map]',
      // The intel step (plan 01-17) is the second contained invocation, behind its own checkpoint.
      'ensureDir after index:intel',
      'invoke after index:intel with steps [launch:map,launch:intel]',
      'put after activate',
    ]);
  });
});

describe('the fake host cannot reach production', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && /\.(?:ts|js|mjs|cjs|json)$/.test(e.name))
      .map((e) => join(e.parentPath, e.name));
  }

  it('is referenced from nothing under src/ or bin/', () => {
    for (const root of [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'bin')]) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /fake-agent-host|FakeAgentHost|AVARICE_FAKE_HOST|test-cli/, file);
      }
    }
    assert.ok(readFileSync(PRODUCTION_ENTRY, 'utf8').includes('main('), 'the production entry is the thing that was scanned');
  });
});

describe('the ledger holds no map document text', () => {
  it('stores paths, digests and revisions; the document bytes live only in the artifact store', () => {
    const { roots, repo } = fixture();
    assert.equal(onboardWithFake(roots, repo).code, 0);
    const found: string[] = [];
    const store: string[] = [];
    const visit = (dir: string, inStore: boolean): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) visit(full, inStore || entry.name === 'artifacts');
        else if (readFileSync(full).includes(FAKE_DOCUMENT_MARKER)) (inStore ? store : found).push(full);
      }
    };
    visit(roots.AVARICE_DATA_ROOT, false);
    assert.deepEqual(found, [], 'no ledger file contains document text');
    assert.equal(store.length, 7, 'positive control: the seven documents are in the artifact store');

    const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records');
    const body = JSON.parse(record?.body_json ?? '{}') as { artifacts: { codebase: Array<{ path: string; digest: string; lastMappedCommit: string }>; snapshot: string } };
    assert.equal(body.artifacts.codebase.length, 7);
    for (const doc of body.artifacts.codebase) {
      assert.match(doc.digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(doc.lastMappedCommit, repo.head);
    }
    assert.match(body.artifacts.snapshot, /^sha256:[0-9a-f]{64}$/);
  });
});

describe('the production path fails closed', () => {
  it('blocks with enforcement_failure, never invokes a host and leaves staging .planning/codebase empty', () => {
    const { roots, repo } = fixture();
    const before = checkoutSnapshot(repo.path);
    const r = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots });
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.match(r.stdout, /onboarding onb_[0-9A-Z]{26}: blocked \(enforcement_failure\)/);

    const [onboarding] = rows<{ state: string }>(roots, 'SELECT state FROM onboardings');
    assert.equal(onboarding?.state, 'blocked');
    const reasons = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'onboarding.transition' ORDER BY seq DESC LIMIT 1");
    assert.equal((JSON.parse(reasons[0]?.data_json ?? '{}') as { reason?: string }).reason, 'enforcement_failure');
    assert.deepEqual(
      rows<{ step: string }>(roots, "SELECT step FROM onboarding_steps WHERE step LIKE 'launch:%'"),
      [],
      'no launch:map step: the host was never called',
    );
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);

    const codebase = join(stagingOf(roots), '.planning', 'codebase');
    assert.deepEqual(existsSync(codebase) ? readdirSync(codebase) : [], [], 'no map file and no invocation file in staging');
    assert.deepEqual(checkoutSnapshot(repo.path), before);

    const status = runCli(['status', '--json'], { roots });
    const entries = JSON.parse(status.stdout) as Array<{ state: string; reason: string; recordVersion: number | null }>;
    assert.deepEqual([entries[0]?.state, entries[0]?.reason, entries[0]?.recordVersion], ['blocked', 'enforcement_failure', null]);
  });

  it('records the production host as unavailable with enforcement none', () => {
    const { roots, repo } = fixture();
    runCli(['onboard', '--policy', 'onboarding', repo.path], { roots });
    const [config] = rows<{ adapter: string; descriptor_json: string }>(roots, "SELECT adapter, descriptor_json FROM adapter_configs WHERE port = 'agent-host'");
    assert.equal(config?.adapter, 'unavailable');
    assert.equal((JSON.parse(config?.descriptor_json ?? '{}') as { attributes: { enforcement: string } }).attributes.enforcement, 'none');
  });
});

describe('a malformed map is retried once, then blocks with a decision', () => {
  it('validation_failed twice, two attempts, blocked (decision), no record', () => {
    const { roots, repo } = fixture();
    const before = checkoutSnapshot(repo.path);
    const r = onboardWithFake(roots, repo, { omit: ['TESTING.md'] });
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.match(r.stdout, /blocked \(decision\)/);

    const states = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'onboarding.transition' ORDER BY seq").map(
      (e) => (JSON.parse(e.data_json) as { to: string }).to,
    );
    assert.deepEqual(states, [
      'discovered', 'contract_proposed', 'mapping', 'validating', 'validation_failed',
      'mapping', 'validating', 'validation_failed', 'blocked',
    ]);
    assert.equal(rows<{ n: number }>(roots, "SELECT count(*) AS n FROM attempts").at(0)?.n, 2);
    assert.deepEqual(
      rows<{ step: string; attempt: number }>(roots, "SELECT step, attempt FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt").map((s) => s.attempt),
      [1, 2],
      'the host ran twice',
    );
    const rejected = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'validate' AND status = 'rejected'");
    assert.equal(rejected.length, 2);
    assert.match(rejected[0]?.result_json ?? '', /TESTING\.md/, 'the failing check names the missing file');
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);
    assert.deepEqual(checkoutSnapshot(repo.path), before);
  });

  it('also rejects a map stamped with the wrong commit', () => {
    const { roots, repo } = fixture();
    const r = onboardWithFake(roots, repo, { stamp: 'deadbeef' });
    assert.equal(r.code, 3, r.stderr + r.stdout);
    assert.match(r.stdout, /blocked \(decision\)/);
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);
  });
});

describe('promotion other than none is refused', () => {
  // Plan 01-08 moved this refusal from the contract stage (blocked, exit 3, after an onboarding row exists) to
  // preflight: a usage error, exit 64, before a project, an onboarding, a contract or any staging exists. The
  // contract compiler still refuses it too (test/unit/domain-contracts.test.ts), as defence in depth.
  it('--promote copy exits 64 with the compiler message before any onboarding or staging exists', () => {
    const { roots, repo } = fixture();
    const before = checkoutSnapshot(repo.path);
    const r = onboardWithFake(roots, repo, {}, ['--promote', 'copy']);
    assert.equal(r.code, 64, r.stderr + r.stdout);
    assert.match(r.stderr, /request\.promote: promotion "copy" is not authorized: the onboarding preset allows only "none"/);

    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM onboardings')[0]?.n, 0, 'no onboarding row');
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM projects')[0]?.n, 0, 'no project row');
    assert.deepEqual(readdirSync(roots.AVARICE_WORK_ROOT), [], 'nothing was created under the work root');
    assert.deepEqual(checkoutSnapshot(repo.path), before);
  });
});

describe('index steps (plan 01-14)', () => {
  // No graphify, so the code-graph step is absent and these tests stay about the registry, not the tool.
  const NO_GRAPHIFY = { AVARICE_FAKE_HOST: '{}', AVARICE_GRAPHIFY_BIN: '/nonexistent' };

  it('runs code-graph, intel and knowledge in order, one stored result each, and records the intel and knowledge steps as absent', () => {
    const { roots, repo } = fixture();
    const r = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: NO_GRAPHIFY });
    assert.equal(r.code, 0, r.stderr + r.stdout);

    const steps = rows<{ step: string; status: string; result_json: string }>(roots, "SELECT step, status, result_json FROM onboarding_steps WHERE step LIKE 'index:%' ORDER BY rowid");
    assert.deepEqual(steps.map((s) => s.step), ['index:code-graph', 'index:intel', 'index:knowledge']);
    assert.ok(steps.every((s) => s.status === 'completed'));
    // The fake map host cannot do the intel purpose (plan 01-17 tests the step with a fake intel host), so the
    // invocation fails and the index is absent without blocking.
    const intelResult = JSON.parse(steps[1]?.result_json ?? '{}') as { index: string; status: string; reason: string };
    assert.deepEqual([intelResult.index, intelResult.status, intelResult.reason], ['intel', 'absent', 'invocation-failed']);
    assert.deepEqual(JSON.parse(steps[2]?.result_json ?? '{}'), { index: 'knowledge', status: 'absent', reason: 'not-built-in-this-build' });

    const [record] = rows<{ body_json: string; graph_commit: string | null; intel_commit: string | null; knowledge_commit: string | null }>(
      roots,
      'SELECT body_json, graph_commit, intel_commit, knowledge_commit FROM project_records',
    );
    const body = JSON.parse(record?.body_json ?? '{}') as { indexes: { intel?: unknown; absent: Array<{ index: string; reason: string }> } };
    assert.equal(body.indexes.intel, undefined);
    assert.deepEqual(body.indexes.absent.filter((a) => a.index !== 'graph'), [
      { index: 'intel', reason: 'invocation-failed' },
      { index: 'knowledge', reason: 'not-built-in-this-build' },
    ]);
    assert.equal(record?.intel_commit, null, 'the ledger column follows the body: no intel, no commit');
    assert.equal(record?.knowledge_commit, null);

    const events = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'index.absent' ORDER BY seq").map((e) => JSON.parse(e.data_json) as { index: string; reason: string });
    assert.deepEqual(events.filter((e) => e.index !== 'code-graph').map((e) => [e.index, e.reason]), [['intel', 'invocation-failed'], ['knowledge', 'not-built-in-this-build']]);
  });

  it('status says which indexes are absent and why', () => {
    const { roots, repo } = fixture();
    assert.equal(runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: NO_GRAPHIFY }).code, 0);
    const status = runCli(['status'], { roots, entry: TEST_CLI, env: NO_GRAPHIFY });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /intel absent \(invocation-failed\)/);
    assert.match(status.stdout, /knowledge absent \(not-built-in-this-build\)/);
  });
});

// The final check before activation re-reads the whole staging diff (T-01-67). Late writes are simulated by
// reporting extra changes on every read after the validation stage's.
describe('activation re-checks the whole staging diff against every write set (plan 01-14)', () => {
  async function onboardWithLateChanges(late: Readonly<Partial<Record<keyof StagingChanges, readonly string[]>>>): Promise<{ roots: CliRoots; state: string; reason: string | null }> {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);
    const env = {
      ...process.env,
      AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
      AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
      AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
      AVARICE_GRAPHIFY_BIN: '/nonexistent',
    };
    const composed = createDeps(env, { host: new FakeAgentHost() });
    assert.ok(composed.ok, 'composition');
    const real = composed.value.deps;
    let reads = 0;
    const staging: typeof real.staging = {
      prepare: (input) => real.staging.prepare(input),
      head: (p) => real.staging.head(p),
      changes: (p, pin) => {
        const changes = real.staging.changes(p, pin);
        reads += 1;
        // The first read is the validation stage's; every later one is the activation check.
        if (!changes.ok || reads === 1) return changes;
        return { ok: true, value: { modified: [...changes.value.modified, ...(late.modified ?? [])], added: [...changes.value.added, ...(late.added ?? [])], deleted: [...changes.value.deleted, ...(late.deleted ?? [])] } };
      },
      describe: (p, pin) => real.staging.describe(p, pin),
      listTracked: (p, pin) => real.staging.listTracked(p, pin),
      read: (p, rel, max) => real.staging.read(p, rel, max),
      ensureDir: (p, rel) => real.staging.ensureDir(p, rel),
      inspectRepo: (p) => real.staging.inspectRepo(p),
    };
    try {
      const started = startOnboarding({ ...real, staging }, { repoPath: repo.path, policy: 'onboarding' });
      assert.ok(started.ok);
      const outcome = await runOnboarding({ ...real, staging }, started.value.onboardingId);
      assert.ok(outcome.ok, 'the run itself does not fail');
      assert.ok(reads >= 2, 'the activation stage read the diff again');
      return { roots, state: outcome.value.state, reason: outcome.value.reason };
    } finally {
      composed.value.close();
    }
  }

  for (const [name, late] of [
    ['an added file outside every write set', { added: ['rogue.txt'] }],
    ['a modified tracked source file', { modified: ['package.json'] }],
    ['a deleted tracked source file', { deleted: ['src/index.ts'] }],
    ['a planning file outside every write set', { added: ['.planning/phases/01/PLAN.md'] }],
    ['a new top-level directory', { added: ['dist/out.js'] }],
  ] as const) {
    it(`blocks activation for ${name}, with a containment.finding event and no record`, async () => {
      const { roots, state, reason } = await onboardWithLateChanges(late);
      assert.equal(state, 'blocked');
      assert.equal(reason, 'enforcement_failure');
      assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0, 'no record was activated');
      const findings = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'containment.finding' ORDER BY seq").map((e) => JSON.parse(e.data_json) as { check: string; count: number; paths: string[] });
      assert.equal(findings.length, 1);
      assert.equal(findings[0]?.check, 'activation-scope');
      const paths = [...(late.added ?? []), ...(late.modified ?? []), ...(late.deleted ?? [])];
      assert.deepEqual(findings[0]?.paths, [...paths].sort());
      assert.equal(rows<{ n: number }>(roots, "SELECT count(*) AS n FROM artifacts WHERE kind = 'map-document'")[0]?.n, 0, 'nothing was stored for a map that cannot be activated');
    });
  }

  for (const [name, late] of [
    ['a new file under .planning/graphs/', { added: ['.planning/graphs/graph.json', '.planning/graphs/.last-build-snapshot.json'] }],
    ['a committed graph that AVARICE regenerates', { modified: ['.planning/graphs/graph.json'] }],
    ['the GSD config', { modified: ['.planning/config.json'] }],
    ['a file under graphify-out/ and .avarice-knowledge/', { added: ['graphify-out/graph.json', '.avarice-knowledge/manifest.json'] }],
  ] as const) {
    it(`activates with ${name}`, async () => {
      const { roots, state } = await onboardWithLateChanges(late);
      assert.equal(state, 'active');
      assert.equal(rows<{ n: number }>(roots, "SELECT count(*) AS n FROM events WHERE type = 'containment.finding'")[0]?.n, 0);
    });
  }
});
