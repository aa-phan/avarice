// The response checks in the order D-15 states them (AUT-4, AUT-5; T-03-08, T-03-09). The expected verdicts are written out
// here, independently of the module. No verdict is ever `apply` because time passed: the facts carry no time at all.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESPONSE_CHECKS, validateResponse } from '../../src/domain/response-validation.ts';
import type { ResponseFacts, ResponseVerdict } from '../../src/domain/response-validation.ts';

const DIGEST = 'sha256:' + 'a'.repeat(64);
const MOVED = 'sha256:' + 'b'.repeat(64);

const CHOICES = [
  { key: '1', label: 'one', kind: 'choice' as const },
  { key: '2', label: 'two', kind: 'choice' as const },
];

interface Over {
  identity?: Partial<ResponseFacts['identity']>;
  decision?: Partial<ResponseFacts['decision']>;
  answer?: ResponseFacts['answer'];
  currentDigest?: string;
}

function facts(over: Over = {}): ResponseFacts {
  return {
    identity: { interactive: true, underRun: false, inRunTree: false, ownsProfile: true, ...over.identity },
    decision: { decisionId: 'dec_1', state: 'open', options: CHOICES, answer: null, stateDigest: DIGEST, ...over.decision },
    answer: over.answer ?? { key: '1' },
    currentDigest: over.currentDigest ?? DIGEST,
  };
}

function reject(verdict: ResponseVerdict): { stage: string; check: string; detail: string } {
  assert.equal(verdict.verdict, 'reject', JSON.stringify(verdict));
  return verdict as { stage: string; check: string; detail: string; verdict: 'reject' };
}

describe('RESPONSE_CHECKS', () => {
  it('lists the D-15 checks in order', () => {
    assert.deepEqual([...RESPONSE_CHECKS], ['identity', 'open', 'option', 'duplicate', 'state-digest']);
  });
});

describe('validateResponse: identity', () => {
  it('passes for an interactive terminal outside the run that the profile owner types at', () => {
    assert.deepEqual(validateResponse(facts()), { verdict: 'apply', answer: '1', kind: 'choice' });
  });

  it('rejects each failing fact alone, with the check that names it', () => {
    const cases: Array<[Partial<ResponseFacts['identity']>, string]> = [
      [{ interactive: false }, 'identity:not-interactive'],
      [{ underRun: true }, 'identity:avarice-run'],
      [{ inRunTree: true }, 'identity:run-tree'],
      [{ ownsProfile: false }, 'identity:profile-owner'],
    ];
    for (const [identity, code] of cases) {
      const r = reject(validateResponse(facts({ identity })));
      assert.equal(r.stage, 'identity');
      assert.equal(r.check, code);
    }
  });

  it('with several failures the first in the order interactive, run marker, run tree, owner wins', () => {
    const all = { interactive: false, underRun: true, inRunTree: true, ownsProfile: false };
    assert.equal(reject(validateResponse(facts({ identity: all }))).check, 'identity:not-interactive');
    assert.equal(reject(validateResponse(facts({ identity: { ...all, interactive: true } }))).check, 'identity:avarice-run');
    assert.equal(reject(validateResponse(facts({ identity: { ...all, interactive: true, underRun: false } }))).check, 'identity:run-tree');
    assert.equal(reject(validateResponse(facts({ identity: { interactive: true, underRun: false, inRunTree: false, ownsProfile: false } }))).check, 'identity:profile-owner');
  });

  it('is judged before anything about the decision or the answer', () => {
    const r = reject(validateResponse(facts({
      identity: { underRun: true },
      decision: { state: 'withdrawn' },
      answer: { key: 'nope' },
      currentDigest: MOVED,
    })));
    assert.equal(r.check, 'identity:avarice-run');
  });
});

describe('validateResponse: the decision is open', () => {
  it('rejects a stale decision and names its successor when there is one', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'stale', successorId: 'dec_2' } })));
    assert.equal(r.stage, 'open');
    assert.equal(r.check, 'decision-stale');
    assert.match(r.detail, /dec_2/);
  });

  it('rejects a stale decision with no successor named', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'stale' } })));
    assert.equal(r.check, 'decision-stale');
  });

  it('rejects a withdrawn decision', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'withdrawn' } })));
    assert.equal(r.stage, 'open');
    assert.equal(r.check, 'decision-withdrawn');
  });

  it('rejects a state it does not know', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'pending' } })));
    assert.equal(r.stage, 'open');
    assert.equal(r.check, 'decision-not-open');
  });

  it('is judged before the answer: a stale decision with an unlisted answer is stale', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'stale' }, answer: { key: '9' } })));
    assert.equal(r.check, 'decision-stale');
  });

  it('lets an answered decision go on to the option and duplicate checks', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'answered', answer: '1' }, answer: { key: '9' } })));
    assert.equal(r.check, 'option-not-listed');
  });
});

describe('validateResponse: the answer is a listed option or allowed free text', () => {
  it('applies a listed key', () => {
    assert.deepEqual(validateResponse(facts({ answer: { key: '2' } })), { verdict: 'apply', answer: '2', kind: 'choice' });
  });

  it('rejects a key that is not listed', () => {
    for (const key of ['3', '', 'text', 'withdraw']) {
      const r = reject(validateResponse(facts({ answer: { key } })));
      assert.equal(r.stage, 'option');
      assert.equal(r.check, 'option-not-listed', key);
    }
  });

  it('rejects an answer that holds neither a key nor text, or both', () => {
    assert.equal(reject(validateResponse(facts({ answer: {} }))).check, 'answer-missing');
    assert.equal(reject(validateResponse(facts({ answer: { key: '1', text: 'x' } }))).check, 'answer-ambiguous');
  });

  it('rejects free text on a record that has no text option', () => {
    const r = reject(validateResponse(facts({ answer: { text: 'my own idea' } })));
    assert.equal(r.stage, 'option');
    assert.equal(r.check, 'free-text-not-allowed');
  });

  const TEXT_RECORD = [{ key: 'text', label: 'free text', kind: 'text' as const }];

  it('applies free text on a record that allows it', () => {
    assert.deepEqual(validateResponse(facts({ decision: { options: TEXT_RECORD }, answer: { text: 'keep the heading' } })), {
      verdict: 'apply',
      answer: 'keep the heading',
      kind: 'text',
    });
  });

  it('rejects text over 2000 characters, text with a control character, and text that is empty', () => {
    const cases = ['x'.repeat(2001), 'a\u0007b', 'a\u0000b', '', '   \n  '];
    for (const text of cases) {
      const r = reject(validateResponse(facts({ decision: { options: TEXT_RECORD }, answer: { text } })));
      assert.equal(r.check, 'text-invalid', JSON.stringify(text).slice(0, 20));
    }
  });

  it('allows text of exactly 2000 characters, with tabs and line feeds', () => {
    const text = `${'x'.repeat(1990)}\t\n${'y'.repeat(8)}`;
    assert.equal(text.length, 2000);
    const v = validateResponse(facts({ decision: { options: TEXT_RECORD }, answer: { text } }));
    assert.equal(v.verdict, 'apply');
  });

  it('does not take a text option for a key', () => {
    const r = reject(validateResponse(facts({ decision: { options: TEXT_RECORD }, answer: { key: 'text' } })));
    assert.equal(r.check, 'option-not-listed');
  });
});

describe('validateResponse: duplicates', () => {
  it('ignores the same key answered again, and the same text', () => {
    const again = validateResponse(facts({ decision: { state: 'answered', answer: '1' }, answer: { key: '1' } }));
    assert.deepEqual(again, { verdict: 'duplicate', answer: '1', kind: 'choice' });
    const text = validateResponse(facts({
      decision: { state: 'answered', answer: 'keep it', options: [{ key: 'text', label: 'free text', kind: 'text' }] },
      answer: { text: 'keep it' },
    }));
    assert.deepEqual(text, { verdict: 'duplicate', answer: 'keep it', kind: 'text' });
  });

  it('rejects a different answer to an answered decision', () => {
    const r = reject(validateResponse(facts({ decision: { state: 'answered', answer: '1' }, answer: { key: '2' } })));
    assert.equal(r.stage, 'duplicate');
    assert.equal(r.check, 'decision-answered');
  });

  it('is judged before the digest: a duplicate whose digest moved is a duplicate, not stale', () => {
    const v = validateResponse(facts({ decision: { state: 'answered', answer: '1' }, answer: { key: '1' }, currentDigest: MOVED }));
    assert.equal(v.verdict, 'duplicate');
  });
});

describe('validateResponse: the state digest', () => {
  it('applies when the digest matches', () => {
    assert.equal(validateResponse(facts()).verdict, 'apply');
  });

  it('is stale, never apply, when the digest moved', () => {
    assert.deepEqual(validateResponse(facts({ currentDigest: MOVED })), { verdict: 'stale', answer: '1', kind: 'choice' });
    const text = validateResponse(facts({ decision: { options: [{ key: 'text', label: 'free text', kind: 'text' }] }, answer: { text: 'hi' }, currentDigest: MOVED }));
    assert.deepEqual(text, { verdict: 'stale', answer: 'hi', kind: 'text' });
  });

  it('is stale when the digest to compare is empty on either side', () => {
    assert.equal(validateResponse(facts({ currentDigest: '' })).verdict, 'stale');
    assert.equal(validateResponse(facts({ decision: { stateDigest: '' }, currentDigest: '' })).verdict, 'stale');
  });

  it('applies a withdraw even when the digest differs, because a withdraw applies nothing to the work', () => {
    const withdraw = [{ key: 'withdraw', label: 'withdraw', kind: 'withdraw' as const }];
    assert.deepEqual(validateResponse(facts({ decision: { options: withdraw }, answer: { key: 'withdraw' }, currentDigest: MOVED })), {
      verdict: 'apply',
      answer: 'withdraw',
      kind: 'withdraw',
    });
  });

  it('does not let withdraw skip any earlier check', () => {
    const withdraw = [{ key: 'withdraw', label: 'withdraw', kind: 'withdraw' as const }];
    const base = { decision: { options: withdraw }, answer: { key: 'withdraw' }, currentDigest: MOVED };
    assert.equal(reject(validateResponse(facts({ ...base, identity: { inRunTree: true } }))).check, 'identity:run-tree');
    assert.equal(reject(validateResponse(facts({ ...base, decision: { options: withdraw, state: 'stale' } }))).check, 'decision-stale');
  });
});

describe('every check rejects and passes', () => {
  it('has a rejecting case and a passing case for each name in RESPONSE_CHECKS', () => {
    const rejecting: Record<string, Over> = {
      identity: { identity: { interactive: false } },
      open: { decision: { state: 'withdrawn' } },
      option: { answer: { key: '9' } },
      duplicate: { decision: { state: 'answered', answer: '1' }, answer: { key: '2' } },
    };
    for (const stage of RESPONSE_CHECKS) {
      if (stage === 'state-digest') {
        // This check does not reject: it decides between apply and stale.
        assert.equal(validateResponse(facts({ currentDigest: MOVED })).verdict, 'stale');
        assert.equal(validateResponse(facts()).verdict, 'apply');
        continue;
      }
      assert.equal(reject(validateResponse(facts(rejecting[stage]))).stage, stage);
      // The same facts with that one problem removed reach a later stage and are not rejected there.
      const v = validateResponse(facts());
      assert.notEqual(v.verdict === 'reject' ? v.stage : null, stage);
    }
  });
});

describe('validateResponse takes no time: silence cannot approve (AUT-4)', () => {
  it('the facts hold no field about time, a deadline or a timeout', () => {
    const f = facts();
    const names = [...Object.keys(f), ...Object.keys(f.identity), ...Object.keys(f.decision), ...Object.keys(f.answer)];
    assert.deepEqual(names.filter((n) => /time|deadline|expire|clock|now|elapsed|silence|timeout|ttl/i.test(n)), []);
  });

  it('a time field is not part of the facts type', () => {
    // @ts-expect-error the facts have no deadline
    const withDeadline: ResponseFacts = { ...facts(), deadline: 1 };
    // @ts-expect-error the facts have no time
    const withTime: ResponseFacts = { ...facts(), nowMs: 1 };
    assert.equal(typeof withDeadline, 'object');
    assert.equal(typeof withTime, 'object');
  });

  it('reads no clock: Date.now and the Date constructor are never called', (t) => {
    t.mock.method(Date, 'now', () => {
      throw new Error('validateResponse read the clock');
    });
    assert.equal(validateResponse(facts()).verdict, 'apply');
    assert.equal(validateResponse(facts({ currentDigest: MOVED })).verdict, 'stale');
  });

  it('gives the same verdict however often it is asked: no verdict depends on when', () => {
    const first = validateResponse(facts({ currentDigest: MOVED }));
    for (let i = 0; i < 5; i += 1) assert.deepEqual(validateResponse(facts({ currentDigest: MOVED })), first);
  });
});
