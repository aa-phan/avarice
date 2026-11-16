// The one state digest (D-15). A decision opened before this phase hashed contract version, base revision and policy
// revision; for a manual brief the new function must give the same value, so those decisions keep matching.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { digestOf } from '../../src/domain/digest.ts';
import { computeStateDigest } from '../../src/domain/state-digest.ts';

const BASE = 'a'.repeat(40);
const POLICY = 'sha256:' + 'b'.repeat(64);
const BRIEF = { kind: 'brief', revision: 'sha256:' + 'c'.repeat(64) };

function facts(over: Partial<Parameters<typeof computeStateDigest>[0]> = {}): Parameters<typeof computeStateDigest>[0] {
  return { contractVersion: 1, baseRevision: BASE, policyRevision: POLICY, requirementRefs: [BRIEF], ...over };
}

describe('computeStateDigest', () => {
  it('equals the Phase 2 digest for a manual brief, so earlier decisions keep matching', () => {
    const phase2 = digestOf({ contractVersion: 1, baseRevision: BASE, policyRevision: POLICY });
    assert.equal(computeStateDigest(facts()), phase2);
    assert.equal(computeStateDigest(facts({ requirementRefs: [] })), phase2);
  });

  it('is a sha256 digest string', () => {
    assert.match(computeStateDigest(facts()), /^sha256:[0-9a-f]{64}$/);
  });

  it('changes with the contract version, the base revision and the policy revision', () => {
    const one = computeStateDigest(facts());
    assert.notEqual(computeStateDigest(facts({ contractVersion: 2 })), one);
    assert.notEqual(computeStateDigest(facts({ baseRevision: 'd'.repeat(40) })), one);
    assert.notEqual(computeStateDigest(facts({ policyRevision: 'sha256:' + 'e'.repeat(64) })), one);
  });

  it('adds the ticket revisions when a requirement reference is not the manual brief', () => {
    const ticket = { kind: 'ticket', id: 'T-1', revision: 'r7' };
    const withTicket = computeStateDigest(facts({ requirementRefs: [BRIEF, ticket] }));
    assert.notEqual(withTicket, computeStateDigest(facts()));
    assert.equal(withTicket, digestOf({ contractVersion: 1, baseRevision: BASE, policyRevision: POLICY, ticketRevisions: ['ticket:T-1:r7'] }));
  });

  it('changes when a ticket revision moves, whichever order the references arrive in', () => {
    const a = { kind: 'ticket', id: 'T-1', revision: 'r7' };
    const b = { kind: 'ticket', id: 'T-2', revision: 'r3' };
    const forward = computeStateDigest(facts({ requirementRefs: [a, b] }));
    assert.equal(computeStateDigest(facts({ requirementRefs: [b, a] })), forward);
    assert.notEqual(computeStateDigest(facts({ requirementRefs: [a, { ...b, revision: 'r4' }] })), forward);
  });

  it('does not let the brief revision change it: the brief stands for itself through the contract version', () => {
    const other = { kind: 'brief', revision: 'sha256:' + 'f'.repeat(64) };
    assert.equal(computeStateDigest(facts({ requirementRefs: [other] })), computeStateDigest(facts()));
  });
});
