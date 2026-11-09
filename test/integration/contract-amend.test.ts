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
import { canonicalJson, digestOf } from '../../src/domain/digest.ts';
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

// `avarice contract amend <argv>` in this process, on a terminal that answers `answer` (undefined: no answer can be read).
async function amend(roots: CliRoots, argv: readonly string[], options: { answer?: string } = {}): Promise<Ran> {
  const term = fakeTerminal();
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const code = await main(['contract', 'amend', ...argv], {
    env: profileEnv(roots),
    io: { out: (t) => void out.push(t), err: (t) => void err.push(t) },
    stdin: term.stdin,
    stdout: term.stdout,
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
