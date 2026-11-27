// The pure rules of parameter-bound approvals (plan 04-16; FR-12, FR-15, ADR-005): the canonical parameter digest, the idempotency key, the expiry
// boundary and the bounded parameter summary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_TTL_MS, MAX_CWD_CHARS, MAX_SUMMARY_CHARS, MAX_VALUE_CHARS, approvalKey, isUsable, paramsDigest, paramsSummary, scopeRunId, unshowableReason } from '../../src/domain/approval.ts';
import { classifyLine } from '../../src/domain/privileged-commands.ts';
import { findSecrets } from '../../src/domain/secret-patterns.ts';

const T = Date.UTC(2026, 10, 16, 12, 0, 0);
const usable = (expiresAtMs: number, extra: { revokedAt?: string | null; consumedAt?: string | null } = {}) => ({
  expiresAt: new Date(expiresAtMs).toISOString(),
  revokedAt: extra.revokedAt ?? null,
  consumedAt: extra.consumedAt ?? null,
});

describe('APPROVAL_TTL_MS', () => {
  it('is 30 minutes (docs/contracts-and-state.md: single use, 30-minute default)', () => {
    assert.equal(APPROVAL_TTL_MS, 30 * 60 * 1000);
  });
});

describe('isUsable: the expiry boundary (FR-12)', () => {
  it('is false at the instant the approval expires', () => {
    assert.equal(isUsable(usable(T), T), false);
  });

  it('is true one millisecond before it expires', () => {
    assert.equal(isUsable(usable(T), T - 1), true);
  });

  it('is false after it expired', () => {
    assert.equal(isUsable(usable(T), T + 1), false);
  });

  it('is false for a revoked approval and for a consumed one, however far from expiry', () => {
    assert.equal(isUsable(usable(T + APPROVAL_TTL_MS, { revokedAt: new Date(T).toISOString() }), T), false);
    assert.equal(isUsable(usable(T + APPROVAL_TTL_MS, { consumedAt: new Date(T).toISOString() }), T), false);
  });

  it('is false when the stored expiry is not a time', () => {
    assert.equal(isUsable({ expiresAt: 'tomorrow', revokedAt: null, consumedAt: null }, T), false);
    assert.equal(isUsable({ expiresAt: '', revokedAt: null, consumedAt: null }, T), false);
  });
});

describe('paramsDigest: SHA-256 of canonical JSON (FR-12 precision edge)', () => {
  it('gives equal digests for equal values whatever the key order, at any depth', () => {
    assert.equal(paramsDigest({ a: 1, b: [2] }), paramsDigest({ b: [2], a: 1 }));
    assert.equal(paramsDigest({ outer: { x: 1, y: 2 }, z: 'q' }), paramsDigest({ z: 'q', outer: { y: 2, x: 1 } }));
  });

  it('has the form sha256:<64 hex>', () => {
    assert.match(paramsDigest({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  });

  it('gives a different digest when any value, key or element order changes', () => {
    const base = paramsDigest({ a: 1, b: [2, 3], c: 'x' });
    assert.notEqual(paramsDigest({ a: 2, b: [2, 3], c: 'x' }), base);
    assert.notEqual(paramsDigest({ a: 1, b: [3, 2], c: 'x' }), base);
    assert.notEqual(paramsDigest({ a: 1, b: [2, 3], c: 'y' }), base);
    assert.notEqual(paramsDigest({ a: 1, b: [2, 3], c: 'x', d: 0 }), base);
    assert.notEqual(paramsDigest({ a: 1, b: [2, 3] }), base);
  });

  it('does not confuse a string with a number or a nested value with a flat one', () => {
    assert.notEqual(paramsDigest({ n: 1 }), paramsDigest({ n: '1' }));
    assert.notEqual(paramsDigest({ a: { b: 1 } }), paramsDigest({ 'a.b': 1 }));
  });

  it('refuses a value that has no canonical form instead of sharing a digest', () => {
    assert.throws(() => paramsDigest({ n: Number.NaN }), TypeError);
    assert.throws(() => paramsDigest({ n: Number.POSITIVE_INFINITY }), TypeError);
    assert.throws(() => paramsDigest({ f: () => 1 }), TypeError);
  });
});

describe('approvalKey', () => {
  const digest = paramsDigest({ head: 'x' });

  it('is a SHA-256 hex string, the same for the same inputs', () => {
    assert.match(approvalKey('run_a', 'scm.pr.create', digest, 0), /^[0-9a-f]{64}$/);
    assert.equal(approvalKey('run_a', 'scm.pr.create', digest, 0), approvalKey('run_a', 'scm.pr.create', digest, 0));
  });

  it('changes with the scope, the action, the digest and the ordinal, each alone', () => {
    const base = approvalKey('run_a', 'scm.pr.create', digest, 0);
    assert.notEqual(approvalKey('run_b', 'scm.pr.create', digest, 0), base);
    assert.notEqual(approvalKey('run_a', 'scm.pr.update', digest, 0), base);
    assert.notEqual(approvalKey('run_a', 'scm.pr.create', paramsDigest({ head: 'y' }), 0), base);
    assert.notEqual(approvalKey('run_a', 'scm.pr.create', digest, 1), base);
  });

  it('cannot be forged by moving text between fields', () => {
    assert.notEqual(approvalKey('run_a', 'b', digest, 0), approvalKey('run_', 'ab', digest, 0));
    assert.notEqual(approvalKey('a:b', 'c', digest, 0), approvalKey('a', 'b:c', digest, 0));
  });
});

describe('scopeRunId', () => {
  it('is the scope itself for a run or an onboarding, and nothing for an attended session', () => {
    assert.equal(scopeRunId('run_01ABC'), 'run_01ABC');
    assert.equal(scopeRunId('onb_01ABC'), 'onb_01ABC');
    assert.equal(scopeRunId('attended:sess_1'), undefined);
  });
});

describe('paramsSummary: what the owner is shown (bounded, one line)', () => {
  it('lists key=value in key order', () => {
    assert.equal(paramsSummary({ head: 'avarice/run_x', base: 'main' }), 'base=main head=avarice/run_x');
  });

  it('cuts a long value and the whole summary', () => {
    const one = paramsSummary({ body: 'x'.repeat(500) });
    assert.ok(one.length <= 'body='.length + 80, one);
    assert.ok(one.endsWith('…'));
    const many = paramsSummary(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key${String(i).padStart(2, '0')}`, 'v'.repeat(70)])));
    assert.ok(many.length <= 400, `${many.length}`);
  });

  it('replaces control characters so a value cannot move the cursor or start a line', () => {
    const text = paramsSummary({ title: 'a\nb\u001b[31mc' });
    assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f]/);
  });

  it('shows a nested value as canonical JSON and leaves out an undefined one', () => {
    assert.equal(paramsSummary({ labels: ['b', 'a'], meta: { z: 1, a: 2 }, gone: undefined }), 'labels=["b","a"] meta={"a":2,"z":1}');
  });

  it('does not throw for a value with no canonical form', () => {
    assert.equal(paramsSummary({ f: () => 1 }), 'f=[unprintable]');
  });
});

describe('unshowableReason: the parameters an owner cannot be shown whole are refused (G-04-1, GCR-01, FR-12)', () => {
  const v = (n: number): string => 'v'.repeat(n);
  // Four values of 80 characters and a fifth sized so the entries other than cwd, joined with single spaces, take exactly `total` characters.
  const summaryOf = (total: number): Record<string, string> => ({ k1: v(80), k2: v(80), k3: v(80), k4: v(80), k5: v(total - 339) });
  const unclipped = (params: Record<string, string>): string =>
    Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join(' ');

  it('the value cap: exactly 80 characters is shown whole, 81 is refused with a reason that names the key and not the value', () => {
    assert.equal(MAX_VALUE_CHARS, 80);
    assert.equal(unshowableReason({ head: v(80) }), undefined);
    const reason = unshowableReason({ head: v(81) });
    assert.ok(reason !== undefined);
    assert.match(reason, /head is 81 characters; at most 80 are shown/);
    assert.ok(!reason.includes(v(10)), 'the reason holds no part of the value');
    assert.ok(reason.endsWith('; the owner can run the command at their own terminal'), reason);
  });

  it('the key cap: a key of 80 characters is shown whole, 81 is refused', () => {
    assert.equal(unshowableReason({ [v(80)]: 'x' }), undefined);
    assert.match(unshowableReason({ [v(81)]: 'x' }) ?? '', /a parameter name is 81 characters; at most 80 are shown/);
  });

  it('the summary cap: entries other than cwd of exactly 400 characters are shown whole, 401 are refused', () => {
    assert.equal(MAX_SUMMARY_CHARS, 400);
    const at = summaryOf(400);
    assert.equal(unclipped(at).length, 400);
    assert.equal(unshowableReason(at), undefined);
    assert.equal(paramsSummary(at), unclipped(at), 'an accepted summary is never cut');
    const past = summaryOf(401);
    assert.equal(unclipped(past).length, 401);
    assert.match(unshowableReason(past) ?? '', /the parameters other than cwd take 401 characters to show; at most 400 are shown/);
  });

  it('refuses a key or a value that holds a control character, since it would be shown as a space', () => {
    for (const bad of ['a\tb', 'a\nb', 'a\u001b[31mb', 'a\u007fb']) {
      assert.match(unshowableReason({ title: bad }) ?? '', /title holds a control character/);
    }
    assert.match(unshowableReason({ 'a\nb': 'x' }) ?? '', /a parameter name holds a control character/);
  });

  it('refuses a value the secret patterns match, without printing it', () => {
    const token = `ghp_${'a'.repeat(36)}`;
    const reason = unshowableReason({ note: `x ${token}` });
    assert.ok(reason !== undefined);
    assert.match(reason, /note holds text that looks like a credential \([a-z-]+\)/);
    assert.ok(!reason.includes(token));
    assert.ok(unshowableReason({ cwd: `/work/${token}` }) !== undefined, 'the directory is checked too');
  });

  it('refuses a value with no canonical form, and ignores an undefined one', () => {
    assert.match(unshowableReason({ n: Number.NaN }) ?? '', /n has no printable canonical form/);
    assert.match(unshowableReason({ f: () => 1 }) ?? '', /f has no printable canonical form/);
    assert.equal(unshowableReason({ a: 'x', gone: undefined }), undefined);
    assert.equal(unshowableReason({ n: 5, ok: true, none: null, list: ['a'], meta: { z: 1 } }), undefined);
  });

  it('for any parameters it accepts, paramsSummary is the whole joined text', () => {
    const params = { head: 'avarice/run_x', base: 'main', n: 5, ok: false, none: null, meta: { z: 1, a: 2 } };
    assert.equal(unshowableReason(params), undefined);
    assert.equal(paramsSummary(params), 'base=main head=avarice/run_x meta={"a":2,"z":1} n=5 none=null ok=false');
  });

  it('the cwd cap: exactly 512 characters is shown whole, 513 is refused with a reason that names cwd', () => {
    assert.equal(MAX_CWD_CHARS, 512);
    const at = { cwd: `/${v(511)}` };
    assert.equal(at.cwd.length, 512);
    assert.equal(unshowableReason(at), undefined);
    assert.equal(paramsSummary(at), `cwd=${at.cwd}`);
    const past = { cwd: `/${v(512)}` };
    assert.match(unshowableReason(past) ?? '', /cwd is 513 characters; at most 512 are shown/);
    assert.ok(!(unshowableReason(past) ?? '').includes(v(20)));
  });

  it('the cwd counts against neither the value cap nor the summary cap, and is shown whole', () => {
    const cwd = `/${v(299)}`;
    assert.equal(cwd.length, 300);
    const params = { cwd, a: v(80), b: v(80), c: 'x' };
    assert.equal(unshowableReason(params), undefined);
    const summary = paramsSummary(params);
    assert.ok(summary.includes(`cwd=${cwd}`), 'the whole directory is shown');
    assert.ok(!summary.includes('…'), summary);
    assert.equal(summary, unclipped(params));
    // the longest summary an accepted set can take: 400 characters of other entries, a space and a directory entry of 516
    const longest = { ...summaryOf(400), cwd: `/${v(511)}` };
    assert.equal(unshowableReason(longest), undefined);
    assert.equal(paramsSummary(longest), unclipped(longest));
    assert.equal(paramsSummary(longest).length, 400 + ' cwd='.length + 512);
  });

  it('refuses a cwd that holds a newline', () => {
    assert.match(unshowableReason({ cwd: '/tmp/a\nb' }) ?? '', /cwd holds a control character/);
  });

  it('accepts the parameters the classifier builds for a real push, with a long directory and a 64-hex value, and their summary holds no secret', () => {
    const found = classifyLine('GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519" git -c user.name=Owner push origin main');
    assert.equal(found.kind, 'privileged');
    const command = found.kind === 'privileged' ? found.commands[0] : undefined;
    assert.ok(command !== undefined);
    for (const key of ['remote', 'refspec', 'gitOptions', 'env', 'line']) assert.ok(key in command.params, `the classifier sets ${key}`);
    assert.match(command.params['line'] as string, /^sha256:[0-9a-f]{32}$/);
    const cwd = `/private/var/folders/xx/${v(76)}`;
    assert.equal(cwd.length, 100);
    const params = { ...command.params, cwd, digest: 'ab12cd34'.repeat(8) };
    assert.equal(unshowableReason(params), undefined);
    assert.deepEqual(findSecrets(paramsSummary(params)), []);
  });
});
