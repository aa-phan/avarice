// Plan 04-31 (FR-3, FR-22, D-06, D-07, D-08): the groundwork of the AC-8 evaluation. This file holds the knowledge pass switch (`adapters.knowledgePass`, the
// key the D-08 rule sets) and the evaluation harness tests (dry run, leakage guards, verdict arithmetic). Nothing here calls a model: the host is a fake and the
// repositories are scratch repositories.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    mkdirSync(dirname(join(dest, leak.task.heldOutTest)), { recursive: true });
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

  // The historical commit messages of the portfolio ask for "unit and e2e coverage". The harness runs and judges the four required checks and the held-out unit test only (the
  // e2e spec is a denied read and `npm run test:e2e` is neither a required check nor an allowed command), so a unit that took the bullet literally finished the change, found the
  // e2e coverage unverifiable and ended on a question, which the run recorded as an acceptance decision (the diagnostic of plan 04-36: run_01M7VBZJC2MK5J2KQYM89QHPTJ).
  it('states, for every task alike, that only the required checks run here and that end-to-end work is out of scope and no reason to ask or stop, and keeps the commit message whole', async () => {
    const { briefFor } = await harness();
    const { parseBrief } = await import('../../src/domain/brief.ts');
    const leak = leakFixture();
    const e2e = { ...leak.task, brief: 'fix(x): reduced then off\n\n- hold the loader\n- Add unit and e2e coverage for the reduced-then-off case' };
    const text = briefFor(e2e);
    const parsed = parseBrief(text, { kind: 'file', id: 'brief.md' });
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.match(parsed.value.behavior, /Add unit and e2e coverage for the reduced-then-off case/, 'the commit message is kept whole');
    assert.match(parsed.value.behavior, /hold the loader/);
    const behavior = parsed.value.behavior;
    assert.match(behavior, /Only the required checks can run in this environment/);
    for (const check of e2e.checks) assert.ok(behavior.includes(check.argv.join(' ')), `names ${check.argv.join(' ')}`);
    assert.match(behavior, /end-to-end or browser test/i);
    assert.match(behavior, /out of scope/i);
    assert.match(behavior, /do not write it, do not ask whether to cover it and do not stop for it/i);
    assert.match(behavior, /finish the rest of the change/i);
    // The same wording for a task that does not mention e2e: the arms and the tasks are briefed alike.
    const plain = parseBrief(briefFor(leak.task), { kind: 'file', id: 'brief.md' });
    assert.ok(plain.ok);
    assert.match(plain.value.behavior, /Only the required checks can run in this environment/);
    assert.equal(plain.value.title, 'fix(x): make a two');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Plan 04-36: the task selector, the merge of a results file and the arm C onboarding cap (the owner's ruling of 2026-11-19 on the balanced-9 evaluation)
// ---------------------------------------------------------------------------------------------------------------------------------------------

describe('the --task-ids selector (plan 04-36)', () => {
  it('selects the named approved tasks in the order given, and refuses an id that is not on the approved list, a repeat or an empty list', async () => {
    const { loadApprovedTasks, selectTasks, EvalRefusal } = await harness();
    const approved = loadApprovedTasks(TASKS_FILE);
    assert.deepEqual(selectTasks(approved, { ids: ['T16', 'T01', 'T07'] }).map((t) => t.id), ['T16', 'T01', 'T07']);
    assert.deepEqual(selectTasks(approved, { first: 2 }).map((t) => t.id), ['T01', 'T02']);
    assert.equal(selectTasks(approved, {}).length, 20);
    for (const ids of [['T21'], ['T01', 'T99'], ['T01', 'T01'], [], ['t01'], ['T01 ']]) {
      assert.throws(() => selectTasks(approved, { ids }), (e: unknown) => e instanceof EvalRefusal, JSON.stringify(ids));
    }
  });

  it('plans only the named tasks on --dry-run, prints the digest of the approved file and spends nothing', async () => {
    const { loadApprovedTasks } = await harness();
    const ledger = phase4Ledger(undefined);
    const result = runScript(['--dry-run', '--task-ids', 'T01,T07,T16'], ledger.env);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /\b9 planned runs\b/);
    for (const id of ['T01', 'T07', 'T16']) for (const arm of ['A', 'B', 'C']) assert.match(result.stdout, new RegExp(`${id}\\s+${arm}\\s`));
    assert.doesNotMatch(result.stdout, /T02\s+[ABC]\s/);
    assert.ok(result.stdout.includes(`sha256 ${loadApprovedTasks(TASKS_FILE).digest}`), 'the approved digest is printed');
    assert.equal(existsSync(ledger.path), false);
  });

  it('refuses an id that is not approved, a selector given together with --tasks, and a list that is not approved, before any plan is printed', () => {
    const ledger = phase4Ledger(undefined);
    const unknown = runScript(['--dry-run', '--task-ids', 'T01,T21'], ledger.env);
    assert.equal(unknown.code, 3, unknown.stderr);
    assert.match(unknown.stderr, /refused/);
    assert.match(unknown.stderr, /T21/);
    assert.doesNotMatch(unknown.stdout, /planned runs/);
    const both = runScript(['--dry-run', '--task-ids', 'T01', '--tasks', '3'], ledger.env);
    assert.equal(both.code, 64, both.stderr);
    const approved = JSON.parse(readFileSync(TASKS_FILE, 'utf8')) as Record<string, unknown>;
    const file = join(temp('eval-ids-unapproved'), 'eval-tasks.json');
    writeFileSync(file, JSON.stringify({ ...approved, approvedBy: null }));
    const unapproved = runScript(['--dry-run', '--task-ids', 'T01', '--tasks-file', file], ledger.env);
    assert.equal(unapproved.code, 3);
    assert.match(unapproved.stderr, /not approved/);
  });
});

function resultsFileWith(runs: Array<{ task: string; arm: 'A' | 'B' | 'C' }>, sha256: string): string {
  const file = join(temp('eval-merge'), 'eval-results.json');
  const body = runs.map((r) => ({ task: r.task, arm: r.arm, success: r.arm !== 'A', tokens: 1000, costUsd: 0.25, runId: `run_${r.task}${r.arm}`, state: 'succeeded', tokensComplete: true, setup: { costUsd: 0.1, tokens: 10, mapCostUsd: 0 } }));
  writeFileSync(file, `${JSON.stringify({ schema: 1, kind: 'avarice-ac8-evaluation', tasksFile: { sha256 }, runs: body })}\n`);
  return file;
}

describe('merging a results file (plan 04-36)', () => {
  it('skips a recorded (task, arm) and renumbers what is left, and never lists a pair twice', async () => {
    const { loadApprovedTasks, planRuns, skipRecorded } = await harness();
    const tasks = loadApprovedTasks(TASKS_FILE).tasks.slice(0, 3);
    const plan = planRuns(tasks, ['A', 'B', 'C'], { capUsd: 0.4, mapPresent: () => true });
    const left = skipRecorded(plan, [{ task: 'T01', arm: 'A' }, { task: 'T01', arm: 'B' }, { task: 'T01', arm: 'C' }, { task: 'T02', arm: 'B' }]);
    assert.deepEqual(left.map((r) => `${r.task.id}${r.arm}`), ['T02A', 'T02C', 'T03A', 'T03B', 'T03C']);
    assert.deepEqual(left.map((r) => r.n), [1, 2, 3, 4, 5]);
    assert.equal(skipRecorded(plan, []).length, 9);
    assert.equal(skipRecorded(plan, plan.map((r) => ({ task: r.task.id, arm: r.arm }))).length, 0);
  });

  it('reads the recorded runs of a results file of the same approved list and refuses one of another list, a malformed one or a duplicate pair', async () => {
    const { loadApprovedTasks, readRecordedRuns, EvalRefusal } = await harness();
    const digest = loadApprovedTasks(TASKS_FILE).digest;
    const good = resultsFileWith([{ task: 'T01', arm: 'A' }, { task: 'T01', arm: 'B' }], digest);
    const read = readRecordedRuns(good, digest);
    assert.deepEqual(read.map((r) => `${r.task}${r.arm}`), ['T01A', 'T01B']);
    assert.throws(() => readRecordedRuns(resultsFileWith([{ task: 'T01', arm: 'A' }], 'f'.repeat(64)), digest), (e: unknown) => e instanceof EvalRefusal && /list/.test(e.message));
    assert.throws(() => readRecordedRuns(resultsFileWith([{ task: 'T01', arm: 'A' }, { task: 'T01', arm: 'A' }], digest), digest), (e: unknown) => e instanceof EvalRefusal);
    const bad = join(temp('eval-merge-bad'), 'r.json');
    writeFileSync(bad, '{ not json');
    assert.throws(() => readRecordedRuns(bad, digest), (e: unknown) => e instanceof EvalRefusal);
    assert.deepEqual(readRecordedRuns(join(temp('eval-merge-none'), 'absent.json'), digest), []);
  });

  it('lists only the runs not yet recorded on --dry-run --merge', async () => {
    const { loadApprovedTasks } = await harness();
    const file = resultsFileWith([{ task: 'T01', arm: 'A' }, { task: 'T01', arm: 'B' }, { task: 'T01', arm: 'C' }], loadApprovedTasks(TASKS_FILE).digest);
    const result = runScript(['--dry-run', '--task-ids', 'T01,T04', '--merge', '--out', file], phase4Ledger(undefined).env);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /\b3 planned runs\b/);
    assert.doesNotMatch(result.stdout, /T01\s+[ABC]\s/);
    assert.match(result.stdout, /T04\s+A\s/);
    assert.match(result.stdout, /3 recorded run/);
  });

  it('refuses a live start over a results file that holds runs unless --merge is given, before it clones, onboards or spends anything', async () => {
    const { loadApprovedTasks } = await harness();
    const file = resultsFileWith([{ task: 'T01', arm: 'A' }], loadApprovedTasks(TASKS_FILE).digest);
    const before = readFileSync(file, 'utf8');
    const scratch = temp('eval-merge-scratch');
    const result = runScript(['--live', '--task-ids', 'T01', '--arms', 'A', '--out', file, '--scratch', scratch], { ...phase4Ledger(undefined).env, AVARICE_CLAUDE_BIN: '/nonexistent/claude' });
    assert.equal(result.code, 3, result.stderr + result.stdout);
    assert.match(result.stderr, /--merge/);
    assert.equal(readFileSync(file, 'utf8'), before, 'the recorded results are not rewritten');
    assert.deepEqual(readdirSync(scratch), []);
  });

  it('ends a live --merge with nothing to run without starting a model, spending or rewriting the file', async () => {
    const { loadApprovedTasks } = await harness();
    const file = resultsFileWith([{ task: 'T01', arm: 'A' }, { task: 'T01', arm: 'B' }], loadApprovedTasks(TASKS_FILE).digest);
    const before = readFileSync(file, 'utf8');
    const ledger = phase4Ledger(undefined);
    const scratch = temp('eval-merge-nothing');
    const result = runScript(['--live', '--merge', '--task-ids', 'T01', '--arms', 'A,B', '--out', file, '--scratch', scratch], { ...ledger.env, AVARICE_CLAUDE_BIN: '/nonexistent/claude' });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /nothing to run/);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.equal(existsSync(ledger.path), false);
    assert.deepEqual(readdirSync(scratch), []);
  });

  it('refuses --merge over a results file of another approved list', () => {
    const file = resultsFileWith([{ task: 'T01', arm: 'A' }], 'e'.repeat(64));
    const result = runScript(['--dry-run', '--merge', '--task-ids', 'T04', '--out', file], phase4Ledger(undefined).env);
    assert.equal(result.code, 3, result.stderr);
    assert.match(result.stderr, /refused/);
  });
});

describe('the conventions file and the repository formatter (plan 04-36)', () => {
  // The harness's own `.avarice/config.json` is not formatted the way prettier prints it, so a repository whose `format:check` runs `prettier --check .` and does not ignore
  // `.avarice/` would fail that required check at the setup commit, for every arm, before the agent changed anything (found by judging a parent offline, plan 04-36).
  function setupFixture(files: Record<string, string>) {
    const repo = makeScratchRepo({ files: { 'src/a.ts': 'export const a = 1;\n', ...files }, commits: [{ 'src/a.ts': 'export const a = 2;\n' }] });
    cleanup.push(repo.base);
    const task = {
      id: 'T98',
      repository: 'scratch',
      commit: repo.shas[1] as string,
      parent: repo.shas[0] as string,
      brief: 'fix(x): a\n',
      checks: [{ name: 'format:check', argv: ['npm', 'run', 'format:check'] }],
      heldOutTest: 'tests/held.test.ts',
      heldOutCommand: ['node', 'tests/held.test.ts'],
      allowedReads: ['**'],
      deniedReads: ['tests/held.test.ts'],
      size: 'small' as const,
    };
    return { repo, task };
  }
  const PRETTIER_PACKAGE = '{ "name": "x", "scripts": { "format:check": "prettier --check ." }, "devDependencies": { "prettier": "3.0.0" } }\n';

  it('adds .avarice/ to an existing .prettierignore of a repository that uses prettier, in the setup commit, once', async () => {
    const { prepareArmWorkspace } = await harness();
    const { repo, task } = setupFixture({ 'package.json': PRETTIER_PACKAGE, '.prettierignore': 'node_modules\ndocs/' });
    const dest = join(temp('eval-fmt'), 'repo');
    prepareArmWorkspace({ source: repo.path, task, dest });
    assert.equal(readFileSync(join(dest, '.prettierignore'), 'utf8'), 'node_modules\ndocs/\n.avarice/\n');
    assert.equal(git(dest, ['status', '--porcelain']).trim(), '', 'committed in the setup commit');
    assert.match(git(dest, ['show', '--stat', '--format=', 'HEAD']), /\.prettierignore/);
    const again = join(temp('eval-fmt2'), 'repo');
    const { repo: ignoring, task: ignoringTask } = setupFixture({ 'package.json': PRETTIER_PACKAGE, '.prettierignore': 'node_modules\n.avarice/\n' });
    prepareArmWorkspace({ source: ignoring.path, task: ignoringTask, dest: again });
    assert.equal(readFileSync(join(again, '.prettierignore'), 'utf8'), 'node_modules\n.avarice/\n', 'a repository that already ignores it is left as it is');
  });

  it('creates .prettierignore for a repository that uses prettier without one, and leaves a repository without prettier alone', async () => {
    const { prepareArmWorkspace } = await harness();
    const withPrettier = setupFixture({ 'package.json': PRETTIER_PACKAGE });
    const a = join(temp('eval-fmt3'), 'repo');
    prepareArmWorkspace({ source: withPrettier.repo.path, task: withPrettier.task, dest: a });
    assert.equal(readFileSync(join(a, '.prettierignore'), 'utf8'), '.avarice/\n');
    const without = setupFixture({ 'package.json': '{ "name": "x" }\n' });
    const b = join(temp('eval-fmt4'), 'repo');
    prepareArmWorkspace({ source: without.repo.path, task: without.task, dest: b });
    assert.equal(existsSync(join(b, '.prettierignore')), false);
    const python = setupFixture({});
    const c = join(temp('eval-fmt5'), 'repo');
    prepareArmWorkspace({ source: python.repo.path, task: python.task, dest: c });
    assert.equal(existsSync(join(c, '.prettierignore')), false);
  });
});

describe('the paths the checks write (plan 04-36)', () => {
  // The run validates every required check once before any model call and blocks the run when a check writes outside the paths it declares. `tsc -b` writes
  // node_modules/.tmp/*.tsbuildinfo and vitest writes node_modules/.cache/imagetools, node_modules/.vite and node_modules/.vitest-cache, so a check list that declares no
  // `writes` blocked every T01 run on the portfolio repository with a permission decision before it started (diagnosed by a kept run, plan 04-36).
  const TOOL_CACHES = ['node_modules/.tmp/tsconfig.app.tsbuildinfo', 'node_modules/.cache/imagetools/09b7c31399', 'node_modules/.vite/vitest/da39a3ee5e/results.json', 'node_modules/.vite-temp/vitest.config.ts.timestamp-1.mjs', 'node_modules/.vitest-cache/a.json'];

  it('declares the dependency tree tool caches as writes of every check when the parent has an npm lockfile, and nothing outside them', async () => {
    const { prepareArmWorkspace } = await harness();
    const { parseConventions } = await import('../../src/domain/conventions.ts');
    const { matchesAny } = await import('../../src/domain/glob.ts');
    const leak = leakFixture();
    const dest = join(temp('eval-writes'), 'repo');
    prepareArmWorkspace({ source: leak.repo.path, task: leak.task, dest });
    const parsed = parseConventions(git(dest, ['show', 'HEAD:.avarice/config.json']));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.ok(parsed.value.checks.length > 0);
    for (const check of parsed.value.checks) {
      for (const path of TOOL_CACHES) assert.ok(matchesAny(path, check.writes), `${check.name} declares ${path}`);
      assert.ok(!matchesAny('src/a.ts', check.writes) && !matchesAny('node_modules/left-pad/index.js', check.writes), `${check.name} declares no source path and no installed package`);
    }
  });

  it('keeps the declared writes off the protected paths the run contract enforces, and declares none for a repository without an npm lockfile', async () => {
    const { conventionsFor } = await harness();
    const { ROUTINE_PRESET } = await import('../../src/domain/run-contract.ts');
    const { matchesAny } = await import('../../src/domain/glob.ts');
    const task = { id: 'T98', checks: [{ name: 'test', argv: ['npm', 'run', 'test'] }] } as never;
    const withLock = conventionsFor(task, ['src'], ['package.json'], true) as { checks: Array<{ writes?: string[] }> };
    const writes = withLock.checks[0]?.writes ?? [];
    assert.ok(writes.length > 0);
    for (const glob of writes) assert.ok(!matchesAny(glob.replace(/\*\*$/, 'x'), ROUTINE_PRESET.protected), `${glob} is not protected`);
    const without = conventionsFor(task, ['src'], ['setup.py'], false) as { checks: Array<Record<string, unknown>> };
    assert.equal(without.checks[0]?.['writes'], undefined);
  });
});

describe('the arm C onboarding cap (plan 04-36)', () => {
  it('is 1.10 USD, above the 0.974 USD the knowledge pass cost on the largest repository, and the plan charges it', async () => {
    const { ONBOARD_CAP_USD, loadApprovedTasks, planRuns } = await harness();
    assert.equal(ONBOARD_CAP_USD.C, 1.1);
    assert.equal(ONBOARD_CAP_USD.A, 0.6);
    assert.equal(ONBOARD_CAP_USD.B, 0.6);
    const plan = planRuns(loadApprovedTasks(TASKS_FILE).tasks.slice(0, 1), ['A', 'B', 'C'], { capUsd: 0.4, mapPresent: () => true });
    assert.deepEqual(plan.map((r) => r.onboardCapUsd), [0.6, 0.6, 1.1]);
  });
});

describe('the results document (plan 04-36)', () => {
  // The plan's automated check reads `verdict` and `knowledgeRule` at the top level of the results file; the harness wrote the same two values under `summary` only.
  it('carries the AC-8 verdict and the D-08 outcome at the top level, equal to the summary, with the header and the runs kept', async () => {
    const { resultsDocument, summarize } = await harness();
    const runs = [
      { task: 'T01', arm: 'A' as const, success: false, tokens: 1000, costUsd: 0.1, runId: 'r1', state: 'x', tokensComplete: true, setup: { costUsd: 0, tokens: 0, mapCostUsd: 0 } },
      { task: 'T01', arm: 'B' as const, success: true, tokens: 400, costUsd: 0.1, runId: 'r2', state: 'x', tokensComplete: true, setup: { costUsd: 0, tokens: 0, mapCostUsd: 0 } },
      { task: 'T01', arm: 'C' as const, success: true, tokens: 450, costUsd: 0.1, runId: 'r3', state: 'x', tokensComplete: true, setup: { costUsd: 0, tokens: 0, mapCostUsd: 0 } },
    ];
    const doc = resultsDocument({ schema: 1, kind: 'avarice-ac8-evaluation' }, runs, undefined);
    const summary = summarize(runs);
    assert.deepEqual(doc['verdict'], summary.ac8);
    assert.deepEqual(doc['knowledgeRule'], summary.knowledge);
    assert.deepEqual(doc['summary'], summary);
    assert.equal(doc['schema'], 1);
    assert.equal((doc['runs'] as unknown[]).length, 3);
    assert.equal('stopped' in doc, false);
    assert.equal(resultsDocument({}, runs, 'ceiling: x')['stopped'], 'ceiling: x');
    assert.equal((doc['verdict'] as { pass: boolean }).pass, true);
    assert.equal((doc['knowledgeRule'] as { outcome: string }).outcome, 'on');
  });
});

describe('the per-run evidence the harness keeps (plan 04-36, owner ruling 3)', () => {
  // A blocked run's scratch was removed before anyone read its decision record or its transcript, so a stop could not be classified. The harness now copies the run's
  // records into an evidence directory before it removes the scratch. Everything it copies is redacted with the AVARICE redactor, and the copy is bounded.
  const TRANSCRIPT_BODY =
    [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cd src && npm run test 2>&1 | tail"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"Permission to use Bash has been denied."}]}}',
      '{"type":"result","subtype":"success","num_turns":6}',
    ].join('\n') + '\n';

  interface Seed {
    blocked: boolean;
    secret?: string;
    transcript?: string;
    extraEvents?: number;
  }

  // A scratch the way a run leaves it: `<dir>/arm/data/state.db` (the ledger tables the evidence reads), a transcript blob in the artifact store and the arm's
  // repository at `<dir>/repo` (which the copy must never read).
  function scratchWith(seed: Seed): { dir: string; dataRoot: string } {
    const dir = temp('eval-evidence-scratch');
    const dataRoot = join(dir, 'arm', 'data');
    mkdirSync(dataRoot, { recursive: true });
    const db = new DatabaseSync(join(dataRoot, 'state.db'));
    const secret = seed.secret ?? '';
    try {
      db.exec(`
        CREATE TABLE runs (run_id TEXT PRIMARY KEY, project_id TEXT, state TEXT, version INTEGER, reason TEXT, title TEXT);
        CREATE TABLE work_items (run_id TEXT, item_id TEXT, type TEXT, state TEXT, attempts INTEGER, spec_json TEXT);
        CREATE TABLE attempts (attempt_id TEXT PRIMARY KEY, run_id TEXT, ordinal INTEGER, outcome TEXT);
        CREATE TABLE run_steps (run_id TEXT, step TEXT, attempt INTEGER, status TEXT, result_json TEXT);
        CREATE TABLE decisions (decision_id TEXT PRIMARY KEY, run_id TEXT, class TEXT, issue TEXT, options_json TEXT, state TEXT, urgency TEXT);
        CREATE TABLE contracts (run_id TEXT, version INTEGER, body_json TEXT);
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, level TEXT, type TEXT, run_id TEXT, attempt_id TEXT, invocation_id TEXT, data_json TEXT);
        CREATE TABLE artifacts (digest TEXT PRIMARY KEY, size INTEGER, kind TEXT, run_id TEXT, retention TEXT, created_at TEXT, store TEXT);
      `);
      const state = seed.blocked ? 'blocked_on_decision' : 'closed';
      db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?)').run('run_X1', 'proj_1', state, 4, seed.blocked ? 'decision' : null, `brief ${secret}`);
      db.prepare('INSERT INTO work_items VALUES (?, ?, ?, ?, ?, ?)').run('run_X1', 'A', 'implement', seed.blocked ? 'blocked' : 'done', 1, '{"title":"unit A"}');
      db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?)').run('att_1', 'run_X1', 1, seed.blocked ? 'denied' : 'ok');
      db.prepare('INSERT INTO run_steps VALUES (?, ?, ?, ?, ?)').run('run_X1', 'launch', 1, 'completed', JSON.stringify({ outcome: 'denied', note: secret }));
      db.prepare('INSERT INTO contracts VALUES (?, ?, ?)').run('run_X1', 1, '{"policy":"routine"}');
      if (seed.blocked) {
        db.prepare('INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?)').run('dec_1', 'run_X1', 'permission', `the unit made no in-scope change; the host or the hook denied 4 call(s) ${secret}`, '[{"id":"withdraw"}]', 'open', 'blocking');
      }
      const event = db.prepare('INSERT INTO events (ts, level, type, run_id, attempt_id, invocation_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
      event.run('2026-11-20T00:00:00.000Z', 'warn', 'hook.decision', 'run_X1', null, 'inv_1', JSON.stringify({ tool: 'Glob', decision: 'deny', rule: 'outside-read-set', target: secret }));
      for (let i = 0; i < (seed.extraEvents ?? 0); i += 1) event.run('2026-11-20T00:00:01.000Z', 'info', 'tool.completed', 'run_X1', null, 'inv_1', JSON.stringify({ tool: 'Read', i }));
      const transcript = seed.transcript ?? TRANSCRIPT_BODY;
      const hex = createHash('sha256').update(transcript).digest('hex');
      mkdirSync(join(dataRoot, 'artifacts', hex.slice(0, 2)), { recursive: true });
      writeFileSync(join(dataRoot, 'artifacts', hex.slice(0, 2), hex), transcript);
      db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?)').run(`sha256:${hex}`, transcript.length, 'transcript', 'run_X1', 'run', '2026-11-20T00:00:02.000Z', 'local');
    } finally {
      db.close();
    }
    mkdirSync(join(dir, 'repo'), { recursive: true });
    writeFileSync(join(dir, 'repo', 'owner-private.txt'), 'OWNER-CHECKOUT-CONTENT-MUST-NOT-BE-COPIED\n');
    return { dir, dataRoot };
  }

  function filesUnder(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else out.push(path);
      }
    };
    walk(root);
    return out.sort();
  }

  const allText = (root: string): string => filesUnder(root).map((f) => readFileSync(f, 'latin1')).join('\n');

  it('copies the decision records, run, work-item and attempt rows, steps, events with their hook decisions and the host transcript of a blocked run', async () => {
    const { captureEvidence } = await harness();
    const { dataRoot } = scratchWith({ blocked: true });
    const dest = join(temp('eval-evidence-dest'), 'T01-B');
    const manifest = captureEvidence({ dataRoot, dest });
    const read = (name: string): Array<Record<string, unknown>> => readFileSync(join(dest, name), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.match(String(read('decisions.jsonl')[0]?.['issue']), /the unit made no in-scope change; the host or the hook denied 4 call\(s\)/);
    assert.equal(read('runs.jsonl')[0]?.['state'], 'blocked_on_decision');
    assert.equal(read('work_items.jsonl')[0]?.['item_id'], 'A');
    assert.equal(read('attempts.jsonl')[0]?.['outcome'], 'denied');
    assert.equal(read('run_steps.jsonl')[0]?.['step'], 'launch');
    assert.equal(read('contracts.jsonl')[0]?.['version'], 1);
    const events = read('events.jsonl');
    assert.equal(events[0]?.['type'], 'hook.decision');
    assert.match(String(events[0]?.['data_json']), /outside-read-set/);
    const transcripts = filesUnder(join(dest, 'transcripts'));
    assert.equal(transcripts.length, 1);
    assert.equal(readFileSync(transcripts[0] as string, 'utf8'), TRANSCRIPT_BODY);
    assert.deepEqual(manifest.truncated, []);
    assert.ok(manifest.files.some((f) => f.name === 'decisions.jsonl' && f.rows === 1));
    assert.deepEqual(JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')), JSON.parse(JSON.stringify(manifest)));
  });

  it('copies on a success too, with no decision record, and reads nothing but the data root: the arm repository is never copied', async () => {
    const { captureEvidence } = await harness();
    const { dataRoot } = scratchWith({ blocked: false });
    const dest = join(temp('eval-evidence-dest'), 'T01-A');
    const manifest = captureEvidence({ dataRoot, dest });
    assert.equal(readFileSync(join(dest, 'decisions.jsonl'), 'utf8'), '');
    assert.match(readFileSync(join(dest, 'runs.jsonl'), 'utf8'), /"state":"closed"/);
    assert.equal(filesUnder(join(dest, 'transcripts')).length, 1);
    assert.ok(manifest.bytes > 0);
    assert.doesNotMatch(allText(dest), /OWNER-CHECKOUT-CONTENT-MUST-NOT-BE-COPIED/);
  });

  it('redacts a seeded secret and every secret-shaped string from every row and the transcript, and a positive control shows the raw scratch holds them', async () => {
    const { captureEvidence } = await harness();
    const { Redactor } = await import('../../src/domain/redactor.ts');
    const { SECRET_CORPUS, SEEDED_VALUE, scanForCorpus, scanTotal } = await import('../helpers/secret-corpus.ts');
    const text = `${SECRET_CORPUS.map((e) => e.text).join(' | ')} | ${SEEDED_VALUE}`;
    const transcript = `${TRANSCRIPT_BODY}{"type":"user","message":{"content":[{"type":"tool_result","content":${JSON.stringify(text)}}]}}\n`;
    const { dataRoot } = scratchWith({ blocked: true, secret: text, transcript });
    // The positive control: the scratch the copy reads from holds the secrets.
    const raw = `${readFileSync(join(dataRoot, 'state.db')).toString('latin1')}\n${allText(join(dataRoot, 'artifacts'))}`;
    assert.ok(scanTotal(scanForCorpus(raw)) > 0, 'the raw scratch holds the corpus');
    const redactor = new Redactor();
    assert.ok(redactor.seed(SEEDED_VALUE).ok);
    const dest = join(temp('eval-evidence-dest'), 'T01-C');
    captureEvidence({ dataRoot, dest, redactor });
    const copied = allText(dest);
    const scan = scanForCorpus(copied);
    assert.equal(scanTotal(scan), 0, JSON.stringify(scan));
    assert.match(copied, /\[REDACTED:seeded\]/);
    assert.match(copied, /\[REDACTED:/);
    for (const entry of SECRET_CORPUS) assert.ok(!copied.includes(entry.text), entry.kind);
    // What is not secret is kept: the evidence is still readable.
    assert.match(copied, /outside-read-set/);
    assert.match(copied, /Permission to use Bash has been denied/);
  });

  it('is bounded: a run over the cap keeps whole lines up to it, ends each cut file with a note and records every truncation in the manifest', async () => {
    const { captureEvidence, EVIDENCE_CAP_BYTES } = await harness();
    assert.equal(EVIDENCE_CAP_BYTES, 5 * 1024 * 1024);
    const bigTranscript = '{"type":"assistant","text":"line of the transcript"}\n'.repeat(4000);
    const { dataRoot } = scratchWith({ blocked: true, transcript: bigTranscript, extraEvents: 300 });
    const dest = join(temp('eval-evidence-dest'), 'T01-B');
    const capBytes = 6000;
    const manifest = captureEvidence({ dataRoot, dest, capBytes });
    const total = filesUnder(dest).filter((f) => !f.endsWith('manifest.json')).reduce((n, f) => n + statSync(f).size, 0);
    assert.ok(total <= capBytes, `${total} bytes kept, cap ${capBytes}`);
    assert.equal(manifest.capBytes, capBytes);
    assert.ok(manifest.truncated.length > 0, 'a truncation is recorded');
    assert.ok(manifest.bytes <= capBytes);
    for (const name of manifest.truncated) assert.match(readFileSync(join(dest, name), 'utf8'), /\[evidence truncated at/, `${name} ends with a note`);
    // Rows of the first, highest-priority files survive the cap whole.
    assert.match(readFileSync(join(dest, 'decisions.jsonl'), 'utf8'), /denied 4 call/);
    // A line is never cut in the middle: every kept row of a jsonl file parses.
    for (const line of readFileSync(join(dest, 'events.jsonl'), 'utf8').split('\n')) {
      if (line === '' || line.startsWith('[evidence truncated')) continue;
      JSON.parse(line);
    }
  });

  it('settles a scratch: copies into <evidence>/<task>-<arm> and then removes the scratch, a repeated pair gets a numbered directory, and --keep leaves the scratch', async () => {
    const { settleScratch } = await harness();
    const evidenceRoot = temp('eval-evidence-root');
    const logs: string[] = [];
    for (const blocked of [true, false]) {
      const { dir } = scratchWith({ blocked });
      const kept = settleScratch({ dir, evidenceRoot, task: 'T01', arm: 'B', keep: false, log: (l) => logs.push(l) });
      assert.equal(existsSync(dir), false, 'the scratch is removed after the copy');
      assert.ok(kept !== undefined && existsSync(join(kept, 'manifest.json')));
    }
    assert.deepEqual(readdirSync(evidenceRoot).sort(), ['T01-B', 'T01-B-2']);
    const { dir } = scratchWith({ blocked: true });
    const third = settleScratch({ dir, evidenceRoot, task: 'T02', arm: 'C', keep: true, log: (l) => logs.push(l) });
    assert.equal(existsSync(dir), true, '--keep leaves the scratch');
    assert.ok(third !== undefined && third.endsWith('T02-C'));
    assert.ok(logs.some((l) => l.includes('kept ')));
  });

  it('removes the scratch with no evidence directory named, and a failing copy still removes it and says so instead of hiding the run result', async () => {
    const { settleScratch } = await harness();
    const logs: string[] = [];
    const plain = scratchWith({ blocked: true });
    assert.equal(settleScratch({ dir: plain.dir, evidenceRoot: undefined, task: 'T01', arm: 'A', keep: false, log: (l) => logs.push(l) }), undefined);
    assert.equal(existsSync(plain.dir), false);
    const broken = temp('eval-evidence-broken');
    writeFileSync(join(broken, 'not-a-directory'), 'x');
    const noDb = temp('eval-evidence-nodb');
    mkdirSync(join(noDb, 'arm', 'data'), { recursive: true });
    const result = settleScratch({ dir: noDb, evidenceRoot: join(broken, 'not-a-directory'), task: 'T01', arm: 'A', keep: false, log: (l) => logs.push(l) });
    assert.equal(result, undefined);
    assert.equal(existsSync(noDb), false);
    assert.ok(logs.some((l) => /evidence/.test(l)), logs.join('\n'));
  });

  it('accepts --evidence-dir on the command line and refuses it without a value', () => {
    const ledger = phase4Ledger(undefined);
    const ok = runScript(['--dry-run', '--task-ids', 'T01', '--evidence-dir', join(temp('eval-evidence-flag'), 'e')], ledger.env);
    assert.equal(ok.code, 0, ok.stderr);
    const bad = runScript(['--dry-run', '--evidence-dir'], ledger.env);
    assert.equal(bad.code, 64, bad.stderr);
  });
});
