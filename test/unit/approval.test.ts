// The pure rules of parameter-bound approvals (plan 04-16; FR-12, FR-15, ADR-005): the canonical parameter digest, the idempotency key, the expiry
// boundary and the bounded parameter summary.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVAL_TTL_MS, approvalKey, isUsable, paramsDigest, paramsSummary, scopeRunId } from '../../src/domain/approval.ts';

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
