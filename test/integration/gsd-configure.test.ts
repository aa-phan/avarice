// Plan 01-09 Task 2: AVARICE probes and configures GSD in staging before any host invocation, stamps a fast map
// itself, and records the mapping mode. Real gsd-core, scratch repositories, the fake host.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { runGsd } from '../../src/adapters/gsd/gsd-tools.ts';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import type { InvocationOutcome, InvocationRequest } from '../../src/ports/agent-host.ts';
import type { Result } from '../../src/domain/result.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { checkoutSnapshot, git, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo, ScratchRepoOptions } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import type { FakeHostOptions } from '../helpers/fake-agent-host.ts';
import { writeLoggingGsdCore } from '../helpers/fake-gsd-core.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REAL_HOME = process.env['HOME'] ?? homedir();
const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export const answer = 42;\n',
};
const FAST_FILES = ['STACK.md', 'INTEGRATIONS.md', 'ARCHITECTURE.md', 'STRUCTURE.md'];
const FULL_FILES = ['STACK.md', 'ARCHITECTURE.md', 'STRUCTURE.md', 'CONVENTIONS.md', 'TESTING.md', 'INTEGRATIONS.md', 'CONCERNS.md'];

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `avarice-${prefix}-`));
  cleanup.push(dir);
  return dir;
}

function fixture(options: ScratchRepoOptions = { files: REPO_FILES }): { roots: CliRoots; repo: ScratchRepo } {
  const roots = makeRoots();
  const repo = makeScratchRepo(options);
  cleanup.push(roots.base, repo.base);
  return { roots, repo };
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function step<T>(roots: CliRoots, name: string): T {
  const [row] = rows<{ result_json: string }>(roots, 'SELECT result_json FROM onboarding_steps WHERE step = ? ORDER BY attempt DESC', name);
  assert.ok(row, `step ${name} is recorded`);
  return JSON.parse(row.result_json) as T;
}

function stagingOf(roots: CliRoots): string {
  const [onboarding] = rows<{ staging_worktree: string | null }>(roots, 'SELECT staging_worktree FROM onboardings');
  assert.ok(onboarding?.staging_worktree, 'the onboarding records its staging worktree');
  return onboarding.staging_worktree;
}

function onboardCli(roots: CliRoots, repo: ScratchRepo, host: FakeHostOptions = {}, extra: readonly string[] = []) {
  return runCli(['onboard', '--policy', 'onboarding', ...extra, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: JSON.stringify(host) } });
}

const realGsd = (): string => {
  const located = locateGsdCore({ HOME: REAL_HOME });
  assert.ok(located.ok, 'the installed gsd-core is admitted');
  return located.value.gsdCoreDir;
};

interface LoggedCall {
  cwd: string;
  args: string[];
}

// In-process onboarding through a logging gsd-core, with a host that records the log length at the moment of
// each invocation.
async function onboardLogged(roots: CliRoots, repo: ScratchRepo, hostOptions: FakeHostOptions, mode?: string) {
  const dir = temp('gsdlog');
  const logPath = join(dir, 'calls.log');
  const gsdHome = writeLoggingGsdCore(join(dir, 'gsd-core'), logPath, join(realGsd(), 'bin', 'gsd-tools.cjs'));
  const readLog = (): LoggedCall[] =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as LoggedCall)
      : [];
  // `codebaseEntries`: what `.planning/codebase` holds when the host is invoked (null when it does not exist).
  const atInvoke: Array<{ prompt: string; logged: number; codebaseEntries: string[] | null }> = [];
  class Spy extends FakeAgentHost {
    override invoke(req: InvocationRequest, signal: AbortSignal): Promise<Result<InvocationOutcome>> {
      // These tests are about the map invocation; the intel step (plan 01-17) has its own tests.
      if (req.purpose === 'map') {
        const mapDir = join(req.scope.stagingPath, '.planning', 'codebase');
        atInvoke.push({ prompt: req.prompt, logged: readLog().length, codebaseEntries: existsSync(mapDir) ? readdirSync(mapDir) : null });
      }
      return super.invoke(req, signal);
    }
  }
  const env = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    GSD_HOME: gsdHome,
  };
  const composed = createDeps(env, { host: new Spy(hostOptions) });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding', ...(mode !== undefined ? { mode } : {}) });
    assert.ok(started.ok, JSON.stringify(started));
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    return { outcome: outcome.value, atInvoke, calls: readLog(), onboardingId: started.value.onboardingId };
  } finally {
    composed.value.close();
  }
}

describe('configure-gsd: probe, plan and configure in staging', () => {
  it('turns commit_docs off and text_mode, intel and graphify on in staging, and `query commit` skips', async () => {
    const { roots, repo } = fixture();
    const r = onboardCli(roots, repo);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const staging = stagingOf(roots);

    const config = JSON.parse(readFileSync(join(staging, '.planning', 'config.json'), 'utf8')) as {
      commit_docs: boolean;
      workflow: { text_mode: boolean };
      intel: { enabled: boolean };
      graphify: { enabled: boolean };
    };
    assert.equal(config.commit_docs, false);
    assert.equal(config.workflow.text_mode, true);
    assert.equal(config.intel.enabled, true);
    assert.equal(config.graphify.enabled, true);

    const committed = await runGsd(new SandboxedExecutor(), realGsd(), ['query', 'commit', 'x', '--files', '.planning/config.json'], { cwd: staging });
    assert.ok(committed.ok, JSON.stringify(committed));
    assert.equal((committed.value as { reason: string }).reason, 'skipped_commit_docs_false');
    assert.equal(git(staging, ['rev-list', '--count', `${repo.head}..HEAD`]).trim(), '0', 'no commit was made in staging');
  });

  it('records the probe projection, the mapping plan and the applied settings as steps', () => {
    const { roots, repo } = fixture();
    assert.equal(onboardCli(roots, repo).code, 0);
    const probe = step<{ isBrownfield: boolean; mapReadiness: string; nextAction: string; missingMapFiles: string[] }>(roots, 'gsd:probe');
    assert.equal(probe.isBrownfield, true);
    assert.equal(probe.mapReadiness, 'none');
    assert.equal(probe.nextAction, 'map-codebase');
    assert.equal(probe.missingMapFiles.length, 7);
    const plan = step<{ mode: string; completeness: string; existingMap: string }>(roots, 'mapping:plan');
    assert.equal(plan.mode, 'full');
    assert.equal(plan.completeness, 'complete');
    assert.equal(plan.existingMap, 'none');
    const configured = step<{ applied: Array<{ key: string; value: string }> }>(roots, 'gsd:configure');
    assert.deepEqual(
      configured.applied.map((a) => `${a.key}=${a.value}`),
      ['commit_docs=false', 'workflow.text_mode=true', 'intel.enabled=true', 'graphify.enabled=true'],
    );
  });

  it('leaves the user checkout byte-identical, including a committed .planning/config.json', () => {
    const configBytes = '{\n  "commit_docs": true,\n  "mode": "yolo"\n}\n';
    const { roots, repo } = fixture({ files: { ...REPO_FILES, '.planning/config.json': configBytes, '.planning/PROJECT.md': '# p\n' } });
    const before = checkoutSnapshot(repo.path);
    const r = onboardCli(roots, repo);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(readFileSync(join(repo.path, '.planning', 'config.json'), 'utf8'), configBytes, 'the checkout config.json is untouched');
    assert.deepEqual(checkoutSnapshot(repo.path), before);
    // The staging copy was changed, and kept the repository's own keys.
    const staged = JSON.parse(readFileSync(join(stagingOf(roots), '.planning', 'config.json'), 'utf8')) as { commit_docs: boolean; mode?: string };
    assert.equal(staged.commit_docs, false);
    assert.equal(staged.mode, 'yolo');
  });

  it('creates no .planning directory in a checkout that has none', () => {
    const { roots, repo } = fixture();
    assert.equal(onboardCli(roots, repo).code, 0);
    assert.equal(existsSync(join(repo.path, '.planning')), false);
  });

  it('runs every GSD verb that writes with cwd = staging, in order, before the host is invoked', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke, calls } = await onboardLogged(roots, repo, {});
    assert.equal(outcome.state, 'active');
    const staging = realpathSync(stagingOf(roots));
    const mutating = calls.filter((c) => ['init', 'config-set', 'stamp-codebase-map'].includes(c.args[0] ?? ''));
    assert.ok(mutating.length >= 5, 'init onboard and four config-set calls were made');
    for (const call of mutating) assert.equal(realpathSync(call.cwd), staging, `${call.args.join(' ')} ran in staging`);
    for (const call of calls) assert.notEqual(realpathSync(call.cwd), realpathSync(repo.path), `${call.args.join(' ')} never ran in the user checkout`);
    assert.deepEqual(
      mutating.map((c) => c.args.slice(0, 3).join(' ')),
      ['init onboard --raw', 'config-set commit_docs false', 'config-set workflow.text_mode true', 'config-set intel.enabled true', 'config-set graphify.enabled true'],
    );
    assert.equal(atInvoke.length, 1);
    // After the host, the index stage asks GSD for the graph snapshot and status (plan 01-14); nothing else.
    const afterHost = calls.slice(atInvoke[0]?.logged ?? 0);
    assert.ok(afterHost.every((c) => c.args[0] === 'graphify'), `only graphify verbs run after the host: ${JSON.stringify(afterHost.map((c) => c.args))}`);
    assert.equal(atInvoke[0]?.logged, calls.filter((c) => c.args[0] !== 'graphify').length, 'every other GSD call was made before the host was invoked (and none after, for a full map)');
    for (const call of afterHost) assert.equal(realpathSync(call.cwd), staging, `${call.args.join(' ')} ran in staging`);
    assert.equal(calls.some((c) => c.args[0] === 'stamp-codebase-map'), false, 'a full map is not stamped by AVARICE');
  });
});

describe('mapping mode', () => {
  it('stamps a fast map itself with --files for exactly the four fast-map files, and records mode fast', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke, calls } = await onboardLogged(roots, repo, { files: FAST_FILES, stamp: false }, 'fast');
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(atInvoke[0]?.prompt.split('\n')[0], '/gsd-map-codebase --fast');

    const staging = stagingOf(roots);
    const head = git(staging, ['rev-parse', 'HEAD']).trim();
    const stampCalls = calls.filter((c) => c.args[0] === 'stamp-codebase-map');
    assert.equal(stampCalls.length, 1);
    assert.deepEqual(stampCalls[0]?.args, ['stamp-codebase-map', '--files', 'STACK.md,INTEGRATIONS.md,ARCHITECTURE.md,STRUCTURE.md']);
    assert.equal(realpathSync(stampCalls[0]?.cwd ?? ''), realpathSync(staging));

    assert.deepEqual(readdirSync(join(staging, '.planning', 'codebase')).sort(), [...FAST_FILES].sort());
    for (const name of FAST_FILES) {
      const text = readFileSync(join(staging, '.planning', 'codebase', name), 'utf8');
      assert.match(text, new RegExp(`^---\\nlast_mapped_commit: ${head}\\n`), `${name} is stamped with the staging HEAD`);
    }
    const stamped = step<{ stamped: string[]; failed: string[]; commit: string }>(roots, 'gsd:stamp');
    assert.deepEqual([...stamped.stamped].sort(), [...FAST_FILES].sort());
    assert.equal(stamped.commit, head);

    const [record] = rows<{ mapping_mode: string; completeness: string }>(roots, 'SELECT mapping_mode, completeness FROM project_records');
    assert.equal(record?.mapping_mode, 'fast');
    assert.equal(record?.completeness, 'partial');
  });

  it('records a full map as mode full, complete, with the full-map prompt', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke } = await onboardLogged(roots, repo, {});
    assert.equal(outcome.state, 'active');
    assert.equal(atInvoke[0]?.prompt.split('\n')[0], '/gsd-map-codebase');
    const [record] = rows<{ mapping_mode: string; completeness: string }>(roots, 'SELECT mapping_mode, completeness FROM project_records');
    assert.equal(record?.mapping_mode, 'full');
    assert.equal(record?.completeness, 'complete');
  });

  // Found by the live exit rehearsal (plan 01-19, deferred item 9): the mapper's closing `stamp-codebase-map` call is denied by
  // the hook (the verb writes, S0-F), so a real full map arrives unstamped and validation `stamp` failed on all seven files.
  // AVARICE stamps a full map itself, as it does a fast map; the hook stays as strict as it was.
  it('stamps a full map itself with --files for exactly the seven full-map files, after the invocation and before validation', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke, calls } = await onboardLogged(roots, repo, { stamp: false });
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(atInvoke[0]?.prompt.split('\n')[0], '/gsd-map-codebase');

    const staging = stagingOf(roots);
    const head = git(staging, ['rev-parse', 'HEAD']).trim();
    const stampCalls = calls.filter((c) => c.args[0] === 'stamp-codebase-map');
    assert.equal(stampCalls.length, 1);
    assert.deepEqual(stampCalls[0]?.args, ['stamp-codebase-map', '--files', FULL_FILES.join(',')]);
    assert.equal(realpathSync(stampCalls[0]?.cwd ?? ''), realpathSync(staging));
    assert.ok((stampCalls[0] as LoggedCall).cwd !== '', 'the stamp ran in staging');

    for (const name of FULL_FILES) {
      const text = readFileSync(join(staging, '.planning', 'codebase', name), 'utf8');
      assert.match(text, new RegExp(`^---\\nlast_mapped_commit: ${head}\\n`), `${name} is stamped with the staging HEAD`);
    }
    const stamped = step<{ stamped: string[]; failed: string[]; commit: string }>(roots, 'gsd:stamp');
    assert.deepEqual([...stamped.stamped].sort(), [...FULL_FILES].sort());
    assert.equal(stamped.commit, head);

    // The stamp comes after the map invocation and before the validation that needs it.
    const order = rows<{ step: string }>(roots, "SELECT step FROM onboarding_steps WHERE step IN ('launch:map', 'gsd:stamp', 'validate') ORDER BY rowid").map((r) => r.step);
    assert.deepEqual(order, ['launch:map', 'gsd:stamp', 'validate']);
    const validation = step<{ checks: Array<{ name: string; passed: boolean }> }>(roots, 'validate');
    assert.equal(validation.checks.find((c) => c.name === 'stamp')?.passed, true);

    const [record] = rows<{ mapping_mode: string; completeness: string }>(roots, 'SELECT mapping_mode, completeness FROM project_records');
    assert.equal(record?.mapping_mode, 'full');
    assert.equal(record?.completeness, 'complete');
  });

  // Found by the live exit rehearsal (plan 01-19): AVARICE creates `.planning/codebase` (empty) before the mapper starts, and
  // GSD's map workflow treats an existing directory as an existing map and asks Refresh, Update or Skip, which a headless
  // session cannot answer. The mapper ended without a file (outcome denied, blocked decision) on a repository with no map.
  it('answers the existing-map question up front for a repository with no map, because AVARICE creates .planning/codebase empty before the mapper starts', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke } = await onboardLogged(roots, repo, {});
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(step<{ existingMap: string }>(roots, 'mapping:plan').existingMap, 'none', 'the repository has no map');
    assert.deepEqual(atInvoke[0]?.codebaseEntries, [], 'the directory exists and is empty when the mapper starts');
    assert.equal(atInvoke[0]?.prompt, '/gsd-map-codebase\nIf .planning/codebase already exists, answer the question about it with: Refresh.');
  });

  it('answers the existing-map question up front in fast mode too', async () => {
    const { roots, repo } = fixture();
    const { outcome, atInvoke } = await onboardLogged(roots, repo, { files: FAST_FILES, stamp: false }, 'fast');
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(atInvoke[0]?.prompt, '/gsd-map-codebase --fast\nIf .planning/codebase already exists, answer the question about it with: Refresh.');
  });

  it('skips mapping for a repository that is not brownfield: no invocation, completeness none', async () => {
    const { roots, repo } = fixture({ files: { 'README.md': '# only a readme\n' } });
    const { outcome, atInvoke } = await onboardLogged(roots, repo, {});
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    assert.equal(atInvoke.length, 0, 'the host was never invoked');
    assert.equal(rows(roots, "SELECT 1 FROM onboarding_steps WHERE step = 'launch:map'").length, 0, 'no map invocation was recorded');
    const plan = step<{ mode: string; completeness: string }>(roots, 'mapping:plan');
    assert.equal(plan.mode, 'skip');
    assert.equal(plan.completeness, 'none');
    const [record] = rows<{ mapping_mode: string; completeness: string }>(roots, 'SELECT mapping_mode, completeness FROM project_records');
    assert.equal(record?.mapping_mode, 'skip');
    assert.equal(record?.completeness, 'none');
  });

  it('regenerates an existing committed map in staging and passes the contract answer to the mapper', async () => {
    const { roots, repo } = fixture({ files: { ...REPO_FILES, '.planning/codebase/STACK.md': '# old stack\n' } });
    const { outcome, atInvoke } = await onboardLogged(roots, repo, {});
    assert.equal(outcome.state, 'active', outcome.message ?? '');
    const plan = step<{ mode: string; existingMap: string }>(roots, 'mapping:plan');
    assert.equal(plan.mode, 'full');
    assert.equal(plan.existingMap, 'unstamped');
    assert.match(atInvoke[0]?.prompt ?? '', /^\/gsd-map-codebase\n/);
    assert.match(atInvoke[0]?.prompt ?? '', /Refresh/);
  });
});

describe('avarice onboard --mode', () => {
  it('accepts full and fast, and refuses anything else as a usage error', () => {
    const { roots, repo } = fixture();
    for (const mode of ['paths', 'adopt', 'sideways']) {
      const r = runCli(['onboard', '--policy', 'onboarding', '--mode', mode, repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
      assert.equal(r.code, 64, `--mode ${mode}: ${r.stderr}`);
      assert.match(r.stderr, /--mode/);
    }
    const created = existsSync(join(roots.AVARICE_DATA_ROOT, 'state.db')) ? rows(roots, 'SELECT 1 FROM onboardings').length : 0;
    assert.equal(created, 0, 'a refused mode creates nothing');
  });

  it('passes --mode fast through to the onboarding: a fast map, stamped by AVARICE', () => {
    const { roots, repo } = fixture();
    const r = onboardCli(roots, repo, { files: FAST_FILES, stamp: false }, ['--mode', 'fast']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const [record] = rows<{ mapping_mode: string; completeness: string }>(roots, 'SELECT mapping_mode, completeness FROM project_records');
    assert.equal(record?.mapping_mode, 'fast');
    assert.equal(record?.completeness, 'partial');
  });
});
