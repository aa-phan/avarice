// Reference freshness on resume (plan 04-20; FR-8, FR-3, FR-18, S-5, T-04-54). A run records the brief file it was started from in task_refs; `avarice resume`
// refreshes every recorded reference before anything continues, and a changed, deleted or revoked one stops the run on a decision with its own blocked reason
// instead of planning on text that is no longer what the run was built from. Every kill is a real SIGKILL of the detached supervisor; the fake run host plays
// the units; git, the ledger and the lease are real. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, resumeRunCli, rows, runRunWithFault, sleepSync } from '../helpers/fault-run.ts';
import { FIXED_SLUG, RUN_CONVENTIONS, commitConventions, makeRunRepo, onboardRunRepo, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

interface TaskRefDb {
  provider: string;
  kind: string;
  ext_id: string;
  revision: string | null;
  retrieved_at: string;
  scope: string;
  freshness: string;
}
const taskRefsOf = (roots: CliRoots, runId: string): TaskRefDb[] =>
  rows<TaskRefDb>(roots, 'SELECT provider, kind, ext_id, revision, retrieved_at, scope, freshness FROM task_refs WHERE run_id = ? ORDER BY provider, kind, ext_id', runId);
const runOf = (roots: CliRoots, runId: string): { state: string; reason: string | null } => rows<{ state: string; reason: string | null }>(roots, 'SELECT state, reason FROM runs WHERE run_id = ?', runId)[0] as { state: string; reason: string | null };
const launches = (roots: CliRoots, runId: string): number => rows<{ n: number }>(roots, "SELECT count(*) AS n FROM run_steps WHERE run_id = ? AND step LIKE 'launch:%'", runId)[0]?.n ?? 0;
const attempts = (roots: CliRoots, runId: string): number => rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ?', runId)[0]?.n ?? 0;

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

const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('S-5 tracer: an edited brief file blocks the resumed run with ref_changed before any unit is launched (FR-8, FR-18, T-04-54)', () => {
  const f = fixture();
  const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:context-pack#2', FIX);
  const { runId } = killed;
  const briefPath = realpathSync(f.brief);
  const originalDigest = sha256(readFileSync(f.brief));

  it('start records the brief file as a task reference: provider manual-brief, kind brief-file, the real path, the digest of its bytes, fresh', () => {
    const refs = taskRefsOf(f.roots, runId);
    assert.equal(refs.length, 1);
    const ref = refs[0] as TaskRefDb;
    assert.equal(ref.provider, 'manual-brief');
    assert.equal(ref.kind, 'brief-file');
    assert.equal(ref.ext_id, briefPath);
    assert.equal(ref.revision, originalDigest);
    assert.equal(ref.freshness, 'fresh');
    assert.ok(!Number.isNaN(Date.parse(ref.retrieved_at)));
    assert.equal(ref.scope, briefPath);
  });

  it('after the brief is edited, resume blocks the run: blocked_on_decision with reason ref_changed, one open decision naming the brief, no unit launched', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const launchesBefore = launches(f.roots, runId);
    const attemptsBefore = attempts(f.roots, runId);
    appendFileSync(f.brief, '\nA later line the run was not built from.\n');
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0, `the run waits for the owner: ${resumed.stdout}${resumed.stderr}`);
    assert.deepEqual(runOf(f.roots, runId), { state: 'blocked_on_decision', reason: 'ref_changed' });
    const decisions = decisionsOf(f.roots, runId);
    assert.equal(decisions.length, 1);
    const decision = decisions[0] as DecisionDb;
    assert.equal(decision.state, 'open');
    assert.ok(decision.issue.includes('manual-brief'), decision.issue);
    assert.ok(decision.evidence_refs_json.includes(briefPath), decision.evidence_refs_json);
    assert.equal(launches(f.roots, runId), launchesBefore, 'no host was launched');
    assert.equal(attempts(f.roots, runId), attemptsBefore, 'no attempt was started');
  });

  it('the reference is now `changed` and still names the digest the run was built from', () => {
    const ref = taskRefsOf(f.roots, runId)[0] as TaskRefDb;
    assert.equal(ref.freshness, 'changed');
    assert.equal(ref.revision, originalDigest, 'the revision the pack was built from is kept, so a later resume finds the change again');
  });
});

describe('a deleted brief file blocks the resumed run with ref_deleted (FR-8)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:context-pack#2', FIX);

  it('resume moves the run to blocked_on_decision with reason ref_deleted and marks the reference deleted', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    rmSync(f.brief);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.notEqual(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
    assert.deepEqual(runOf(f.roots, runId), { state: 'blocked_on_decision', reason: 'ref_deleted' });
    assert.equal((taskRefsOf(f.roots, runId)[0] as TaskRefDb).freshness, 'deleted');
    assert.equal(decisionsOf(f.roots, runId).length, 1);
  });
});

describe('an unchanged brief file does not stop the resume (FR-8)', () => {
  const f = fixture();
  const { runId } = runRunWithFault(f.roots, f.repo, f.brief, 'mid-verify', FIX);

  it('the reference is refreshed to fresh and the run goes on to ready_for_review', () => {
    sleepSync(RUN_EXPIRY_WAIT_MS);
    const resumed = resumeRunCli(f.roots, runId, FIX);
    assert.equal(resumed.code, 0, `${resumed.stdout}${resumed.stderr}`);
    assert.equal(runOf(f.roots, runId).state, 'ready_for_review');
    assert.equal((taskRefsOf(f.roots, runId)[0] as TaskRefDb).freshness, 'fresh');
    assert.equal(decisionsOf(f.roots, runId).length, 0);
  });
});
