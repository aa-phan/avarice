// `avarice contract amend` (plan 03-15; RC-6, D-17, D-18, D-19, D-20, CS-11). A scratch GSD project is onboarded through the real CLI with the fake
// host, runs are started in this process with the real `startRun`, and the command runs in this process through main() with a scripted answer
// to its confirmation. Every write is observed with raw SQL on the ledger and the files of the data root.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { canonicalJson, digestOf } from '../../src/domain/digest.ts';
import { err as portErr, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { RunState } from '../../src/domain/run-lifecycle.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ITEMS_BRIEF_ACCEPTANCE, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief, writeItemsBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { fakeTerminal } from '../helpers/shell-streams.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

// The repository conventions of this file: two required checks, and a write set wider than the brief's (it adds tests/** and docs/**), so an
// amendment can add a write glob inside the conventions that the contract did not start with.
const AMEND_CONVENTIONS = {
  schema: 1,
  checks: [
    { name: 'test', argv: ['npm', 'test'], timeoutSec: 120, required: true },
    { name: 'lint', argv: ['npm', 'run', 'lint'], timeoutSec: 120, required: true },
  ],
  paths: { write: ['src/**', 'test/**', 'tests/**', 'docs/**'], protected: [], artifacts: [] },
} as const;

// One onboarded repository with committed conventions for the whole file; each test starts its own run in it.
let shared: Fixture | undefined;
function fixture(): Fixture {
  if (shared === undefined) {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, AMEND_CONVENTIONS);
    shared = { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
  }
  return shared;
}

function withDeps<T>(f: Fixture, body: (deps: AppDeps) => T): T {
  const composed = createDeps(profileEnv(f.roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    return body(composed.value.deps);
  } finally {
    composed.value.close();
  }
}

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

// Moves a run along `states` under a lease, one transition each (the edges of the run state machine).
function driveRun(deps: AppDeps, runId: string, states: readonly RunState[]): void {
  const lease = must(deps.ledger.acquireRunLease(runId, 'test-supervisor', 60_000, Date.now()));
  for (const to of states) {
    const run = must(deps.ledger.getRun(runId));
    must(
      deps.ledger.transitionRun(
        runId,
        { version: run.version, fence: lease.fence },
        { to, nextAction: `moved to ${to}`, nowMs: Date.now(), ...(to === 'blocked_on_decision' ? { reason: 'decision' as const } : {}) },
      ),
    );
  }
  must(deps.ledger.releaseRunLease(runId, 'test-supervisor', lease.fence));
}

const ALL_GATES = ['G0', 'G1', 'G2', 'G3', 'G4'] as const;

// A passed check row for each required check (the test check mapped to AC1) and a passed row for every gate, under contract version 1.
function recordResults(deps: AppDeps, runId: string): void {
  const attempt = must(deps.ledger.recordRunAttempt(runId, { reason: 'initial', nowMs: Date.now() }));
  const contract = must(deps.ledger.getRunContract(runId));
  assert.ok(contract !== null);
  const policyRevision = contract.policyRevision;
  for (const name of ['test', 'lint']) {
    must(
      deps.ledger.recordEvidence({
        attemptId: attempt.attemptId,
        workItem: 'A',
        kind: 'check',
        name,
        status: 'passed',
        revision: 'a'.repeat(40),
        clean: true,
        treeDigest: `sha256:${'1'.repeat(64)}`,
        environment: {},
        contractVersion: 1,
        policyRevision,
        independence: 'deterministic',
        acceptance: name === 'test' ? ['AC1'] : [],
        nowMs: Date.now(),
      }),
    );
  }
  for (const gate of ALL_GATES) {
    must(deps.ledger.recordGateResult({ runId, gate, workItem: 'A', contractVersion: 1, policyRevision, revision: 'a'.repeat(40), passed: true, failures: [], nowMs: Date.now() }));
  }
}

interface SeedOptions {
  // The run state to move to: blocked_on_decision, ready_for_review (with passed evidence and gates) or cancelled. Default: contract_ready.
  state?: 'blocked_on_decision' | 'ready_for_review' | 'cancelled';
  // The brief to start from (default: the one-item brief of the fixture).
  brief?: string;
}

// Starts a run in this process (the store, the contract and its file, as `start` writes them, without the detached supervisor).
function seedRun(f: Fixture, options: SeedOptions = {}): string {
  return withDeps(f, (deps) => {
    const started = startRun(deps, { cwd: f.repo.path, briefPath: options.brief ?? f.brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    const { runId } = started.value;
    if (options.state === 'blocked_on_decision') driveRun(deps, runId, ['blocked_on_decision']);
    if (options.state === 'cancelled') driveRun(deps, runId, ['cancelled']);
    if (options.state === 'ready_for_review') {
      recordResults(deps, runId);
      driveRun(deps, runId, ['running', 'verifying', 'ready_for_review']);
    }
    return runId;
  });
}

interface Ran {
  code: number;
  out: string;
  err: string;
  questions: string[];
}

const entry = (pid: number, ppid: number, command: string): ProcessEntry => ({ pid, ppid, command });
// A shell, a login and launchd: a person at a terminal. The signature of a run's supervisor is in INSIDE_A_RUN.
const CALM_CHAIN = (): Result<ProcessEntry[]> => ok([entry(300, 200, 'node avarice.ts contract amend'), entry(200, 100, '-zsh'), entry(100, 1, 'login'), entry(1, 0, '/sbin/launchd')]);
const INSIDE_A_RUN = (): Result<ProcessEntry[]> =>
  ok([entry(300, 250, 'bash'), entry(250, 200, 'claude --print'), entry(200, 1, 'node --disable-warning=ExperimentalWarning /opt/avarice/bin/avarice.ts supervise run_01ABC'), entry(1, 0, '/sbin/launchd')]);

interface AmendOptions {
  // What the confirmation is answered with (undefined: no answer can be read).
  answer?: string;
  // Replaces the scripted answer: called when the confirmation is asked, so a test can act between the plan and the answer.
  onAsk?: (question: string) => Promise<string | undefined>;
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  env?: NodeJS.ProcessEnv;
  ancestry?: () => Result<ProcessEntry[]>;
}

// `avarice contract amend <argv>` in this process, on a terminal that answers `answer`.
async function amend(roots: CliRoots, argv: readonly string[], options: AmendOptions = {}): Promise<Ran> {
  const term = fakeTerminal({ inputIsTty: options.stdinIsTty ?? true, outputIsTty: options.stdoutIsTty ?? true });
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const code = await main(['contract', 'amend', ...argv], {
    env: { ...profileEnv(roots), ...options.env },
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
    ancestry: options.ancestry ?? CALM_CHAIN,
    ask: (question) => {
      questions.push(question);
      return options.onAsk === undefined ? Promise.resolve(options.answer) : options.onAsk(question);
    },
  });
  return { code, out: out.join(''), err: err.join(''), questions };
}

interface ContractRowOut {
  version: number;
  digest: string;
  body_json: string;
  authorized_by: string;
  reason: string | null;
  diff_json: string | null;
}

const contracts = (roots: CliRoots, runId: string): ContractRowOut[] =>
  ledgerRows<ContractRowOut>(roots, 'SELECT version, digest, body_json, authorized_by, reason, diff_json FROM contracts WHERE run_id = ? ORDER BY version', runId);

const budget = (roots: CliRoots, runId: string, name: string): { limit_value: number; used: number; reserved: number; contract_version: number } =>
  ledgerRows<{ limit_value: number; used: number; reserved: number; contract_version: number }>(roots, 'SELECT limit_value, used, reserved, contract_version FROM budgets WHERE run_id = ? AND name = ?', runId, name)[0] as {
    limit_value: number;
    used: number;
    reserved: number;
    contract_version: number;
  };

const contractFile = (roots: CliRoots, runId: string, version: number): string => join(roots.AVARICE_DATA_ROOT, 'runs', runId, `contract-v${version}.json`);

describe('contract amend: a budget raise confirmed at a terminal becomes contract version 2 (tracer)', () => {
  it('prints the diff and the invalidation, records version 2 with the owner, the reason and the diff, raises the limit and writes the file 0600', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'blocked_on_decision' });
    const before = budget(f.roots, runId, 'costUsd');
    assert.equal(before.limit_value, 10);

    const r = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--reason', 'room to resume'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.includes('budgets.costUsd.perRun: 10 -> 12'), r.out);
    assert.ok(lines.includes('invalidates: nothing'), r.out);
    assert.ok(lines.includes('contract v2 recorded'), r.out);
    assert.ok(lines.indexOf('budgets.costUsd.perRun: 10 -> 12') < lines.indexOf('contract v2 recorded'), 'the diff comes before the result');
    assert.deepEqual(r.questions, ['apply contract v2? [y/N] ']);

    const stored = contracts(f.roots, runId);
    assert.deepEqual(stored.map((c) => c.version), [1, 2]);
    const v2 = stored[1] as ContractRowOut;
    assert.equal(v2.authorized_by, `owner:${userInfo().username}`);
    assert.equal(v2.reason, 'room to resume');
    assert.deepEqual(JSON.parse(v2.diff_json as string), [{ path: 'budgets.costUsd.perRun', from: 10, to: 12 }]);
    const body = JSON.parse(v2.body_json) as { contractVersion: number; budgets: { costUsd: { perRun: number } } };
    assert.equal(body.contractVersion, 2);
    assert.equal(body.budgets.costUsd.perRun, 12);
    assert.equal(v2.digest, digestOf(body));

    // D-19: the limit rose; what was spent stays spent and nothing is refunded.
    const after = budget(f.roots, runId, 'costUsd');
    assert.equal(after.limit_value, 12);
    assert.equal(after.contract_version, 2);
    assert.equal(after.used, before.used);
    assert.equal(after.reserved, before.reserved);

    const file = contractFile(f.roots, runId, 2);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, 'utf8'), canonicalJson(body));
    assert.ok(existsSync(contractFile(f.roots, runId, 1)), 'version 1 stays');
    assert.equal(ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state, 'blocked_on_decision', 'an amendment does not move the run');
  });

  it('writes nothing when the answer is n, or when no answer can be read', async () => {
    const f = fixture();
    const runId = seedRun(f);
    for (const answer of ['n', '', 'maybe', undefined]) {
      const r = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--reason', 'room to resume'], answer === undefined ? {} : { answer });
      assert.equal(r.code, 0, r.err + r.out);
      assert.match(r.out, /^not amended$/m);
      assert.doesNotMatch(r.out, /recorded/);
    }
    assert.deepEqual(contracts(f.roots, runId).map((c) => c.version), [1]);
    assert.equal(budget(f.roots, runId, 'costUsd').limit_value, 10);
    assert.equal(existsSync(contractFile(f.roots, runId, 2)), false);
  });
});

// D-18, CS-11: three layers keep the run from amending itself. The refusals sit in usage(), before the profile is resolved, so on a profile
// that was never created they leave no data root, no store file and no row.
describe('contract amend: refused inside a run, off a terminal and from a run process tree (CS-11)', () => {
  const ARGV = ['run_01ABC', '--budget', 'costUsdPerRun=12', '--reason', 'room to resume'];

  const cases: ReadonlyArray<{ name: string; options: AmendOptions; message: RegExp }> = [
    { name: 'AVARICE_RUN is set', options: { env: { AVARICE_RUN: 'run_01ABC' }, answer: 'y' }, message: /refused inside a run \(AVARICE_RUN is set\)/ },
    { name: 'standard input is not a terminal', options: { stdinIsTty: false, answer: 'y' }, message: /needs an interactive terminal/ },
    { name: 'standard output is not a terminal', options: { stdoutIsTty: false, answer: 'y' }, message: /needs an interactive terminal/ },
    { name: 'an ancestor is a run supervisor', options: { ancestry: INSIDE_A_RUN, answer: 'y' }, message: /refused from inside a run's process tree/ },
    {
      name: 'the process table cannot be read (fail closed)',
      options: { ancestry: () => portErr({ kind: 'unavailable', cause: 'ps is not allowed here' }), answer: 'y' },
      message: /refused from inside a run's process tree/,
    },
  ];

  for (const c of cases) {
    it(`exits 64 naming the reason and creates no data root, store or file when ${c.name}`, async () => {
      const roots = makeRoots();
      cleanup.push(roots.base);
      const r = await amend(roots, ARGV, c.options);
      assert.equal(r.code, 64, r.err + r.out);
      assert.match(r.err, c.message);
      assert.equal(r.out, '');
      assert.deepEqual(r.questions, [], 'nothing was asked');
      assert.equal(existsSync(join(roots.AVARICE_DATA_ROOT, 'state.db')), false, 'no store file');
      assert.equal(existsSync(roots.AVARICE_DATA_ROOT), false, 'no data root');
      assert.equal(existsSync(roots.AVARICE_CONFIG_HOME), false, 'no config home');
    });
  }

  it('leaves an existing run untouched: no version 2, no stale row, no file, even with the answer y', async () => {
    const f = fixture();
    const runId = seedRun(f);
    const events = (): number => ledgerRows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM events')[0]?.n ?? 0;
    const eventsBefore = events();
    for (const c of cases) {
      const r = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--reason', 'try'], c.options);
      assert.equal(r.code, 64, `${c.name}: ${r.err}`);
    }
    assert.deepEqual(contracts(f.roots, runId).map((c) => c.version), [1]);
    assert.equal(budget(f.roots, runId, 'costUsd').limit_value, 10);
    assert.equal(existsSync(contractFile(f.roots, runId, 2)), false);
    assert.equal(events(), eventsBefore);
  });
});

// ---- every flag with its D-20 invalidation, decision resolution, conflicts ---------------------------------------------------------------------

interface GateRow {
  gate: string;
  contract_version: number;
  passed: number;
  failures_json: string;
}

interface EvidenceRowOut {
  name: string;
  kind: string;
  status: string;
  contract_version: number;
  environment_json: string;
  acceptance_json: string;
}

const gateRows = (roots: CliRoots, runId: string): GateRow[] =>
  ledgerRows<GateRow>(roots, 'SELECT gate, contract_version, passed, failures_json FROM gate_results WHERE run_id = ? ORDER BY rowid', runId);

const evidenceRows = (roots: CliRoots, runId: string): EvidenceRowOut[] =>
  ledgerRows<EvidenceRowOut>(
    roots,
    'SELECT e.name, e.kind, e.status, e.contract_version, e.environment_json, e.acceptance_json FROM evidence e JOIN attempts a ON a.attempt_id = e.attempt_id WHERE a.run_id = ? ORDER BY e.rowid',
    runId,
  );

const versions = (roots: CliRoots, runId: string): number[] => contracts(roots, runId).map((c) => c.version);

const bodyOf = (roots: CliRoots, runId: string, version: number): Record<string, any> =>
  JSON.parse((contracts(roots, runId).find((c) => c.version === version) as ContractRowOut).body_json) as Record<string, any>;

// Writes a file next to the briefs of the fixture and returns its path.
function writeAmendFile(f: Fixture, name: string, text: string | Buffer): string {
  const dir = join(f.roots.base, 'amend-files');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

// The gates the latest `status --json` shows for the run: the latest row of each gate.
function statusGates(roots: CliRoots, runId: string): Record<string, boolean> {
  const result = runCli(['status', '--json'], { roots });
  assert.equal(result.code, 0, result.stderr);
  const find = (node: unknown): { gates?: Array<{ gate: string; passed: boolean }> } | undefined => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child);
        if (found !== undefined) return found;
      }
    } else if (typeof node === 'object' && node !== null) {
      if ((node as { runId?: unknown }).runId === runId) return node as { gates?: Array<{ gate: string; passed: boolean }> };
      for (const child of Object.values(node)) {
        const found = find(child);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const run = find(JSON.parse(result.stdout));
  assert.ok(run?.gates !== undefined, `status --json lists the gates of ${runId}`);
  return Object.fromEntries(run.gates.map((g) => [g.gate, g.passed]));
}

// Opens a decision of `cls` on item A of a run that is blocked_on_decision, and returns its ID.
function openDecisionOnA(f: Fixture, runId: string, cls: string): string {
  return withDeps(f, (deps) => {
    const lease = must(deps.ledger.acquireRunLease(runId, 'test-supervisor', 60_000, Date.now()));
    must(deps.ledger.transitionWorkItem(runId, 'A', { fence: lease.fence }, { to: 'blocked_on_decision', nowMs: Date.now() }));
    const decision = must(
      deps.ledger.openDecision({
        runId,
        contractVersion: 1,
        class: cls,
        issue: 'The change needs a file outside the write set',
        recommendation: 'amend',
        options: [{ id: 'amend', label: 'widen the write set' }],
        consequences: { amend: 'the run may write there' },
        evidenceRefs: [],
        affectedItems: ['A'],
        stateDigest: `sha256:${'9'.repeat(64)}`,
        urgency: 'blocking',
        nowMs: Date.now(),
      }),
    );
    must(deps.ledger.releaseRunLease(runId, 'test-supervisor', lease.fence));
    return decision.decisionId;
  });
}

const EXTRA_TEST = 'tests/unit/extra.test.ts';

describe('contract amend --add-write: scope-conformance results are invalidated (D-20)', () => {
  it('adds the glob to files.write, appends stale rows for G2 and G4 only, and status shows the latest G4 as not passed', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'ready_for_review' });
    assert.deepEqual(statusGates(f.roots, runId), { G0: true, G1: true, G2: true, G3: true, G4: true });

    const r = await amend(f.roots, [runId, '--add-write', EXTRA_TEST, '--reason', 'tests live in tests/'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    const lines = r.out.split('\n');
    assert.ok(lines.includes(`files.write: +${EXTRA_TEST}`), r.out);
    assert.ok(lines.includes('invalidates: scope-conformance'), r.out);
    assert.ok(lines.includes('stale gates: G2, G4'), r.out);
    assert.ok(lines.includes('contract v2 recorded'), r.out);

    assert.deepEqual(versions(f.roots, runId), [1, 2]);
    assert.ok(!(bodyOf(f.roots, runId, 1)['files'].write as string[]).includes(EXTRA_TEST));
    assert.ok((bodyOf(f.roots, runId, 2)['files'].write as string[]).includes(EXTRA_TEST));

    const rows = gateRows(f.roots, runId);
    assert.equal(rows.length, 7, 'five original rows and two appended');
    assert.ok(rows.slice(0, 5).every((g) => g.contract_version === 1 && g.passed === 1), 'the original rows are untouched');
    const appended = rows.slice(5);
    assert.deepEqual(appended.map((g) => g.gate).sort(), ['G2', 'G4']);
    assert.ok(appended.every((g) => g.contract_version === 2 && g.passed === 0 && g.failures_json.includes('stale-after-amendment')));
    assert.deepEqual(evidenceRows(f.roots, runId).map((e) => e.status), ['passed', 'passed'], 'no evidence is invalidated by a scope change');
    assert.deepEqual(statusGates(f.roots, runId), { G0: true, G1: true, G2: false, G3: true, G4: false });
  });

  it('refuses a glob outside the write set of the conventions or on a protected path, naming add-write, and writes nothing', async () => {
    const f = fixture();
    const runId = seedRun(f);
    for (const glob of ['secrets/**', '.git/hooks/**']) {
      const r = await amend(f.roots, [runId, '--add-write', glob, '--reason', 'try'], { answer: 'y' });
      assert.equal(r.code, 64, `${glob}: ${r.err}`);
      assert.match(r.err, /add-write/);
    }
    assert.deepEqual(versions(f.roots, runId), [1]);
  });
});

describe('contract amend --check: required-check evidence is invalidated (D-20, AUT-16)', () => {
  it('-test with lint still required: version 2 requires lint only, and every check evidence row gets a stale copy', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'ready_for_review' });
    const r = await amend(f.roots, [runId, '--check', '-test', '--reason', 'the unit test is covered elsewhere'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /^verification\.requiredChecks: -test$/m);
    assert.match(r.out, /^invalidates: check-evidence$/m);
    assert.deepEqual(bodyOf(f.roots, runId, 1)['verification'].requiredChecks, ['test', 'lint']);
    assert.deepEqual(bodyOf(f.roots, runId, 2)['verification'].requiredChecks, ['lint']);

    const rows = evidenceRows(f.roots, runId);
    assert.equal(rows.length, 4, 'two originals and two stale copies');
    assert.deepEqual(rows.filter((e) => e.contract_version === 1).map((e) => [e.name, e.status]), [['test', 'passed'], ['lint', 'passed']], 'the originals stay passed');
    const copies = rows.filter((e) => e.contract_version === 2);
    assert.deepEqual(copies.map((e) => e.name).sort(), ['lint', 'test']);
    assert.ok(copies.every((e) => e.status === 'stale' && e.kind === 'check' && e.environment_json.includes('amendment')));
    assert.equal(gateRows(f.roots, runId).filter((g) => g.contract_version === 2).length, 0, 'a check change stales no gate');
  });

  it('+lint after -lint is not a change; naming every required check with - exits 64 naming check, an undeclared name too, and nothing is written', async () => {
    const f = fixture();
    const runId = seedRun(f);
    const cases: ReadonlyArray<readonly string[]> = [
      ['--check', '-test', '--check', '-lint'],
      ['--check', '+nope'],
      ['--check', '+test', '--check', '-test'],
    ];
    for (const flags of cases) {
      const r = await amend(f.roots, [runId, ...flags, '--reason', 'try'], { answer: 'y' });
      assert.equal(r.code, 64, `${flags.join(' ')}: ${r.err}`);
      assert.match(r.err, /check/);
    }
    const bare = await amend(f.roots, [runId, '--check', 'test', '--reason', 'try'], { answer: 'y' });
    assert.equal(bare.code, 64, bare.err);
    assert.match(bare.err, /--check/);
    assert.deepEqual(versions(f.roots, runId), [1]);
  });
});

describe('contract amend --acceptance-file: gates and acceptance mappings are invalidated (D-20, G0)', () => {
  const CHANGED_AC1 = '- AC1: Repeated separators collapse to one dash and the slug is trimmed | verifiedBy: check:test\n';

  it('a changed AC1 names intent.acceptance.AC1.text, invalidates gates, acceptance mappings and check re-runs, and stales the mapped evidence and every passed gate', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'ready_for_review' });
    const file = writeAmendFile(f, 'ac1.md', CHANGED_AC1);
    const r = await amend(f.roots, [runId, '--acceptance-file', file, '--reason', 'tighten AC1'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /^intent\.acceptance\.AC1\.text: "Repeated separators collapse to one dash" -> "Repeated separators collapse to one dash and the slug is trimmed"$/m);
    assert.match(r.out, /^invalidates: gates, acceptance-mappings, checks-rerun$/m);
    assert.match(r.out, /^stale gates: G0, G1, G2, G3, G4$/m);
    assert.match(r.out, /^stale evidence: ev_[0-9A-Z]{26}$/m, 'only the check mapped to a criterion');

    const text = (bodyOf(f.roots, runId, 2)['intent'].acceptance as Array<{ id: string; text: string }>).find((c) => c.id === 'AC1')?.text;
    assert.equal(text, 'Repeated separators collapse to one dash and the slug is trimmed');
    const gates = gateRows(f.roots, runId).filter((g) => g.contract_version === 2);
    assert.deepEqual(gates.map((g) => g.gate).sort(), ['G0', 'G1', 'G2', 'G3', 'G4']);
    const stale = evidenceRows(f.roots, runId).filter((e) => e.contract_version === 2);
    assert.deepEqual(stale.map((e) => [e.name, e.status]), [['test', 'stale']], 'the lint row maps no criterion and keeps its standing');
  });

  it('on a run with three items a new criterion needs --item; with --item it joins that item and the diff says so', async () => {
    const f = fixture();
    const brief = writeItemsBrief(join(f.roots.base, 'item-briefs'));
    assert.equal(ITEMS_BRIEF_ACCEPTANCE.length, 3);
    const runId = seedRun(f, { brief });
    const file = writeAmendFile(f, 'ac4.md', '- AC4: The slug rules are documented | verifiedBy: check:test\n');

    const without = await amend(f.roots, [runId, '--acceptance-file', file, '--reason', 'document it'], { answer: 'y' });
    assert.equal(without.code, 64, without.err + without.out);
    assert.match(without.err, /item/);
    assert.deepEqual(versions(f.roots, runId), [1]);

    const withItem = await amend(f.roots, [runId, '--acceptance-file', file, '--item', 'B', '--reason', 'document it'], { answer: 'y' });
    assert.equal(withItem.code, 0, withItem.err + withItem.out);
    assert.match(withItem.out, /^intent\.acceptance: \+AC4$/m);
    assert.match(withItem.out, /^intent\.workItems\[B\]\.acceptance: \+AC4$/m);
    const items = bodyOf(f.roots, runId, 2)['intent'].workItems as Array<{ id: string; acceptance: string[] }>;
    assert.deepEqual(items.find((i) => i.id === 'B')?.acceptance, ['AC2', 'AC4']);
  });

  it('refuses a missing file, a file over 64 KiB, a file that is not UTF-8 and a file with no criterion, naming acceptance-file, and --item without a file', async () => {
    const f = fixture();
    const runId = seedRun(f);
    const bad: ReadonlyArray<readonly [string, string]> = [
      ['missing', join(f.roots.base, 'amend-files', 'nowhere.md')],
      ['big', writeAmendFile(f, 'big.md', `- AC1: ${'x'.repeat(70 * 1024)}\n`)],
      ['binary', writeAmendFile(f, 'binary.md', Buffer.from([0xff, 0xfe, 0x2d, 0x20]))],
      ['empty', writeAmendFile(f, 'empty.md', '\n')],
    ];
    for (const [name, path] of bad) {
      const r = await amend(f.roots, [runId, '--acceptance-file', path, '--reason', 'try'], { answer: 'y' });
      assert.equal(r.code, 64, `${name}: ${r.err}`);
      assert.match(r.err, /acceptance/, name);
    }
    const stray = await amend(f.roots, [runId, '--item', 'A', '--budget', 'costUsdPerRun=12', '--reason', 'try'], { answer: 'y' });
    assert.equal(stray.code, 64, stray.err);
    assert.match(stray.err, /--item/);
    assert.deepEqual(versions(f.roots, runId), [1]);
  });
});

describe('contract amend --decision: one amendment answers the decision it resolves (D-17)', () => {
  it('a scope_expansion decision is answered amended:v2 and its item is ready again', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'blocked_on_decision' });
    const decisionId = openDecisionOnA(f, runId, 'scope_expansion');
    const r = await amend(f.roots, [runId, '--add-write', EXTRA_TEST, '--decision', decisionId, '--reason', 'allow the new test file'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, new RegExp(`^decision ${decisionId} answered amended:v2$`, 'm'));

    const [decision] = ledgerRows<{ state: string; answer: string; answered_by: string; answer_channel: string }>(f.roots, 'SELECT state, answer, answered_by, answer_channel FROM decisions WHERE decision_id = ?', decisionId);
    assert.equal(decision?.state, 'answered');
    assert.equal(decision?.answer, 'amended:v2');
    assert.equal(decision?.answered_by, `owner:${userInfo().username}`);
    assert.equal(decision?.answer_channel, 'terminal');
    assert.equal(ledgerRows<{ state: string }>(f.roots, "SELECT state FROM work_items WHERE run_id = ? AND item_id = 'A'", runId)[0]?.state, 'ready');
    assert.deepEqual(versions(f.roots, runId), [1, 2]);
  });

  it('an acceptance decision, an unknown decision and a decision of another run exit 64 naming decision and write nothing; an answered one exits 3', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'blocked_on_decision' });
    const acceptance = openDecisionOnA(f, runId, 'acceptance');
    const other = seedRun(f, { state: 'blocked_on_decision' });
    const foreign = openDecisionOnA(f, other, 'scope_expansion');
    for (const id of [acceptance, 'dec_00000000000000000000000000', foreign]) {
      const r = await amend(f.roots, [runId, '--add-write', EXTRA_TEST, '--decision', id, '--reason', 'try'], { answer: 'y' });
      assert.equal(r.code, 64, `${id}: ${r.err}`);
      assert.match(r.err, /decision/);
    }
    assert.deepEqual(versions(f.roots, runId), [1]);
    assert.equal(ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE decision_id = ?', acceptance)[0]?.state, 'open');

    const ok1 = await amend(f.roots, [other, '--add-write', EXTRA_TEST, '--decision', foreign, '--reason', 'first'], { answer: 'y' });
    assert.equal(ok1.code, 0, ok1.err);
    const again = await amend(f.roots, [other, '--add-write', 'docs/**', '--decision', foreign, '--reason', 'again'], { answer: 'y' });
    assert.equal(again.code, 3, again.err + again.out);
    assert.deepEqual(versions(f.roots, other), [1, 2]);
  });
});

describe('contract amend: budgets carry spend over, conflicts and ended runs exit 3, invalid input exits 64 (D-19, T-03-28)', () => {
  it('raises the limit while used and reserved carry over and nothing is refunded', async () => {
    const f = fixture();
    const runId = seedRun(f);
    withDeps(f, (deps) => {
      must(deps.ledger.chargeBudget(runId, 'costUsd', 3.25, { fromReserved: false }));
      must(deps.ledger.reserveBudget(runId, 'costUsd', 0.5));
    });
    const r = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--budget', 'invocations=5', '--reason', 'more room'], { answer: 'y' });
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /^budgets\.invocations: 3 -> 5$/m);
    const cost = budget(f.roots, runId, 'costUsd');
    assert.deepEqual([cost.limit_value, cost.used, cost.reserved], [12, 3.25, 0.5]);
    assert.equal(budget(f.roots, runId, 'invocations').limit_value, 5);
  });

  it('exits 3 and writes nothing when another amendment lands between the plan and the confirmation', async () => {
    const f = fixture();
    const runId = seedRun(f);
    let inner: Ran | undefined;
    const first = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--reason', 'first'], {
      onAsk: async () => {
        inner = await amend(f.roots, [runId, '--budget', 'invocations=5', '--reason', 'second'], { answer: 'y' });
        return 'y';
      },
    });
    assert.equal(inner?.code, 0, inner?.err);
    assert.equal(first.code, 3, first.err + first.out);
    assert.match(first.err, /not amended/);
    assert.doesNotMatch(first.out, /recorded/);
    assert.deepEqual(versions(f.roots, runId), [1, 2]);
    assert.equal(contracts(f.roots, runId)[1]?.reason, 'second');
    assert.equal(budget(f.roots, runId, 'costUsd').limit_value, 10, 'the first amendment wrote nothing');
    assert.equal(budget(f.roots, runId, 'invocations').limit_value, 5);
  });

  it('exits 3 for a cancelled run and writes nothing', async () => {
    const f = fixture();
    const runId = seedRun(f, { state: 'cancelled' });
    const r = await amend(f.roots, [runId, '--budget', 'costUsdPerRun=12', '--reason', 'too late'], { answer: 'y' });
    assert.equal(r.code, 3, r.err + r.out);
    assert.match(r.err, /cancelled/);
    assert.deepEqual(versions(f.roots, runId), [1]);
    assert.equal(r.questions.length, 0, 'it does not ask about a run that has ended');
  });

  it('exits 64 for an unknown run, a bad budget value, a missing reason, a request that changes nothing and a missing change, naming the field', async () => {
    const f = fixture();
    const runId = seedRun(f);
    const cases: ReadonlyArray<{ name: string; argv: readonly string[]; message: RegExp }> = [
      { name: 'unknown run', argv: ['run_00000000000000000000000000', '--budget', 'costUsdPerRun=12', '--reason', 'x'], message: /run_00000000000000000000000000/ },
      { name: 'zero budget', argv: [runId, '--budget', 'costUsdPerRun=0', '--reason', 'x'], message: /costUsdPerRun/ },
      { name: 'unknown budget', argv: [runId, '--budget', 'bogus=3', '--reason', 'x'], message: /bogus/ },
      { name: 'fractional count', argv: [runId, '--budget', 'invocations=2.5', '--reason', 'x'], message: /invocations/ },
      { name: 'no reason', argv: [runId, '--budget', 'costUsdPerRun=12'], message: /--reason/ },
      { name: 'same value', argv: [runId, '--budget', 'costUsdPerRun=10', '--reason', 'x'], message: /nothing to amend/ },
      { name: 'no change named', argv: [runId, '--reason', 'x'], message: /nothing to amend/ },
      { name: 'cap above the run cap', argv: [runId, '--budget', 'costUsdPerInvocation=50', '--reason', 'x'], message: /costUsd/ },
    ];
    for (const c of cases) {
      const r = await amend(f.roots, c.argv, { answer: 'y' });
      assert.equal(r.code, 64, `${c.name}: ${r.err}${r.out}`);
      assert.match(r.err, c.message, c.name);
    }
    assert.deepEqual(versions(f.roots, runId), [1]);
  });
});
