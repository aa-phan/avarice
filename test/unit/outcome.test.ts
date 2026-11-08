// classifyOutcome (ONB-3, ONB-12, CON-3): the outcome kind is derived from the host's final result, the process
// exit, the staging HEAD and the hook's own deny events, never from what the model wrote.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyOutcome } from '../../src/domain/outcome.ts';
import type { OutcomeFacts } from '../../src/domain/outcome.ts';
import { detectPause } from '../../src/domain/outcome.ts';

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
