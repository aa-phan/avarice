// `status --json` latency benchmark (AC-2, SC2; plan 04-13). Builds a store of N runs through the ledger's own write methods in a temp
// profile, then spawns the real `avarice status --json` entry the given number of times and prints the p50 and p95 wall time of the
// whole process (Node start included, about 129 ms of it) as one JSON line. Exits 1 when p95Ms is 300 or more.
//   node scripts/status-bench.ts                       1,000 runs, 30 timed samples
//   node scripts/status-bench.ts --runs 200 --samples 10
// Every run copies one template: a contract with two budgets, two work items, an attempt with a passed check, a gate result, two steps,
// and, by run index, one of four shapes (ready, active, blocked on a decision with a banner, interrupted). The store is created by the
// first `status` call itself, so it carries the schema and the profile a real store has. Everything lives under a temp directory that is
// removed afterwards. `emptyP50Ms` is the same measurement against a store with no run: the floor of Node start plus opening the store.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../src/adapters/sqlite/db.ts';
import { SqliteLedger } from '../src/adapters/sqlite/ledger.ts';
import type { Result } from '../src/domain/result.ts';

const LIMIT_MS = 300;
const DIGEST = 'sha256:' + 'a'.repeat(64);
const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);
const entry = resolve(dirname(new URL(import.meta.url).pathname), '..', 'bin', 'avarice.ts');

function numberFlag(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} needs a positive integer, got ${String(process.argv[at + 1])}`);
  return value;
}
const runs = numberFlag('--runs', 1000);
const samples = numberFlag('--samples', 30);

function must<T>(result: Result<T>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

const pickOf = (times: number[], q: number): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] as number;
};

const base = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-status-bench-')));
try {
  const dataRoot = join(base, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(base, 'home'),
    AVARICE_CONFIG_HOME: join(base, 'config'),
    AVARICE_DATA_ROOT: dataRoot,
    AVARICE_WORK_ROOT: join(base, 'work'),
    AVARICE_CLAUDE_BIN: '/nonexistent/avarice-bench-has-no-claude',
  };
  delete env['NODE_TEST_CONTEXT'];

  const status = (): { ms: number; stdout: string } => {
    const started = process.hrtime.bigint();
    const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', entry, 'status', '--json'], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (result.status !== 0) throw new Error(`status exited ${String(result.status)}: ${result.stderr}`);
    return { ms, stdout: result.stdout };
  };
  const measure = (): number[] => {
    status();
    const times: number[] = [];
    for (let i = 0; i < samples; i += 1) times.push(status().ms);
    return times;
  };

  // The first call creates and migrates the store; the timed calls after it open an existing one, as every real call does.
  const emptyP50Ms = pickOf(measure(), 0.5);

  const opened = must(openDb(join(dataRoot, 'state.db')), 'open the bench store');
  // The seeding is not what is measured: skip the fsync of each of its thousands of transactions.
  opened.exec('PRAGMA synchronous = OFF');
  let n = 0;
  const ledger = new SqliteLedger(opened, (prefix) => prefix + String(++n).padStart(26, '0'));
  must(ledger.registerProject({ projectId: 'proj_bench', rootCommit: 'rootbench', repoPath: '/repo/bench', remote: null, defaultBranch: 'main', nowMs: T0 }), 'register the project');
  for (let i = 0; i < runs; i += 1) {
    const runId = `run_bench${String(i).padStart(8, '0')}`;
    const at = T0 + i * 20;
    must(
      ledger.createRunWithContract({
        run: { runId, projectId: 'proj_bench', title: `bench task ${i}`, nowMs: at, baseRevision: 'git:abc1234', branch: `avarice/${runId}` },
        contract: {
          version: 1,
          digest: DIGEST,
          body: { schema: 1, intent: { requirementRefs: [{ kind: 'brief', id: 'brief.md', revision: 'abc123' }] }, workspace: { conventionsRevision: 'def456' } },
          policyRevision: 'p1',
          authorizedBy: 'owner',
          budgets: [
            { name: 'toolCalls', limit: 400, exactness: 'exact' },
            { name: 'invocations', limit: 3, exactness: 'exact' },
          ],
          nowMs: at,
        },
        workItems: ['A', 'B'].map((itemId) => ({ runId, itemId, dependsOn: itemId === 'B' ? ['A'] : [], size: 'medium', model: 'sonnet', spec: { goal: itemId }, nowMs: at })),
      }),
      'create a run',
    );
    let row = must(ledger.transitionRun(runId, { version: 1, fence: 0 }, { to: 'running', nextAction: 'launch:run', nowMs: at + 1 }), 'start a run');
    const attempt = must(ledger.recordRunAttempt(runId, { reason: 'first try', itemId: 'A', nowMs: at + 2 }), 'record an attempt');
    must(
      ledger.recordEvidence({
        attemptId: attempt.attemptId,
        workItem: 'A',
        kind: 'check',
        name: 'test',
        status: 'passed',
        revision: 'git:abc1234',
        clean: true,
        treeDigest: DIGEST,
        environment: { phase: 'final' },
        contractVersion: 1,
        policyRevision: 'p1',
        independence: 'deterministic',
        acceptance: ['AC-1'],
        nowMs: at + 3,
      }),
      'record evidence',
    );
    must(ledger.recordGateResult({ runId, gate: 'G2', workItem: 'A', contractVersion: 1, policyRevision: 'p1', revision: 'git:abc1234', passed: true, failures: [], nowMs: at + 4 }), 'record a gate result');
    must(ledger.recordRunStep(runId, { step: 'launch:run', status: 'started', result: {}, nowMs: at + 5 }), 'record a step');
    must(ledger.recordRunStep(runId, { step: 'handoff:fetch', status: 'completed', result: { commit: 'abc1234' }, nowMs: at + 6, completedAtMs: at + 7 }), 'record the hand-off');
    const shape = i % 4;
    if (shape === 0) {
      must(ledger.endRunAttempt(attempt.attemptId, { outcome: 'passed', nowMs: at + 8 }), 'end the attempt');
      row = must(ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'verifying', nextAction: 'verify:checks', nowMs: at + 9 }), 'verify');
      must(ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'ready_for_review', nextAction: 'none', nowMs: at + 10 }), 'finish');
    } else if (shape === 1) {
      // A lease that outlives the bench: the run shows as active, not interrupted.
      must(ledger.acquireRunLease(runId, 'bench-holder', 365 * 24 * 3600 * 1000, Date.now()), 'take a lease');
    } else if (shape === 2) {
      const decision = must(
        ledger.openDecision({
          runId,
          contractVersion: 1,
          class: 'acceptance',
          issue: 'The brief does not say whether slugs keep digits',
          options: [{ id: 'keep', label: 'keep digits' }, { id: 'drop', label: 'drop digits' }],
          consequences: { keep: 'matches the tests', drop: 'breaks 3 tests' },
          evidenceRefs: [],
          affectedItems: ['B'],
          stateDigest: DIGEST,
          urgency: 'blocking',
          nowMs: at + 8,
        }),
        'open a decision',
      );
      must(ledger.createNotification({ runId, kind: 'decisions', destination: 'banner', subjectIds: [decision.decisionId], state: 'pending', nowMs: at + 9 }), 'raise a banner');
      must(ledger.transitionRun(runId, { version: row.version, fence: 0 }, { to: 'blocked_on_decision', nextAction: 'none', reason: 'budget_exhausted', nowMs: at + 10 }), 'block on the decision');
    }
    // shape 3 stays running with its attempt open and no lease: interrupted.
  }
  opened.close();

  // One untimed call proves the bench measures a real answer: status must list every run it seeded.
  const listed = (JSON.parse(status().stdout) as Array<{ runs?: unknown[] }>).reduce((sum, project) => sum + (project.runs?.length ?? 0), 0);
  if (listed !== runs) throw new Error(`status listed ${listed} runs, the bench seeded ${runs}`);

  const times = measure();
  const p50Ms = Math.round(pickOf(times, 0.5));
  const p95Ms = Math.round(pickOf(times, 0.95));
  console.log(JSON.stringify({ runs, samples, p50Ms, p95Ms, emptyP50Ms: Math.round(emptyP50Ms) }));
  process.exitCode = p95Ms >= LIMIT_MS ? 1 : 0;
} finally {
  rmSync(base, { recursive: true, force: true });
}
