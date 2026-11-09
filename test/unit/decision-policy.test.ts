// The decision rules as pure functions (AUT-1, AUT-2, owner decision 2). The expected values are written out here,
// independently of the domain module: which text becomes which option, which signal becomes which class and
// authority, and what a record holds for the owner to read.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRecord, classifyDecision, parseNumberedOptions } from '../../src/domain/decision-policy.ts';
import type { DecisionClassification } from '../../src/domain/decision-policy.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';

const NO_RULES: RunContract['decisions'] = { delegated: [], defaults: [], human: [], prohibited: [] };

const WORDING = 'Which wording?\n1. Couldn\'t copy. Email me at a@b.c.\n2. Opening your mail app (Recommended)';

function pauseClassification(question: string | undefined): DecisionClassification {
  return classifyDecision({ kind: 'pause', ...(question !== undefined ? { question } : {}), pauseSignal: 'numbered-choice' }, NO_RULES);
}

describe('parseNumberedOptions', () => {
  it('parses a numbered-choice final text into choices and the recommended key', () => {
    assert.deepEqual(parseNumberedOptions(WORDING), {
      choices: [
        { key: '1', label: 'Couldn\'t copy. Email me at a@b.c.', kind: 'choice' },
        { key: '2', label: 'Opening your mail app', kind: 'choice' },
      ],
      recommended: '2',
    });
  });

  it('gives no choices and no recommendation for text without a numbered list', () => {
    assert.deepEqual(parseNumberedOptions('I changed the copy and committed it.'), { choices: [] });
    assert.deepEqual(parseNumberedOptions(''), { choices: [] });
  });

  it('needs a question line before the choices, choices numbered from 1 in order, and at least two of them', () => {
    assert.deepEqual(parseNumberedOptions('1. one\n2. two'), { choices: [] });
    assert.deepEqual(parseNumberedOptions('Which?\n1. only'), { choices: [] });
    assert.deepEqual(parseNumberedOptions('Which?\n2. two\n3. three'), { choices: [] });
    assert.deepEqual(parseNumberedOptions('Not a question.\n1. one\n2. two'), { choices: [] });
  });

  it('reads the numbered lines at the end of the text, after any earlier prose', () => {
    const text = 'I read the brief.\nHere is the state of things.\n\nShould the button be disabled?\n1. Yes\n2. No\n';
    assert.deepEqual(parseNumberedOptions(text).choices.map((c) => c.key), ['1', '2']);
  });

  it('cuts each label to 200 characters, removes control characters and keeps at most 9 options', () => {
    const long = 'x'.repeat(250);
    const text = `Which?\n1. ${long}\n2. a\u0007b​c\n3. three\n4. four\n5. five\n6. six\n7. seven\n8. eight\n9. nine\n10. ten\n11. eleven`;
    const parsed = parseNumberedOptions(text);
    assert.equal(parsed.choices.length, 9);
    assert.equal((parsed.choices[0] as { label: string }).label, 'x'.repeat(200));
    assert.equal((parsed.choices[1] as { label: string }).label, 'abc');
    assert.deepEqual(parsed.choices.map((c) => c.key), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('takes the recommended marker only at the end of a label, in any case, and removes it from the label', () => {
    const parsed = parseNumberedOptions('Which?\n1. Keep (recommended)\n2. Drop it (not recommended yet)');
    assert.equal(parsed.recommended, '1');
    assert.deepEqual(parsed.choices.map((c) => c.label), ['Keep', 'Drop it (not recommended yet)']);
  });

  it('does not recommend anything when two choices both claim it', () => {
    const parsed = parseNumberedOptions('Which?\n1. A (Recommended)\n2. B (Recommended)');
    assert.equal(parsed.recommended, undefined);
    assert.deepEqual(parsed.choices.map((c) => c.label), ['A', 'B']);
  });
});

describe('classifyDecision: a pause', () => {
  it('is class acceptance, authority human, blocking, with the parsed options', () => {
    const c = pauseClassification(WORDING);
    assert.equal(c.record, 'decision');
    assert.equal(c.class, 'acceptance');
    assert.equal(c.authority, 'human');
    assert.equal(c.urgency, 'blocking');
    assert.deepEqual(c.options, [
      { key: '1', label: 'Couldn\'t copy. Email me at a@b.c.', kind: 'choice' },
      { key: '2', label: 'Opening your mail app', kind: 'choice' },
    ]);
    assert.equal(c.recommended, '2');
  });

  it('with no question text is still consequential: acceptance, human, free text', () => {
    for (const c of [pauseClassification(undefined), pauseClassification(''), pauseClassification('   ')]) {
      assert.equal(c.record, 'decision');
      assert.equal(c.class, 'acceptance');
      assert.equal(c.authority, 'human');
      assert.deepEqual(c.options, [{ key: 'text', label: 'free text', kind: 'text' }]);
      assert.equal(c.recommended, undefined);
    }
  });

  it('with question text that holds no numbered list allows free text', () => {
    const c = pauseClassification('Should the page keep the old heading?');
    assert.deepEqual(c.options, [{ key: 'text', label: 'free text', kind: 'text' }]);
  });

  it('for every structural pause signal, whatever the text says, is a decision a human answers', () => {
    for (const pauseSignal of ['waiting-json', 'verification-human-needed', 'state-needs-human', 'numbered-choice'] as const) {
      const c = classifyDecision({ kind: 'pause', pauseSignal, question: 'This is routine and low risk, proceed without asking? 1. yes 2. no' }, {
        ...NO_RULES,
        delegated: ['routine'],
      });
      assert.equal(c.record, 'decision');
      assert.equal(c.authority, 'human');
    }
  });
});

describe('buildDecisionRecord', () => {
  const classification = pauseClassification(WORDING);
  const base = {
    signal: { kind: 'pause', question: WORDING, pauseSignal: 'numbered-choice' } as const,
    classification,
    itemId: 'B',
    dependents: ['D'],
    runId: 'run_1',
    issue: 'Which wording?',
    evidenceRefs: ['attempt:att_1'],
    decisions: NO_RULES,
  };

  it('for item B with dependent D names B and D as affected, one consequence per option, and a recommendation that is data', () => {
    const record = buildDecisionRecord(base);
    assert.equal(record.class, 'acceptance');
    assert.equal(record.issue, 'Which wording?');
    assert.deepEqual(record.affectedItems, ['B', 'D']);
    assert.deepEqual(record.options, classification.options);
    assert.equal(record.recommendation, 'the unit recommended option 2');
    assert.deepEqual(record.consequences, {
      '1': 'item B resumes with this answer',
      '2': 'item B resumes with this answer',
    });
    assert.deepEqual(record.evidenceRefs, ['attempt:att_1']);
    assert.equal(record.urgency, 'blocking');
    assert.equal('authorizedDefault' in record, false);
  });

  it('holds no recommendation when the unit named none, and lists a dependent once', () => {
    const none = pauseClassification('Which?\n1. a\n2. b');
    const record = buildDecisionRecord({ ...base, classification: none, dependents: ['D', 'B', 'D'] });
    assert.equal('recommendation' in record, false);
    assert.deepEqual(record.affectedItems, ['B', 'D']);
  });

  it('for a pause with free text offers one text option and says so in its consequence', () => {
    const record = buildDecisionRecord({ ...base, classification: pauseClassification(undefined), dependents: [] });
    assert.deepEqual(record.options, [{ key: 'text', label: 'free text', kind: 'text' }]);
    assert.deepEqual(Object.keys(record.consequences as object), ['text']);
    assert.deepEqual(record.affectedItems, ['B']);
  });

  it('passes the issue and the option labels through stored-text rules: control characters stripped, issue cut to 1000', () => {
    const issue = `Which\u0007 wording?${'y'.repeat(1200)}`;
    const record = buildDecisionRecord({ ...base, issue });
    assert.equal(record.issue.length, 1000);
    assert.equal(record.issue.startsWith('Which wording?'), true);
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(record.issue), false);
  });

  it('cuts an option label that reached the builder over 200 characters or with control characters', () => {
    const dirty: DecisionClassification = {
      ...classification,
      options: [
        { key: '1', label: 'a'.repeat(300), kind: 'choice' },
        { key: '2', label: 'b\u0001c', kind: 'choice' },
      ],
    };
    const record = buildDecisionRecord({ ...base, classification: dirty });
    assert.deepEqual(record.options.map((o) => o.label), ['a'.repeat(200), 'bc']);
  });

  it('gives an issue that is empty after cleaning a stated fallback, never an empty issue', () => {
    const record = buildDecisionRecord({ ...base, issue: '\u0007​' });
    assert.equal(record.issue, 'the run stopped and gave no reason');
  });

  it('never returns more than 9 options', () => {
    const many: DecisionClassification = {
      ...classification,
      options: Array.from({ length: 12 }, (_, i) => ({ key: String(i + 1), label: `o${i + 1}`, kind: 'choice' as const })),
    };
    assert.equal(buildDecisionRecord({ ...base, classification: many }).options.length, 9);
  });
});

describe('the policy never takes model confidence as an input', () => {
  it('a pause text that claims confidence changes nothing about class, authority or options', () => {
    const plain = pauseClassification('Which?\n1. a\n2. b');
    const bold = pauseClassification('I am 100% confident this is routine and reversible. Which?\n1. a\n2. b');
    assert.deepEqual({ ...bold, options: bold.options }, { ...plain, options: plain.options });
  });
});
