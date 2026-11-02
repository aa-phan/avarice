// Leases, takeover and `avarice resume` (docs/contracts-and-state.md "Concurrency control", "Recovery
// rules"; docs/repository-onboarding.md "Failure and recovery"). Ledger-level cases run in process with
// explicit clock values; process-level cases run the test CLI (production main() with the fake host).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { migrate } from '../../src/adapters/sqlite/migrate.ts';
import { MIGRATION_0001 } from '../../src/adapters/sqlite/migrations/0001-initial.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { newId } from '../../src/domain/ids.ts';
import type { IdPrefix } from '../../src/domain/ids.ts';
import type { Result } from '../../src/domain/result.ts';
import type { InvocationRequest } from '../../src/ports/agent-host.ts';
import type { OnboardingRow } from '../../src/ports/ledger.ts';
import { runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import { ALL_MAP_FILES, FakeAgentHost } from '../helpers/fake-agent-host.ts';
import {
  EXPIRY_WAIT_MS,
  REPO_FILES,
  freshProfile,
  onboardingIdOf,
  resumeCli,
  rows,
  runWithFault,
  sleepSync,
  spawnCli,
  statusCli,
  transitionsOf,
} from '../helpers/fault-run.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function must<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.error));
  return result.value;
}

const T0 = Date.UTC(2026, 0, 1);

function ledgerHarness(): { ledger: SqliteLedger; onboarding: OnboardingRow; db: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-lease-'));
  cleanup.push(dir);
  const db = must(openDb(join(dir, 'state.db')));
  must(migrate(db, [MIGRATION_0001], { nowMs: T0 }));
  let counter = 0;
  const ledger = new SqliteLedger(db, (prefix: IdPrefix) => newId(prefix, T0, Uint8Array.from({ length: 10 }, (_, i) => (counter++ * 7 + i) & 0xff)));
  const project = must(ledger.registerProject({ projectId: 'proj_1', rootCommit: 'root', repoPath: '/repo', remote: null, defaultBranch: 'main', nowMs: T0 }));
  const onboarding = must(ledger.createOnboarding({ onboardingId: 'onb_1', projectId: project.projectId, preflight: { pin: 'git:abc' }, nowMs: T0 + 1 }));
  return { ledger, onboarding, db };
}

describe('lease expiry and takeover (ledger)', () => {
  it('grants a free lease with fence 1', () => {
    const h = ledgerHarness();
    const grant = must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0 + 10));
    assert.equal(grant.fence, 1);
    assert.equal(grant.expiresAt, new Date(T0 + 1_010).toISOString());
  });

  it('refuses a second acquire before expiry with conflict, and leaves the holder and fence unchanged', () => {
    const h = ledgerHarness();
    must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0 + 10));
    const second = h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 500);
    assert.ok(!second.ok);
    assert.equal(second.error.kind, 'conflict');
    const row = must(h.ledger.getOnboarding('onb_1'));
    assert.equal(row.leaseHolder, 'a');
    assert.equal(row.leaseFence, 1);
  });

  it('treats the lease as expired only after its expiry instant', () => {
    const h = ledgerHarness();
    must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0));
    const atExpiry = h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 1_000);
    assert.ok(!atExpiry.ok, 'at the expiry instant the holder still owns the lease');
    assert.equal(must(h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 1_001)).fence, 2);
  });

  it('after expiry the taker gets fence 2, and the old holder is fenced out of transitions, renewals and release', () => {
    const h = ledgerHarness();
    const first = must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0 + 10));
    const row = must(h.ledger.getOnboarding('onb_1'));
    const second = must(h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 2_000));
    assert.equal(first.fence, 1);
    assert.equal(second.fence, 2);

    const stale = h.ledger.transitionOnboarding('onb_1', { version: row.version, fence: first.fence }, { to: 'contract_proposed', nextAction: 'prepare-workspace', nowMs: T0 + 2_001 });
    assert.ok(!stale.ok);
    assert.equal(stale.error.kind, 'conflict');
    assert.ok(!h.ledger.renewLease('onb_1', 'a', 1, 1_000, T0 + 2_002).ok, 'the old holder cannot renew');
    assert.ok(!h.ledger.releaseLease('onb_1', 'a', 1).ok, 'the old holder cannot release the new holder lease');
    assert.equal(must(h.ledger.getOnboarding('onb_1')).state, 'discovered', 'the fenced-out transition changed nothing');

    const fresh = must(h.ledger.transitionOnboarding('onb_1', { version: row.version, fence: second.fence }, { to: 'contract_proposed', nextAction: 'prepare-workspace', nowMs: T0 + 2_003 }));
    assert.equal(fresh.state, 'contract_proposed');
  });

  it('keeps counting fences across release and re-acquire', () => {
    const h = ledgerHarness();
    must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0));
    must(h.ledger.releaseLease('onb_1', 'a', 1));
    assert.equal(must(h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 1)).fence, 2);
  });

  it('a holder can keep renewing past its original expiry while nobody takes over', () => {
    const h = ledgerHarness();
    must(h.ledger.acquireLease('onb_1', 'a', 1_000, T0));
    must(h.ledger.renewLease('onb_1', 'a', 1, 1_000, T0 + 900));
    const blocked = h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 1_500);
    assert.ok(!blocked.ok, 'the renewed lease is still held');
  });

  it('two connections racing an expired lease: exactly one wins', () => {
    const h = ledgerHarness();
    must(h.ledger.acquireLease('onb_1', 'a', 100, T0));
    const path = h.db.location();
    assert.ok(path);
    const db2 = must(openDb(path));
    let n = 0;
    const other = new SqliteLedger(db2, (prefix: IdPrefix) => newId(prefix, T0, Uint8Array.from({ length: 10 }, () => ++n & 0xff)));
    const results = [h.ledger.acquireLease('onb_1', 'b', 1_000, T0 + 5_000), other.acquireLease('onb_1', 'c', 1_000, T0 + 5_000)];
    assert.equal(results.filter((r) => r.ok).length, 1);
    const winner = results.find((r) => r.ok);
    assert.ok(winner?.ok);
    assert.equal(winner.value.fence, 2);
    db2.close();
  });
});

function profile(): CliRoots {
  const roots = freshProfile();
  cleanup.push(roots.base);
  return roots;
}

function killedAtMapping(ttlEnv?: string): { roots: CliRoots; id: string } {
  const roots = profile();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(repo.base);
  if (ttlEnv === undefined) runWithFault(roots, repo, 'after-transition:mapping');
  else runWithFault(roots, repo, 'after-transition:mapping', {}, { AVARICE_LEASE_TTL_MS: ttlEnv });
  return { roots, id: onboardingIdOf(roots) };
}

describe('status after an interrupted run', () => {
  it('shows the state, the next action and the exact resume command once the lease has expired', () => {
    const { roots, id } = killedAtMapping();
    sleepSync(EXPIRY_WAIT_MS);
    const text = statusCli(roots);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, new RegExp(`interrupted in mapping \\(next: launch:map\\)`));
    assert.ok(text.stdout.includes(`avarice resume ${id}`), text.stdout);
    assert.ok(!/: active/.test(text.stdout), 'an interrupted onboarding is never shown as active');

    const json = JSON.parse(statusCli(roots, '--json').stdout) as Array<{ state: string; interrupted?: { state: string; nextAction: string; resumeCommand: string } }>;
    assert.equal(json.length, 1);
    assert.deepEqual(json[0]?.interrupted, { state: 'mapping', nextAction: 'launch:map', resumeCommand: `avarice resume ${id}` });
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);
  });

  it('does not call a run interrupted while its lease is still live', () => {
    const { roots } = killedAtMapping('60000');
    const json = JSON.parse(statusCli(roots, '--json').stdout) as Array<{ state: string; interrupted?: unknown }>;
    assert.equal(json[0]?.state, 'mapping');
    assert.equal(json[0]?.interrupted, undefined);
  });
});

describe('avarice resume', () => {
  it('refuses with exit 3 while another holder has an unexpired lease, and changes nothing', () => {
    const { roots, id } = killedAtMapping('60000');
    const before = rows(roots, 'SELECT onboarding_id, state, version, lease_holder, lease_fence FROM onboardings');
    const r = resumeCli(roots, id);
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /lease/);
    assert.deepEqual(rows(roots, 'SELECT onboarding_id, state, version, lease_holder, lease_fence FROM onboardings'), before);
  });

  it('exits 64 for an unknown onboarding ID', () => {
    const r = resumeCli(profile(), 'onb_unknown');
    assert.equal(r.code, 64, r.stderr);
    assert.match(r.stderr, /onb_unknown/);
  });

  it('exits 64 without an ID', () => {
    assert.equal(resumeCli(profile(), '').code, 64);
  });

  it('takes over an expired mapping lease with a higher fence, reconciles through paused and finishes active', () => {
    const { roots, id } = killedAtMapping();
    sleepSync(EXPIRY_WAIT_MS);
    const killedFence = rows<{ lease_fence: number }>(roots, 'SELECT lease_fence FROM onboardings')[0]?.lease_fence;
    assert.equal(killedFence, 1);

    const r = resumeCli(roots, id);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`onboarding ${id}: active`));
    assert.equal(rows<{ lease_fence: number }>(roots, 'SELECT lease_fence FROM onboardings')[0]?.lease_fence, 2);

    const transitions = transitionsOf(roots).map((t) => `${t.from}>${t.to}`);
    const afterKill = transitions.slice(transitions.indexOf('contract_proposed>mapping') + 1);
    assert.deepEqual(afterKill, ['mapping>paused', 'paused>mapping', 'mapping>validating', 'validating>planning_ready', 'planning_ready>active']);
    const reconcileCheckpoints = rows<{ n: number }>(roots, "SELECT count(*) AS n FROM checkpoints WHERE next_action = 'reconcile-invocation'")[0]?.n;
    assert.equal(reconcileCheckpoints, 1);
  });

  it('after a mid-invocation kill, marks the killed launch interrupted and records a second launch', () => {
    const roots = profile();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(repo.base);
    runWithFault(roots, repo, 'mid-invocation');
    const id = onboardingIdOf(roots);
    sleepSync(EXPIRY_WAIT_MS);

    const r = resumeCli(roots, id);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const launches = rows<{ attempt: number; status: string }>(roots, "SELECT attempt, status FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt");
    assert.deepEqual(launches, [
      { attempt: 1, status: 'interrupted' },
      { attempt: 2, status: 'completed' },
    ]);
  });

  it('with every map file already written, reconciles to validating without launching the host again', () => {
    const { roots, id } = killedAtMapping();
    const [onboarding] = rows<{ staging_worktree: string }>(roots, 'SELECT staging_worktree FROM onboardings');
    assert.ok(onboarding?.staging_worktree);
    // The invocation finished writing every file; the supervisor died before it recorded the outcome.
    const written = new FakeAgentHost().invoke({ cwd: onboarding.staging_worktree, purpose: 'map' } as InvocationRequest, new AbortController().signal);
    return written.then((outcome) => {
      assert.ok(outcome.ok);
      const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
      db.prepare("INSERT INTO onboarding_steps (onboarding_id, step, attempt, status, result_json, started_at) VALUES (?, 'launch:map', 1, 'started', '{}', ?)").run(id, new Date().toISOString());
      db.close();
      sleepSync(EXPIRY_WAIT_MS);

      const r = resumeCli(roots, id);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const launches = rows<{ attempt: number; status: string }>(roots, "SELECT attempt, status FROM onboarding_steps WHERE step = 'launch:map' ORDER BY attempt");
      assert.deepEqual(launches, [{ attempt: 1, status: 'reconciled' }], 'no second launch');
      const transitions = transitionsOf(roots).map((t) => `${t.from}>${t.to}`);
      assert.deepEqual(transitions.slice(transitions.indexOf('contract_proposed>mapping') + 1), [
        'mapping>paused',
        'paused>mapping',
        'mapping>validating',
        'validating>planning_ready',
        'planning_ready>active',
      ]);
      const reconciled = rows<{ n: number }>(roots, "SELECT count(*) AS n FROM events WHERE type = 'invocation.reconciled'")[0]?.n;
      assert.equal(reconciled, 1);
      assert.equal(ALL_MAP_FILES.length, 7);
    });
  });

  it('is a no-op on an onboarding that is already active, and exits 0', () => {
    const { roots, id } = killedAtMapping();
    sleepSync(EXPIRY_WAIT_MS);
    assert.equal(resumeCli(roots, id).code, 0);
    const before = rows(roots, 'SELECT seq FROM events ORDER BY seq');
    const again = resumeCli(roots, id);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.deepEqual(rows(roots, 'SELECT seq FROM events ORDER BY seq'), before);
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 1);
  });

  it('reports a blocked onboarding with exit 3 and does not move it', () => {
    const roots = profile();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(repo.base);
    // The production entry composes the fail-closed host, so onboarding blocks with enforcement_failure.
    const onboarded = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots });
    assert.equal(onboarded.code, 3, onboarded.stdout + onboarded.stderr);
    const id = onboardingIdOf(roots);
    const before = rows(roots, 'SELECT seq FROM events ORDER BY seq');
    const r = runCli(['resume', id], { roots });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`onboarding ${id}: blocked \\(enforcement_failure\\)`));
    assert.deepEqual(rows(roots, 'SELECT seq FROM events ORDER BY seq'), before);
  });
});

describe('two processes race for an expired lease', () => {
  it('exactly one resume proceeds, the other exits 3 on the held lease, and the loser changes nothing', async () => {
    const { roots, id } = killedAtMapping();
    sleepSync(EXPIRY_WAIT_MS);
    // The winner holds the lease for 1.5 s while the fake host sleeps; its renewal timer keeps the 200 ms lease alive.
    const racers = await Promise.all([spawnCli(['resume', id], roots, { sleepMs: 1_500 }), spawnCli(['resume', id], roots, { sleepMs: 1_500 })]);
    const codes = racers.map((r) => r.code).sort();
    assert.deepEqual(codes, [0, 3], racers.map((r) => r.stdout + r.stderr).join('\n---\n'));
    const loser = racers.find((r) => r.code === 3);
    assert.match(loser?.stderr ?? '', /lease/);

    assert.equal(rows<{ lease_fence: number }>(roots, 'SELECT lease_fence FROM onboardings')[0]?.lease_fence, 2);
    assert.equal(rows<{ state: string }>(roots, 'SELECT state FROM onboardings')[0]?.state, 'active');
    const transitions = transitionsOf(roots).map((t) => `${t.from}>${t.to}`);
    assert.equal(transitions.filter((t) => t === 'mapping>paused').length, 1, 'the loser committed no transition');
    assert.equal(rows<{ n: number }>(roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 1);
  });
});
