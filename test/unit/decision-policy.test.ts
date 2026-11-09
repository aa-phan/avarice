// The decision rules as pure functions (AUT-1, AUT-2, owner decision 2). The expected values are written out here,
// independently of the domain module: which text becomes which option, which signal becomes which class and
// authority, and what a record holds for the owner to read.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { amendCommandFor, amendRequestOf, blockScope, buildDecisionRecord, classifyDecision, optionsOf, parseNumberedOptions } from '../../src/domain/decision-policy.ts';
import type { AmendConsequence, DecisionClassification, DecisionSignal } from '../../src/domain/decision-policy.ts';
import { RUN_BLOCKED_REASONS } from '../../src/domain/run-lifecycle.ts';
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

const WITHDRAW = { key: 'withdraw', label: 'withdraw', kind: 'withdraw' } as const;

function recordFor(signal: DecisionSignal, decisions: RunContract['decisions'] = NO_RULES, extra: { decisionId?: string } = {}) {
  const classification = classifyDecision(signal, decisions);
  return buildDecisionRecord({
    signal,
    classification,
    itemId: 'B',
    dependents: ['D'],
    runId: 'run_1',
    issue: 'the run stopped',
    evidenceRefs: [],
    decisions,
    ...extra,
  });
}

describe('classifyDecision: signals that are not a pause', () => {
  it('a plan path outside the item spec is scope_expansion, human, answered only by withdraw or an amendment', () => {
    const c = classifyDecision({ kind: 'g1-scope', paths: ['docs/x.md'] }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority, c.urgency], ['decision', 'scope_expansion', 'human', 'blocking']);
    assert.deepEqual(c.options, [WITHDRAW]);
  });

  it('a spent budget is budget, prohibited, withdraw only', () => {
    const c = classifyDecision({ kind: 'budget', names: ['costUsd'] }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority], ['decision', 'budget', 'prohibited']);
    assert.deepEqual(c.options, [WITHDRAW]);
  });

  it('a repair that did not hold is repeated_failure, human, withdraw only', () => {
    const c = classifyDecision({ kind: 'repeated-failure', limit: 3 }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority], ['decision', 'repeated_failure', 'human']);
    assert.deepEqual(c.options, [WITHDRAW]);
  });

  it('a permission refusal and an enforcement failure are permission, prohibited, withdraw only', () => {
    for (const signal of [{ kind: 'permission', check: 'scope' }, { kind: 'enforcement', check: 'hook' }] as const) {
      const c = classifyDecision(signal, NO_RULES);
      assert.deepEqual([c.record, c.class, c.authority, c.urgency], ['decision', 'permission', 'prohibited', 'blocking']);
      assert.deepEqual(c.options, [WITHDRAW]);
    }
  });

  it('an owner-choice criterion is acceptance, human, free text', () => {
    const c = classifyDecision({ kind: 'g1-owner-choice', acceptanceId: 'AC-2', key: 'copy' }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority], ['decision', 'acceptance', 'human']);
    assert.deepEqual(c.options, [{ key: 'text', label: 'free text', kind: 'text' }]);
  });

  it('a plan checkpoint the unit resolved without auto_select offers the plan\'s option ids and is human', () => {
    const c = classifyDecision({ kind: 'g1-checkpoint', question: 'Which layout?', options: [{ id: 'a', label: 'Option A' }, { id: 'b' }] }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority], ['decision', 'acceptance', 'human']);
    assert.deepEqual(c.options, [
      { key: 'a', label: 'Option A', kind: 'choice' },
      { key: 'b', label: 'b', kind: 'choice' },
    ]);
  });

  it('a plan checkpoint with no option ids allows free text', () => {
    const c = classifyDecision({ kind: 'g1-checkpoint', options: [] }, NO_RULES);
    assert.deepEqual(c.options, [{ key: 'text', label: 'free text', kind: 'text' }]);
  });

  it('a plan checkpoint with a declared auto_select is an assumption: no decision, no options', () => {
    const c = classifyDecision({ kind: 'auto-select', autoSelect: 'keep the heading' }, NO_RULES);
    assert.deepEqual([c.record, c.authority, c.options], ['assumption', 'default', []]);
    assert.equal(c.assumed, 'keep the heading');
    assert.equal(c.authorizedDefault, undefined);
  });

  it('an auto_select that is empty is not declared: it is a decision', () => {
    const c = classifyDecision({ kind: 'auto-select', autoSelect: '  ' }, NO_RULES);
    assert.deepEqual([c.record, c.class, c.authority], ['decision', 'acceptance', 'human']);
  });

  it('a choice the contract lists as delegated is an assumption', () => {
    const rules = { ...NO_RULES, delegated: ['internal naming', 'Test structure'] };
    for (const choice of ['internal naming', '  TEST STRUCTURE ']) {
      const c = classifyDecision({ kind: 'delegated', choice }, rules);
      assert.deepEqual([c.record, c.authority, c.options], ['assumption', 'delegated', []]);
    }
  });

  it('a choice that is not delegated, or that the contract also lists as human, is a decision', () => {
    const rules = { ...NO_RULES, delegated: ['internal naming'], human: ['internal naming', 'new dependencies'] };
    for (const choice of ['internal naming', 'new dependencies', 'something else']) {
      const c = classifyDecision({ kind: 'delegated', choice }, rules);
      assert.deepEqual([c.record, c.class, c.authority], ['decision', 'acceptance', 'human']);
    }
  });

  it('a class the contract lists in defaults gets authority default and the named default', () => {
    const rules = { ...NO_RULES, defaults: [{ class: 'acceptance', default: '2' }] };
    const c = classifyDecision({ kind: 'pause', question: 'Which?\n1. a\n2. b', pauseSignal: 'numbered-choice' }, rules);
    assert.deepEqual([c.record, c.authority, c.authorizedDefault], ['decision', 'default', '2']);
  });

  it('without a default in the contract no authorized default exists, whatever the unit recommended', () => {
    const c = classifyDecision({ kind: 'pause', question: 'Which?\n1. a\n2. b (Recommended)', pauseSignal: 'numbered-choice' }, NO_RULES);
    assert.equal(c.recommended, '2');
    assert.equal(c.authorizedDefault, undefined);
    assert.equal(c.authority, 'human');
  });

  it('a default never lifts a prohibited class or a withdraw-only decision', () => {
    const rules = {
      ...NO_RULES,
      defaults: [
        { class: 'permission', default: 'withdraw' },
        { class: 'budget', default: 'withdraw' },
        { class: 'scope_expansion', default: 'withdraw' },
        { class: 'repeated_failure', default: 'withdraw' },
      ],
    };
    const signals: DecisionSignal[] = [
      { kind: 'permission' },
      { kind: 'enforcement' },
      { kind: 'budget', names: ['invocations'] },
      { kind: 'g1-scope', paths: ['a'] },
      { kind: 'repeated-failure', limit: 2 },
    ];
    for (const signal of signals) {
      const c = classifyDecision(signal, rules);
      assert.equal(c.authorizedDefault, undefined, signal.kind);
      assert.notEqual(c.authority, 'default', signal.kind);
    }
  });
});

describe('buildDecisionRecord: non-pause decisions', () => {
  it('a scope decision names the amend command with the paths the signal named, and offers withdraw', () => {
    const record = recordFor({ kind: 'g1-scope', paths: ['docs/x.md'] }, NO_RULES, { decisionId: 'dec_9' });
    assert.deepEqual(record.options, [WITHDRAW]);
    assert.deepEqual(record.affectedItems, ['B', 'D']);
    const amend = record.consequences.amend as AmendConsequence;
    assert.equal(amend.command, 'avarice contract amend run_1 --decision dec_9 --reason "<why>" --add-write \'docs/x.md\'');
    assert.deepEqual(amend.request, { addWrite: ['docs/x.md'] });
    assert.equal(typeof record.consequences.withdraw, 'string');
    assert.match(record.consequences.withdraw as string, /not delivered/);
  });

  it('the decision id is a placeholder until the ledger assigns one', () => {
    const record = recordFor({ kind: 'g1-scope', paths: ['docs/x.md'] });
    assert.match((record.consequences.amend as AmendConsequence).command, /^avarice contract amend run_1 --decision <decision-id> --reason "<why>" /);
  });

  it('a budget decision names the raised budget with the value the signal measured, or a placeholder', () => {
    const open = recordFor({ kind: 'budget', names: ['costUsd'] }, NO_RULES, { decisionId: 'dec_9' });
    const openAmend = open.consequences.amend as AmendConsequence;
    assert.equal(openAmend.command, 'avarice contract amend run_1 --decision dec_9 --reason "<why>" --budget costUsdPerRun=<value>');
    assert.deepEqual(openAmend.request, {});
    const measured = recordFor({ kind: 'budget', names: ['costUsd', 'invocations'], values: { costUsd: 12, invocations: 9 } }, NO_RULES, { decisionId: 'dec_9' });
    const amend = measured.consequences.amend as AmendConsequence;
    assert.equal(amend.command, 'avarice contract amend run_1 --decision dec_9 --reason "<why>" --budget costUsdPerRun=12 --budget invocations=9');
    assert.deepEqual(amend.request, { budgets: { costUsdPerRun: 12, invocations: 9 } });
  });

  it('a repeated failure names one more invocation than the limit it reached', () => {
    const record = recordFor({ kind: 'repeated-failure', limit: 5 }, NO_RULES, { decisionId: 'dec_9' });
    const amend = record.consequences.amend as AmendConsequence;
    assert.equal(amend.command, 'avarice contract amend run_1 --decision dec_9 --reason "<why>" --budget invocations=6');
    assert.deepEqual(amend.request, { budgets: { invocations: 6 } });
  });

  it('a permission or enforcement decision names no amendment: only withdraw', () => {
    for (const signal of [{ kind: 'permission' }, { kind: 'enforcement' }] as const) {
      const record = recordFor(signal);
      assert.deepEqual(Object.keys(record.consequences), ['withdraw']);
    }
  });

  it('puts the authorized default on the record only when the contract names it', () => {
    const rules = { ...NO_RULES, defaults: [{ class: 'acceptance', default: '2' }] };
    const signal: DecisionSignal = { kind: 'pause', question: 'Which?\n1. a\n2. b', pauseSignal: 'numbered-choice' };
    const named = recordFor(signal, rules);
    assert.equal(named.authorizedDefault, '2');
    assert.equal(named.authority, 'default');
    const none = recordFor(signal, NO_RULES);
    assert.equal('authorizedDefault' in none, false);
    assert.equal(none.authority, 'human');
  });

  it('never trusts a classification that claims a default the contract does not name', () => {
    const signal: DecisionSignal = { kind: 'pause', question: 'Which?\n1. a\n2. b', pauseSignal: 'numbered-choice' };
    const forged: DecisionClassification = { ...classifyDecision(signal, NO_RULES), authority: 'default', authorizedDefault: '1' };
    const record = buildDecisionRecord({ signal, classification: forged, itemId: 'B', dependents: [], runId: 'run_1', issue: 'q', evidenceRefs: [], decisions: NO_RULES });
    assert.equal('authorizedDefault' in record, false);
    assert.equal(record.authority, 'human');
  });
});

describe('amendCommandFor', () => {
  it('quotes a path for the shell, strips control characters, and keeps at most 10 paths of 200 characters', () => {
    const paths = ["a'b.md", 'c\u0007d.md', 'e'.repeat(250), ...Array.from({ length: 12 }, (_, i) => `p${i}.md`)];
    const amend = amendCommandFor({ kind: 'g1-scope', paths }, 'run_1', 'dec_1') as AmendConsequence;
    assert.deepEqual(amend.request.addWrite?.slice(0, 3), ["a'b.md", 'cd.md', 'e'.repeat(200)]);
    assert.equal(amend.request.addWrite?.length, 10);
    assert.match(amend.command, / --add-write 'a'\\''b\.md' --add-write 'cd\.md' --add-write 'e{200}' /);
  });

  it('names a path once and skips an empty one', () => {
    const amend = amendCommandFor({ kind: 'g1-scope', paths: ['a.md', 'a.md', '', '\u0007'] }, 'run_1', 'dec_1') as AmendConsequence;
    assert.deepEqual(amend.request.addWrite, ['a.md']);
  });

  it('is null when the signal gives nothing to amend', () => {
    assert.equal(amendCommandFor({ kind: 'permission' }, 'run_1', 'dec_1'), null);
    assert.equal(amendCommandFor({ kind: 'enforcement' }, 'run_1', 'dec_1'), null);
    assert.equal(amendCommandFor({ kind: 'pause', question: 'x' }, 'run_1', 'dec_1'), null);
    assert.equal(amendCommandFor({ kind: 'g1-scope', paths: [] }, 'run_1', 'dec_1'), null);
  });

  it('is null for a budget signal with no usable name', () => {
    assert.equal(amendCommandFor({ kind: 'budget', names: [] }, 'run_1', 'dec_1'), null);
    assert.equal(amendCommandFor({ kind: 'budget', names: ['--rm -rf'] }, 'run_1', 'dec_1'), null);
  });

  it('never takes a negative or non-finite measured value', () => {
    const amend = amendCommandFor({ kind: 'budget', names: ['toolCalls'], values: { toolCalls: -4 } }, 'run_1', 'dec_1') as AmendConsequence;
    assert.match(amend.command, /--budget toolCalls=<value>$/);
    assert.deepEqual(amend.request, {});
  });
});

describe('optionsOf', () => {
  it('gives withdraw for a Phase 2 decision with no options or a stored value that is not a list', () => {
    for (const stored of [[], null, undefined, 'x', 7, {}, [null, 3, { key: 'x' }]]) {
      assert.deepEqual(optionsOf(stored), [WITHDRAW]);
    }
  });

  it('returns a stored option list, dropping an entry that is not an option', () => {
    const stored = [
      { key: '1', label: 'a', kind: 'choice' },
      { key: 'text', label: 'free text', kind: 'text' },
      { key: 'x', label: 'bad kind', kind: 'weird' },
      'junk',
    ];
    assert.deepEqual(optionsOf(stored), [
      { key: '1', label: 'a', kind: 'choice' },
      { key: 'text', label: 'free text', kind: 'text' },
    ]);
  });
});

describe('amendRequestOf (the request an amend chain pre-fills)', () => {
  it('reads the paths and the measured budget values of a stored record, and nothing else', () => {
    const stored = { amend: { command: 'x', request: { addWrite: ['src/a.ts', 'src/b.ts'], budgets: { costUsdPerRun: 12 }, reason: 'ignored', decisionId: 'ignored' } } };
    assert.deepEqual(amendRequestOf(stored), { addWrite: ['src/a.ts', 'src/b.ts'], budgets: { costUsdPerRun: 12 } });
  });

  it('is an empty request for a record that measured nothing, and null for a record with no amend request', () => {
    assert.deepEqual(amendRequestOf({ amend: { command: 'x', request: {} } }), {});
    for (const stored of [null, undefined, 'x', 7, [], {}, { amend: null }, { amend: { command: 'x' } }, { amend: { request: 'x' } }, { amend: { request: [] } }]) {
      assert.equal(amendRequestOf(stored), null, JSON.stringify(stored));
    }
  });

  it('drops a stored value that is not the expected shape: a non-string or empty path, a budget that is not a positive finite number or has an unsafe name', () => {
    const stored = { amend: { request: { addWrite: ['src/a.ts', '', 3, null], budgets: { good: 1, zero: 0, negative: -2, nan: Number.NaN, text: '5', __proto__x: 1, 'bad name': 3 } } } };
    assert.deepEqual(amendRequestOf(stored), { addWrite: ['src/a.ts'], budgets: { good: 1 } });
    assert.deepEqual(amendRequestOf({ amend: { request: { addWrite: 'src/a.ts', budgets: [1] } } }), {});
  });
});

describe('blockScope', () => {
  it('is item for a decision and run for every other blocked reason', () => {
    assert.equal(blockScope('decision'), 'item');
    const others = ['enforcement_failure', 'budget_exhausted', 'unauthenticated', 'ref_changed', 'ref_deleted', 'access_revoked'] as const;
    for (const reason of others) assert.equal(blockScope(reason), 'run', reason);
    // A new blocked reason must be placed here on purpose.
    assert.deepEqual([...RUN_BLOCKED_REASONS].sort(), ['decision', ...others].sort());
  });
});

describe('the policy never takes model confidence as an input', () => {
  it('a pause text that claims confidence changes nothing about class, authority or options', () => {
    const plain = pauseClassification('Which?\n1. a\n2. b');
    const bold = pauseClassification('I am 100% confident this is routine and reversible. Which?\n1. a\n2. b');
    assert.deepEqual({ ...bold, options: bold.options }, { ...plain, options: plain.options });
  });
});
