// classifyOutcome (ONB-3, ONB-12, CON-3): the outcome kind is derived from the host's final result, the process
// exit, the staging HEAD and the hook's own deny events, never from what the model wrote.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyOutcome } from '../../src/domain/outcome.ts';
import type { OutcomeFacts } from '../../src/domain/outcome.ts';

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
