// classifyOutcome (ONB-3, ONB-12, CON-3): the outcome kind is derived from the host's final result, the process
// exit, the staging HEAD and the hook's own deny events, never from what the model wrote.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { attributeNumberedChoice, choiceLines, classifyOutcome } from '../../src/domain/outcome.ts';
import type { AttributionInput, OutcomeFacts } from '../../src/domain/outcome.ts';
import { detectPause } from '../../src/domain/outcome.ts';
import { hasOwnerChoice, itemBehavior, itemChoiceOptions, normalizeChoice, normalizeOption, sharedChoiceOptions } from '../../src/domain/item-scope.ts';
import type { ScopeContract } from '../../src/domain/item-scope.ts';

const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);

// A finished, successful run that left every expected file.
function facts(over: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    resultSeen: true,
    isError: false,
    subtype: 'success',
    terminalReason: 'completed',
    permissionDenials: 0,
    hookDenies: 0,
    hookBudgetDenies: 0,
    timedOut: false,
    exitCode: 0,
    signal: null,
    headBefore: HEAD,
    headAfter: HEAD,
    expectedFilesPresent: true,
    ...over,
  };
}

describe('classifyOutcome', () => {
  it('calls a finished run that left the expected files progressed', () => {
    assert.deepEqual(classifyOutcome(facts()), { kind: 'progressed', headMoved: false });
  });

  it('calls a run with no result event inconclusive, whatever else is true', () => {
    const killed = classifyOutcome(facts({ resultSeen: false, exitCode: null, signal: 'SIGKILL' }));
    assert.equal(killed.kind, 'inconclusive');
    assert.equal(classifyOutcome(facts({ resultSeen: false, exitCode: 0, expectedFilesPresent: true })).kind, 'inconclusive');
  });

  it('calls a run that hit the wall clock inconclusive even when it printed a result and left the files', () => {
    assert.equal(classifyOutcome(facts({ timedOut: true })).kind, 'inconclusive');
    assert.equal(classifyOutcome(facts({ timedOut: true, resultSeen: false, exitCode: null, signal: 'SIGTERM' })).kind, 'inconclusive');
  });

  it('maps the budget subtype to budget_exhausted', () => {
    const outcome = classifyOutcome(facts({ isError: true, subtype: 'error_max_budget_usd', terminalReason: 'budget_exhausted', exitCode: 1, expectedFilesPresent: false }));
    assert.equal(outcome.kind, 'budget_exhausted');
  });

  it('maps the budget_exhausted terminal reason alone to budget_exhausted', () => {
    assert.equal(classifyOutcome(facts({ isError: true, subtype: 'success', terminalReason: 'budget_exhausted', exitCode: 1 })).kind, 'budget_exhausted');
  });

  it('maps a hook budget_exhausted deny to budget_exhausted even when the host reports success', () => {
    assert.equal(classifyOutcome(facts({ hookDenies: 3, hookBudgetDenies: 3 })).kind, 'budget_exhausted');
  });

  it('never infers success from the subtype: is_error true with subtype success and terminal_reason api_error is failed', () => {
    assert.equal(classifyOutcome(facts({ isError: true, subtype: 'success', terminalReason: 'api_error', exitCode: 1 })).kind, 'failed');
  });

  it('treats a result with no is_error field as failed, not as a success', () => {
    const { isError: _omitted, ...rest } = facts();
    assert.equal(classifyOutcome(rest).kind, 'failed');
  });

  it('calls other error subtypes failed', () => {
    assert.equal(classifyOutcome(facts({ isError: true, subtype: 'error_max_turns', terminalReason: 'max_turns', exitCode: 1 })).kind, 'failed');
    assert.equal(classifyOutcome(facts({ isError: true, subtype: 'error_during_execution', exitCode: 1 })).kind, 'failed');
  });

  it('calls a success result with a non-zero exit or a signal failed', () => {
    assert.equal(classifyOutcome(facts({ exitCode: 3 })).kind, 'failed');
    assert.equal(classifyOutcome(facts({ exitCode: null, signal: 'SIGSEGV' })).kind, 'failed');
  });

  it('reports a moved staging HEAD as a containment finding: failed with headMoved, ahead of every other kind', () => {
    assert.deepEqual(classifyOutcome(facts({ headAfter: MOVED })), { kind: 'failed', headMoved: true });
    assert.deepEqual(classifyOutcome(facts({ headAfter: MOVED, resultSeen: false, timedOut: true, exitCode: null, signal: 'SIGTERM' })), { kind: 'failed', headMoved: true });
    assert.equal(classifyOutcome(facts({ headAfter: MOVED, isError: true, subtype: 'error_max_budget_usd' })).kind, 'failed');
  });

  it('does not call an unknown HEAD a moved HEAD', () => {
    assert.deepEqual(classifyOutcome(facts({ headBefore: '', headAfter: '' })), { kind: 'progressed', headMoved: false });
  });

  it('calls a successful run without the expected files and with a host permission denial denied', () => {
    assert.equal(classifyOutcome(facts({ expectedFilesPresent: false, permissionDenials: 1 })).kind, 'denied');
  });

  it('calls a successful run without the expected files and with a hook deny denied', () => {
    assert.equal(classifyOutcome(facts({ expectedFilesPresent: false, hookDenies: 2 })).kind, 'denied');
  });

  it('calls a successful run without the expected files and with no deny no_progress', () => {
    assert.equal(classifyOutcome(facts({ expectedFilesPresent: false })).kind, 'no_progress');
  });

  it('prefers progressed over denied when the files are there: a refused extra call does not undo the work', () => {
    assert.equal(classifyOutcome(facts({ permissionDenials: 2, hookDenies: 1 })).kind, 'progressed');
  });

  it('is a pure function of its facts: the same facts give the same answer', () => {
    const f = facts({ expectedFilesPresent: false });
    assert.deepEqual(classifyOutcome(f), classifyOutcome({ ...f }));
  });
});

// A structural pause signal (02-RESEARCH Pitfall 11) makes a clean finished run paused, after failed and before progressed.
describe('classifyOutcome with a pause signal', () => {
  it('calls a clean run with pauseSignal paused even when the expected files are present', () => {
    assert.deepEqual(classifyOutcome(facts({ pauseSignal: true })), { kind: 'paused', headMoved: false });
  });

  it('calls a clean run with pauseSignal paused when the expected files are absent too', () => {
    assert.equal(classifyOutcome(facts({ pauseSignal: true, expectedFilesPresent: false })).kind, 'paused');
  });

  it('still reports a moved HEAD as failed first', () => {
    assert.deepEqual(classifyOutcome(facts({ pauseSignal: true, headAfter: MOVED })), { kind: 'failed', headMoved: true });
  });

  it('still reports a wall clock timeout or a missing result as inconclusive', () => {
    assert.equal(classifyOutcome(facts({ pauseSignal: true, timedOut: true })).kind, 'inconclusive');
    assert.equal(classifyOutcome(facts({ pauseSignal: true, resultSeen: false, exitCode: null, signal: 'SIGTERM' })).kind, 'inconclusive');
  });

  it('still reports a budget subtype or a hook budget deny as budget_exhausted', () => {
    assert.equal(classifyOutcome(facts({ pauseSignal: true, isError: true, subtype: 'error_max_budget_usd', exitCode: 1 })).kind, 'budget_exhausted');
    assert.equal(classifyOutcome(facts({ pauseSignal: true, hookDenies: 1, hookBudgetDenies: 1 })).kind, 'budget_exhausted');
  });

  it('still reports a non-zero exit, a signal or is_error as failed', () => {
    assert.equal(classifyOutcome(facts({ pauseSignal: true, exitCode: 2 })).kind, 'failed');
    assert.equal(classifyOutcome(facts({ pauseSignal: true, exitCode: null, signal: 'SIGSEGV' })).kind, 'failed');
    assert.equal(classifyOutcome(facts({ pauseSignal: true, isError: true, exitCode: 1 })).kind, 'failed');
  });

  it('treats pauseSignal false the same as absent', () => {
    assert.deepEqual(classifyOutcome(facts({ pauseSignal: false })), classifyOutcome(facts()));
    assert.equal(classifyOutcome(facts({ pauseSignal: false, expectedFilesPresent: false })).kind, 'no_progress');
  });
});

describe('detectPause', () => {
  it('reads a waiting JSON file as waiting-json', () => {
    assert.deepEqual(detectPause({ waitingJson: true }), { paused: true, signal: 'waiting-json' });
  });

  it('reads a human_needed VERIFICATION status as verification-human-needed', () => {
    assert.deepEqual(detectPause({ verificationStatus: 'human_needed' }), { paused: true, signal: 'verification-human-needed' });
  });

  it('does not read any other VERIFICATION status as a pause', () => {
    for (const verificationStatus of ['passed', 'gaps_found', 'missing', '']) {
      assert.deepEqual(detectPause({ verificationStatus }), { paused: false, signal: null }, verificationStatus);
    }
  });

  it('reads a STATE needing a human as state-needs-human', () => {
    assert.deepEqual(detectPause({ stateNeedsHuman: true }), { paused: true, signal: 'state-needs-human' });
  });

  it('reads a final text ending in a question and two numbered choices as numbered-choice', () => {
    const tail = 'I checked both files.\n\nWhich approach should I take?\n1. Edit the shared helper\n2. Duplicate the helper\n';
    assert.deepEqual(detectPause({ finalTextTail: tail }), { paused: true, signal: 'numbered-choice' });
  });

  it('accepts blank lines between the choices and three or more choices', () => {
    const tail = 'Which one?\n\n1. A\n\n2. B\n\n3. C\n\n';
    assert.equal(detectPause({ finalTextTail: tail }).signal, 'numbered-choice');
  });

  it('does not read a question with a single numbered line, or choices with no question, as a pause', () => {
    assert.equal(detectPause({ finalTextTail: 'Which one?\n1. only one' }).paused, false);
    assert.equal(detectPause({ finalTextTail: 'Done. Steps taken:\n1. read\n2. edited\n3. tested' }).paused, false);
  });

  it('does not read a numbered list in the middle of the text as a pause', () => {
    assert.equal(detectPause({ finalTextTail: 'Which one?\n1. A\n2. B\nI picked A and finished the work.' }).paused, false);
  });

  it('does not read choices that do not start at 1 as a pause', () => {
    assert.equal(detectPause({ finalTextTail: 'Which one?\n3. A\n4. B' }).paused, false);
  });

  it('reads only the last 2000 characters of the tail', () => {
    const noise = 'x'.repeat(5000);
    assert.equal(detectPause({ finalTextTail: `Which one?\n1. A\n2. B\n${noise}` }).paused, false);
    assert.equal(detectPause({ finalTextTail: `${noise}\nWhich one?\n1. A\n2. B` }).signal, 'numbered-choice');
  });

  it('reports no pause when no signal is present', () => {
    assert.deepEqual(detectPause({}), { paused: false, signal: null });
    assert.deepEqual(detectPause({ waitingJson: false, stateNeedsHuman: false, finalTextTail: '' }), { paused: false, signal: null });
  });

  it('prefers the structural signals over the text shape, in a fixed order', () => {
    const tail = 'Which one?\n1. A\n2. B';
    assert.equal(detectPause({ waitingJson: true, verificationStatus: 'human_needed', stateNeedsHuman: true, finalTextTail: tail }).signal, 'waiting-json');
    assert.equal(detectPause({ verificationStatus: 'human_needed', stateNeedsHuman: true, finalTextTail: tail }).signal, 'verification-human-needed');
    assert.equal(detectPause({ stateNeedsHuman: true, finalTextTail: tail }).signal, 'state-needs-human');
  });
});

// ---- plan 03-40: an item's own part of the brief, and a numbered choice that belongs to another item ---------------------------------------------

const WORDING_1 = '`Couldn’t copy. Email me at <address>.`';
const WORDING_2 = '`Couldn’t copy the address. Opening your mail app to <address>.`';
const NORM_1 = 'couldnt copy. email me at <address>';
const NORM_2 = 'couldnt copy the address. opening your mail app to <address>';

// The Behavior of exit run 1: one paragraph per item, item B's with its two numbered wordings.
const RUN1_BEHAVIOR = [
  'Item A: `src/lib/dates.ts` checks content dates with a private regular expression. Export `isIsoYearMonth(value: string): boolean`.',
  '',
  'Item B: when copying the email fails, the toast must name the address. The wording is the owner’s choice between two options; stop and ask which one before writing it:',
  `1. ${WORDING_1}`,
  `2. ${WORDING_2}`,
  'Keep `COPY_FALLBACK` exported and unchanged in this item.',
  '',
  'Item C: `useCopyEmail` shows `copyFallback(address)` when copying fails.',
].join('\n');

const IDS = ['A', 'B', 'C'];

function scopeContract(behavior: string = RUN1_BEHAVIOR): ScopeContract {
  return {
    intent: {
      behavior,
      acceptance: [
        { id: 'AC1', text: 'isIsoYearMonth accepts 2026-12', verifiedBy: ['check:test'] },
        { id: 'AC2', text: 'the existing monthYear tests pass', verifiedBy: ['check:test'] },
        { id: 'AC3', text: 'copyFallback returns the wording the owner chose', verifiedBy: ['decision:fallback-wording', 'check:test'] },
        { id: 'AC4', text: 'useCopyEmail uses copyFallback', verifiedBy: ['check:test'] },
      ],
      workItems: [
        { id: 'A', acceptance: ['AC1', 'AC2'] },
        { id: 'B', acceptance: ['AC3'] },
        { id: 'C', acceptance: ['AC4'] },
      ],
    },
  };
}

describe('itemBehavior', () => {
  it("gives item A its own paragraph and none of the text of B's or C's", () => {
    const a = itemBehavior(RUN1_BEHAVIOR, 'A', IDS);
    assert.ok(a.startsWith('Item A: '));
    assert.ok(!a.includes('Item B') && !a.includes('Item C'));
    assert.ok(!a.includes('Couldn’t') && !a.includes('stop and ask'));
  });

  it("gives item B its own paragraph, with the two wordings, and none of A's or C's", () => {
    const b = itemBehavior(RUN1_BEHAVIOR, 'B', IDS);
    assert.ok(b.includes(WORDING_1) && b.includes(WORDING_2) && b.includes('Keep `COPY_FALLBACK`'));
    assert.ok(!b.includes('Item A') && !b.includes('Item C'));
  });

  it('gives every item the unlabelled paragraphs, in their original order, with the item’s own', () => {
    const behavior = ['Shared first.', '', 'Item B: only B.', '', 'Shared middle.', '', 'Work item A: only A.', '', 'Shared last.'].join('\n');
    assert.equal(itemBehavior(behavior, 'A', IDS), 'Shared first.\n\nShared middle.\n\nWork item A: only A.\n\nShared last.');
    assert.equal(itemBehavior(behavior, 'B', IDS), 'Shared first.\n\nItem B: only B.\n\nShared middle.\n\nShared last.');
    assert.equal(itemBehavior(behavior, 'C', IDS), 'Shared first.\n\nShared middle.\n\nShared last.');
  });

  it('returns a Behavior that labels no paragraph unchanged, for every item', () => {
    const plain = 'A slug never has two dashes in a row.\n\nThe slug rules are covered by tests.\n';
    for (const id of IDS) assert.equal(itemBehavior(plain, id, IDS), plain);
  });

  it('does not take a label for an ID that is not an item of the brief, nor a label that is not at the start of the paragraph', () => {
    const behavior = ['Item Z: not an item of this brief.', '', 'See Item B: the note.', '', 'Item items: still not a label.'].join('\n');
    for (const id of IDS) assert.equal(itemBehavior(behavior, id, IDS), behavior);
  });
});

describe('normalizeChoice and normalizeOption', () => {
  it('removes the number and its dot, backticks and every straight or typographic quote, collapses whitespace, lowercases and drops one trailing period', () => {
    assert.equal(normalizeChoice(`1. ${WORDING_1}`), NORM_1);
    assert.equal(normalizeChoice(`  2.   ${WORDING_2}  `), NORM_2);
    assert.equal(normalizeChoice('3. “Quoted”   ‘text’ \'here\' "now".'), 'quoted text here now');
    assert.equal(normalizeChoice('1. Keep the helper...'), 'keep the helper..');
  });

  it('normalizes an option label the same way and leaves a leading number in a label alone', () => {
    assert.equal(normalizeOption(WORDING_1), NORM_1);
    assert.equal(normalizeOption('404'), '404');
    assert.equal(normalizeOption('3. thing'), '3. thing');
  });
});

describe('itemChoiceOptions, sharedChoiceOptions and hasOwnerChoice', () => {
  it('gives item B the two normalized wordings of its paragraph, equal to the normalized labels of its decisions', () => {
    const own = itemChoiceOptions(scopeContract(), 'B', []);
    assert.deepEqual(own, [NORM_1, NORM_2]);
    const fromDecision = itemChoiceOptions(scopeContract(), 'B', [WORDING_1, WORDING_2]);
    assert.deepEqual(fromDecision, [NORM_1, NORM_2], 'the same options, not counted twice');
  });

  it('adds the labels of an open decision of the item, and reads numbered lines of a decision criterion', () => {
    assert.deepEqual(itemChoiceOptions(scopeContract(), 'A', ['Use the helper']), ['use the helper']);
    const contract = scopeContract();
    contract.intent.acceptance = contract.intent.acceptance.map((c) => (c.id === 'AC1' ? { ...c, text: 'pick one\n1. red\n2. blue', verifiedBy: ['decision:colour', 'check:test'] } : c));
    assert.deepEqual(itemChoiceOptions(contract, 'A', []), ['red', 'blue']);
  });

  it('gives items A and C no options when their paragraphs and criteria hold none', () => {
    assert.deepEqual(itemChoiceOptions(scopeContract(), 'A', []), []);
    assert.deepEqual(itemChoiceOptions(scopeContract(), 'C', []), []);
  });

  it('reads the numbered lines of the unlabelled paragraphs as shared, and none when no paragraph is labelled', () => {
    const behavior = ['Shared note.', '1. one', '2. two', '', 'Item B: private.', '1. hidden', '2. hidden too'].join('\n');
    assert.deepEqual(sharedChoiceOptions(behavior, IDS), ['one', 'two']);
    assert.deepEqual(sharedChoiceOptions(RUN1_BEHAVIOR, IDS), []);
    const unlabelled = 'Pick one:\n1. x\n2. y';
    assert.deepEqual(sharedChoiceOptions(unlabelled, IDS), ['x', 'y'], 'with no label every paragraph is shared');
  });

  it('says an item has an owner choice only when one of its own criteria carries a decision: reference', () => {
    assert.equal(hasOwnerChoice(scopeContract(), 'B'), true);
    assert.equal(hasOwnerChoice(scopeContract(), 'A'), false);
    assert.equal(hasOwnerChoice(scopeContract(), 'C'), false);
    assert.equal(hasOwnerChoice(scopeContract(), 'Z'), false);
  });
});

const RUN1_TAIL = `Item A is done and verified.\n\nWhich wording should item B use?\n1. ${WORDING_1}\n2. ${WORDING_2}\n`;

describe('choiceLines', () => {
  it('returns the trailing numbered lines a final text ends in, trimmed', () => {
    assert.deepEqual(choiceLines(RUN1_TAIL), [`1. ${WORDING_1}`, `2. ${WORDING_2}`]);
    assert.deepEqual(choiceLines('Which one?\n\n  1. A  \n\n2. B\n'), ['1. A', '2. B']);
  });

  it('returns nothing exactly when detectPause does not read the text as a numbered choice', () => {
    for (const tail of ['Which one?\n1. only one', 'Steps:\n1. read\n2. edited', 'Which one?\n1. A\n2. B\nDone.', 'Which one?\n3. A\n4. B', '']) {
      assert.deepEqual(choiceLines(tail), [], tail);
      assert.equal(detectPause({ finalTextTail: tail }).paused, false);
    }
    assert.equal(choiceLines(RUN1_TAIL).length > 0, detectPause({ finalTextTail: RUN1_TAIL }).signal === 'numbered-choice');
  });
});

// Unit A of exit run 1: verified, no option of its own, item B owns the two wordings and has an owner choice.
function attribution(over: Partial<AttributionInput> = {}): AttributionInput {
  return {
    signal: 'numbered-choice',
    choiceLines: choiceLines(RUN1_TAIL),
    ownItemId: 'A',
    itemIds: IDS,
    ownOptions: [],
    sharedOptions: [],
    optionsByItem: { A: [], B: [NORM_1, NORM_2], C: [] },
    ownerChoiceItems: ['B'],
    verified: true,
    ...over,
  };
}

describe('attributeNumberedChoice', () => {
  it("attributes a verified unit's numbered choice to the other item that owns exactly those options", () => {
    assert.deepEqual(attributeNumberedChoice(attribution()), { attributedTo: 'B' });
  });

  it('does not attribute a unit that is not verified', () => {
    const result = attributeNumberedChoice(attribution({ verified: false }));
    assert.equal(result.attributedTo, null);
    assert.ok('reason' in result && result.reason !== '');
  });

  it('does not attribute a choice that is the unit’s own, whether its own paragraph or its own decision lists it', () => {
    const own = attributeNumberedChoice(attribution({ ownOptions: [NORM_1, NORM_2], optionsByItem: { A: [NORM_1, NORM_2], B: [NORM_1, NORM_2], C: [] } }));
    assert.equal(own.attributedTo, null);
    const oneOwn = attributeNumberedChoice(attribution({ ownOptions: [NORM_2], optionsByItem: { A: [NORM_2], B: [NORM_1, NORM_2], C: [] } }));
    assert.equal(oneOwn.attributedTo, null, 'one line the unit owns is enough to keep the pause');
  });

  it('does not attribute when one line matches the other item and the other matches nothing', () => {
    const partial = attributeNumberedChoice(attribution({ choiceLines: [`1. ${WORDING_1}`, '2. Something else entirely'] }));
    assert.equal(partial.attributedTo, null);
    const paraphrase = attributeNumberedChoice(attribution({ choiceLines: [`1. ${WORDING_1}`, '2. Couldn’t copy the address, opening your mail app.'] }));
    assert.equal(paraphrase.attributedTo, null);
  });

  it('does not attribute options that appear in a shared paragraph', () => {
    const shared = attributeNumberedChoice(attribution({ sharedOptions: [NORM_1, NORM_2] }));
    assert.equal(shared.attributedTo, null);
    const oneShared = attributeNumberedChoice(attribution({ sharedOptions: [NORM_1] }));
    assert.equal(oneShared.attributedTo, null);
  });

  it('does not attribute options that match two other items', () => {
    const two = attributeNumberedChoice(attribution({ optionsByItem: { A: [], B: [NORM_1, NORM_2], C: [NORM_1, NORM_2] }, ownerChoiceItems: ['B', 'C'] }));
    assert.equal(two.attributedTo, null);
    const split = attributeNumberedChoice(attribution({ optionsByItem: { A: [], B: [NORM_1, NORM_2], C: [NORM_2] }, ownerChoiceItems: ['B', 'C'] }));
    assert.equal(split.attributedTo, null, 'a line that is also another item’s option keeps the pause');
  });

  it('does not attribute to an item that has no owner choice and no open decision', () => {
    assert.equal(attributeNumberedChoice(attribution({ ownerChoiceItems: [] })).attributedTo, null);
    assert.equal(attributeNumberedChoice(attribution({ ownerChoiceItems: ['C'] })).attributedTo, null);
  });

  it('does not attribute in a run with one item, nor to the unit’s own item', () => {
    assert.equal(attributeNumberedChoice(attribution({ itemIds: ['A'], optionsByItem: { A: [NORM_1, NORM_2] }, ownerChoiceItems: ['A'] })).attributedTo, null);
    assert.equal(attributeNumberedChoice(attribution({ ownItemId: 'B', optionsByItem: { A: [], B: [NORM_1, NORM_2], C: [] }, ownOptions: [NORM_1, NORM_2] })).attributedTo, null);
  });

  it('never attributes a structural pause signal or an absent signal', () => {
    for (const signal of ['waiting-json', 'verification-human-needed', 'state-needs-human', null] as const) {
      assert.equal(attributeNumberedChoice(attribution({ signal })).attributedTo, null, String(signal));
    }
  });

  it('does not attribute when there are no choice lines, or a line normalizes to nothing', () => {
    assert.equal(attributeNumberedChoice(attribution({ choiceLines: [] })).attributedTo, null);
    assert.equal(attributeNumberedChoice(attribution({ choiceLines: ['1. ``', '2. ""'], optionsByItem: { A: [], B: [''], C: [] } })).attributedTo, null);
  });
});
