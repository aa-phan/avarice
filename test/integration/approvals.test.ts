// Parameter-bound approvals (plan 04-16; FR-12, FR-13, FR-15, ADR-005, S-7). A privileged action is denied with the command that approves it, the owner
// approves it at a terminal through the real `avarice approve`, and the retry consumes the approval in the transaction that records the action's start.
// Every write is observed with raw SQL on the ledger. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { authorizeAction } from '../../src/app/authorize.ts';
import type { AuthorizeInput, AuthorizeOutcome } from '../../src/app/authorize.ts';
import type { AppDeps, Clock } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { APPROVAL_TTL_MS } from '../../src/domain/approval.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import { runMain } from '../helpers/decide-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function freshRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

// The composed deps of the profile for the duration of `body`; the store is closed afterwards so the CLI under test can open it.
function withDeps<T>(roots: CliRoots, body: (deps: AppDeps) => T, clock?: Clock): T {
  const composed = createDeps(profileEnv(roots), clock === undefined ? {} : { clock });
  assert.ok(composed.ok, 'composition');
  try {
    return body(composed.value.deps);
  } finally {
    composed.value.close();
  }
}

function authorize(roots: CliRoots, input: AuthorizeInput, clock?: Clock): AuthorizeOutcome {
  return withDeps(
    roots,
    (deps) => {
      const result = authorizeAction(deps, input);
      assert.ok(result.ok, `authorizeAction failed: ${JSON.stringify(result)}`);
      return result.value;
    },
    clock,
  );
}

interface EventDb {
  seq: number;
  type: string;
  run_id: string | null;
  data_json: string;
}
const eventsOf = (roots: CliRoots, type: string): EventDb[] => ledgerRows<EventDb>(roots, 'SELECT seq, type, run_id, data_json FROM events WHERE type = ? ORDER BY seq', type);

interface ApprovalDb {
  approval_id: string;
  run_id: string;
  action: string;
  params_digest: string;
  idempotency_key: string;
  source: string;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}
const approvalsOf = (roots: CliRoots): ApprovalDb[] => ledgerRows<ApprovalDb>(roots, 'SELECT * FROM approvals ORDER BY rowid');

const SCOPE = 'run_01TRACERSCOPE';
const PR = { scope: SCOPE, action: 'scm.pr.create', params: { head: 'avarice/run_x', base: 'main' } } as const;

describe('tracer: a privileged action is denied with an approve hint, the owner approves it, and the retry consumes the approval in its start transaction (FR-12, S-7)', () => {
  const roots = freshRoots();
  let requestId = '';

  it('denies an action with no approval: rule approval-required:<apr id>, the message names `avarice approve <apr id>`, and an approval.requested event is recorded', () => {
    const outcome = authorize(roots, PR);
    assert.equal(outcome.effect, 'deny');
    assert.ok(outcome.effect === 'deny');
    assert.match(outcome.rule, /^approval-required:apr_[0-9A-Z]{26}$/);
    requestId = outcome.rule.slice('approval-required:'.length);
    assert.equal(outcome.requestId, requestId);
    assert.ok(outcome.message.includes(`avarice approve ${requestId}`), outcome.message);

    const requested = eventsOf(roots, 'approval.requested');
    assert.equal(requested.length, 1);
    const data = JSON.parse((requested[0] as EventDb).data_json) as Record<string, unknown>;
    assert.equal(data['requestId'], requestId);
    assert.equal(data['scope'], SCOPE);
    assert.equal(data['action'], 'scm.pr.create');
    assert.match(String(data['paramsDigest']), /^sha256:[0-9a-f]{64}$/);
    assert.equal(approvalsOf(roots).length, 0, 'a request is an event; the approvals table holds only granted approvals');
  });

  it('`avarice approve <apr id>` at a terminal, answered y, exits 0 and inserts one approval (source local-user, granted_by owner:<user>) expiring 30 minutes later', async () => {
    const ran = await runMain(roots, ['approve', requestId], { answers: ['y'] });
    assert.equal(ran.code, 0, ran.out + ran.err);
    assert.ok(ran.out.includes('scm.pr.create'), 'the action is shown');
    assert.ok(ran.out.includes('head=avarice/run_x'), 'a redacted parameter summary is shown');
    assert.equal(ran.questions.length, 1);
    const rows = approvalsOf(roots);
    assert.equal(rows.length, 1);
    const row = rows[0] as ApprovalDb;
    assert.equal(row.run_id, SCOPE);
    assert.equal(row.action, 'scm.pr.create');
    assert.equal(row.source, 'local-user');
    assert.equal(row.granted_by, `owner:${userInfo().username}`);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.granted_at), APPROVAL_TTL_MS);
    assert.equal(row.consumed_at, null);
    assert.equal(row.revoked_at, null);
    assert.equal(eventsOf(roots, 'approval.granted').length, 1);
  });

  it('the retry with the same parameters is allowed with source approval: consumed_at is set and an action.started event names the approval', () => {
    const outcome = authorize(roots, PR);
    assert.ok(outcome.effect === 'allow', JSON.stringify(outcome));
    assert.equal(outcome.source, 'approval');
    const row = approvalsOf(roots)[0] as ApprovalDb;
    assert.equal(outcome.approvalId, row.approval_id);
    assert.notEqual(row.consumed_at, null);
    const started = eventsOf(roots, 'action.started');
    assert.equal(started.length, 1);
    const data = JSON.parse((started[0] as EventDb).data_json) as Record<string, unknown>;
    assert.equal(data['approvalId'], row.approval_id);
    assert.equal(data['scope'], SCOPE);
    assert.equal(data['action'], 'scm.pr.create');
  });

  it('`avarice approve <apr id>` without a terminal exits 64 and writes nothing', async () => {
    const other = freshRoots();
    const denied = authorize(other, PR);
    assert.ok(denied.effect === 'deny');
    const before = ledgerRows<{ n: number }>(other, 'SELECT count(*) AS n FROM events')[0]?.n;
    const ran = await runMain(other, ['approve', denied.requestId as string], { answers: ['y'], stdinIsTty: false });
    assert.equal(ran.code, 64, ran.out + ran.err);
    assert.match(ran.err, /interactive terminal/);
    assert.equal(approvalsOf(other).length, 0);
    assert.equal(ledgerRows<{ n: number }>(other, 'SELECT count(*) AS n FROM events')[0]?.n, before, 'no event was written');
    assert.equal(ran.questions.length, 0, 'nothing was asked');
  });
});
