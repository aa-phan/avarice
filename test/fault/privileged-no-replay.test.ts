// A privileged action is never replayed after an interruption, and nothing but the owner's `avarice approve` makes an approval (plan 04-16; FR-13, FR-15,
// T-04-44, ADR-005). A run is killed for real (SIGKILL of its detached supervisor); a privileged action whose start was recorded and whose end was not is
// then in the ledger, and `avarice resume` must open a permission decision that names it instead of running it again, in the order the starts were
// recorded; a run with no interrupted privileged action resumes exactly as before. The second half shows that answering decisions, amending the contract and
// resuming write no approvals row. The fake run host plays the units; no test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { authorizeAction } from '../../src/app/authorize.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { paramsDigest } from '../../src/domain/approval.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, resumeRunCli, rows, runRunWithFault, sleepSync } from '../helpers/fault-run.ts';
import { decideMain, runMain, startBlocked, withSupervisorEntry } from '../helpers/decide-cli.ts';
import { s17Host } from '../helpers/independent-work.ts';
import { FIXED_SLUG, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };
// The synthetic privileged action of this plan: no privileged action of a run exists before Phase 5, and a name outside the classification table is privileged.
const SYNTHETIC = 'x.synthetic';

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
  calls: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')), calls: join(roots.base, 'privileged-calls.log') };
}

// A run whose supervisor is killed in verification, with its lease lapsed: the state a resume starts from.
function killedRun(f: Fixture): string {
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX);
  sleepSync(RUN_EXPIRY_WAIT_MS);
  return killed.runId;
}

function withDeps<T>(roots: CliRoots, body: (deps: AppDeps) => T): T {
  const composed = createDeps(profileEnv(roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    return body(composed.value.deps);
  } finally {
    composed.value.close();
  }
}

// What the run's own code does for a privileged action: ask the gate, and only on an allow call the action (here, write one line to a log) and, if it
// survives, record its end. A process killed after the call leaves the start without an end.
function runPrivileged(f: Fixture, runId: string, action: string, params: Record<string, unknown>): void {
  withDeps(f.roots, (deps) => {
    const granted = deps.ledger.grantApproval({ scope: runId, action, paramsDigest: paramsDigest(params), grantedBy: 'owner:test', nowMs: deps.clock.nowMs() });
    assert.ok(granted.ok, JSON.stringify(granted));
    const outcome = authorizeAction(deps, { scope: runId, action, params });
    assert.ok(outcome.ok && outcome.value.effect === 'allow', JSON.stringify(outcome));
    appendFileSync(f.calls, `${action} ${JSON.stringify(params)}\n`);
  });
}

const callsOf = (f: Fixture): string[] => {
  try {
    return readFileSync(f.calls, 'utf8').trim().split('\n').filter((l) => l !== '');
  } catch {
    return [];
  }
};

interface DecisionDb {
  decision_id: string;
  class: string;
  issue: string;
  state: string;
  evidence_refs_json: string;
  options_json: string;
}
const decisionsOf = (roots: CliRoots, runId: string): DecisionDb[] =>
  rows<DecisionDb>(roots, 'SELECT decision_id, class, issue, state, evidence_refs_json, options_json FROM decisions WHERE run_id = ? ORDER BY rowid', runId);
const typeCount = (roots: CliRoots, runId: string, type: string): number => rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM events WHERE run_id = ? AND type = ?', runId, type)[0]?.n ?? 0;
const runOf = (roots: CliRoots, runId: string): { state: string; reason: string | null } => rows<{ state: string; reason: string | null }>(roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0] as { state: string; reason: string | null };
const approvalCount = (roots: CliRoots): number => rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM approvals')[0]?.n ?? 0;
const transitionsOf = (roots: CliRoots, runId: string): string[] =>
  rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'run.transition' AND run_id = ? ORDER BY seq", runId).map((r) => {
    const data = JSON.parse(r.data_json) as { from: string; to: string };
    return `${data.from}>${data.to}`;
  });

describe('a run with no interrupted privileged action resumes exactly as before (FR-15 empty edge)', () => {
  const f = fixture();
  const runId = killedRun(f);

  it('re-verifies and reaches ready_for_review with no decision and no interrupted mark', () => {
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
    assert.equal(runOf(f.roots, runId).state, 'ready_for_review');
    assert.equal(decisionsOf(f.roots, runId).length, 0);
    assert.equal(typeCount(f.roots, runId, 'action.interrupted'), 0);
    assert.deepEqual(transitionsOf(f.roots, runId).slice(-4), ['running>verifying', 'verifying>paused', 'paused>verifying', 'verifying>ready_for_review']);
  });
});

describe('an interrupted privileged action is never replayed: resume opens a permission decision that names it (FR-15, T-04-44)', () => {
  const f = fixture();
  const runId = killedRun(f);
  const params = { target: 'registry.example.com', version: '1.2.3' };

  it('the action was called once before the kill and its end was never recorded', () => {
    runPrivileged(f, runId, SYNTHETIC, params);
    assert.equal(callsOf(f).length, 1);
    assert.equal(typeCount(f.roots, runId, 'action.started'), 1);
    assert.equal(typeCount(f.roots, runId, 'action.finished'), 0);
    assert.equal(approvalCount(f.roots), 1);
  });

  it('resume blocks the run on one open permission decision naming the action and its parameter summary, and does not call the action again', () => {
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0, 'the run is not delivered: it waits for the owner');
    assert.deepEqual(runOf(f.roots, runId), { state: 'blocked_on_decision', reason: 'enforcement_failure' });
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 1);
    const decision = decisions[0] as DecisionDb;
    assert.equal(decision.class, 'permission');
    assert.equal(decision.state, 'open');
    assert.ok(decision.issue.includes(SYNTHETIC), decision.issue);
    assert.ok(decision.issue.includes('target=registry.example.com version=1.2.3'), decision.issue);
    assert.ok(decision.issue.includes('not repeated'), decision.issue);
    assert.deepEqual((JSON.parse(decision.options_json) as Array<{ key: string }>).map((o) => o.key), ['withdraw'], 'nothing in the record can be answered into an approval');

    const started = rows<{ seq: number }>(f.roots, "SELECT seq FROM events WHERE run_id = ? AND type = 'action.started'", runId);
    assert.deepEqual(JSON.parse(decision.evidence_refs_json), [`event:${started[0]?.seq}`]);
    assert.equal(callsOf(f).length, 1, 'the callable was invoked exactly once across the kill and the resume');
    assert.equal(typeCount(f.roots, runId, 'action.started'), 1, 'resume started no action');
    assert.equal(typeCount(f.roots, runId, 'action.interrupted'), 1);
    assert.equal(approvalCount(f.roots), 1, 'no approval was written by the resume');
  });

  it('a second resume is a stopped run: no second decision, nothing called', () => {
    const again = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(again.code, 0);
    assert.equal(decisionsOf(f.roots, runId).length, 1);
    assert.equal(callsOf(f).length, 1);
  });

  it('the same action with the same parameters needs a fresh approval: the one it started with was spent', () => {
    withDeps(f.roots, (deps) => {
      const outcome = authorizeAction(deps, { scope: runId, action: SYNTHETIC, params });
      assert.ok(outcome.ok);
      assert.equal(outcome.value.effect, 'deny');
    });
  });
});

describe('several interrupted privileged actions of one run each open their own decision, in the order their starts were recorded', () => {
  const f = fixture();
  const runId = killedRun(f);

  it('opens three decisions in start order and blocks the run once', () => {
    runPrivileged(f, runId, SYNTHETIC, { step: 'first' });
    runPrivileged(f, runId, 'y.synthetic', { step: 'second' });
    runPrivileged(f, runId, SYNTHETIC, { step: 'third' });
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0);
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 3);
    assert.deepEqual(
      decisions.map((d) => /step=(\w+)/.exec(d.issue)?.[1]),
      ['first', 'second', 'third'],
    );
    const refs = decisions.map((d) => (JSON.parse(d.evidence_refs_json) as string[])[0] as string);
    const seqs = refs.map((r) => Number(r.slice('event:'.length)));
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'the decisions follow the order of the starts');
    assert.equal(new Set(seqs).size, 3);
    assert.equal(callsOf(f).length, 3, 'no action was called again');
    assert.equal(runOf(f.roots, runId).state, 'blocked_on_decision');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'run.transition' AND data_json LIKE '%\"to\":\"blocked_on_decision\"%'", runId)[0]?.n, 1);
  });
});

describe('no decision answer, contract amendment or plan approval writes an approvals row (FR-13)', () => {
  const f = fixture();
  const runId = killedRun(f);

  it('answering the permission decision, amending the contract and resuming again leave the approvals table empty', async () => {
    withDeps(f.roots, (deps) => {
      // The interrupted start without any approval behind it: a contract-sourced start, the shape promotion will use.
      const outcome = authorizeAction(deps, {
        scope: runId,
        action: 'onboarding.promote.copy',
        params: { onboardingId: 'onb_01X' },
        contractAuthorization: { action: 'onboarding.promote.copy', params: { onboardingId: 'onb_01X' } },
      });
      assert.ok(outcome.ok && outcome.value.effect === 'allow' && outcome.value.source === 'contract');
    });
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0);
    const decision = decisionsOf(f.roots, runId)[0] as DecisionDb;
    assert.equal(decision.class, 'permission');

    // An option the record does not offer is not an answer, and the words of one are not an approval.
    const tried = await withSupervisorEntry(FIX, () => decideMain(f.roots, [decision.decision_id, '1']));
    assert.notEqual(tried.code, 0, tried.out + tried.err);
    const text = await withSupervisorEntry(FIX, () => decideMain(f.roots, [decision.decision_id, '--text', 'yes, approve it']));
    assert.notEqual(text.code, 0, text.out + text.err);
    const withdrawn = await withSupervisorEntry(FIX, () => decideMain(f.roots, [decision.decision_id, 'withdraw']));
    assert.equal(withdrawn.code, 0, withdrawn.out + withdrawn.err);
    assert.equal(decisionsOf(f.roots, runId)[0]?.state, 'withdrawn');

    const amended = await runMain(f.roots, ['contract', 'amend', runId, '--budget', 'costUsdPerRun=12', '--reason', 'room to continue'], { answers: ['y'] });
    assert.equal(amended.code, 0, amended.out + amended.err);
    resumeRunCli(f.roots, runId, FIX);

    assert.equal(approvalCount(f.roots), 0, 'nothing wrote an approval');
    assert.equal(rows<{ n: number }>(f.roots, "SELECT count(*) AS n FROM events WHERE type = 'approval.granted'")[0]?.n, 0);
  });

  it('answering a decision of the blocked four-item run through decide leaves the approvals table empty too', async () => {
    const blocked = startBlocked(cleanup);
    const answered = await withSupervisorEntry(s17Host({ question: undefined }), () => decideMain(blocked.f.roots, [blocked.decisionId, '1', '--wait']));
    assert.equal(answered.code, 0, answered.out + answered.err);
    assert.equal(rows<{ n: number }>(blocked.f.roots, 'SELECT count(*) AS n FROM approvals')[0]?.n, 0);
  });
});
