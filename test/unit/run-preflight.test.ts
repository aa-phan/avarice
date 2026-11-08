// judgeRunPreflight (plan 02-10, D-04, D-16): the pure start rules. Every refusal code, both boundaries of the staleness
// limits (25 commits ok and 26 refuses; 14.0 days ok and 14.01 refuses), and the wording the owner reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STALENESS_LIMITS, judgeRunPreflight } from '../../src/domain/run-preflight.ts';
import type { RunPreflightFacts } from '../../src/domain/run-preflight.ts';

const PIN = '9f1cd8d0a1b2c3d4e5f60718293a4b5c6d7e8f90';
const HEAD = '4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6';

function facts(overrides: Partial<RunPreflightFacts> = {}): RunPreflightFacts {
  return {
    pin: PIN,
    head: HEAD,
    staleness: { descendant: true, commitsOutside: 0, oldestOutsideAgeDays: null },
    conventions: 'found',
    roadmapAtPin: true,
    ...overrides,
  };
}

function refusal(f: RunPreflightFacts): { code: string; message: string } {
  const verdict = judgeRunPreflight(f);
  assert.equal(verdict.ok, false, 'expected a refusal');
  if (verdict.ok) throw new Error('unreachable');
  return verdict.refusal;
}

describe('judgeRunPreflight', () => {
  it('limits are 25 commits and 14 days', () => {
    assert.deepEqual({ ...STALENESS_LIMITS }, { commits: 25, days: 14 });
  });

  it('accepts a source at the pin with conventions and a roadmap', () => {
    assert.deepEqual(judgeRunPreflight(facts()), { ok: true });
  });

  it('accepts a brief that names the pin by an abbreviation, in either letter case', () => {
    assert.deepEqual(judgeRunPreflight(facts({ briefBaseRevision: PIN.slice(0, 7) })), { ok: true });
    assert.deepEqual(judgeRunPreflight(facts({ briefBaseRevision: PIN.slice(0, 12).toUpperCase() })), { ok: true });
    assert.deepEqual(judgeRunPreflight(facts({ briefBaseRevision: PIN })), { ok: true });
  });

  it('revision-mismatch: a brief that names another revision asks for a re-onboard', () => {
    const r = refusal(facts({ briefBaseRevision: 'abc1234' }));
    assert.equal(r.code, 'revision-mismatch');
    assert.match(r.message, /abc1234/);
    assert.match(r.message, new RegExp(PIN.slice(0, 7)));
    assert.match(r.message, /re-onboard/);
  });

  it('not-descendant: a source HEAD that does not descend from the pin', () => {
    const r = refusal(facts({ staleness: { descendant: false, commitsOutside: 0, oldestOutsideAgeDays: null } }));
    assert.equal(r.code, 'not-descendant');
    assert.match(r.message, new RegExp(HEAD.slice(0, 7)));
    assert.match(r.message, /re-onboard/);
  });

  it('stale-commits: 25 commits is ok and 26 refuses, with the specified wording', () => {
    assert.deepEqual(judgeRunPreflight(facts({ staleness: { descendant: true, commitsOutside: 25, oldestOutsideAgeDays: 1 } })), { ok: true });
    const r = refusal(facts({ staleness: { descendant: true, commitsOutside: 26, oldestOutsideAgeDays: 1 } }));
    assert.equal(r.code, 'stale-commits');
    assert.equal(
      r.message,
      `the source has 26 commits past the onboarded revision ${PIN.slice(0, 7)} outside .avarice/ and .planning/ (limit 25); re-onboard the repository (adoption and refresh arrive in a later phase)`,
    );
  });

  it('stale-age: 14.0 days is ok and 14.01 refuses', () => {
    assert.deepEqual(judgeRunPreflight(facts({ staleness: { descendant: true, commitsOutside: 3, oldestOutsideAgeDays: 14.0 } })), { ok: true });
    const r = refusal(facts({ staleness: { descendant: true, commitsOutside: 3, oldestOutsideAgeDays: 14.01 } }));
    assert.equal(r.code, 'stale-age');
    assert.match(r.message, /14\.01 days old/);
    assert.match(r.message, /limit 14/);
    assert.match(r.message, /re-onboard/);
  });

  it('a stale age with no commit outside is not a refusal (nothing is stale)', () => {
    assert.deepEqual(judgeRunPreflight(facts({ staleness: { descendant: true, commitsOutside: 0, oldestOutsideAgeDays: null } })), { ok: true });
  });

  it('no-conventions: names .avarice/config.json and the D-16 rule in one sentence', () => {
    const r = refusal(facts({ conventions: 'not_found' }));
    assert.equal(r.code, 'no-conventions');
    assert.match(r.message, /\.avarice\/config\.json/);
    assert.match(r.message, /only \.avarice\//);
    assert.equal(r.message.includes('\n'), false);
    assert.equal(r.message.split('. ').length, 1, 'one sentence');
  });

  it('no-planning: a pin tree without .planning/ROADMAP.md is refused', () => {
    const r = refusal(facts({ roadmapAtPin: false }));
    assert.equal(r.code, 'no-planning');
    assert.match(r.message, /\.planning\/ROADMAP\.md/);
  });

  it('judges in order: revision, descent, commits, age, conventions, planning', () => {
    const everything = facts({
      briefBaseRevision: 'abc1234',
      staleness: { descendant: false, commitsOutside: 99, oldestOutsideAgeDays: 99 },
      conventions: 'not_found',
      roadmapAtPin: false,
    });
    assert.equal(refusal(everything).code, 'revision-mismatch');
    assert.equal(refusal({ ...everything, briefBaseRevision: undefined } as RunPreflightFacts).code, 'not-descendant');
    const stale = { ...everything, briefBaseRevision: undefined, staleness: { descendant: true, commitsOutside: 99, oldestOutsideAgeDays: 99 } } as RunPreflightFacts;
    assert.equal(refusal(stale).code, 'stale-commits');
    assert.equal(refusal({ ...stale, staleness: { descendant: true, commitsOutside: 5, oldestOutsideAgeDays: 99 } }).code, 'stale-age');
    assert.equal(refusal({ ...stale, staleness: { descendant: true, commitsOutside: 5, oldestOutsideAgeDays: 1 } }).code, 'no-conventions');
    assert.equal(refusal({ ...stale, staleness: { descendant: true, commitsOutside: 5, oldestOutsideAgeDays: 1 }, conventions: 'found' }).code, 'no-planning');
  });
});
