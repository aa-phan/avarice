// Plan 04-31 (FR-3, FR-22, D-06, D-07, D-08): the groundwork of the AC-8 evaluation. This file holds the knowledge pass switch (`adapters.knowledgePass`, the
// key the D-08 rule sets) and the evaluation harness tests (dry run, leakage guards, verdict arithmetic). Nothing here calls a model: the host is a fake and the
// repositories are scratch repositories.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configPathFor } from '../../src/adapters/fs/profile-config.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { git, gitRun, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeKnowledgeHost } from '../helpers/fake-knowledge-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { KNOWLEDGE_REPO_FILES } from '../fixtures/knowledge.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

function rows<T>(roots: CliRoots, sql: string): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all() as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

function envFor(roots: CliRoots): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(temp('fake-graphify'), 'ok'),
  };
}

// The `adapters` section of the profile config as the harness writes it for an arm (written before the first composition).
function writeAdapters(roots: CliRoots, adapters: Record<string, unknown>): void {
  const path = configPathFor(roots.AVARICE_CONFIG_HOME, 'personal-local');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schema: 1, adapters }));
}

// Onboards a scratch repository with the given `adapters` section and says how the knowledge step ended and how many knowledge invocations the host saw.
async function onboardWith(adapters: Record<string, unknown> | undefined): Promise<{ knowledgeStep: { index: string; status: string } | undefined; knowledgeCalls: number; state: string }> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: KNOWLEDGE_REPO_FILES });
  cleanup.push(roots.base, repo.base);
  if (adapters !== undefined) writeAdapters(roots, adapters);
  const host = new FakeKnowledgeHost(new FakeAgentHost());
  const composed = createDeps(envFor(roots), { host });
  assert.ok(composed.ok, 'composition');
  try {
    const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok, 'the run itself does not fail');
    const stored = rows<{ result_json: string }>(roots, "SELECT result_json FROM onboarding_steps WHERE step = 'index:knowledge' AND status = 'completed'");
    const step = stored[0] === undefined ? undefined : (JSON.parse(stored[0].result_json) as { index: string; status: string });
    return { knowledgeStep: step, knowledgeCalls: host.calls.length, state: outcome.value.state };
  } finally {
    composed.value.close();
  }
}

describe('adapters.knowledgePass (D-08)', () => {
  it('records the knowledge step as disabled and runs no knowledge invocation when the key is false', async () => {
    const off = await onboardWith({ knowledgePass: false });
    assert.equal(off.state, 'active', 'a profile with the pass off still onboards');
    assert.equal(off.knowledgeCalls, 0);
    assert.deepEqual(off.knowledgeStep, { index: 'knowledge', status: 'disabled' });
  });

  it('runs the knowledge step as before when the key is true, or when the key or the whole section is absent', async () => {
    for (const adapters of [{ knowledgePass: true }, {}, undefined]) {
      const on = await onboardWith(adapters);
      assert.equal(on.state, 'active', JSON.stringify(adapters));
      assert.equal(on.knowledgeCalls, 1, `one knowledge invocation for ${JSON.stringify(adapters)}`);
      assert.equal(on.knowledgeStep?.status, 'present', JSON.stringify(adapters));
    }
  });

  it('refuses a value that is not a boolean at composition, naming adapters.knowledgePass, for a command that writes and for one that does not', () => {
    for (const value of ['false', 0, 1, null, [], {}]) {
      const roots = makeRoots();
      cleanup.push(roots.base);
      writeAdapters(roots, { knowledgePass: value });
      for (const options of [{}, { readOnly: true, gsd: true }]) {
        const composed = createDeps(envFor(roots), {}, options);
        if (composed.ok) {
          composed.value.close();
          assert.fail(`composition accepted ${JSON.stringify(value)}`);
        } else {
          assert.match(composed.message, /adapters\.knowledgePass/, composed.message);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The evaluation harness (scripts/eval-retrieval.ts): pure arithmetic, the approved list, the dry run, the leakage guards
// ---------------------------------------------------------------------------------------------------------------------------------------------

const harness = () => import('../../scripts/eval-retrieval.ts');
const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'eval-retrieval.ts');
const TASKS_FILE = join(import.meta.dirname, '..', 'benchmark', 'phase4', 'eval-tasks.json');

function runScript(args: readonly string[], env: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string } {
  const childEnv: Record<string, string | undefined> = { ...process.env, ...env };
  delete childEnv['NODE_TEST_CONTEXT'];
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT, ...args], { encoding: 'utf8', env: childEnv as NodeJS.ProcessEnv, timeout: 120_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A ledger file for the Phase 4 spend of the child process; `spent` USD already in it (none: the file does not exist).
function phase4Ledger(spent: number | undefined): { path: string; env: Record<string, string> } {
  const dir = temp('eval-ledger');
  const path = join(dir, 'live-spend-phase4.jsonl');
  if (spent !== undefined) writeFileSync(path, `${JSON.stringify({ plan: '04-00', case: 'earlier', costUsd: spent, claudeVersion: 'x', at: '2026-11-17T00:00:00.000Z' })}\n`);
  return { path, env: { AVARICE_PHASE4_LEDGER: path } };
}

describe('verdict (AC-8) and knowledgeRule (D-08)', () => {
  it('passes when arm B succeeds as often as A at no more than half of A tokens, and fails one token above half', async () => {
    const { verdict } = await harness();
    const pass = verdict({ A: { success: 10, tokens: 1000 }, B: { success: 10, tokens: 500 } });
    assert.equal(pass.pass, true);
    assert.equal(pass.via, 'B');
    assert.equal(verdict({ A: { success: 10, tokens: 1000 }, B: { success: 10, tokens: 501 } }).pass, false);
  });

  it('fails when the success of B and C is below A even at a tenth of the tokens, and passes through C when only C qualifies', async () => {
    const { verdict } = await harness();
    assert.equal(verdict({ A: { success: 10, tokens: 1000 }, B: { success: 9, tokens: 100 }, C: { success: 9, tokens: 100 } }).pass, false);
    const viaC = verdict({ A: { success: 10, tokens: 1000 }, B: { success: 9, tokens: 100 }, C: { success: 11, tokens: 400 } });
    assert.equal(viaC.pass, true);
    assert.equal(viaC.via, 'C');
  });

  it('compares success rates when the arms ran different numbers of tasks, and never passes against an arm A that measured no tokens', async () => {
    const { verdict } = await harness();
    assert.equal(verdict({ A: { success: 8, tokens: 1000, tasks: 10 }, B: { success: 4, tokens: 400, tasks: 5 } }).pass, true);
    assert.equal(verdict({ A: { success: 8, tokens: 1000, tasks: 10 }, B: { success: 3, tokens: 400, tasks: 5 } }).pass, false);
    const unmeasured = verdict({ A: { success: 1, tokens: 0 }, B: { success: 1, tokens: 0 } });
    assert.equal(unmeasured.pass, false);
    assert.match(unmeasured.reason, /arm A/);
  });

  it('turns the knowledge pass off only when C shows no success gain over B and costs more tokens', async () => {
    const { knowledgeRule } = await harness();
    assert.equal(knowledgeRule({ success: 8, tokens: 400 }, { success: 8, tokens: 450 }).outcome, 'off');
    assert.equal(knowledgeRule({ success: 8, tokens: 400 }, { success: 9, tokens: 450 }).outcome, 'on');
    assert.equal(knowledgeRule({ success: 8, tokens: 400 }, { success: 8, tokens: 400 }).outcome, 'on', 'equal tokens is not more');
    assert.equal(knowledgeRule({ success: 8, tokens: 400 }, { success: 7, tokens: 300 }).outcome, 'on', 'cheaper keeps the pass on even with no gain');
    assert.equal(knowledgeRule({ success: 8, tokens: 400 }, { success: 7, tokens: 900 }).outcome, 'off');
  });

  it('sums the runs per arm, counts the runs that could not be judged and states both outcomes', async () => {
    const { summarize } = await harness();
    const run = (arm: 'A' | 'B' | 'C', success: boolean, tokens: number, costUsd: number, judgeError?: string) => ({ task: 'T', arm, success, tokens, costUsd, runId: 'run_x', ...(judgeError !== undefined ? { judgeError } : {}) });
    const summary = summarize([run('A', true, 1000, 0.3), run('A', false, 2000, 0.4), run('B', true, 400, 0.2), run('B', true, 300, 0.2), run('C', true, 450, 0.25, 'dependencies-missing')]);
    assert.deepEqual(summary.arms['A'], { runs: 2, success: 1, tokens: 3000, costUsd: 0.7, judgeErrors: 0 });
    assert.deepEqual(summary.arms['B'], { runs: 2, success: 2, tokens: 700, costUsd: 0.4, judgeErrors: 0 });
    assert.equal(summary.arms['C']?.judgeErrors, 1);
    assert.equal(summary.ac8.pass, true);
    assert.ok(['on', 'off'].includes(summary.knowledge.outcome));
  });
});

describe('the approved task list', () => {
  it('loads the twenty approved tasks with the approval and the digest of the file', async () => {
    const { loadApprovedTasks } = await harness();
    const loaded = loadApprovedTasks(TASKS_FILE);
    assert.equal(loaded.tasks.length, 20);
    assert.equal(loaded.approvedBy, 'Aaron Phan');
    assert.match(loaded.digest, /^[0-9a-f]{64}$/);
    for (const task of loaded.tasks) {
      assert.match(task.commit, /^[0-9a-f]{40}$/);
      assert.match(task.parent, /^[0-9a-f]{40}$/);
      assert.ok(task.deniedReads.includes(task.heldOutTest), `${task.id} denies its held-out test`);
    }
  });

  it('refuses a list with approvedBy null, with approvedAt null, or that is not the expected shape', async () => {
    const { loadApprovedTasks, EvalRefusal } = await harness();
    const approved = JSON.parse(readFileSync(TASKS_FILE, 'utf8')) as Record<string, unknown>;
    const dir = temp('eval-tasks');
    for (const [name, change] of [
      ['by', { approvedBy: null }],
      ['at', { approvedAt: null }],
      ['empty', { approvedBy: '' }],
      ['tasks', { tasks: [] }],
      ['schema', { schema: 2 }],
    ] as const) {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify({ ...approved, ...change }));
      assert.throws(() => loadApprovedTasks(file), (e: unknown) => e instanceof EvalRefusal, name);
    }
    writeFileSync(join(dir, 'unapproved.json'), JSON.stringify({ ...approved, approvedBy: null }));
    assert.throws(() => loadApprovedTasks(join(dir, 'unapproved.json')), /not approved/);
  });
});

describe('the plan of runs and its projection', () => {
  it('plans every task under every arm with the cap, and charges the map of arm A only where the parent carries none', async () => {
    const { loadApprovedTasks, planRuns, projection } = await harness();
    const tasks = loadApprovedTasks(TASKS_FILE).tasks.slice(0, 3);
    const plan = planRuns(tasks, ['A', 'B', 'C'], { capUsd: 0.4, mapPresent: (task) => task.id === 'T02' });
    assert.equal(plan.length, 9);
    assert.deepEqual(plan.slice(0, 3).map((r) => [r.task.id, r.arm]), [['T01', 'A'], ['T01', 'B'], ['T01', 'C']]);
    assert.ok(plan.every((r) => r.runCapUsd === 0.4));
    const mapCharged = plan.filter((r) => r.mapCapUsd > 0).map((r) => `${r.task.id}${r.arm}`);
    assert.deepEqual(mapCharged, ['T01A', 'T03A']);
    const total = projection(plan);
    assert.equal(total.runs, 9);
    assert.ok(Math.abs(total.runUsd - 3.6) < 1e-9);
    assert.equal(total.mapParents, 2);
    assert.ok(Math.abs(total.totalUsd - (total.runUsd + total.onboardUsd + total.mapUsd)) < 1e-9);
  });
});

describe('--dry-run', () => {
  it('prints 9 planned runs for three tasks, projects the cost, exits 0 inside the ceiling and writes nothing to the ledger', () => {
    const ledger = phase4Ledger(undefined);
    const result = runScript(['--dry-run', '--tasks', '3'], ledger.env);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /\b9 planned runs\b/);
    for (const arm of ['A', 'B', 'C']) assert.match(result.stdout, new RegExp(`T01\\s+${arm}\\s`));
    assert.match(result.stdout, /projected/i);
    assert.match(result.stdout, /Phase 4 spend 0\.00 of 40\.00 USD/);
    assert.equal(existsSync(ledger.path), false, 'a dry run spends and records nothing');
  });

  it('exits non-zero with the D-03 refusal when the projection passes the ceiling, whether the ledger is near it or the ceiling is lowered', () => {
    const near = runScript(['--dry-run', '--tasks', '3'], phase4Ledger(39.9).env);
    assert.notEqual(near.code, 0);
    assert.match(near.stderr, /D-03/);
    assert.match(near.stderr, /ceiling/);
    const lowered = runScript(['--dry-run'], { ...phase4Ledger(undefined).env, AVARICE_PHASE4_CEILING_USD: '5' });
    assert.notEqual(lowered.code, 0);
    assert.match(lowered.stdout, /\b60 planned runs\b/);
    assert.match(lowered.stderr, /D-03/);
  });

  it('plans only the arms named', () => {
    const result = runScript(['--dry-run', '--tasks', '2', '--arms', 'B,C'], phase4Ledger(undefined).env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /\b4 planned runs\b/);
    assert.doesNotMatch(result.stdout, /T01\s+A\s/);
  });

  it('refuses a list that is not approved, and a call that names neither --dry-run nor --live, before anything else', () => {
    const approved = JSON.parse(readFileSync(TASKS_FILE, 'utf8')) as Record<string, unknown>;
    const file = join(temp('eval-unapproved'), 'eval-tasks.json');
    writeFileSync(file, JSON.stringify({ ...approved, approvedBy: null, approvedAt: null }));
    const refused = runScript(['--dry-run', '--tasks-file', file], phase4Ledger(undefined).env);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /not approved/);
    const usage = runScript(['--tasks', '3'], phase4Ledger(undefined).env);
    assert.equal(usage.code, 64);
  });

  it('refuses a live start whose plan passes the ceiling before it clones, onboards or spends anything', () => {
    const ledger = phase4Ledger(39.9);
    const scratch = temp('eval-scratch');
    const out = join(scratch, 'results.json');
    const result = runScript(['--live', '--tasks', '1', '--arms', 'A', '--out', out, '--scratch', scratch], { ...ledger.env, AVARICE_CLAUDE_BIN: '/nonexistent/claude' });
    assert.equal(result.code, 3, result.stderr + result.stdout);
    assert.match(result.stderr, /D-03/);
    assert.deepEqual(readdirSync(scratch), [], 'nothing was created in the scratch directory');
    assert.equal(readFileSync(ledger.path, 'utf8').split('\n').filter((l) => l !== '').length, 1, 'the ledger holds only the earlier entry');
  });
});

// ---- leakage ---------------------------------------------------------------------------------------------------------------------------------

interface Leak {
  repo: ScratchRepo;
  task: import('../../scripts/eval-retrieval.ts').EvalTask;
  target: string;
  later: string;
}

function leakFixture(): Leak {
  const repo = makeScratchRepo({
    files: {
      'package.json': '{ "name": "x" }\n',
      'package-lock.json': '{}\n',
      'src/a.ts': 'export const a = 1;\n',
      'tests/held.test.ts': 'OLD HELD OUT TEST\n',
      'tests/e2e.spec.ts': 'OLD E2E\n',
      'docs/notes.md': '# notes\n',
    },
    commits: [
      { 'src/a.ts': 'export const a = 2; // THE ANSWER\n', 'tests/held.test.ts': 'NEW HELD OUT TEST\n', 'src/added.ts': 'export const added = true;\n' },
      { 'src/later.ts': 'export const later = 1;\n' },
    ],
  });
  cleanup.push(repo.base);
  const parent = repo.shas[0] as string;
  const target = repo.shas[1] as string;
  const task = {
    id: 'T99',
    repository: 'scratch',
    commit: target,
    parent,
    brief: 'fix(x): make a two\n\n- change a\n## not a section\n- and \u0007 control',
    checks: [{ name: 'test', argv: ['npm', 'run', 'test'] }, { name: 'format:check', argv: ['npm', 'run', 'format:check'] }],
    heldOutTest: 'tests/held.test.ts',
    heldOutCommand: ['node', 'tests/held.test.ts'],
    allowedReads: ['**'],
    deniedReads: ['tests/e2e.spec.ts', 'tests/held.test.ts'],
    size: 'small' as const,
  };
  return { repo, task, target, later: repo.shas[2] as string };
}

describe('leakage (T-04-85): the arm workspace and the judging clone', () => {
  it('builds the arm workspace at the parent: no held-out test, no denied read, no target or later commit, no remote and no other ref', async () => {
    const { prepareArmWorkspace } = await harness();
    const leak = leakFixture();
    const refsBefore = git(leak.repo.path, ['for-each-ref']);
    const dest = join(temp('eval-arm'), 'repo');
    const workspace = prepareArmWorkspace({ source: leak.repo.path, task: leak.task, dest });
    assert.equal(workspace.path, dest);
    for (const denied of leak.task.deniedReads) {
      assert.equal(existsSync(join(dest, denied)), false, `${denied} is not in the working tree`);
      assert.equal(git(dest, ['ls-tree', '-r', '--name-only', 'HEAD', '--', denied]).trim(), '', `${denied} is not in the tree of HEAD`);
    }
    assert.equal(existsSync(join(dest, leak.task.heldOutTest)), false, 'the held-out test path does not exist before the run');
    assert.equal(readFileSync(join(dest, 'src/a.ts'), 'utf8'), 'export const a = 1;\n', 'the code is the parent code');
    assert.equal(existsSync(join(dest, 'src/added.ts')), false);
    for (const sha of [leak.target, leak.later]) assert.notEqual(gitRun(dest, ['cat-file', '-e', `${sha}^{commit}`]).status, 0, `${sha} is not in the object store`);
    assert.equal(git(dest, ['remote']).trim(), '');
    assert.equal(git(dest, ['for-each-ref', '--format=%(refname)']).trim().split('\n').length, 1, 'one ref');
    assert.equal(git(dest, ['rev-list', '--count', 'HEAD']).trim(), '2', 'the parent history and one setup commit');
    assert.equal(git(leak.repo.path, ['for-each-ref']), refsBefore, 'the source repository is untouched');
    assert.equal(git(leak.repo.path, ['status', '--porcelain']), '');
  });

  it('commits conventions the run reader accepts, with the task checks as required checks and a write set off the protected paths', async () => {
    const { prepareArmWorkspace } = await harness();
    const { parseConventions } = await import('../../src/domain/conventions.ts');
    const leak = leakFixture();
    const dest = join(temp('eval-arm'), 'repo');
    prepareArmWorkspace({ source: leak.repo.path, task: leak.task, dest });
    const parsed = parseConventions(git(dest, ['show', 'HEAD:.avarice/config.json']));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepEqual(parsed.value.checks.map((c) => c.name), ['test', 'format:check']);
    assert.ok(parsed.value.checks.every((c) => c.required));
    assert.ok(parsed.value.paths.write.includes('src/**') && parsed.value.paths.write.includes('docs/**'));
    assert.ok(!parsed.value.paths.write.some((glob) => glob.startsWith('.avarice') || glob.startsWith('.git')));
    assert.equal(parsed.value.dependencies?.lockfile, 'package-lock.json');
    assert.ok(git(dest, ['ls-tree', '--name-only', 'HEAD', '.planning/']).includes('.planning/ROADMAP.md'), 'GSD planning is present for the start checks');
  });

  it('stops when the held-out test or the target commit is anywhere an arm could read it', async () => {
    const { prepareArmWorkspace, assertNoLeak, EvalRefusal } = await harness();
    const leak = leakFixture();
    const dest = join(temp('eval-arm'), 'repo');
    prepareArmWorkspace({ source: leak.repo.path, task: leak.task, dest });
    assertNoLeak(dest, leak.task);
    writeFileSync(join(dest, leak.task.heldOutTest), 'planted');
    assert.throws(() => assertNoLeak(dest, leak.task), (e: unknown) => e instanceof EvalRefusal && /held-out/.test(e.message));
    rmSync(join(dest, leak.task.heldOutTest));
    git(dest, ['fetch', '-q', leak.repo.path, leak.target]);
    assert.throws(() => assertNoLeak(dest, leak.task), (e: unknown) => e instanceof EvalRefusal && /target commit/.test(e.message));
  });

  it('adds the held-out test from the target commit only in the judging clone, and leaves the arm workspace as the run left it', async () => {
    const { prepareArmWorkspace, prepareJudgeClone } = await harness();
    const leak = leakFixture();
    const dest = join(temp('eval-arm'), 'repo');
    prepareArmWorkspace({ source: leak.repo.path, task: leak.task, dest });
    git(dest, ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'agent work']);
    const judgeDir = join(temp('eval-judge'), 'judge');
    prepareJudgeClone({ workspace: dest, ref: 'HEAD', source: leak.repo.path, task: leak.task, dest: judgeDir });
    assert.equal(readFileSync(join(judgeDir, leak.task.heldOutTest), 'utf8'), 'NEW HELD OUT TEST\n', 'the held-out test is the target commit version');
    assert.equal(readFileSync(join(judgeDir, 'src/a.ts'), 'utf8'), 'export const a = 1;\n', 'the code is what the run left, not the target');
    assert.equal(existsSync(join(dest, leak.task.heldOutTest)), false, 'the arm workspace never gets it');
    assert.equal(git(dest, ['status', '--porcelain']), '');
  });
});

describe('judging', () => {
  const executor = (statuses: Record<string, 'passed' | 'failed'>, calls: Array<{ argv: readonly string[]; cwd: string }>) => ({
    descriptor: { port: 'executor', adapter: 'fake', version: '1', capabilities: {}, attributes: {}, offline: true },
    async run(cmd: { argv: readonly string[]; cwd: string }) {
      calls.push({ argv: cmd.argv, cwd: cmd.cwd });
      const status = statuses[cmd.argv.join(' ')] ?? 'passed';
      return { ok: true as const, value: { exitCode: status === 'passed' ? 0 : 1, signal: null, status, durationMs: 1, stdout: '', stderr: '', truncated: false } };
    },
  });

  it('succeeds only when every required check and the held-out test pass, and reports a failing held-out test as a failure, not an error', async () => {
    const { judgeClone } = await harness();
    const leak = leakFixture();
    const dir = temp('eval-judge-run');
    const calls: Array<{ argv: readonly string[]; cwd: string }> = [];
    const task = { ...leak.task, checks: [{ name: 'test', argv: ['node', '--check'] }] };
    writeFileSync(join(dir, 'x'), '');
    const passed = await judgeClone({ cwd: dir, task, executor: executor({}, calls) as never, nodeModules: undefined, skipDependencies: true });
    assert.equal(passed.success, true);
    assert.deepEqual(calls.map((c) => c.argv.join(' ')), ['node --check', 'node tests/held.test.ts']);
    const failedHeld = await judgeClone({ cwd: dir, task, executor: executor({ 'node tests/held.test.ts': 'failed' }, []) as never, nodeModules: undefined, skipDependencies: true });
    assert.equal(failedHeld.success, false);
    assert.equal(failedHeld.error, undefined);
    const failedCheck = await judgeClone({ cwd: dir, task, executor: executor({ 'node --check': 'failed' }, []) as never, nodeModules: undefined, skipDependencies: true });
    assert.equal(failedCheck.success, false);
  });

  it('reports missing dependencies as a judging error, never as a failed task', async () => {
    const { judgeClone } = await harness();
    const leak = leakFixture();
    const dir = temp('eval-judge-deps');
    writeFileSync(join(dir, 'package.json'), '{}');
    const verdict = await judgeClone({ cwd: dir, task: leak.task, executor: executor({}, []) as never, nodeModules: undefined });
    assert.equal(verdict.success, false);
    assert.match(verdict.error ?? '', /dependencies-missing/);
  });
});

describe('the brief of a run', () => {
  it('is the commit message under the title, parses with the real brief parser, and keeps a heading line in the message from opening a section', async () => {
    const { briefFor } = await harness();
    const { parseBrief } = await import('../../src/domain/brief.ts');
    const leak = leakFixture();
    const text = briefFor(leak.task);
    const parsed = parseBrief(text, { kind: 'file', id: 'brief.md' });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.equal(parsed.value.title, 'fix(x): make a two');
    assert.match(parsed.value.behavior, /change a/);
    assert.match(text, /verifiedBy: check:test, check:format:check/);
    assert.match(text, /^size: small$/m);
    assert.doesNotMatch(text, /\u0007/);
  });
});
