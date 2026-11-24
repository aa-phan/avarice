// Parameter-bound approvals (plan 04-16; FR-12, FR-13, FR-15, ADR-005, S-7). A privileged action is denied with the command that approves it, the owner
// approves it at a terminal through the real `avarice approve`, and the retry consumes the approval in the transaction that records the action's start.
// Every write is observed with raw SQL on the ledger. No test calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { authorizeAction, finishPrivilegedAction } from '../../src/app/authorize.ts';
import type { AuthorizeInput, AuthorizeOutcome } from '../../src/app/authorize.ts';
import type { AppDeps, Clock } from '../../src/app/deps.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { APPROVAL_TTL_MS, approvalKey, paramsDigest } from '../../src/domain/approval.ts';
import type { ApprovalRow } from '../../src/ports/ledger.ts';
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

// A clock a test sets, so an approval can be checked at the exact instant it expires.
class SetClock implements Clock {
  t: number;
  constructor(t: number) {
    this.t = t;
  }
  nowMs(): number {
    return this.t;
  }
}

const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

// An approval granted straight through the ledger (the owner's command is proven above): returns its row.
function grant(roots: CliRoots, scope: string, action: string, params: Readonly<Record<string, unknown>>, clock: Clock): ApprovalRow {
  return withDeps(
    roots,
    (deps) => {
      const granted = deps.ledger.grantApproval({ scope, action, paramsDigest: paramsDigest(params), grantedBy: 'owner:test', nowMs: clock.nowMs() });
      assert.ok(granted.ok, `grantApproval failed: ${JSON.stringify(granted)}`);
      return granted.value;
    },
    clock,
  );
}

// Ends the start of `scm.pr.create` the gate returned, as the caller of a privileged action does when it is done.
function finish(roots: CliRoots, scope: string, startSeq: number | undefined, clock: Clock): void {
  const ended = withDeps(roots, (deps) => finishPrivilegedAction(deps, scope, 'scm.pr.create', { status: 'succeeded' }, startSeq), clock);
  assert.ok(ended.ok, JSON.stringify(ended));
}

const allowed = (outcome: AuthorizeOutcome): Extract<AuthorizeOutcome, { effect: 'allow' }> => {
  assert.ok(outcome.effect === 'allow', `expected allow, got ${JSON.stringify(outcome)}`);
  return outcome;
};
const denied = (outcome: AuthorizeOutcome): Extract<AuthorizeOutcome, { effect: 'deny' }> => {
  assert.ok(outcome.effect === 'deny', `expected deny, got ${JSON.stringify(outcome)}`);
  return outcome;
};

describe('an approval is bound to its scope, action, parameters and window (T-04-41, FR-12)', () => {
  it('expires exactly at its expiry instant: denied then, allowed one millisecond earlier', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    grant(roots, 'run_EXPIRYAT', 'scm.pr.create', PR.params, clock);
    grant(roots, 'run_EXPIRYBEFORE', 'scm.pr.create', PR.params, clock);

    clock.t = T0 + APPROVAL_TTL_MS;
    const at = denied(authorize(roots, { ...PR, scope: 'run_EXPIRYAT' }, clock));
    assert.match(at.rule, /^approval-required:apr_/);

    clock.t = T0 + APPROVAL_TTL_MS - 1;
    const before = allowed(authorize(roots, { ...PR, scope: 'run_EXPIRYBEFORE' }, clock));
    assert.equal(before.source, 'approval');
  });

  it('matches the canonical digest: a reordered parameter object is the same action, a changed value is not', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    grant(roots, 'run_DIGEST', 'scm.pr.create', { head: 'avarice/run_x', base: 'main' }, clock);

    denied(authorize(roots, { scope: 'run_DIGEST', action: 'scm.pr.create', params: { head: 'avarice/run_x', base: 'release' } }, clock));
    denied(authorize(roots, { scope: 'run_DIGEST', action: 'scm.pr.create', params: { head: 'avarice/run_x', base: 'main', draft: true } }, clock));
    assert.equal(approvalsOf(roots)[0]?.consumed_at, null, 'a different parameter consumed nothing');

    const same = allowed(authorize(roots, { scope: 'run_DIGEST', action: 'scm.pr.create', params: { base: 'main', head: 'avarice/run_x' } }, clock));
    assert.equal(same.source, 'approval');
  });

  it('does not authorize another run, and does not authorize another action', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    grant(roots, 'run_A', 'scm.pr.create', PR.params, clock);

    denied(authorize(roots, { scope: 'run_B', action: 'scm.pr.create', params: PR.params }, clock));
    denied(authorize(roots, { scope: 'run_A', action: 'scm.pr.update', params: PR.params }, clock));
    assert.equal(approvalsOf(roots)[0]?.consumed_at, null, 'neither attempt consumed the approval');

    allowed(authorize(roots, { scope: 'run_A', action: 'scm.pr.create', params: PR.params }, clock));
  });

  it('is denied after `approve --revoke`; a second revoke exits 3 and an unknown approval exits 64', async () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const row = grant(roots, 'run_REVOKE', 'scm.pr.create', PR.params, clock);

    const first = await runMain(roots, ['approve', '--revoke', row.approvalId], { clock });
    assert.equal(first.code, 0, first.out + first.err);
    assert.equal(approvalsOf(roots)[0]?.revoked_at, new Date(T0).toISOString());
    assert.equal(eventsOf(roots, 'approval.revoked').length, 1);

    denied(authorize(roots, { ...PR, scope: 'run_REVOKE' }, clock));

    const second = await runMain(roots, ['approve', '--revoke', row.approvalId], { clock });
    assert.equal(second.code, 3, second.out + second.err);
    assert.equal(eventsOf(roots, 'approval.revoked').length, 1, 'the second revoke wrote nothing');

    const unknown = await runMain(roots, ['approve', '--revoke', 'apv_01NOSUCHAPPROVAL0000000'], { clock });
    assert.equal(unknown.code, 64, unknown.out + unknown.err);
    assert.match(unknown.err, /^avarice approve: no such approval \(/m, 'a missing approval is named an approval, not a request');
    assert.doesNotMatch(unknown.err, /no such approval request/);
  });

  it('refuses to revoke an approval that was already consumed', async () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const row = grant(roots, 'run_SPENT', 'scm.pr.create', PR.params, clock);
    allowed(authorize(roots, { ...PR, scope: 'run_SPENT' }, clock));
    const ran = await runMain(roots, ['approve', '--revoke', row.approvalId], { clock });
    assert.equal(ran.code, 3, ran.out + ran.err);
    assert.equal(approvalsOf(roots)[0]?.revoked_at, null);
  });

  it('answers n or nothing without writing an approval, and an unknown request with exit 64', async () => {
    const roots = freshRoots();
    const request = denied(authorize(roots, PR)).requestId as string;
    const no = await runMain(roots, ['approve', request], { answers: ['n'] });
    assert.equal(no.code, 0, no.out + no.err);
    assert.match(no.out, /not approved/);
    const none = await runMain(roots, ['approve', request], { answers: [] });
    assert.equal(none.code, 0, none.out + none.err);
    assert.equal(approvalsOf(roots).length, 0);
    const unknown = await runMain(roots, ['approve', 'apr_01NOSUCHREQUEST00000000'], { answers: ['y'] });
    assert.equal(unknown.code, 64, unknown.out + unknown.err);
    assert.match(unknown.err, /^avarice approve: no such approval request \(/m, 'a missing request is named a request (WR-27)');
    assert.equal(unknown.questions.length, 0, 'an unknown request is not asked about');
  });

  it('grants one request once: a second `approve` of the same request exits 3 and adds no row', async () => {
    const roots = freshRoots();
    const request = denied(authorize(roots, PR)).requestId as string;
    const first = await runMain(roots, ['approve', request], { answers: ['y'] });
    assert.equal(first.code, 0, first.out + first.err);
    const again = await runMain(roots, ['approve', request], { answers: ['y'] });
    assert.equal(again.code, 3, again.out + again.err);
    assert.equal(approvalsOf(roots).length, 1);
  });
});

describe('a contract is a source of its own, for exactly the parameters it names (FR-12, D-15)', () => {
  const contract = { action: 'onboarding.promote.copy', params: { onboardingId: 'onb_01CONTRACTED' } };

  it('authorizes the named action with the named parameters, records its start, and writes no approvals row', () => {
    const roots = freshRoots();
    const outcome = allowed(authorize(roots, { scope: 'onb_01CONTRACTED', action: 'onboarding.promote.copy', params: { onboardingId: 'onb_01CONTRACTED' }, contractAuthorization: contract }));
    assert.equal(outcome.source, 'contract');
    assert.equal(approvalsOf(roots).length, 0);
    const started = eventsOf(roots, 'action.started');
    assert.equal(started.length, 1);
    assert.equal(started[0]?.run_id, 'onb_01CONTRACTED');
    assert.equal(outcome.startSeq, started[0]?.seq);
  });

  it('does not authorize other parameters or another action', () => {
    const roots = freshRoots();
    const other = denied(authorize(roots, { scope: 'onb_01CONTRACTED', action: 'onboarding.promote.copy', params: { onboardingId: 'onb_01OTHER' }, contractAuthorization: contract }));
    assert.match(other.rule, /^approval-required:apr_/);
    const action = denied(authorize(roots, { scope: 'onb_01CONTRACTED', action: 'onboarding.promote.commit', params: { onboardingId: 'onb_01CONTRACTED' }, contractAuthorization: contract }));
    assert.match(action.rule, /^approval-required:apr_/);
    assert.equal(eventsOf(roots, 'action.started').length, 0);
    assert.equal(approvalsOf(roots).length, 0);
  });

  it('is not a way around a policy deny: a SEC-5 action is denied whatever the contract says', () => {
    const roots = freshRoots();
    const sec5 = { action: 'net.egress-unlisted', params: { host: 'example.com' } };
    const outcome = denied(authorize(roots, { scope: 'run_SEC5', ...sec5, contractAuthorization: sec5 }));
    assert.equal(outcome.rule, 'sec5.egress');
    assert.equal(outcome.requestId, undefined, 'a policy deny is not a request for approval');
    assert.equal(eventsOf(roots, 'approval.requested').length, 0);
    assert.equal(eventsOf(roots, 'action.started').length, 0);
  });
});

describe('single use (FR-15 adjacency edge)', () => {
  it('two identical privileged actions each need their own approval: one approval starts the first and the second is denied', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    grant(roots, 'run_TWICE', 'scm.pr.create', PR.params, clock);
    const first = allowed(authorize(roots, { ...PR, scope: 'run_TWICE' }, clock));
    assert.equal(first.source, 'approval');
    denied(authorize(roots, { ...PR, scope: 'run_TWICE' }, clock));
    assert.equal(eventsOf(roots, 'action.started').length, 1, 'only the first started');

    // The first start ends (WR-09): the gate refuses a second start of the same parameters while the first has no end, whatever approval is held.
    finish(roots, 'run_TWICE', first.startSeq, clock);
    grant(roots, 'run_TWICE', 'scm.pr.create', PR.params, clock);
    allowed(authorize(roots, { ...PR, scope: 'run_TWICE' }, clock));
    assert.equal(eventsOf(roots, 'action.started').length, 2);
  });

  it('a fresh approval after the first expired inserts: the key counts the earlier approvals of the same scope, action and digest', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const digest = paramsDigest(PR.params);
    const first = grant(roots, 'run_ORDINAL', 'scm.pr.create', PR.params, clock);
    clock.t = T0 + APPROVAL_TTL_MS + 1;
    denied(authorize(roots, { ...PR, scope: 'run_ORDINAL' }, clock));
    const second = grant(roots, 'run_ORDINAL', 'scm.pr.create', PR.params, clock);
    const third = grant(roots, 'run_ORDINAL', 'scm.pr.create', PR.params, clock);
    assert.equal(first.idempotencyKey, approvalKey('run_ORDINAL', 'scm.pr.create', digest, 0));
    assert.equal(second.idempotencyKey, approvalKey('run_ORDINAL', 'scm.pr.create', digest, 1));
    assert.equal(third.idempotencyKey, approvalKey('run_ORDINAL', 'scm.pr.create', digest, 2));
    assert.equal(new Set([first, second, third].map((r) => r.idempotencyKey)).size, 3);
    allowed(authorize(roots, { ...PR, scope: 'run_ORDINAL' }, clock));
  });

  it('the oldest usable approval is consumed first', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const older = grant(roots, 'run_ORDER', 'scm.pr.create', PR.params, clock);
    clock.t = T0 + 1000;
    const newer = grant(roots, 'run_ORDER', 'scm.pr.create', PR.params, clock);
    const first = allowed(authorize(roots, { ...PR, scope: 'run_ORDER' }, clock));
    assert.equal(first.approvalId, older.approvalId);
    finish(roots, 'run_ORDER', first.startSeq, clock);
    assert.equal(allowed(authorize(roots, { ...PR, scope: 'run_ORDER' }, clock)).approvalId, newer.approvalId);
  });
});

describe('the request, the scopes and the classes around the gate', () => {
  it('a retry of a denied action names the same request and records it once', () => {
    const roots = freshRoots();
    const first = denied(authorize(roots, PR));
    const second = denied(authorize(roots, PR));
    assert.equal(second.requestId, first.requestId);
    assert.equal(eventsOf(roots, 'approval.requested').length, 1);
    const changed = denied(authorize(roots, { ...PR, params: { head: 'avarice/run_x', base: 'release' } }));
    assert.notEqual(changed.requestId, first.requestId, 'other parameters are another request');
  });

  it('after the request was approved and spent, the next denial asks again', async () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const request = denied(authorize(roots, PR, clock)).requestId as string;
    assert.equal((await runMain(roots, ['approve', request], { answers: ['y'], clock })).code, 0);
    allowed(authorize(roots, PR, clock));
    const next = denied(authorize(roots, PR, clock));
    assert.notEqual(next.requestId, request);
  });

  it('an attended session is a scope of its own: its events carry no run ID and its approval works', async () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    const input: AuthorizeInput = { scope: 'attended:sess_01ABC', action: 'scm.pr.create', params: PR.params };
    const request = denied(authorize(roots, input, clock)).requestId as string;
    assert.equal(eventsOf(roots, 'approval.requested')[0]?.run_id, null);
    assert.equal((await runMain(roots, ['approve', request], { answers: ['y'], clock })).code, 0);
    allowed(authorize(roots, input, clock));
    assert.equal(eventsOf(roots, 'action.started')[0]?.run_id, null);
    assert.equal(approvalsOf(roots)[0]?.run_id, 'attended:sess_01ABC');
  });

  it('a read action and a local-write action pass on their class with no record; an unknown action name is privileged', () => {
    const roots = freshRoots();
    assert.equal(allowed(authorize(roots, { scope: 'run_CLASS', action: 'repo.read', params: { path: 'src/a.ts' } })).source, 'class');
    assert.equal(allowed(authorize(roots, { scope: 'run_CLASS', action: 'workspace.write', params: { path: 'src/a.ts' } })).source, 'class');
    assert.equal(eventsOf(roots, 'action.started').length, 0);
    assert.match(denied(authorize(roots, { scope: 'run_CLASS', action: 'x.never-heard-of', params: {} })).rule, /^approval-required:apr_/);
  });

  it('parameters with no canonical form are refused, not approved', () => {
    const roots = freshRoots();
    const result = withDeps(roots, (deps) => authorizeAction(deps, { scope: 'run_NAN', action: 'scm.pr.create', params: { n: Number.NaN } }));
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'invalid');
  });

  it('parameters that cannot be shown whole get no approval request: deny with privileged:unapprovable, and a contract that authorizes them exactly still allows (G-04-1, GCR-01)', () => {
    const roots = freshRoots();
    const params = { head: 'avarice/run_x', base: 'b'.repeat(81) };
    const refused = denied(authorize(roots, { scope: 'run_UNSHOWABLE', action: 'scm.pr.create', params }));
    assert.equal(refused.rule, 'privileged:unapprovable');
    assert.equal(refused.requestId, undefined);
    assert.match(refused.message, /scm\.pr\.create cannot be approved/);
    assert.match(refused.message, /base is 81 characters/);
    assert.ok(!refused.message.includes('b'.repeat(20)), 'the message holds no part of the value');
    assert.equal(eventsOf(roots, 'approval.requested').length, 0);
    assert.equal(eventsOf(roots, 'action.started').length, 0);

    const contract = allowed(authorize(roots, { scope: 'run_UNSHOWABLE', action: 'scm.pr.create', params, contractAuthorization: { action: 'scm.pr.create', params } }));
    assert.equal(contract.source, 'contract');
    assert.equal(eventsOf(roots, 'approval.requested').length, 0);
    assert.equal(eventsOf(roots, 'action.started').length, 1);
  });

  it('finishPrivilegedAction ends an open start once, and refuses an end with no start', () => {
    const roots = freshRoots();
    const clock = new SetClock(T0);
    grant(roots, 'run_FIN', 'scm.pr.create', PR.params, clock);
    allowed(authorize(roots, { ...PR, scope: 'run_FIN' }, clock));
    withDeps(roots, (deps) => {
      assert.ok(finishPrivilegedAction(deps, 'run_FIN', 'scm.pr.create', { status: 'succeeded' }).ok);
      const again = finishPrivilegedAction(deps, 'run_FIN', 'scm.pr.create', { status: 'succeeded' });
      assert.ok(!again.ok);
      assert.equal(again.error.kind, 'conflict');
      const never = finishPrivilegedAction(deps, 'run_FIN', 'scm.pr.merge', { status: 'failed' });
      assert.ok(!never.ok);
    }, clock);
    assert.equal(eventsOf(roots, 'action.finished').length, 1);
  });
});
