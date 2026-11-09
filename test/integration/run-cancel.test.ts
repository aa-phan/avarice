// `avarice cancel` (plan 03-24; AUT-12, owner decision 3 of 2026-11-08; S-20, T-03-47, T-03-48). The four-item scenario of plan 03-18 (S-17) is run through the
// real CLI with the fake run host until B asks and the run is blocked on one decision with no supervisor alive; the command then runs in this process through
// main() on a stream that claims to be a terminal. Every write is observed with raw SQL on the ledger, and the user's checkout is compared as one digest. No
// test calls a real model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { runRowOf } from '../helpers/independent-work.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { ProcessEntry } from '../../src/adapters/proc/ancestry.ts';
import { main } from '../../src/cli/main.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import { cancelCli, checkoutState, cloneKept, eventsOf, rowsSnapshot, startBlockedS17 } from '../helpers/cancel-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

describe('cancel: a run blocked on a decision, with no live supervisor, is cancelled from a terminal (tracer; AUT-12, S-20)', () => {
  const s = startBlockedS17(cleanup);
  const { f, runId, decisionId } = s;
  const checkoutBefore = checkoutState(f.repo.path);
  let first: Awaited<ReturnType<typeof cancelCli>>;

  it('is blocked on one open decision, with the lease free, before the cancel', () => {
    const row = runRowOf(f.roots, runId);
    assert.deepEqual([row.state, row.reason, row.lease_holder], ['blocked_on_decision', 'decision', null]);
    assert.deepEqual(
      ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE run_id = ?', runId).map((d) => d.state),
      ['open'],
    );
  });

  it('exits 0 and prints one result line: the run is cancelled and one decision was withdrawn', async () => {
    first = await cancelCli(f.roots, [runId]);
    assert.equal(first.code, 0, first.err + first.out);
    assert.equal(first.out, `run ${runId}: cancelled; 1 decision withdrawn\n`);
  });

  it('withdrew the decision with the reason cancel, moved the run to cancelled and freed the lease', () => {
    const decision = ledgerRows<{ state: string }>(f.roots, 'SELECT state FROM decisions WHERE decision_id = ?', decisionId)[0];
    assert.equal(decision?.state, 'withdrawn');
    const withdrawn = eventsOf(f.roots, runId, 'decision.withdrawn');
    assert.deepEqual(withdrawn, [{ runId, decisionId, reason: 'cancel' }]);
    const row = runRowOf(f.roots, runId);
    assert.deepEqual([row.state, row.reason, row.lease_holder], ['cancelled', null, null]);
    const transitions = eventsOf(f.roots, runId, 'run.transition').filter((t) => t['to'] === 'cancelled');
    assert.equal(transitions.length, 1, 'one transition to cancelled');
    assert.equal(transitions[0]?.['from'], 'blocked_on_decision');
    assert.equal(transitions[0]?.['withdrawn'], 1);
    assert.equal(ledgerRows<{ n: number }>(f.roots, 'SELECT count(*) AS n FROM attempts WHERE run_id = ? AND ended_at IS NULL', runId)[0]?.n, 0, 'every attempt ended');
  });

  it('leaves the user checkout byte-identical and keeps the run clone and its branch (S-20, T-03-47)', () => {
    assert.equal(checkoutState(f.repo.path), checkoutBefore, 'the digest of the checkout is equal before and after');
    const kept = cloneKept(f.roots, runId);
    assert.equal(kept.directory, true, 'the run clone directory still exists');
    assert.equal(kept.head, true, 'the clone still has its HEAD');
    assert.ok(kept.branch !== null && kept.branch !== '', 'the run still names its branch');
  });

  it('a second cancel exits 3 with `already cancelled` and writes nothing', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const again = await cancelCli(f.roots, [runId]);
    assert.equal(again.code, 3, again.err + again.out);
    assert.match(again.err, /already cancelled/);
    assert.equal(again.out, '');
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('`resume` reports the cancelled run as stopped and takes no lease', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['resume', runId], { env: profileEnv(f.roots), io: { out: (t) => void out.push(t), err: (t) => void err.push(t) } });
    assert.equal(code, 3, err.join('') + out.join(''));
    assert.equal(out.join('').trim(), `run ${runId}: cancelled`);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
    assert.equal(runRowOf(f.roots, runId).lease_holder, null);
  });
});

describe('cancel refuses outside a person at a terminal, and writes nothing (CS-11, T-03-48)', () => {
  const s = startBlockedS17(cleanup);
  const { f, runId } = s;

  const inRunTree = (): Result<ProcessEntry[]> =>
    ok([
      { pid: 300, ppid: 250, command: 'node avarice.ts cancel' },
      { pid: 250, ppid: 200, command: 'claude -p --session-id 4b6f0f67-6b8b-4a91-9a1c-0c2f3d6f6f11 /gsd-quick' },
      { pid: 200, ppid: 100, command: 'node avarice.ts supervise run_X' },
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 1, ppid: 0, command: '/sbin/launchd' },
    ]);

  it('exits 64 under AVARICE_RUN', async () => {
    const before = rowsSnapshot(f.roots, runId);
    const r = await cancelCli(f.roots, [runId], { env: { AVARICE_RUN: runId } });
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /AVARICE_RUN/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('exits 64 without a terminal on standard input or output', async () => {
    const before = rowsSnapshot(f.roots, runId);
    for (const stream of [{ stdinIsTty: false }, { stdoutIsTty: false }] as const) {
      const r = await cancelCli(f.roots, [runId], stream);
      assert.equal(r.code, 64, r.err + r.out);
      assert.match(r.err, /interactive terminal/);
    }
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it("exits 64 from inside a run's process tree", async () => {
    const before = rowsSnapshot(f.roots, runId);
    const r = await cancelCli(f.roots, [runId], { ancestry: inRunTree });
    assert.equal(r.code, 64, r.err + r.out);
    assert.match(r.err, /process tree/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
  });

  it('exits 64 for no run ID, two run IDs, a malformed ID and an unknown run', async () => {
    const before = rowsSnapshot(f.roots, runId);
    for (const argv of [[], [runId, runId], ['not-a-run']] as const) {
      const r = await cancelCli(f.roots, argv);
      assert.equal(r.code, 64, `${argv.join(' ')}: ${r.err}${r.out}`);
    }
    const unknown = await cancelCli(f.roots, ['run_00000000000000000000000000']);
    assert.equal(unknown.code, 64, unknown.err + unknown.out);
    assert.match(unknown.err, /no run/);
    assert.deepEqual(rowsSnapshot(f.roots, runId), before);
    assert.equal(rowsSnapshot(f.roots, runId).state, 'blocked_on_decision', 'the run is untouched');
  });
});
