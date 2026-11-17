// An approval is consumed at most once under a race (plan 04-16; FR-12, FR-15, T-04-42). Two processes hold the same store and call
// consumeApprovalAndStart for the same approval at the same instant: BEGIN IMMEDIATE serializes them, and exactly one gets the approval and writes the
// start event; the other gets null and writes nothing. The two processes run 25 rounds, each on its own approval and each released at a start time both
// processes wait for. The 0004 update guard is also shown: a consumed approval cannot be consumed again, or changed in any other way, by plain SQL.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { paramsDigest } from '../../src/domain/approval.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';

const ROUNDS = 25;
const SCOPE = 'run_01RACESCOPE';
const ACTION = 'scm.pr.merge';
const CHILD = join(import.meta.dirname, '..', 'helpers', 'approval-consume-child.ts');

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Line {
  label: string;
  digest: string;
  consumed: string | null;
}

function runChild(dbPath: string, label: string, rounds: ReadonlyArray<{ digest: string; startAtMs: number }>): Promise<Line[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, dbPath, SCOPE, ACTION, label, JSON.stringify(rounds)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`child ${label} exited ${String(code)}: ${err}`));
      else resolve(out.trim().split('\n').map((l) => JSON.parse(l) as Line));
    });
  });
}

describe('two processes consume one approval: exactly one gets it (T-04-42)', () => {
  const roots = makeRoots();
  cleanup.push(roots.base);
  const dbPath = join(roots.AVARICE_DATA_ROOT, 'state.db');
  const approvalOf = new Map<string, string>();
  const rounds: Array<{ digest: string; startAtMs: number }> = [];
  let a: Line[] = [];
  let b: Line[] = [];

  it(`runs ${ROUNDS} rounds, each with its own approval, in two processes that start together`, async () => {
    const composed = createDeps(profileEnv(roots), {});
    assert.ok(composed.ok, 'composition');
    const base = Date.now() + 1500;
    try {
      for (let i = 0; i < ROUNDS; i += 1) {
        const digest = paramsDigest({ round: i });
        const granted = composed.value.deps.ledger.grantApproval({ scope: SCOPE, action: ACTION, paramsDigest: digest, grantedBy: 'owner:test', nowMs: Date.now() });
        assert.ok(granted.ok, JSON.stringify(granted));
        approvalOf.set(digest, granted.value.approvalId);
        rounds.push({ digest, startAtMs: base + i * 40 });
      }
    } finally {
      composed.value.close();
    }
    [a, b] = await Promise.all([runChild(dbPath, 'A', rounds), runChild(dbPath, 'B', rounds)]);
    assert.equal(a.length, ROUNDS);
    assert.equal(b.length, ROUNDS);
  });

  it('gives each approval to exactly one of the two processes, every round', () => {
    let wonByA = 0;
    let wonByB = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const round = rounds[i] as { digest: string };
      const x = a[i] as Line;
      const y = b[i] as Line;
      assert.equal(x.digest, round.digest);
      assert.equal(y.digest, round.digest);
      const winners = [x, y].filter((l) => l.consumed !== null);
      assert.equal(winners.length, 1, `round ${i}: ${JSON.stringify([x, y])}`);
      assert.equal(winners[0]?.consumed, approvalOf.get(round.digest), `round ${i}: the winner holds the approval of its round`);
      if (x.consumed !== null) wonByA += 1;
      else wonByB += 1;
    }
    assert.equal(wonByA + wonByB, ROUNDS);
  });

  it('writes one action.started per approval, naming the approval its process consumed, and sets consumed_at on every approval once', () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const approvals = db.prepare('SELECT approval_id, consumed_at FROM approvals WHERE run_id = ?').all(SCOPE) as Array<{ approval_id: string; consumed_at: string | null }>;
      assert.equal(approvals.length, ROUNDS);
      assert.ok(approvals.every((r) => r.consumed_at !== null));
      const started = db.prepare("SELECT data_json FROM events WHERE type = 'action.started' AND run_id = ? ORDER BY seq").all(SCOPE) as Array<{ data_json: string }>;
      assert.equal(started.length, ROUNDS, 'a consume and its start event are one transaction: no approval without a start, no start without an approval');
      const named = started.map((r) => (JSON.parse(r.data_json) as { approvalId: string }).approvalId);
      assert.deepEqual([...named].sort(), [...approvals.map((r) => r.approval_id)].sort());
    } finally {
      db.close();
    }
  });

  it('cannot be consumed a second time or changed by SQL: the 0004 guard refuses it', () => {
    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    try {
      const row = db.prepare('SELECT approval_id FROM approvals WHERE run_id = ? LIMIT 1').get(SCOPE) as { approval_id: string };
      assert.throws(() => db.prepare('UPDATE approvals SET consumed_at = ? WHERE approval_id = ?').run('2099-01-01T00:00:00.000Z', row.approval_id), /change only by setting consumed_at or revoked_at once/);
      assert.throws(() => db.prepare('UPDATE approvals SET expires_at = ? WHERE approval_id = ?').run('2099-01-01T00:00:00.000Z', row.approval_id), /change only by setting consumed_at or revoked_at once/);
      assert.throws(() => db.prepare('DELETE FROM approvals WHERE approval_id = ?').run(row.approval_id), /never deleted/);
    } finally {
      db.close();
    }
  });
});
