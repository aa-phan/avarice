// `avarice contract amend` (plan 03-15; RC-6, D-17, D-18, D-19, D-20, CS-11). A scratch GSD project is onboarded through the real CLI with the fake
// host, runs are started in this process with the real `startRun`, and the command runs in this process through main() with a scripted answer
// to its confirmation. Every write is observed with raw SQL on the ledger and the files of the data root.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { startRun } from '../../src/app/run-start.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { canonicalJson, digestOf } from '../../src/domain/digest.ts';
import { err as portErr, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_CONVENTIONS, commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
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

// One onboarded repository with committed conventions for the whole file; each test starts its own run in it.
let shared: Fixture | undefined;
function fixture(): Fixture {
  if (shared === undefined) {
    const roots = makeRoots();
    const repo = makeRunRepo();
    cleanup.push(roots.base, repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo, RUN_CONVENTIONS);
    shared = { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
  }
  return shared;
}

// Starts a run in this process (the store, the contract and its file, as `start` writes them, without the detached supervisor). With `blocked`
// the run is moved to blocked_on_decision, the state a run waiting for an amendment is in.
function seedRun(f: Fixture, options: { blocked?: boolean } = {}): string {
  const composed = createDeps(profileEnv(f.roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    const started = startRun(composed.value.deps, { cwd: f.repo.path, briefPath: f.brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    const { runId } = started.value;
    if (options.blocked === true) {
      const { ledger } = composed.value.deps;
      const run = ledger.getRun(runId);
      assert.ok(run.ok);
      const lease = ledger.acquireRunLease(runId, 'test-supervisor', 60_000, Date.now());
      assert.ok(lease.ok);
      const moved = ledger.transitionRun(runId, { version: run.value.version, fence: lease.value.fence }, { to: 'blocked_on_decision', reason: 'decision', nextAction: 'answer the decision', nowMs: Date.now() });
      assert.ok(moved.ok, JSON.stringify(moved));
      assert.ok(ledger.releaseRunLease(runId, 'test-supervisor', lease.value.fence).ok);
    }
    return runId;
  } finally {
    composed.value.close();
  }
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
      return Promise.resolve(options.answer);
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
    const runId = seedRun(f, { blocked: true });
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
