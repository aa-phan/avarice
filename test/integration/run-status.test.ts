// `status` and `inbox` for runs (plan 02-15; FR-11, OPS-7, S-3, AC-3, D-19; threats T-02-49 and T-02-52). A run is produced by the real
// `start --wait` with the fake run host standing in for the model; everything the views read is a ledger row. Every check here runs
// the production entry (no fake host, no claude) because `status` and `inbox` take no lease, start no model and open the store read-only.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PRODUCTION_ENTRY, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { offlineAvailable, runOffline } from '../helpers/offline.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, startWithFakeRunHost, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

// An onboarded scratch GSD project with committed conventions and a brief; no run yet.
function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

const FIX = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' } as const;

function runIdOf(stdout: string): string {
  const match = /^run (run_[0-9A-Z]{26}): /.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

const status = (roots: CliRoots, ...extra: string[]): CliResult => runCli(['status', ...extra], { roots, entry: PRODUCTION_ENTRY });

interface RunJson {
  runId: string;
  title: string;
  state: string;
  reason: string | null;
  lastCheckpoint: { seq: number; nextAction: string; revision: string | null; at: string } | null;
  branch: string | null;
  commit: string | null;
  clean: boolean | null;
  evidence: Array<{ name: string; kind: string; status: string; revision: string; clean: boolean; preExisting?: boolean }>;
  gates: Array<{ gate: string; passed: boolean; revision: string }>;
  openDecisions: number;
  budgets: Array<{ name: string; used: number; limit: number }>;
  references: Array<{ kind: string; id: string; revision: string }>;
  interrupted?: Record<string, unknown>;
}

interface ProjectJson {
  runs?: RunJson[];
  [key: string]: unknown;
}

const PHASE_1_KEYS = ['projectId', 'repoPath', 'onboardingId', 'state', 'reason', 'recordVersion', 'onboardedRevision', 'mapping', 'indexes'];

describe('status shows a finished run: state, checkpoint, evidence and branch, offline (tracer; FR-11, SC 2)', () => {
  const f = fixture();
  // The status of the project as Phase 1 printed it: no run exists yet.
  const before = status(f.roots, '--json');
  const started = startWithFakeRunHost(f.roots, f.repo, f.brief, FIX);
  const runId = runIdOf(started.stdout);

  it('the run reached ready_for_review', () => {
    assert.equal(started.code, 0, started.stderr + started.stdout);
    assert.equal(before.code, 0, before.stderr);
  });

  it('prints the run row and the detail lines of a ready run', () => {
    const ran = status(f.roots);
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, new RegExp(`^runs: 1$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^${runId}\\s+ready_for_review\\s+Collapse repeated dashes in slugs$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^run ${runId}: ready_for_review$`, 'm'));
    assert.match(ran.stdout, new RegExp(`^  branch avarice/${runId} at [0-9a-f]{7} \\(clean\\)$`, 'm'));
    assert.match(ran.stdout, /^ {2}evidence: test passed$/m);
    assert.match(ran.stdout, /^ {2}gates: G0 passed, G2 passed, G4 passed$/m);
    assert.match(ran.stdout, /^ {2}last checkpoint: handoff:fetch \(\d{2}:\d{2}, [^)]+\)$/m);
    assert.match(ran.stdout, /^ {2}budget: cost [0-9.]+ USD of 5\.00 USD; invocations 1 of 3; tool calls \d+ of 400; /m);
    assert.match(ran.stdout, /^ {2}references: brief \S+ at [0-9a-f]{12}; conventions \.avarice\/config\.json at [0-9a-f]{12}$/m);
    assert.doesNotMatch(ran.stdout, /decisions: \d+ open/);
    assert.doesNotMatch(ran.stdout, /interrupted/);
  });

  it('status --json: every Phase 1 key and value is as before, and the project gains a `runs` array with one run', () => {
    const ran = status(f.roots, '--json');
    assert.equal(ran.code, 0, ran.stderr);
    const [entry] = JSON.parse(ran.stdout) as ProjectJson[];
    assert.ok(entry !== undefined);
    assert.deepEqual(Object.keys(entry), [...PHASE_1_KEYS, 'runs'], 'the Phase 1 keys in their order, then runs last');
    // The entry without `runs`, as text, is the Phase 1 entry byte for byte.
    const { runs, ...rest } = entry;
    const [was] = JSON.parse(before.stdout) as ProjectJson[];
    assert.equal(JSON.stringify(rest, null, 2), JSON.stringify(was, null, 2));
    assert.ok(runs !== undefined && runs.length === 1);
    const run = runs[0] as RunJson;
    assert.deepEqual(Object.keys(run), ['runId', 'title', 'state', 'reason', 'lastCheckpoint', 'branch', 'commit', 'clean', 'evidence', 'gates', 'openDecisions', 'budgets', 'references']);
    assert.equal(run.runId, runId);
    assert.equal(run.state, 'ready_for_review');
    assert.equal(run.reason, null);
    assert.equal(run.branch, `avarice/${runId}`);
    assert.match(run.commit ?? '', /^[0-9a-f]{40}$/);
    assert.equal(run.clean, true);
    assert.deepEqual(
      run.evidence.map((e) => [e.name, e.kind, e.status, e.clean, e.preExisting]),
      [['test', 'check', 'passed', true, undefined]],
    );
    assert.equal(run.evidence[0]?.revision, `git:${run.commit}`);
    assert.deepEqual(
      run.gates.map((g) => [g.gate, g.passed]),
      [
        ['G0', true],
        ['G2', true],
        ['G4', true],
      ],
    );
    assert.equal(run.lastCheckpoint?.nextAction, 'handoff:fetch');
    assert.equal(run.lastCheckpoint?.revision, `git:${run.commit}`);
    assert.equal(run.openDecisions, 0);
    assert.deepEqual(run.budgets.map((b) => b.name).sort(), ['costUsd', 'invocations', 'subagentsTotal', 'toolCalls', 'wallClockMs']);
    assert.equal(run.budgets.find((b) => b.name === 'costUsd')?.limit, 5);
    assert.deepEqual(run.references.map((r) => r.kind), ['brief', 'conventions']);
    assert.equal(run.interrupted, undefined);
  });

  it('a project without runs has no `runs` key', () => {
    const g = fixture();
    const ran = status(g.roots, '--json');
    assert.equal(ran.code, 0, ran.stderr);
    const [entry] = JSON.parse(ran.stdout) as ProjectJson[];
    assert.deepEqual(Object.keys(entry as ProjectJson), PHASE_1_KEYS);
    assert.doesNotMatch(status(g.roots).stdout, /^runs:/m);
  });

  it('takes no lease, writes no row and starts no model: the ledger is the same after status and inbox-free reads', () => {
    const count = (): unknown => ({
      events: rows(f.roots, 'SELECT count(*) AS n FROM events'),
      checkpoints: rows(f.roots, 'SELECT count(*) AS n FROM checkpoints'),
      steps: rows(f.roots, 'SELECT count(*) AS n FROM run_steps'),
      runs: rows(f.roots, 'SELECT * FROM runs ORDER BY run_id'),
    });
    const was = count();
    for (const argv of [['status'], ['status', '--json']]) assert.equal(runCli(argv, { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: undefined } }).code, 0);
    assert.deepEqual(count(), was);
    const [run] = rows<{ lease_holder: string | null; lease_fence: number }>(f.roots, 'SELECT lease_holder, lease_fence FROM runs WHERE run_id = ?', runId);
    assert.equal(run?.lease_holder, null);
  });

  it('works with the network denied and no claude binary', { skip: !offlineAvailable() }, () => {
    const ran = runOffline(['status'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
    assert.equal(ran.code, 0, ran.stderr);
    assert.match(ran.stdout, new RegExp(`^run ${runId}: ready_for_review$`, 'm'));
    const json = runOffline(['status', '--json'], { roots: f.roots, entry: PRODUCTION_ENTRY, env: { AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
    assert.equal(json.code, 0, json.stderr);
    assert.equal((JSON.parse(json.stdout) as ProjectJson[])[0]?.runs?.length, 1);
  });

  it('reads ledger rows only: the run-status module calls no method that writes', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'app', 'run-status.ts'), 'utf8');
    assert.doesNotMatch(text, /acquireRunLease|transitionRun|recordRun|renewRunLease|releaseRunLease|appendEvent/);
  });
});
