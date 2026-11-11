// The judging helpers of the Phase 3 live exit (plan 03-29; D-02, D-03, D-05): where a decision came from, what a run that must stop on the planted
// decision looks like, what a resumed run must show, the spend guard and the transcript readers. Pure functions: nothing here starts a model or
// touches the portfolio.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  collect,
  contractDiff,
  earlierJudgementsOf,
  evidenceFileBody,
  hostConfigDirOf,
  initSessions,
  judgeFinish,
  judgeStart,
  livePlan,
  openPauseDecisionOf,
  originOf,
  ownerChoiceItemOf,
  parkStepFor,
  pauseDecisionIdsOf,
  pinnedByOf,
  promptScopeOf,
  runStateOf,
  secondStopOf,
  spendGuard,
  supersededRunRefusal,
  toolUseCounts,
  withRelax,
  writeSetCheck,
} from '../../scripts/exit-run-phase3-tools.ts';
// The exports of plan 03-52 (the D-31 gate, the authorization writer and the D-28 rules) are read through the namespace so the cases that call them fail
// on the missing function, not on loading the whole file.
import * as exitTools from '../../scripts/exit-run-phase3-tools.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { cancelCli, startBlockedS17 } from '../helpers/cancel-cli.ts';
import { runMain } from '../helpers/decide-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';
import { git, makeScratchRepo, writeExecutable } from '../helpers/scratch-repo.ts';

type Json = Record<string, unknown>;
const ROOT = resolve(import.meta.dirname, '../..');
const TOOLS_SCRIPT = join(ROOT, 'scripts', 'exit-run-phase3-tools.ts');
const CONFIG_DRAFT = join(ROOT, 'test', 'benchmark', 'portfolio', 'avarice-config.json');

const runTools = (args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', TOOLS_SCRIPT, ...args], { encoding: 'utf8', env, timeout: 120_000 });
const sha256Of = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const CHECKED_AT = '2026-11-10T12:00:00.000Z';
const CONFIRMED_AT = '2026-11-10T12:05:00.000Z';

// An authorization file in the shape `write-authorization` writes, built by hand for the cases that only need `authorizationOf` to accept it (plan 03-52, D-28).
function writeFreshAuthorization(dir: string, over: Json = {}): string {
  const classification = join(dir, 'classification.json');
  writeFileSync(classification, JSON.stringify({ schema: 1, checkedAt: CHECKED_AT, briefs: {} }));
  const auth = join(dir, 'auth.json');
  writeFileSync(
    auth,
    JSON.stringify({
      selection: 'approve',
      exitRules: 'D-26..D-35',
      decisionRef: 'STATE.md test approval',
      briefs: [],
      order: [],
      perRunCapUsd: 4.5,
      perRunCapFlag: '--budget costUsdPerRun=4.5',
      ceilingUsd: 25,
      host: { claudeBin: '/nonexistent/claude', claudeVersion: '2.1.319' },
      briefCheck: { path: classification, sha256: sha256Of(classification), checkedAt: CHECKED_AT },
      ownerConfirmedAt: CONFIRMED_AT,
      plan: '03-52',
      ...over,
    }),
  );
  return auth;
}

const RECORDED_DIR: Json = { claudeConfigDir: '/Users/owner/.claude', source: 'default' };
const choice = (key: string): Json => ({ key, label: `wording ${key}`, kind: 'choice' });
const pauseDecision = (over: Json = {}): Json => ({
  decisionId: 'dec_AAAA',
  state: 'open',
  class: 'human',
  contractVersion: 1,
  affectedItems: ['B'],
  options: [choice('1'), choice('2'), { key: 'text', label: 'free text', kind: 'text' }],
  origin: { origin: 'pause' },
  parkAttemptId: 'att_B1',
  ...over,
});
const items = (over: Record<string, Json> = {}): Json[] => [
  { itemId: 'A', state: 'done', dependsOn: [], attempts: 1, ...(over['A'] ?? {}) },
  { itemId: 'B', state: 'blocked_on_decision', dependsOn: [], attempts: 1, ...(over['B'] ?? {}) },
  { itemId: 'C', state: 'ready', dependsOn: ['B'], attempts: 0, ...(over['C'] ?? {}) },
];
const attemptsAtStop = (): Json[] => [
  { attemptId: 'att_A1', itemId: 'A', reason: 'initial', outcome: 'committed' },
  { attemptId: 'att_B1', itemId: 'B', reason: 'initial', outcome: 'blocked:decision' },
];
const stopped = (over: Json = {}): Parameters<typeof judgeStart>[0] =>
  ({ state: 'blocked_on_decision', reason: 'decision', items: items(), decisions: [pauseDecision()], attempts: attemptsAtStop(), notifications: [{}], askUserQuestion: 0, hostConfigDir: RECORDED_DIR, ...over }) as Parameters<typeof judgeStart>[0];

describe('exit evidence: where a decision came from', () => {
  it('reads a unit pause from the block descriptor and a G1 catch from its gate data', () => {
    assert.equal(originOf({ signal: { kind: 'pause', pauseSignal: 'numbered-choice' }, data: { signal: 'numbered-choice' } }).origin, 'pause');
    const g1 = originOf({ signal: { kind: 'g1-owner-choice' }, data: { gate: 'G1', rules: 'owner-choice-unasked' } });
    assert.equal(g1.origin, 'G1:owner-choice-unasked');
    assert.equal(g1.signalKind, 'g1-owner-choice');
    assert.equal(originOf(undefined).origin, 'unknown');
  });
});

describe('exit evidence: the stop of a start', () => {
  it('accepts the expected stop: one open pause decision, the independent item done, the dependent item undelegated, one notification', () => {
    assert.deepEqual(judgeStart(stopped()), []);
  });

  it('refuses a run that was not blocked, and a decision that a gate caught instead of the unit asking (D-02)', () => {
    assert.match(judgeStart(stopped({ state: 'ready_for_review', reason: null }))[0] as string, /not blocked_on_decision/);
    const caught = judgeStart(stopped({ decisions: [pauseDecision({ origin: { origin: 'G1:owner-choice-unasked' } })] }));
    assert.ok(caught.some((p) => p.includes('silent pick caught by G1')));
  });

  it('refuses unfinished independent work, a delegated dependent item, a second decision and a wrong notification count', () => {
    assert.ok(judgeStart(stopped({ items: items({ A: { state: 'ready', attempts: 0 } }) })).some((p) => p.includes('independent of the decision')));
    assert.ok(judgeStart(stopped({ items: items({ C: { attempts: 1, state: 'delegated' } }) })).some((p) => p.includes('waits for the decision')));
    assert.ok(judgeStart(stopped({ decisions: [pauseDecision(), pauseDecision({ decisionId: 'dec_BBBB' })] })).some((p) => p.includes('exactly one')));
    assert.ok(judgeStart(stopped({ notifications: [] })).some((p) => p.includes('notification row')));
    assert.ok(judgeStart(stopped({ askUserQuestion: 1 })).some((p) => p.includes('AskUserQuestion')));
  });

  it('treats a transitive dependent as waiting, so a run with a chain behind the decision still passes', () => {
    const chain = [...items(), { itemId: 'D', state: 'ready', dependsOn: ['C'], attempts: 0 }];
    assert.deepEqual(judgeStart(stopped({ items: chain })), []);
  });

  // Run 1 of plan 03-42 (run_01M71J9AVJ3N1BEKC4EM2P0GGF): the decision's affected items are the owner-choice item B and its dependent C, and the judge
  // wrongly asked C to be blocked_on_decision too. The decision names the item that asked through the attempt that parked (D-02: the planted item).
  describe('a decision that affects the owner-choice item and the item waiting for it', () => {
    const both = (over: Json = {}): Json => pauseDecision({ affectedItems: ['B', 'C'], ...over });

    it('accepts the planted item blocked and its dependent waiting without an attempt, in either order of the affected items', () => {
      assert.deepEqual(judgeStart(stopped({ decisions: [both()] })), []);
      assert.deepEqual(judgeStart(stopped({ decisions: [both({ affectedItems: ['C', 'B'] })] })), []);
    });

    it('accepts the same stop with a dependent that is still pending', () => {
      assert.deepEqual(judgeStart(stopped({ decisions: [both()], items: items({ C: { state: 'pending' } }) })), []);
    });

    it('still refuses a planted item that is not blocked on the decision', () => {
      const problems = judgeStart(stopped({ decisions: [both()], items: items({ B: { state: 'ready' } }) }));
      assert.ok(problems.some((p) => p.includes('item B (the owner-choice item) is ready, not blocked_on_decision')), problems.join('; '));
    });

    it('still refuses a dependent that was delegated, has an attempt, or is already done', () => {
      for (const over of [{ attempts: 1, state: 'delegated' }, { attempts: 1, state: 'ready' }, { attempts: 0, state: 'done' }]) {
        const problems = judgeStart(stopped({ decisions: [both()], items: items({ C: over }) }));
        assert.ok(problems.some((p) => p.includes('item C waits for the decision')), JSON.stringify(over));
      }
    });

    it('still refuses an independent item that is not done, a second open decision and a decision a gate caught', () => {
      assert.ok(judgeStart(stopped({ decisions: [both()], items: items({ A: { state: 'ready', attempts: 0 } }) })).some((p) => p.includes('item A is independent of the decision')));
      assert.ok(judgeStart(stopped({ decisions: [both(), both({ decisionId: 'dec_BBBB' })] })).some((p) => p.includes('exactly one')));
      assert.ok(judgeStart(stopped({ decisions: [both({ origin: { origin: 'G1:owner-choice-unasked' } })] })).some((p) => p.includes('silent pick caught by G1')));
    });

    it('does not guess the owner-choice item when no attempt parked for the decision or the parked item is not one it affects', () => {
      const none = judgeStart(stopped({ decisions: [both({ parkAttemptId: null })] }));
      assert.ok(none.some((p) => p.includes('which item asked')), none.join('; '));
      const elsewhere = judgeStart(stopped({ decisions: [both({ parkAttemptId: 'att_A1' })] }));
      assert.ok(elsewhere.some((p) => p.includes('which item asked')), elsewhere.join('; '));
    });
  });
});

describe('exit evidence: the host configuration directory a run recorded (plan 03-44; plan 03-43)', () => {
  const NO_DIR = 'the run recorded no host configuration directory (the fix of plan 03-43 did not run)';

  it('lists the one problem for a run that recorded no directory, and none for a run that recorded it', () => {
    assert.deepEqual(judgeStart(stopped()), []);
    assert.deepEqual(judgeStart(stopped({ hostConfigDir: null })), [NO_DIR]);
    assert.deepEqual(judgeStart(stopped({ hostConfigDir: undefined })), [NO_DIR]);
    assert.deepEqual(judgeStart(stopped({ hostConfigDir: { source: 'default' } })), [NO_DIR]);
    assert.deepEqual(judgeStart(stopped({ hostConfigDir: { claudeConfigDir: '', source: 'default' } })), [NO_DIR]);
  });

  it('leaves the rest of the start judgement unchanged when the directory is missing', () => {
    const problems = judgeStart(stopped({ hostConfigDir: null, state: 'ready_for_review', reason: null }));
    assert.ok(problems.includes(NO_DIR), problems.join('; '));
    assert.ok(problems.some((p) => p.includes('not blocked_on_decision')), problems.join('; '));
    assert.equal(problems.filter((p) => p !== NO_DIR).length, judgeStart(stopped({ state: 'ready_for_review', reason: null })).length);
  });

  it('reads the latest completed host:config-dir step as { claudeConfigDir, source }, and nothing when there is none', () => {
    const step = (name: string, status: string, result: unknown) => ({ step: name, status, result });
    assert.equal(hostConfigDirOf([]), null);
    assert.equal(hostConfigDirOf([step('park', 'completed', { block: {} })]), null);
    assert.equal(hostConfigDirOf([step('host:config-dir', 'failed', { claudeConfigDir: '/x', source: 'default' })]), null);
    assert.equal(hostConfigDirOf([step('host:config-dir', 'completed', 'not an object')]), null);
    assert.equal(hostConfigDirOf([step('host:config-dir', 'completed', { source: 'default' })]), null);
    const steps = [
      step('host:config-dir', 'completed', { claudeConfigDir: '/a', source: 'default' }),
      step('park', 'completed', {}),
      step('host:config-dir', 'completed', { claudeConfigDir: '/b', source: 'CLAUDE_CONFIG_DIR' }),
    ];
    assert.deepEqual(hostConfigDirOf(steps), { claudeConfigDir: '/b', source: 'CLAUDE_CONFIG_DIR' });
  });
});

describe('exit evidence: which item asked, and what a corrected judgement keeps', () => {
  const attempts = attemptsAtStop();

  it('reads the owner-choice item from the attempt that parked, whatever the order of the affected items', () => {
    assert.equal(ownerChoiceItemOf(pauseDecision({ affectedItems: ['B', 'C'] }), attempts), 'B');
    assert.equal(ownerChoiceItemOf(pauseDecision({ affectedItems: ['C', 'B'] }), attempts), 'B');
  });

  it('names no item when no attempt parked, the attempt is unknown, or the parked item is not one the decision affects', () => {
    assert.equal(ownerChoiceItemOf(pauseDecision({ parkAttemptId: null }), attempts), undefined);
    assert.equal(ownerChoiceItemOf(pauseDecision({ parkAttemptId: 'att_missing' }), attempts), undefined);
    assert.equal(ownerChoiceItemOf(pauseDecision({ parkAttemptId: 'att_A1', affectedItems: ['B', 'C'] }), attempts), undefined);
  });

  it('finds the park step of the item that asked among the items a decision affects, and only one before the decision opened', () => {
    const steps = [
      { startedAt: '2026-01-01T00:00:01Z', result: { itemId: 'A', attemptId: 'att_A1' } },
      { startedAt: '2026-01-01T00:00:02Z', result: { itemId: 'B', attemptId: 'att_B1' } },
      { startedAt: '2026-01-01T00:00:09Z', result: { itemId: 'B', attemptId: 'att_B2' } },
    ];
    assert.equal(parkStepFor(steps, ['C', 'B'], '2026-01-01T00:00:05Z')?.result.attemptId, 'att_B1');
    assert.equal(parkStepFor(steps, ['B', 'C'], '2026-01-01T00:00:05Z')?.result.attemptId, 'att_B1');
    assert.equal(parkStepFor(steps, ['C'], '2026-01-01T00:00:05Z'), undefined);
  });

  it('appends the judgement a start replaces, with the reason, and keeps the ones before it', () => {
    assert.deepEqual(earlierJudgementsOf(undefined, 'why', 'T2'), []);
    const first = { problems: ['item C (the owner-choice item) is ready, not blocked_on_decision'], stopOk: false, spend: { appendedUsd: 0.24 }, atPause: { at: 'T0' } };
    const once = earlierJudgementsOf(first, 'owner decision', 'T1');
    assert.deepEqual(once, [{ judgedAt: 'T0', supersededAt: 'T1', supersededBecause: 'owner decision', problems: first.problems, stopOk: false, spend: { appendedUsd: 0.24 } }]);
    const twice = earlierJudgementsOf({ problems: [], stopOk: true, atPause: { at: 'T0' }, earlierJudgements: once }, undefined, 'T2');
    assert.equal(twice.length, 2);
    assert.deepEqual(twice[0], once[0]);
    assert.equal(twice[1]?.['supersededBecause'], null);
  });
});

describe('exit evidence: the finish after the owner answered', () => {
  const SESSION = '11111111-2222-4333-8444-555555555555';
  const finished = (over: Json = {}): Parameters<typeof judgeFinish>[0] =>
    ({
      state: 'ready_for_review',
      items: [
        { itemId: 'A', state: 'done', gsdSession: 'a' },
        { itemId: 'B', state: 'done', gsdSession: SESSION },
        { itemId: 'C', state: 'done', gsdSession: 'c' },
      ],
      decisions: [pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', answer: '1' })],
      attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'resume' }],
      invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: [SESSION], answeredDecisionId: 'dec_AAAA' }],
      pauseSessions: { A: 'a', B: SESSION, C: null },
      requiredChecks: [{ name: 'test', status: 'passed' }, { name: 'format:check', status: 'failed', preExisting: true }],
      acceptance: [{ id: 'AC1', satisfied: true }],
      commit: 'abc',
      clean: true,
      gates: [{ gate: 'G4', passed: true }],
      commits: [{ itemId: 'A' }, { itemId: 'B' }, { itemId: 'C' }],
      askUserQuestion: 0,
      owner: 'tester',
      ...over,
    }) as Parameters<typeof judgeFinish>[0];

  it('accepts a run whose paused item resumed its own session and is ready for review on verified evidence', () => {
    const judged = judgeFinish(finished());
    assert.deepEqual(judged.problems, []);
    assert.equal(judged.resume['resumed'], true);
  });

  it('judges the resume of the item that asked when the decision also lists the item waiting for it, in either order', () => {
    for (const affectedItems of [['B', 'C'], ['C', 'B']]) {
      const judged = judgeFinish(finished({ decisions: [pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', affectedItems })] }));
      assert.deepEqual(judged.problems, [], affectedItems.join(','));
      assert.equal(judged.resume['itemId'], 'B');
      assert.equal(judged.resume['resumed'], true);
    }
  });

  it('does not count a fresh unit that merely carries the answer as a resume', () => {
    const judged = judgeFinish(finished({ attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'answer' }] }));
    assert.ok(judged.problems.some((p) => p.includes('no attempt with reason resume')));
    assert.equal(judged.resume['resumed'], false);
  });

  it('refuses a resume whose host init event reports another session, and an answer not given by the owner on the terminal', () => {
    const other = judgeFinish(finished({ invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: ['99999999-2222-4333-8444-555555555555'] }] }));
    assert.ok(other.problems.some((p) => p.includes('does not equal the session recorded')));
    const who = judgeFinish(finished({ decisions: [pauseDecision({ state: 'answered', answeredBy: 'owner:someone-else', answerChannel: 'terminal' })] }));
    assert.ok(who.problems.some((p) => p.includes('not owner:tester')));
    const channel = judgeFinish(finished({ decisions: [pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'inbox' })] }));
    assert.ok(channel.problems.some((p) => p.includes('not terminal')));
  });

  it("records the run's host configuration directory beside the resume facts, and keeps the session checks", () => {
    const judged = judgeFinish(finished({ hostConfigDir: RECORDED_DIR }));
    assert.deepEqual(judged.problems, []);
    assert.deepEqual(judged.resume['hostConfigDir'], RECORDED_DIR);
    assert.equal(judgeFinish(finished()).resume['hostConfigDir'], null);
    const other = judgeFinish(finished({ hostConfigDir: RECORDED_DIR, invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: ['99999999-2222-4333-8444-555555555555'] }] }));
    assert.ok(other.problems.some((p) => p.includes('does not equal the session recorded')));
    assert.deepEqual(other.resume['hostConfigDir'], RECORDED_DIR);
    const requested = judgeFinish(finished({ hostConfigDir: RECORDED_DIR, invocations: [{ attemptId: 'att_B2', requestedSession: 'other', initSessions: [SESSION] }] }));
    assert.ok(requested.problems.some((p) => p.includes('does not equal the session recorded')));
  });

  it('refuses a failed required check, an unsatisfied criterion, a dirty tree and a missing G4 or commit', () => {
    const bad = judgeFinish(finished({ requiredChecks: [{ name: 'test', status: 'failed' }], acceptance: [{ id: 'AC2', satisfied: false }], clean: false, commit: null, gates: [] }));
    for (const part of ['required check test', 'acceptance criterion AC2', 'clean tree', 'no handed-off commit', 'G4']) assert.ok(bad.problems.some((p) => p.includes(part)), part);
  });
});

describe('exit evidence: a second stop after the owner answered (plan 03-46)', () => {
  const SESSION = '11111111-2222-4333-8444-555555555555';
  const answered = pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', answer: '2', answeredAt: '2026-11-10T07:51:14Z', issue: 'which wording?' });
  const g2Stop = pauseDecision({
    decisionId: 'dec_BBBB',
    state: 'open',
    class: 'acceptance',
    affectedItems: ['B', 'C'],
    issue: 'GSD VERIFICATION status is gaps_found, not passed',
    origin: { origin: 'G2:gsd-verification', signalKind: 'gate', pauseSignal: null, gate: 'G2', rules: 'gsd-verification' },
    parkAttemptId: 'att_B2',
  });
  const secondStop = (over: Json = {}): Parameters<typeof judgeFinish>[0] =>
    ({
      state: 'blocked_on_decision',
      items: [
        { itemId: 'A', state: 'done', gsdSession: 'a' },
        { itemId: 'B', state: 'blocked_on_decision', gsdSession: SESSION },
        { itemId: 'C', state: 'ready', gsdSession: null },
      ],
      decisions: [answered, g2Stop],
      attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'resume' }],
      invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: [SESSION], answeredDecisionId: 'dec_AAAA' }],
      pauseSessions: { A: 'a', B: SESSION, C: null },
      requiredChecks: [],
      acceptance: [],
      commit: null,
      clean: null,
      gates: [],
      commits: [{ itemId: 'A' }],
      askUserQuestion: 0,
      owner: 'tester',
      pauseDecisionIds: ['dec_AAAA'],
      ...over,
    }) as Parameters<typeof judgeFinish>[0];

  it("reads the start stage's open decisions as the pause decisions, and keeps the ones an earlier finish already recorded", () => {
    assert.deepEqual(pauseDecisionIdsOf({ decisions: [pauseDecision(), pauseDecision({ decisionId: 'dec_OLD', state: 'answered' })] }), ['dec_AAAA']);
    assert.deepEqual(pauseDecisionIdsOf({ pauseDecisionIds: ['dec_AAAA'], decisions: [answered, g2Stop] }), ['dec_AAAA']);
    assert.deepEqual(pauseDecisionIdsOf(undefined), []);
  });

  it('finds the pause decision among the open ones, and reads any open decision as the pause decision when the start recorded none', () => {
    assert.equal(openPauseDecisionOf(['dec_AAAA'], ['dec_AAAA']), 'dec_AAAA');
    assert.equal(openPauseDecisionOf(['dec_AAAA'], ['dec_BBBB']), undefined);
    assert.equal(openPauseDecisionOf(['dec_AAAA'], []), undefined);
    assert.equal(openPauseDecisionOf([], ['dec_BBBB']), 'dec_BBBB');
  });

  it('judges a run blocked again on another decision: the named problem, the resume facts of the answered item, and the run not ready for review', () => {
    const judged = judgeFinish(secondStop());
    assert.ok(judged.problems.includes("the run stopped again on decision dec_BBBB (acceptance, origin G2:gsd-verification) after the owner's answer"), judged.problems.join(' | '));
    assert.ok(judged.problems.some((p) => p.includes('not ready_for_review')));
    assert.equal(judged.resume['resumed'], true);
    assert.equal(judged.resume['itemId'], 'B');
  });

  it('names no second stop when the only open decision is the pause decision, or none is open', () => {
    assert.equal(judgeFinish(secondStop({ decisions: [pauseDecision()] })).problems.some((p) => p.includes('stopped again')), false);
    assert.equal(judgeFinish(secondStop({ decisions: [answered] })).problems.some((p) => p.includes('stopped again')), false);
  });

  it('a run ready for review after the answer is judged as before', () => {
    const judged = judgeFinish(
      secondStop({
        state: 'ready_for_review',
        decisions: [answered],
        items: [{ itemId: 'A', state: 'done' }, { itemId: 'B', state: 'done', gsdSession: SESSION }],
        commits: [{ itemId: 'A' }, { itemId: 'B' }],
        requiredChecks: [{ name: 'test', status: 'passed' }],
        acceptance: [{ id: 'AC1', satisfied: true }],
        commit: 'abc',
        clean: true,
        gates: [{ gate: 'G4', passed: true }],
      }),
    );
    assert.deepEqual(judged.problems, []);
  });

  it('records the answered decision, the new open decision and the stop state of the run', () => {
    const record = secondStopOf([answered, g2Stop] as Json[], ['dec_AAAA'], 'blocked_on_decision', 'decision');
    assert.deepEqual(record['answeredDecision'], { decisionId: 'dec_AAAA', class: 'human', answer: '2', answerChannel: 'terminal', answeredBy: 'owner:tester', answeredAt: '2026-11-10T07:51:14Z', origin: { origin: 'pause' } });
    assert.deepEqual(record['newDecision'], {
      decisionId: 'dec_BBBB',
      class: 'acceptance',
      origin: { origin: 'G2:gsd-verification', signalKind: 'gate', pauseSignal: null, gate: 'G2', rules: 'gsd-verification' },
      issue: 'GSD VERIFICATION status is gaps_found, not passed',
      affectedItems: ['B', 'C'],
    });
    assert.deepEqual(record['stop'], { state: 'blocked_on_decision', reason: 'decision' });
    const clear = secondStopOf([answered] as Json[], ['dec_AAAA'], 'ready_for_review', null);
    assert.equal(clear['newDecision'], null);
    assert.deepEqual(clear['stop'], { state: 'ready_for_review', reason: null });
  });
});

describe('exit evidence: the spend guard and the transcript readers', () => {
  it('fits only while the recorded spend plus the cap stays within the lower of the two ceilings', () => {
    assert.equal(spendGuard(7.9739, 5.67, { ledger: 25, authorized: 25 }).fits, true);
    assert.equal(spendGuard(19.33, 5.67, { ledger: 25, authorized: 25 }).fits, true);
    assert.equal(spendGuard(19.34, 5.67, { ledger: 25, authorized: 25 }).fits, false);
    const lowered = spendGuard(7.9739, 5.67, { ledger: 10, authorized: 25 });
    assert.equal(lowered.fits, false);
    assert.equal(lowered.ceilingUsd, 10);
    assert.equal(spendGuard(0, Number.NaN, { ledger: 25, authorized: 25 }).fits, false);
  });

  it('reads the session of every init event and counts the tools the model called', () => {
    const text = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      'not json',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Read' }, { type: 'text', text: 'x' }] } }),
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's2' }),
    ].join('\n');
    assert.deepEqual(initSessions(text), ['s1', 's2']);
    assert.deepEqual(toolUseCounts(text), { Read: 2 });
  });
});

describe('exit-run-phase3.sh --run and --finish', () => {
  it('refuse to spend without the authorization file and start nothing', () => {
    const script = join(ROOT, 'scripts', 'exit-run-phase3.sh');
    for (const args of [['--run', 'test/benchmark/phase3/p3-run1-copy-fallback.md'], ['--finish', 'run_00000000000000000000000000']]) {
      const ran = spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
      assert.equal(ran.status, 2, `${args[0]}: ${ran.stderr}`);
      assert.match(ran.stderr, /refusing to spend without --authorization-file/);
    }
  });
});

const SUPERSEDES = { file: '03-29-evidence-exit.json', runId: 'run_01M71BDV8MWGEG7XSAWH1GZ80W', state: 'cancelled', stateAt: '2026-11-09T12:00:00.000Z', reason: 'D-03 stop of plan 03-29' };

describe('exit evidence: the plan that spend and evidence are recorded under (plan 03-41)', () => {
  it('reads AVARICE_PHASE3_PLAN and defaults to 03-29', () => {
    assert.equal(livePlan({}), '03-29');
    assert.equal(livePlan({ AVARICE_PHASE3_PLAN: '03-42' }), '03-42');
    assert.equal(livePlan({ AVARICE_PHASE3_PLAN: '' }), '03-29');
  });

  it('names the authorization file it was given as the source of the host pin', () => {
    assert.equal(pinnedByOf('/x/y/03-41-exit-authorization.json'), '03-41-exit-authorization.json');
    assert.equal(pinnedByOf('03-28-exit-authorization.json'), '03-28-exit-authorization.json');
  });
});

describe('exit evidence: rewriting the evidence file keeps what it was given (plan 03-41)', () => {
  it('keeps a supersedes block byte-identical and any other extra top-level key, and replaces only its own keys', () => {
    const existing = { schema: 1, plan: 'old', decision: 'old', updatedAt: 'old', runs: [{ runId: 'old' }], supersedes: SUPERSEDES, note: { kept: true } };
    const rewritten = evidenceFileBody(existing, '03-42', [{ runId: 'new' }], '2026-11-10T00:00:00.000Z');
    assert.equal(JSON.stringify(rewritten['supersedes']), JSON.stringify(SUPERSEDES));
    assert.deepEqual(rewritten['note'], { kept: true });
    assert.deepEqual(rewritten['runs'], [{ runId: 'new' }]);
    assert.equal(rewritten['plan'], '03-42');
    assert.equal(rewritten['decision'], 'D-03, D-05');
    assert.equal(rewritten['updatedAt'], '2026-11-10T00:00:00.000Z');
    assert.equal(rewritten['schema'], 1);
  });

  it('writes the plain five-key file when there is nothing to keep', () => {
    assert.deepEqual(Object.keys(evidenceFileBody(undefined, '03-29', [], 'now')), ['schema', 'plan', 'decision', 'updatedAt', 'runs']);
  });
});

describe('exit evidence: a start is refused while the superseded run is not terminal (plan 03-41; D-03)', () => {
  const evidence = { supersedes: SUPERSEDES };
  it('refuses a run that is blocked_on_decision, naming the run and its state', () => {
    assert.equal(supersededRunRefusal(evidence, () => 'blocked_on_decision'), `run ${SUPERSEDES.runId} is blocked_on_decision; the owner cancels it first (D-03, no silent repeat)`);
  });

  it("passes the same run in state cancelled, failed or closed, and keeps today's behaviour without a supersedes block", () => {
    for (const state of ['cancelled', 'failed', 'closed']) assert.equal(supersededRunRefusal(evidence, () => state), undefined, state);
    assert.equal(supersededRunRefusal({ runs: [] }, () => 'blocked_on_decision'), undefined);
    assert.equal(supersededRunRefusal(undefined, () => 'blocked_on_decision'), undefined);
  });

  it('refuses when the run cannot be read from the ledger', () => {
    assert.match(supersededRunRefusal(evidence, () => undefined) as string, /cannot be read/);
  });
});

describe('exit evidence: the per-item prompt scope of a compiled brief (plan 03-41)', () => {
  const contract = (behavior: string): Parameters<typeof promptScopeOf>[0] => ({
    intent: {
      behavior,
      acceptance: [
        { id: 'AC1', text: 'The label shows.', verifiedBy: ['command:test'] },
        { id: 'AC2', text: 'The owner picks one:\n1. Show the copy fallback\n2. Hide the copy button', verifiedBy: ['decision:fallback-wording'] },
      ],
      workItems: [
        { id: 'A', acceptance: ['AC1'] },
        { id: 'B', acceptance: ['AC2'] },
      ],
    },
  });

  it("counts another item's options found in this item's Behavior: a Behavior that labels nothing gives item A the options of item B", () => {
    const scope = promptScopeOf(contract('Make the control.\n\nChoices:\n1. Show the copy fallback\n2. Hide the copy button'));
    assert.equal(scope['A']?.otherItemOptions, 2);
    assert.equal(scope['B']?.otherItemOptions, 0);
  });

  it('counts 0 for every item when the Behavior is labelled per item', () => {
    const scope = promptScopeOf(contract('Shared text.\n\nItem A: build the label.\n\nItem B: ask which:\n1. Show the copy fallback\n2. Hide the copy button'));
    assert.deepEqual(scope, { A: { otherItemOptions: 0 }, B: { otherItemOptions: 0 } });
  });
});

describe('exit-run-phase3.sh: the default evidence file of the repeated exit (plan 03-41, plan 03-44)', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'exit-run-phase3.sh'), 'utf8');
  it('defaults to 03-48-evidence-exit.json; 03-29, 03-42 and 03-45 are named only as history in the header', () => {
    assert.match(script, /^EVID_DEFAULT=.*03-48-evidence-exit\.json"$/m);
    assert.match(script, /^\s*export AVARICE_PHASE3_PLAN="\$\{AVARICE_PHASE3_PLAN:-03-42\}"$/m);
    const lines = script.split('\n');
    for (const history of ['03-29-evidence-exit.json', '03-42-evidence-exit.json', '03-45-evidence-exit.json']) {
      assert.equal(lines.filter((l) => !l.startsWith('#') && l.includes(history)).length, 0, history);
      assert.ok(lines.some((l) => l.startsWith('#') && l.includes(history)), history);
    }
  });
});

describe('exit evidence: the superseded run read from a real ledger (plan 03-41)', () => {
  const cleanup: string[] = [];
  const dirs: string[] = [];
  const state: { s?: ReturnType<typeof startBlockedS17> } = {};
  before(
    () => {
      state.s = startBlockedS17(cleanup);
    },
    { timeout: 300_000 },
  );
  after(() => {
    for (const dir of [...cleanup, ...dirs]) rmSync(dir, { recursive: true, force: true });
  });

  const tools = (env: NodeJS.ProcessEnv, args: string[]) =>
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'exit-run-phase3-tools.ts'), ...args], { encoding: 'utf8', env, timeout: 60_000 });
  const authorizeArgs = (dir: string, evidence: string): string[] => {
    const auth = writeFreshAuthorization(dir);
    return ['authorize', '--authorization-file', auth, '--brief', join(dir, 'b.md'), '--repo', dir, '--config', join(dir, 'c.json'), '--evidence', evidence];
  };

  it('authorize exits 2 and starts nothing while the superseded run is blocked_on_decision, naming the run and the state', { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-supersede-'));
    dirs.push(dir);
    const { f, runId } = state.s as ReturnType<typeof startBlockedS17>;
    const env = profileEnv(f.roots);
    assert.equal(runStateOf(env, runId), 'blocked_on_decision');
    const evidence = join(dir, 'evidence.json');
    writeFileSync(evidence, JSON.stringify({ schema: 1, runs: [], supersedes: { file: '03-29-evidence-exit.json', runId } }));
    const refused = tools(env, authorizeArgs(dir, evidence));
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, new RegExp(`exit-run: run ${runId} is blocked_on_decision; the owner cancels it first \\(D-03, no silent repeat\\)`));
    assert.equal(JSON.parse(readFileSync(evidence, 'utf8')).runs.length, 0, 'nothing was written');
  });

  it('collect carries the host configuration directory the run recorded at start into its evidence entry', { timeout: 60_000 }, () => {
    const { f, runId } = state.s as ReturnType<typeof startBlockedS17>;
    const composed = createDeps(profileEnv(f.roots), {}, { readOnly: true });
    assert.ok(composed.ok);
    try {
      const collected = collect(composed.value.deps, runId);
      assert.ok(collected.facts, collected.problems.join('; '));
      const recorded = collected.facts.entry['hostConfigDir'] as { claudeConfigDir?: unknown; source?: unknown } | null | undefined;
      assert.ok(recorded !== null && recorded !== undefined, 'the entry has hostConfigDir');
      assert.equal(typeof recorded.claudeConfigDir, 'string');
      assert.ok(String(recorded.claudeConfigDir).startsWith('/'), 'an absolute directory');
      assert.ok(recorded.source === 'default' || recorded.source === 'CLAUDE_CONFIG_DIR');
    } finally {
      composed.value.close();
    }
  });

  describe('--finish against the ledger of a run that is blocked_on_decision (plan 03-46)', () => {
    const finishArgs = (dir: string, runId: string, repo: string, evidence: string): string[] => {
      const auth = writeFreshAuthorization(dir);
      return ['evidence', '--stage', 'finish', '--run-id', runId, '--brief', join(dir, 'b.md'), '--repo', repo, '--authorization-file', auth, '--out', evidence, '--wait-max-minutes', '1'];
    };
    const startRecord = (runId: string, repo: string, pauseDecisionIds: string[]): Json => {
      const snap = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'exit-run-phase3-tools.ts'), 'snapshot', '--repo', repo], { encoding: 'utf8', timeout: 60_000 });
      assert.equal(snap.status, 0, snap.stderr);
      return { runId, atPause: { at: '2026-11-10T06:23:43Z', state: 'blocked_on_decision', items: [] }, checkoutBeforeSnapshot: JSON.parse(snap.stdout), decisions: pauseDecisionIds.map((decisionId) => ({ decisionId, state: 'open' })) };
    };

    it('exits 2 and writes nothing while the decision that paused the run is still open', { timeout: 60_000 }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'exit-finish-open-'));
      dirs.push(dir);
      const { f, runId, decisionId } = state.s as ReturnType<typeof startBlockedS17>;
      const evidence = join(dir, 'evidence.json');
      const before = `${JSON.stringify({ schema: 1, plan: '03-46', runs: [startRecord(runId, f.repo.path, [decisionId])] })}\n`;
      writeFileSync(evidence, before);
      const ledger = join(dir, 'ledger.jsonl');
      const ran = tools({ ...profileEnv(f.roots), AVARICE_PHASE3_LEDGER: ledger }, finishArgs(dir, runId, f.repo.path, evidence));
      assert.equal(ran.status, 2, ran.stderr + ran.stdout);
      assert.match(ran.stderr, new RegExp(`decision ${decisionId} of ${runId} is still open: the owner has not answered it yet`));
      assert.equal(readFileSync(evidence, 'utf8'), before, 'the evidence file is untouched');
      assert.equal(existsSync(ledger), false, 'no spend line was written');
    });

    it('judges and records the stop, and exits 1, when the open decision is not the one that paused the run', { timeout: 60_000 }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'exit-finish-second-'));
      dirs.push(dir);
      const { f, runId, decisionId } = state.s as ReturnType<typeof startBlockedS17>;
      const evidence = join(dir, 'evidence.json');
      writeFileSync(evidence, `${JSON.stringify({ schema: 1, plan: '03-46', keepMe: { k: 1 }, runs: [{ runId: 'run_OTHER', marker: 'untouched' }, startRecord(runId, f.repo.path, ['dec_PAUSE_ANSWERED'])] })}\n`);
      const ledger = join(dir, 'ledger.jsonl');
      const ran = tools({ ...profileEnv(f.roots), AVARICE_PHASE3_LEDGER: ledger }, finishArgs(dir, runId, f.repo.path, evidence));
      assert.equal(ran.status, 1, ran.stderr + ran.stdout);
      assert.match(ran.stdout, /PROBLEM: the run stopped again on decision dec_[0-9A-Z]+ \(\w+, origin [^)]+\) after the owner's answer/);
      const body = JSON.parse(readFileSync(evidence, 'utf8')) as Json;
      assert.deepEqual(body['keepMe'], { k: 1 });
      const runs = body['runs'] as Json[];
      assert.deepEqual(runs.find((r) => r['runId'] === 'run_OTHER'), { runId: 'run_OTHER', marker: 'untouched' });
      const entry = runs.find((r) => r['runId'] === runId) as Json;
      assert.equal(entry['passed'], false);
      assert.equal(entry['finalState'], 'blocked_on_decision');
      assert.deepEqual(entry['pauseDecisionIds'], ['dec_PAUSE_ANSWERED']);
      assert.equal((entry['newDecision'] as Json)['decisionId'], decisionId);
      assert.deepEqual(entry['stop'], { state: 'blocked_on_decision', reason: 'decision' });
      assert.ok('answeredDecision' in entry && 'resume' in entry && 'spend' in entry);
      assert.ok((entry['problems'] as string[]).some((p) => p.includes(`the run stopped again on decision ${decisionId}`)));
    });
  });

  it('authorize refuses a run it cannot read, and moves past the check once the owner has cancelled the run', { timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-supersede-'));
    dirs.push(dir);
    const { f, runId } = state.s as ReturnType<typeof startBlockedS17>;
    const env = profileEnv(f.roots);
    const evidence = join(dir, 'evidence.json');
    writeFileSync(evidence, JSON.stringify({ schema: 1, runs: [], supersedes: { file: '03-29-evidence-exit.json', runId: 'run_00000000000000000000000000' } }));
    const unreadable = tools(env, authorizeArgs(dir, evidence));
    assert.equal(unreadable.status, 2, unreadable.stderr);
    assert.match(unreadable.stderr, /run run_00000000000000000000000000 cannot be read/);

    const cancelled = await cancelCli(f.roots, [runId]);
    assert.equal(cancelled.code, 0, cancelled.err + cancelled.out);
    assert.equal(runStateOf(env, runId), 'cancelled');
    writeFileSync(evidence, JSON.stringify({ schema: 1, runs: [], supersedes: { file: '03-29-evidence-exit.json', runId } }));
    const passed = tools(env, authorizeArgs(dir, evidence));
    assert.doesNotMatch(passed.stderr, /the owner cancels it first/);
    assert.doesNotMatch(passed.stderr, /cannot be read/);
    // It stops later, at the host pin: the test profile has no pinned host, and nothing is started.
    assert.match(passed.stderr, /AVARICE_CLAUDE_BIN is/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-49: an owner-relaxed finish (D-03 relaxed for one run) and the dry run's write-set check
// ---------------------------------------------------------------------------------------------------------------

describe('exit evidence: the finish of a run the owner relaxed under D-03 (plan 03-49)', () => {
  const SESSION = '11111111-2222-4333-8444-555555555555';
  const EXTRA = 'dec_EXTRA';
  const pause = pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', answer: '2' });
  const extra = (over: Json = {}): Json =>
    pauseDecision({ decisionId: EXTRA, state: 'answered', class: 'acceptance', affectedItems: ['C'], answeredBy: 'owner:tester', answerChannel: 'terminal', answer: '2', origin: { origin: 'pause' }, parkAttemptId: 'att_C1', ...over });
  const RELAX = { by: 'owner', ref: 'STATE.md 5ed69e0', decisions: [EXTRA], at: '2026-11-10T23:40:00Z' };
  const finished = (over: Json = {}): Parameters<typeof judgeFinish>[0] =>
    ({
      state: 'ready_for_review',
      items: [
        { itemId: 'A', state: 'done', gsdSession: 'a' },
        { itemId: 'B', state: 'done', gsdSession: SESSION },
        { itemId: 'C', state: 'done', gsdSession: 'c' },
      ],
      decisions: [pause, extra()],
      attempts: [
        { attemptId: 'att_B1', itemId: 'B', reason: 'initial' },
        { attemptId: 'att_B2', itemId: 'B', reason: 'resume' },
        { attemptId: 'att_C1', itemId: 'C', reason: 'initial' },
        { attemptId: 'att_C2', itemId: 'C', reason: 'resume' },
      ],
      invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: [SESSION], answeredDecisionId: 'dec_AAAA' }],
      pauseSessions: { A: 'a', B: SESSION, C: null },
      requiredChecks: [{ name: 'test', status: 'passed' }],
      acceptance: [{ id: 'AC1', satisfied: true }],
      commit: 'abc',
      clean: true,
      gates: [{ gate: 'G4', passed: true }],
      commits: [{ itemId: 'A' }, { itemId: 'B' }, { itemId: 'C' }],
      askUserQuestion: 0,
      owner: 'tester',
      pauseDecisionIds: ['dec_AAAA'],
      ...over,
    }) as Parameters<typeof judgeFinish>[0];
  const amended = (over: Json = {}): Json => ({ version: 2, authorizedBy: 'owner:tester', reason: 'the e2e spec asserts the old toast text', diff: [{ path: 'files.write', added: ['tests/unit/x.ts'] }], ...over });

  it('without a relax record an extra answered decision is refused as before', () => {
    const judged = judgeFinish(finished());
    assert.ok(judged.problems.some((p) => p.includes('2 decision(s) are answered, not one')), judged.problems.join(' | '));
  });

  it('accepts the extra decision when the relax record names it and the owner answered it on the terminal', () => {
    const judged = judgeFinish(finished({ relax: RELAX }));
    assert.deepEqual(judged.problems, []);
    assert.equal(judged.resume['resumed'], true, 'the resume of the paused item is still judged');
    assert.deepEqual(judged.resume['relax'], RELAX);
  });

  it('refuses a relaxed decision that the owner did not answer on the terminal, one the run does not have, and one still open', () => {
    const other = judgeFinish(finished({ relax: RELAX, decisions: [pause, extra({ answeredBy: 'owner:someone-else' })] }));
    assert.ok(other.problems.some((p) => p.includes(EXTRA) && p.includes('owner:tester')), other.problems.join(' | '));
    const inbox = judgeFinish(finished({ relax: RELAX, decisions: [pause, extra({ answerChannel: 'inbox' })] }));
    assert.ok(inbox.problems.some((p) => p.includes(EXTRA) && p.includes('terminal')), inbox.problems.join(' | '));
    const unknown = judgeFinish(finished({ relax: { ...RELAX, decisions: ['dec_NOPE'] } }));
    assert.ok(unknown.problems.some((p) => p.includes('dec_NOPE') && p.includes('does not have')), unknown.problems.join(' | '));
    const open = judgeFinish(finished({ relax: RELAX, decisions: [pause, extra({ state: 'open', answeredBy: null, answerChannel: null })] }));
    assert.ok(open.problems.some((p) => p.includes(EXTRA) && p.includes('open')), open.problems.join(' | '));
  });

  it('does not relax what the record does not name: a second extra decision is still refused', () => {
    const judged = judgeFinish(finished({ relax: RELAX, decisions: [pause, extra(), extra({ decisionId: 'dec_OTHER' })] }));
    assert.ok(judged.problems.some((p) => p.includes('2 decision(s) are answered, not one')), judged.problems.join(' | '));
  });

  it("refuses a relax record that is not the owner's, has no reference or names no decision, and then relaxes nothing", () => {
    for (const bad of [{ ...RELAX, by: 'claude' }, { ...RELAX, ref: '' }, { ...RELAX, decisions: [] }, { ...RELAX, decisions: [7] }, 'owner']) {
      const judged = judgeFinish(finished({ relax: bad as never }));
      assert.ok(judged.problems.some((p) => p.includes('relax record is not valid')), JSON.stringify(bad));
      assert.ok(judged.problems.some((p) => p.includes('2 decision(s) are answered, not one')), 'nothing was relaxed');
    }
  });

  it('accepts a stale decision and its answered successor when both are named and the owner answered both on the terminal', () => {
    const stale = extra({ decisionId: 'dec_OLD', state: 'stale', contractVersion: 1 });
    const successor = extra({ decisionId: EXTRA, contractVersion: 2, supersedes: 'dec_OLD' });
    const judged = judgeFinish(finished({ relax: { ...RELAX, decisions: ['dec_OLD', EXTRA] }, decisions: [pause, stale, successor], contract: amended() as never }));
    assert.deepEqual(judged.problems, []);
  });

  it('accepts an amendment only as contract version 2 with the owner, a reason and a diff, and only with a relax record', () => {
    assert.deepEqual(judgeFinish(finished({ relax: RELAX, contract: amended() as never })).problems, []);
    assert.deepEqual(judgeFinish(finished({ contract: { version: 1 } as never, relax: RELAX })).problems, [], 'version 1 is no amendment');
    for (const [over, part] of [
      [{ version: 3 }, 'version 2'],
      [{ authorizedBy: 'owner:someone-else' }, 'authorized_by'],
      [{ reason: '' }, 'reason'],
      [{ diff: [] }, 'diff'],
    ] as Array<[Json, string]>) {
      const judged = judgeFinish(finished({ relax: RELAX, contract: amended(over) as never }));
      assert.ok(judged.problems.some((p) => p.includes('amend') && p.includes(part)), `${part}: ${judged.problems.join(' | ')}`);
    }
    const without = judgeFinish(finished({ decisions: [pause], contract: amended() as never }));
    assert.ok(without.problems.some((p) => p.includes('amended') && p.includes('relax record')), without.problems.join(' | '));
  });

  it('with relaxAllowed false a relax record is a problem and relaxes nothing, and with the option absent the record counts as before (plan 03-52, D-28)', () => {
    const closed = judgeFinish(finished({ relax: RELAX, relaxAllowed: false }));
    assert.ok(closed.problems.includes('a relax record is not accepted in the exit (D-28)'), closed.problems.join(' | '));
    assert.ok(closed.problems.some((p) => p.includes('2 decision(s) are answered, not one')), 'the extra decision is judged as if there were no record');
    assert.equal('relax' in closed.resume, false);
    const amendedClosed = judgeFinish(finished({ relax: RELAX, relaxAllowed: false, decisions: [pause], contract: amended() as never }));
    assert.ok(amendedClosed.problems.some((p) => p.includes('amended') && p.includes('relax record')), amendedClosed.problems.join(' | '));
    const noRecord = judgeFinish(finished({ decisions: [pause], relaxAllowed: false }));
    assert.deepEqual(noRecord.problems, [], 'nothing to refuse without a record');
    assert.deepEqual(judgeFinish(finished({ relax: RELAX })).problems, [], 'the option absent: the plan 03-49 case passes');
    assert.deepEqual(judgeFinish(finished({ relax: RELAX, relaxAllowed: true })).problems, []);
  });

  it('keeps every other finish check', () => {
    const bad = judgeFinish(finished({ relax: RELAX, requiredChecks: [{ name: 'test', status: 'failed' }], clean: false, commit: null, gates: [] }));
    for (const part of ['required check test', 'clean tree', 'no handed-off commit', 'G4']) assert.ok(bad.problems.some((p) => p.includes(part)), part);
    const items = judgeFinish(finished({ relax: RELAX, items: [{ itemId: 'A', state: 'done' }, { itemId: 'B', state: 'done', gsdSession: SESSION }, { itemId: 'C', state: 'blocked_on_decision' }] }));
    assert.ok(items.problems.some((p) => p.includes('item C is blocked_on_decision, not done')));
  });
});

describe('exit evidence: the relax record is written by a subcommand, and only into the entry it names (plan 03-49)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const tools = (args: string[]) =>
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'exit-run-phase3-tools.ts'), ...args], { encoding: 'utf8', timeout: 60_000 });
  const evidenceFile = (): { dir: string; file: string; body: Json } => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-relax-'));
    dirs.push(dir);
    const body: Json = {
      schema: 1,
      plan: '03-48',
      decision: 'D-03, D-05',
      updatedAt: '2026-11-10T22:51:22Z',
      runs: [
        { runId: 'run_AAAA', title: 'one', problems: ['x'], decisions: [{ decisionId: 'dec_1' }] },
        { runId: 'run_BBBB', title: 'two', problems: [] },
      ],
      supersedes: { file: '03-45-evidence-exit.json', runId: 'run_OLD' },
    };
    const file = join(dir, 'evidence.json');
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    return { dir, file, body };
  };
  const RECORD = { by: 'owner', ref: 'STATE.md 5ed69e0', decisions: ['dec_01M73THARNM0VENR94QDX62BJ3'], at: '2026-11-10T23:40:00Z' };

  it('withRelax sets the record on the named run and changes nothing else', () => {
    const { body } = evidenceFile();
    const next = withRelax(body, 'run_AAAA', RECORD) as Json;
    const runs = next['runs'] as Json[];
    assert.deepEqual(runs[0]?.['relax'], RECORD);
    assert.deepEqual({ ...runs[0], relax: undefined }, { ...(body['runs'] as Json[])[0], relax: undefined });
    assert.deepEqual(runs[1], (body['runs'] as Json[])[1]);
    assert.deepEqual({ ...next, runs: undefined }, { ...body, runs: undefined });
    assert.equal(withRelax(body, 'run_ZZZZ', RECORD), undefined, 'an unknown run has no entry to write into');
  });

  it('relax writes { by, ref, decisions, at } into the entry of the run and keeps every other key', () => {
    const { file, body } = evidenceFile();
    const ran = tools(['relax', '--evidence', file, '--run-id', 'run_AAAA', '--decision', 'dec_01M73THARNM0VENR94QDX62BJ3', '--decision', 'dec_01M73THARNM0VENR94QDX62BJ4', '--ref', 'STATE.md 5ed69e0', '--by', 'owner']);
    assert.equal(ran.status, 0, ran.stderr);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Json;
    const entry = (written['runs'] as Json[])[0] as Json;
    const relax = entry['relax'] as Json;
    assert.deepEqual(Object.keys(relax).sort(), ['at', 'by', 'decisions', 'ref']);
    assert.equal(relax['by'], 'owner');
    assert.equal(relax['ref'], 'STATE.md 5ed69e0');
    assert.deepEqual(relax['decisions'], ['dec_01M73THARNM0VENR94QDX62BJ3', 'dec_01M73THARNM0VENR94QDX62BJ4']);
    assert.match(String(relax['at']), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    assert.deepEqual(written['supersedes'], body['supersedes']);
    assert.deepEqual((written['runs'] as Json[])[1], (body['runs'] as Json[])[1]);
    assert.deepEqual(written['updatedAt'], body['updatedAt'], 'the file is not otherwise re-stamped');
  });

  it('relax refuses an unknown run, a missing reference, a decision ID that is not one and a by other than owner, and writes nothing', () => {
    const { file } = evidenceFile();
    const before = readFileSync(file, 'utf8');
    const common = ['--evidence', file, '--run-id', 'run_AAAA', '--ref', 'STATE.md 5ed69e0', '--by', 'owner'];
    const cases: string[][] = [
      ['relax', '--evidence', file, '--run-id', 'run_ZZZZ', '--decision', 'dec_X1', '--ref', 'r', '--by', 'owner'],
      ['relax', '--evidence', file, '--run-id', 'run_AAAA', '--decision', 'dec_X1', '--by', 'owner'],
      ['relax', ...common, '--decision', 'not-a-decision'],
      ['relax', ...common],
      ['relax', '--evidence', file, '--run-id', 'run_AAAA', '--decision', 'dec_X1', '--ref', 'r', '--by', 'claude'],
    ];
    for (const args of cases) {
      const ran = tools(args);
      assert.equal(ran.status, 2, `${args.join(' ')}: ${ran.stderr}`);
    }
    assert.equal(readFileSync(file, 'utf8'), before);
  });

  it('relax refuses an evidence file marked exitRules D-26..D-35, naming D-28, and leaves it byte-identical (plan 03-52)', () => {
    const { dir, body } = evidenceFile();
    const file = join(dir, 'exit-rules-evidence.json');
    writeFileSync(file, `${JSON.stringify({ ...body, exitRules: 'D-26..D-35' }, null, 2)}\n`);
    const before = sha256Of(file);
    const ran = tools(['relax', '--evidence', file, '--run-id', 'run_AAAA', '--decision', 'dec_X1', '--ref', 'STATE.md 5ed69e0', '--by', 'owner']);
    assert.equal(ran.status, 2, ran.stdout + ran.stderr);
    assert.match(ran.stderr, /D-28/);
    assert.equal(sha256Of(file), before);
    assert.equal('relax' in ((JSON.parse(readFileSync(file, 'utf8')) as Json)['runs'] as Json[])[0]!, false);
  });

  it('contractDiff lists what an amendment added, removed or changed, by field path', () => {
    const before = { files: { write: ['src/a.ts'], create: ['src/a.ts'], protected: ['tests/e2e/**'] }, budgets: { invocations: 7 }, contractVersion: 1 };
    const after = { files: { write: ['src/a.ts', 'tests/unit/x.ts'], create: ['src/a.ts', 'tests/unit/x.ts'], protected: ['tests/e2e/**'] }, budgets: { invocations: 9 }, contractVersion: 2 };
    const diff = contractDiff(before, after);
    assert.deepEqual(
      diff.filter((d) => d['path'] !== 'contractVersion'),
      [
        { path: 'files.write', added: ['tests/unit/x.ts'] },
        { path: 'files.create', added: ['tests/unit/x.ts'] },
        { path: 'budgets.invocations', from: 7, to: 9 },
      ],
    );
    assert.deepEqual(contractDiff(before, before), []);
  });
});

describe('exit evidence: the contract of a run read from a real ledger, amended once (plan 03-49)', () => {
  const cleanup: string[] = [];
  after(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  it('collect carries the version, the owner, the reason and a diff that leaves out the version number and the compile time', { timeout: 120_000 }, async () => {
    const { f, runId } = startBlockedS17(cleanup);
    const read = (): Json => {
      const composed = createDeps(profileEnv(f.roots), {}, { readOnly: true });
      assert.ok(composed.ok);
      try {
        const collected = collect(composed.value.deps, runId);
        assert.ok(collected.facts, collected.problems.join('; '));
        return collected.facts.entry['contract'] as Json;
      } finally {
        composed.value.close();
      }
    };
    const first = read();
    assert.equal(first['version'], 1);
    assert.equal('diff' in first, false, 'version 1 is no amendment');

    const amended = await runMain(f.roots, ['contract', 'amend', runId, '--budget', 'costUsdPerRun=11', '--reason', 'room to finish'], { answers: ['y'] });
    assert.equal(amended.code, 0, amended.err + amended.out);
    const second = read();
    assert.equal(second['version'], 2);
    assert.equal(second['reason'], 'room to finish');
    assert.match(String(second['authorizedBy']), /^owner:/);
    assert.deepEqual(second['diff'], [{ path: 'budgets.costUsd.perRun', from: 10, to: 11 }]);
  });
});

describe('dry run: the write-set check of a brief (plan 03-49)', () => {
  const repos: Array<{ dispose(): void }> = [];
  after(() => {
    for (const r of repos) r.dispose();
  });
  const FALLBACK_TEXT = 'Could not copy the address. Opening your mail app instead.';
  const make = () => {
    const repo = makeScratchRepo({
      files: {
        'src/lib/copy.ts': `export const COPY_SUCCESS = 'Email copied to clipboard'\nexport const COPY_FALLBACK = '${FALLBACK_TEXT}'\nexport const SHORT_LABEL = 'ok'\n`,
        'src/components/useCopy.ts': "import { COPY_FALLBACK } from '../lib/copy'\nexport const useCopy = () => COPY_FALLBACK\n",
        'src/other/Unrelated.tsx': 'export const nothing = 1\n',
        'tests/unit/copy.test.ts': "import { COPY_FALLBACK } from '../../src/lib/copy'\n",
        'tests/e2e/copy.spec.ts': `import { test } from '@playwright/test'\n\nconst x = 1\nconst FALLBACK = '${FALLBACK_TEXT}'\n`,
        'docs/notes.md': `The toast says ${FALLBACK_TEXT}\n`,
        '.planning/phases/03/PLAN.md': `COPY_FALLBACK = '${FALLBACK_TEXT}'\n`,
      },
    });
    repos.push(repo);
    return repo;
  };
  const input = (over: Record<string, unknown> = {}) => ({
    behavior: 'Item C: `useCopy` shows `copyFallback(address)` instead of `COPY_FALLBACK`, and `COPY_FALLBACK` is removed from `src/lib/copy.ts` with every import of it. The label `SHORT_LABEL` is not touched, `string` is a type.',
    writeGlobs: ['src/lib/copy.ts', 'tests/unit/copy.test.ts', 'src/components/useCopy.ts'],
    itemFiles: ['src/lib/copy.ts', 'src/components/useCopy.ts'],
    protectedGlobs: ['tests/e2e/**', 'scripts/**'],
    conventionsWrite: ['src/**', 'tests/unit/**', 'docs/**'],
    ...over,
  });

  it('flags the e2e spec that holds the value of a removed constant, as protected, with its line', () => {
    const repo = make();
    const checked = writeSetCheck(repo.path, repo.head, input());
    const hit = checked.findings.find((f) => f.path === 'tests/e2e/copy.spec.ts');
    assert.ok(hit, JSON.stringify(checked.findings));
    assert.equal(hit.line, 4);
    assert.equal(hit.protected, true);
    assert.equal(hit.problem, true);
    assert.ok(checked.lines.includes(`tests/e2e/copy.spec.ts:4 holds COPY_FALLBACK's value "${FALLBACK_TEXT}" (writable: no, protected: yes)`), checked.lines.join('\n'));
  });

  it("reports a file inside the conventions that is outside the brief's Write list, as not protected and not a problem", () => {
    const repo = make();
    const checked = writeSetCheck(repo.path, repo.head, input({ writeGlobs: ['src/lib/copy.ts', 'tests/unit/copy.test.ts'], itemFiles: ['src/lib/copy.ts'] }));
    const hit = checked.findings.find((f) => f.path === 'src/components/useCopy.ts' && f.line === 1);
    assert.ok(hit, JSON.stringify(checked.findings));
    assert.deepEqual([hit.protected, hit.problem, hit.insideConventions], [false, false, true]);
    assert.ok(checked.lines.some((l) => l.startsWith('src/components/useCopy.ts:1 holds COPY_FALLBACK (writable: no, protected: no)')), checked.lines.join('\n'));
  });

  it("reports nothing for files in the Write list or an item's own files, and skips prose and planning files", () => {
    const repo = make();
    const checked = writeSetCheck(repo.path, repo.head, input());
    const paths = new Set(checked.findings.map((f) => f.path));
    assert.equal(paths.has('src/lib/copy.ts'), false);
    assert.equal(paths.has('tests/unit/copy.test.ts'), false);
    assert.equal(paths.has('src/components/useCopy.ts'), false);
    assert.equal(paths.has('docs/notes.md'), false, 'prose is not tested by any check');
    assert.equal(paths.has('.planning/phases/03/PLAN.md'), false);
    assert.equal(paths.has('src/other/Unrelated.tsx'), false);
  });

  it('a file outside the write set of the conventions is a problem even when it is not protected', () => {
    const repo = make();
    const checked = writeSetCheck(repo.path, repo.head, input({ protectedGlobs: [], conventionsWrite: ['src/**', 'docs/**'] }));
    const hit = checked.findings.find((f) => f.path === 'tests/e2e/copy.spec.ts');
    assert.ok(hit);
    assert.deepEqual([hit.protected, hit.insideConventions, hit.problem], [false, false, true]);
  });

  it('reads the needles from backticks only, skips plain words and types, and ignores a value that is too short to mean anything', () => {
    const repo = make();
    const checked = writeSetCheck(repo.path, repo.head, input());
    const names = checked.needles.map((n) => n.name);
    assert.ok(names.includes('COPY_FALLBACK'));
    assert.equal(names.includes('string'), false);
    assert.equal(names.includes('src/lib/copy.ts'), false);
    assert.ok(names.includes('SHORT_LABEL'));
    assert.equal(checked.needles.find((n) => n.name === 'SHORT_LABEL')?.value, undefined, 'a value of two characters is not searched');
  });

  it("reads git objects only: the repository's working tree and index are not touched", () => {
    const repo = make();
    const status = (): string => spawnSync('git', ['-C', repo.path, 'status', '--porcelain=v2', '--untracked-files=all'], { encoding: 'utf8' }).stdout;
    const before = status();
    writeSetCheck(repo.path, repo.head, input());
    assert.equal(status(), before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-52: the D-31 gate on a classification file, and the authorization writer that depends on it (D-28, D-30, D-31, D-33)
// ---------------------------------------------------------------------------------------------------------------

interface ExitFixture {
  repo: ReturnType<typeof makeScratchRepo>;
  dir: string;
  run1: string;
  run2: string;
  // The uncapped brief-check report of both briefs, as `brief-check --all` wrote it.
  all: Json;
}

const GATE_FALLBACK = 'Could not copy the address. Opening your mail app instead.';

// A temporary git repository with the draft conventions committed, a constant a brief removes, a file outside the brief's Write list that uses it (inside the
// conventions) and a protected e2e spec that asserts its value on line 5; plus two briefs that compile against it (the run 1 brief of Phase 3, and a copy).
function makeExitFixture(): ExitFixture {
  const repo = makeScratchRepo({
    files: {
      '.avarice/config.json': readFileSync(CONFIG_DRAFT, 'utf8'),
      // The preflight of `authorize` reads the staleness rules; a planning roadmap at the pin is what lets it pass.
      '.planning/ROADMAP.md': '# Roadmap\n',
      'src/lib/dates.ts': 'export const monthYear = (v: string) => v\n',
      'src/lib/copy.ts': `export const COPY_SUCCESS = 'Email copied to clipboard'\nexport const COPY_FALLBACK = '${GATE_FALLBACK}'\n`,
      'src/components/ui/useCopyEmail.ts': "import { COPY_FALLBACK } from '../../lib/copy'\nexport const useCopyEmail = () => COPY_FALLBACK\n",
      'src/other/Banner.ts': "import { COPY_FALLBACK } from '../lib/copy'\nexport const banner = COPY_FALLBACK\n",
      'tests/unit/dates.test.ts': 'export {}\n',
      'tests/unit/copy.test.ts': 'export {}\n',
      'tests/e2e/copy-email.spec.ts': `import { test } from '@playwright/test'\n\ntest('x', async () => {\n  const a = 1\n  await expect(page).toHaveText('${GATE_FALLBACK}')\n})\n`,
    },
  });
  const dir = mkdtempSync(join(tmpdir(), 'exit-gate-'));
  const text = readFileSync(join(ROOT, 'test', 'benchmark', 'phase3', 'p3-run1-copy-fallback.md'), 'utf8').replace('baseRevision: 9f1cd8d', `baseRevision: ${repo.head.slice(0, 7)}`);
  const run1 = join(dir, 'run1.md');
  const run2 = join(dir, 'run2.md');
  writeFileSync(run1, text);
  writeFileSync(run2, text.replace('title: The copy fallback names the address', 'title: The copy fallback names the address, second'));
  const reportPath = join(dir, 'all.json');
  const ran = runTools(['brief-check', '--all', '--source', repo.path, '--pin', repo.head, '--brief', run1, '--brief', run2, '--out', reportPath]);
  assert.equal(ran.status, 0, ran.stderr + ran.stdout);
  return { repo, dir, run1, run2, all: JSON.parse(readFileSync(reportPath, 'utf8')) as Json };
}

const briefsOf = (report: Json): Record<string, Json> => report['briefs'] as Record<string, Json>;
const findingsOf = (report: Json, key: string): Json[] => (briefsOf(report)[key] as Json)['findings'] as Json[];
const findingAt = (report: Json, key: string, path: string, line: number): Json => {
  const found = findingsOf(report, key).find((f) => f['path'] === path && f['line'] === line);
  assert.ok(found, `${path}:${line} in ${key}`);
  return found;
};

// The reviewed file a classification starts from: every finding of the report classified `kept` at its own location; `mutate` then edits the copy.
function classifiedCopy(report: Json, mutate: (c: Json) => void = () => undefined): Json {
  const copy = JSON.parse(JSON.stringify(report)) as Json;
  copy['checkedAt'] = CHECKED_AT;
  for (const key of Object.keys(briefsOf(copy))) {
    for (const f of findingsOf(copy, key)) Object.assign(f, { classification: 'kept', assertedAt: `${f['path']}:${f['line']}`, reason: 'The brief leaves this line as it is.' });
  }
  mutate(copy);
  return copy;
}

const only = (problems: string[], ...parts: string[]): void => {
  assert.equal(problems.length, 1, problems.join(' | '));
  for (const part of parts) assert.ok((problems[0] as string).includes(part), `${JSON.stringify(part)} in ${problems[0]}`);
};

const repoState = (repo: string): string => [git(repo, ['rev-parse', 'HEAD']), git(repo, ['status', '--porcelain=v2', '--untracked-files=all']), git(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])].join('\n--\n');

describe('flags, writeSetCheck and brief-check --all (plan 03-52)', () => {
  const fixtures: ExitFixture[] = [];
  const repos: Array<{ dispose(): void }> = [];
  after(() => {
    for (const fx of fixtures) {
      fx.repo.dispose();
      rmSync(fx.dir, { recursive: true, force: true });
    }
    for (const r of repos) r.dispose();
  });

  it('flags records a flag given without a value in `bools`, and parses valued flags as before', () => {
    const parsed = exitTools.flags(['brief-check', '--all', '--source', 'R']);
    assert.deepEqual([...parsed.bools], ['all']);
    assert.equal(parsed.named['source'], 'R');
    assert.equal(parsed.named['all'], undefined);
    const many = exitTools.flags(['--brief', 'a', '--cap', '4.5', '--brief', 'b', '--dry']);
    assert.deepEqual(many.many['brief'], ['a', 'b']);
    assert.equal(many.named['cap'], '4.5');
    assert.deepEqual([...many.bools], ['dry']);
  });

  it('writeSetCheck without options keeps the cap of 25 findings per needle; limitPerNeedle Infinity lists every finding and an empty `truncated`', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/many/f${i}.ts`, `export const x${i} = COPY_FALLBACK\n`]));
    const repo = makeScratchRepo({ files: { 'src/lib/copy.ts': "export const COPY_FALLBACK = 'x'\n", ...many } });
    repos.push(repo);
    const input = { behavior: 'Remove `COPY_FALLBACK`.', writeGlobs: ['src/lib/copy.ts'], itemFiles: ['src/lib/copy.ts'], protectedGlobs: [], conventionsWrite: ['src/**'] };
    const capped = writeSetCheck(repo.path, repo.head, input);
    assert.equal(capped.findings.length, 25);
    assert.deepEqual(capped.truncated, { COPY_FALLBACK: 5 });
    const uncapped = writeSetCheck(repo.path, repo.head, input, { limitPerNeedle: Infinity });
    assert.equal(uncapped.findings.length, 30);
    assert.deepEqual(uncapped.truncated, {});
    assert.deepEqual(uncapped.findings.slice(0, 25), capped.findings, 'the first 25 findings are the capped ones, in the same order');
  });

  it('brief-check --all records an uncapped report; the default brief-check report carries neither the marker nor the extra keys', () => {
    const fx = makeExitFixture();
    fixtures.push(fx);
    assert.equal(fx.all['uncapped'], true);
    const run1 = briefsOf(fx.all)['run1'] as Json;
    // The compiled contract's protected set: the conventions' own list plus the paths AVARICE itself always protects.
    const protectedGlobs = run1['protectedGlobs'] as string[];
    for (const glob of ['tests/e2e/**', 'scripts/**', 'tests/setup.ts', '.avarice/**', 'package.json']) assert.ok(protectedGlobs.includes(glob), glob);
    const plain = join(fx.dir, 'plain.json');
    const ran = runTools(['brief-check', '--source', fx.repo.path, '--pin', fx.repo.head, '--brief', fx.run1, '--out', plain]);
    assert.equal(ran.status, 0, ran.stderr);
    const report = JSON.parse(readFileSync(plain, 'utf8')) as Json;
    assert.equal('uncapped' in report, false);
    assert.deepEqual(Object.keys(briefsOf(report)['run1'] as Json), ['path', 'digest', 'write', 'needles', 'findings', 'lines', 'truncated', 'problems', 'byNeedle']);
    assert.deepEqual(findingsOf(report, 'run1'), findingsOf(fx.all, 'run1'));
  });
});

describe('the D-31 gate: gateClassification and gateForBrief (plan 03-52)', () => {
  const state: { fx?: ExitFixture } = {};
  before(
    () => {
      state.fx = makeExitFixture();
    },
    { timeout: 120_000 },
  );
  after(() => {
    if (state.fx !== undefined) {
      state.fx.repo.dispose();
      rmSync(state.fx.dir, { recursive: true, force: true });
    }
  });
  const fresh = (mutate: (r: Json) => void = () => undefined): Json => {
    const copy = JSON.parse(JSON.stringify((state.fx as ExitFixture).all)) as Json;
    mutate(copy);
    return copy;
  };
  const classified = (mutate: (c: Json) => void = () => undefined): Json => classifiedCopy((state.fx as ExitFixture).all, mutate);
  const BANNER = 'src/other/Banner.ts';
  const SPEC = 'tests/e2e/copy-email.spec.ts';

  it('the fixture holds the three findings of run 1: two unprotected inside the conventions, one protected spec', () => {
    const found = findingsOf((state.fx as ExitFixture).all, 'run1').map((f) => `${f['path']}:${f['line']}:${f['protected']}`);
    assert.deepEqual(found, [`${BANNER}:1:false`, `${BANNER}:2:false`, `${SPEC}:5:true`]);
  });

  it('passes a classification that classifies every fresh finding kept at its own path and line', () => {
    assert.deepEqual(exitTools.gateClassification(classified(), fresh()), []);
  });

  it('passes a changed finding in an unprotected file inside the conventions write set', () => {
    const c = classified((x) => Object.assign(findingAt(x, 'run1', BANNER, 1), { classification: 'changed' }));
    assert.deepEqual(exitTools.gateClassification(c, fresh()), []);
  });

  it('fails a fresh finding the file leaves out, naming the brief, the finding and D-31', () => {
    const c = classified((x) => {
      ((briefsOf(x)['run1'] as Json)['findings'] as Json[]).splice(1, 1);
    });
    only(exitTools.gateClassification(c, fresh()), 'run1', `${BANNER}:2`, 'COPY_FALLBACK', 'D-31');
  });

  it('fails a finding in the file that the fresh check does not report', () => {
    const c = classified((x) => {
      findingsOf(x, 'run1').push({ path: 'src/gone.ts', line: 9, needle: 'COPY_FALLBACK', kind: 'identifier', classification: 'kept', assertedAt: 'src/gone.ts:9' });
    });
    only(exitTools.gateClassification(c, fresh()), 'run1', 'src/gone.ts:9', 'COPY_FALLBACK', 'D-31');
  });

  it('fails a finding with no classification, or one that is neither kept nor changed', () => {
    for (const value of [undefined, 'keep', 'maybe', '', 7]) {
      const c = classified((x) => {
        const f = findingAt(x, 'run1', BANNER, 1);
        if (value === undefined) delete f['classification'];
        else f['classification'] = value;
      });
      only(exitTools.gateClassification(c, fresh()), 'run1', `${BANNER}:1`, 'classification', 'D-31');
    }
  });

  it("fails an assertedAt that is not the finding's own path and line", () => {
    for (const wrong of [`${BANNER}:2`, 'tests/unit/copy.test.ts:1', '', `${BANNER}`]) {
      const c = classified((x) => {
        findingAt(x, 'run1', BANNER, 1)['assertedAt'] = wrong;
      });
      only(exitTools.gateClassification(c, fresh()), 'run1', `${BANNER}:1`, 'assertedAt', 'D-31');
    }
  });

  it('fails a changed finding in a protected file, and still fails it when the file says the finding is not protected', () => {
    const honest = classified((x) => Object.assign(findingAt(x, 'run1', SPEC, 5), { classification: 'changed' }));
    only(exitTools.gateClassification(honest, fresh()), 'run1', `${SPEC}:5`, 'protected', 'D-30');
    const forged = classified((x) => Object.assign(findingAt(x, 'run1', SPEC, 5), { classification: 'changed', protected: false, problem: false, insideConventions: true }));
    only(exitTools.gateClassification(forged, fresh()), 'run1', `${SPEC}:5`, 'protected', 'D-30');
  });

  it('passes a kept finding in a protected file: the brief leaves the spec as it is', () => {
    assert.deepEqual(exitTools.gateClassification(classified(), fresh()), []);
  });

  it("fails a changed finding the fresh check puts outside the conventions' write set, whatever the file says", () => {
    const c = classified((x) => Object.assign(findingAt(x, 'run1', BANNER, 1), { classification: 'changed', insideConventions: true }));
    const moved = fresh((r) => {
      findingAt(r, 'run1', BANNER, 1)['insideConventions'] = false;
    });
    only(exitTools.gateClassification(c, moved), 'run1', `${BANNER}:1`, 'write set', 'D-31');
  });

  it('fails a brief whose digest differs from the fresh parse', () => {
    const c = classified((x) => {
      (briefsOf(x)['run1'] as Json)['digest'] = 'sha256:0000';
    });
    only(exitTools.gateClassification(c, fresh()), 'run1', 'digest', 'D-31');
  });

  it('fails a pin or a conventions revision that differs from the fresh check', () => {
    only(exitTools.gateClassification(classified((x) => void (x['pin'] = 'a'.repeat(40))), fresh()), 'pin', 'D-31');
    only(exitTools.gateClassification(classified((x) => void (x['conventionsRevision'] = 'b'.repeat(40))), fresh()), 'conventions', 'D-31');
  });

  it('fails while the fresh check reports a truncation: a capped check cannot be fully classified', () => {
    const capped = fresh((r) => void ((briefsOf(r)['run1'] as Json)['truncated'] = { COPY_FALLBACK: 3 }));
    only(exitTools.gateClassification(classified(), capped), 'run1', 'truncated', 'COPY_FALLBACK', 'D-31');
  });

  it('fails a compiled Write-list entry that matches a protected glob (D-30)', () => {
    const bad = fresh((r) => void (((briefsOf(r)['run1'] as Json)['write'] as string[]).push(SPEC)));
    only(exitTools.gateClassification(classified(), bad), 'run1', SPEC, 'D-30');
  });

  it('fails a brief the fresh check could not parse or compile, a brief the file lacks and a brief the file invents', () => {
    const broken = fresh((r) => {
      briefsOf(r)['run2'] = { path: 'x', digest: 'sha256:1', problem: 'does not compile: nope' };
    });
    assert.ok(exitTools.gateClassification(classified(), broken).some((p) => p.includes('run2') && p.includes('does not compile: nope')));
    const lacking = classified((x) => void delete briefsOf(x)['run2']);
    assert.ok(exitTools.gateClassification(lacking, fresh()).some((p) => p.includes('run2') && p.includes('D-31')));
    const invented = classified((x) => void (briefsOf(x)['run9'] = { path: 'x', digest: 'sha256:9', findings: [] }));
    assert.ok(exitTools.gateClassification(invented, fresh()).some((p) => p.includes('run9') && p.includes('D-31')));
  });

  it('gateForBrief judges the top-level facts and one brief only', () => {
    const c = classified((x) => {
      ((briefsOf(x)['run1'] as Json)['findings'] as Json[]).splice(0, 1);
    });
    assert.deepEqual(exitTools.gateForBrief(c, fresh(), 'run2'), []);
    only(exitTools.gateForBrief(c, fresh(), 'run1'), 'run1', `${BANNER}:1`, 'D-31');
    assert.equal(exitTools.gateClassification(c, fresh()).length, 1);
    assert.ok(exitTools.gateForBrief(c, fresh(), 'run9').some((p) => p.includes('run9')), 'a brief the fresh check does not hold is refused');
    const wrongPin = classified((x) => void (x['pin'] = 'a'.repeat(40)));
    only(exitTools.gateForBrief(wrongPin, fresh(), 'run2'), 'pin');
  });
});

describe('brief-gate and write-authorization on a temporary repository (plan 03-52)', () => {
  const state: { fx?: ExitFixture } = {};
  before(
    () => {
      state.fx = makeExitFixture();
    },
    { timeout: 120_000 },
  );
  after(() => {
    if (state.fx !== undefined) {
      state.fx.repo.dispose();
      rmSync(state.fx.dir, { recursive: true, force: true });
    }
  });
  const fx = (): ExitFixture => state.fx as ExitFixture;
  const writeClassification = (name: string, mutate: (c: Json) => void = () => undefined): string => {
    const path = join(fx().dir, name);
    writeFileSync(path, `${JSON.stringify(classifiedCopy(fx().all, mutate), null, 2)}\n`);
    return path;
  };
  const dropBanner2 = (c: Json): void => void ((briefsOf(c)['run1'] as Json)['findings'] as Json[]).splice(1, 1);
  const gateArgs = (cls: string): string[] => ['brief-gate', '--classification', cls, '--source', fx().repo.path, '--pin', fx().repo.head];

  it('brief-gate exits 1 on a dropped finding and prints one FAIL line for it; the repository is as it was', () => {
    const before = repoState(fx().repo.path);
    const failed = runTools(gateArgs(writeClassification('dropped.json', dropBanner2)));
    assert.equal(failed.status, 1, failed.stderr + failed.stdout);
    assert.match(failed.stdout, /^brief-gate: FAIL run1: src\/other\/Banner\.ts:2 COPY_FALLBACK: .*D-31/m);
    assert.equal(failed.stdout.split('\n').filter((l) => l.startsWith('brief-gate: FAIL')).length, 1);
    assert.equal(repoState(fx().repo.path), before);
  });

  it('brief-gate exits 0 and prints pass with the number of findings classified once every finding is classified; the repository is as it was', () => {
    const before = repoState(fx().repo.path);
    const passed = runTools(gateArgs(writeClassification('complete.json')));
    assert.equal(passed.status, 0, passed.stderr + passed.stdout);
    assert.match(passed.stdout, /^brief-gate: pass.*6 finding/m);
    assert.equal(repoState(fx().repo.path), before);
  });

  it('brief-gate fails the forged file: a protected finding marked changed and unprotected', () => {
    const forged = writeClassification('forged.json', (c) => void Object.assign(findingAt(c, 'run1', 'tests/e2e/copy-email.spec.ts', 5), { classification: 'changed', protected: false, problem: false, insideConventions: true }));
    const failed = runTools(gateArgs(forged));
    assert.equal(failed.status, 1, failed.stderr + failed.stdout);
    assert.match(failed.stdout, /^brief-gate: FAIL run1: tests\/e2e\/copy-email\.spec\.ts:5 COPY_FALLBACK: .*protected/m);
  });

  it('brief-gate exits 2 without --classification or on a file that is not a classification', () => {
    assert.equal(runTools(['brief-gate', '--source', fx().repo.path]).status, 2);
    const junk = join(fx().dir, 'junk.json');
    writeFileSync(junk, '[]');
    assert.equal(runTools(gateArgs(junk)).status, 2);
  });

  const authArgs = (cls: string, out: string, over: Record<string, string> = {}): string[] => {
    const v: Record<string, string> = { cap: '4.5', ceiling: '25', 'claude-bin': '/nonexistent/claude', 'claude-version': '2.1.319', 'decision-ref': 'STATE.md D-28 approval', 'owner-confirmed-at': CONFIRMED_AT, ...over };
    return [
      'write-authorization',
      '--classification', cls,
      '--brief', fx().run2, '--run', 'run-b', '--expects', 'amend-stale',
      '--brief', fx().run1, '--run', 'run-a', '--expects', 'block-resume',
      ...Object.entries(v).flatMap(([k, x]) => [`--${k}`, x]),
      '--out', out,
      '--source', fx().repo.path,
      '--pin', fx().repo.head,
    ];
  };
  const env = { ...process.env, AVARICE_PHASE3_PLAN: '03-52' };

  it('write-authorization exits 2 and writes nothing while the gate fails', () => {
    const out = join(fx().dir, 'auth-gate-fail.json');
    const ran = runTools(authArgs(writeClassification('dropped2.json', dropBanner2), out), env);
    assert.equal(ran.status, 2, ran.stderr + ran.stdout);
    assert.match(ran.stdout + ran.stderr, /brief-gate: FAIL run1: src\/other\/Banner\.ts:2/);
    assert.equal(existsSync(out), false);
  });

  it('write-authorization exits 2 and writes nothing for a cap above 4.50, a ceiling above 25, an empty decision reference and an owner time that is early or not a time', () => {
    const cls = writeClassification('complete2.json');
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ cap: '4.95' }, /D-33/],
      [{ ceiling: '30' }, /D-05/],
      [{ 'decision-ref': '' }, /decision/],
      [{ 'owner-confirmed-at': '2026-11-10T11:59:59.000Z' }, /owner-confirmed-at/],
      [{ 'owner-confirmed-at': 'yesterday' }, /owner-confirmed-at/],
    ];
    for (const [over, pattern] of cases) {
      const out = join(fx().dir, `auth-refused-${Object.keys(over)[0]}.json`);
      const ran = runTools(authArgs(cls, out, over), env);
      assert.equal(ran.status, 2, `${JSON.stringify(over)}: ${ran.stderr}${ran.stdout}`);
      assert.match(ran.stdout + ran.stderr, pattern, JSON.stringify(over));
      assert.equal(existsSync(out), false, JSON.stringify(over));
    }
  });

  it('write-authorization writes the approval once the gate passes: the fields, the order of the briefs, the cap flag and the digest of the classification file', () => {
    const cls = writeClassification('complete3.json');
    const out = join(fx().dir, 'auth-ok.json');
    const before = repoState(fx().repo.path);
    const ran = runTools(authArgs(cls, out), env);
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const file = JSON.parse(readFileSync(out, 'utf8')) as Json;
    assert.deepEqual(Object.keys(file), ['selection', 'exitRules', 'decisionRef', 'briefs', 'order', 'perRunCapUsd', 'perRunCapFlag', 'ceilingUsd', 'host', 'briefCheck', 'ownerConfirmedAt', 'plan']);
    assert.equal(file['selection'], 'approve');
    assert.equal(file['exitRules'], 'D-26..D-35');
    assert.equal(file['decisionRef'], 'STATE.md D-28 approval');
    const digests = (key: string): unknown => (briefsOf(fx().all)[key] as Json)['digest'];
    assert.deepEqual(file['briefs'], [
      { path: relative(ROOT, fx().run2), digest: digests('run2'), run: 'run-b', expects: 'amend-stale' },
      { path: relative(ROOT, fx().run1), digest: digests('run1'), run: 'run-a', expects: 'block-resume' },
    ]);
    assert.deepEqual(file['order'], ['run-b', 'run-a']);
    assert.equal(file['perRunCapUsd'], 4.5);
    assert.equal(file['perRunCapFlag'], '--budget costUsdPerRun=4.5');
    assert.equal(file['ceilingUsd'], 25);
    assert.deepEqual(file['host'], { claudeBin: '/nonexistent/claude', claudeVersion: '2.1.319' });
    const check = file['briefCheck'] as Json;
    assert.equal(resolve(ROOT, String(check['path'])), cls);
    assert.equal(check['sha256'], sha256Of(cls));
    assert.equal(check['checkedAt'], CHECKED_AT);
    assert.equal(file['ownerConfirmedAt'], CONFIRMED_AT);
    assert.equal(file['plan'], '03-52');
    assert.equal(repoState(fx().repo.path), before);
  });
});

// D-28 (plan 03-52): only a fresh approval authorizes a start. The authorization `write-authorization` wrote after the D-31 gate is the only file the tools read as one;
// the in-place selections of plan 03-49 and every file without `exitRules: D-26..D-35` are refused, whatever else they hold.
describe('authorization: only a fresh approval authorizes a start (plan 03-52, D-28)', () => {
  const state: { fx?: ExitFixture; auth?: string; bin?: string } = {};
  before(
    () => {
      const fx = makeExitFixture();
      state.fx = fx;
      const cls = join(fx.dir, 'classification.json');
      writeFileSync(cls, `${JSON.stringify(classifiedCopy(fx.all), null, 2)}\n`);
      state.bin = writeExecutable(join(fx.dir, 'claude'), '#!/bin/sh\necho "2.1.319 (Claude Code)"\n');
      const auth = join(fx.dir, 'fresh-auth.json');
      const ran = runTools(['write-authorization', '--classification', cls, '--brief', fx.run2, '--run', 'run-b', '--expects', 'amend-stale', '--brief', fx.run1, '--run', 'run-a', '--expects', 'block-resume', '--cap', '4.5', '--ceiling', '25', '--claude-bin', state.bin, '--claude-version', '2.1.319', '--decision-ref', 'STATE.md D-28 approval', '--owner-confirmed-at', CONFIRMED_AT, '--out', auth, '--source', fx.repo.path, '--pin', fx.repo.head]);
      assert.equal(ran.status, 0, ran.stderr + ran.stdout);
      state.auth = auth;
    },
    { timeout: 120_000 },
  );
  after(() => {
    if (state.fx !== undefined) {
      state.fx.repo.dispose();
      rmSync(state.fx.dir, { recursive: true, force: true });
    }
  });
  const fx = (): ExitFixture => state.fx as ExitFixture;
  const mutated = (name: string, edit: (a: Json) => void): string => {
    const body = JSON.parse(readFileSync(state.auth as string, 'utf8')) as Json;
    edit(body);
    const path = join(fx().dir, name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  const field = (auth: string, pick = 'perRunCapUsd'): { status: number | null; stdout: string; stderr: string } => runTools(['field', '--authorization-file', auth, '--pick', pick]);

  it('accepts the file write-authorization produced: field prints the cap, and the Authorization value carries the order, the runs and the classification path', () => {
    const run = field(state.auth as string);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '4.5');
    assert.equal(field(state.auth as string, 'ceilingUsd').stdout.trim(), '25');
    const parsed = exitTools.authorizationOf(state.auth as string);
    assert.equal(typeof parsed, 'object', String(parsed));
    const auth = parsed as unknown as { order: string[]; briefs: Json[]; briefCheckPath: string; perRunCapUsd: number; claudeBin: string };
    assert.deepEqual(auth.order, ['run-b', 'run-a']);
    assert.deepEqual(auth.briefs.map((b) => [b['run'], b['expects']]), [['run-b', 'amend-stale'], ['run-a', 'block-resume']]);
    assert.equal(resolve(ROOT, auth.briefCheckPath), join(fx().dir, 'classification.json'));
    assert.equal(auth.perRunCapUsd, 4.5);
    assert.equal(auth.claudeBin, state.bin);
  });

  const refusals: Array<[string, (a: Json) => void, RegExp]> = [
    ['selection answer-2-in-place', (a) => void (a['selection'] = 'answer-2-in-place'), /D-28/],
    ['selection amend-unprotected-path', (a) => void (a['selection'] = 'amend-unprotected-path'), /D-28/],
    ['selection stop', (a) => void (a['selection'] = 'stop'), /the authorization selection is/],
    ['selection new-conventions-new-run', (a) => void (a['selection'] = 'new-conventions-new-run'), /the authorization selection is/],
    ['selection empty', (a) => void (a['selection'] = ''), /the authorization selection is/],
    ['approve without exitRules', (a) => void delete a['exitRules'], /D-28/],
    ['approve with other exitRules', (a) => void (a['exitRules'] = 'D-26..D-34'), /D-28/],
    ['a briefCheck file that is missing', (a) => void ((a['briefCheck'] as Json)['path'] = '/nonexistent/classification.json'), /D-28/],
    ['a briefCheck sha256 that does not match the file', (a) => void ((a['briefCheck'] as Json)['sha256'] = '0'.repeat(64)), /D-28/],
    ['a per-run cap of 4.95', (a) => void (a['perRunCapUsd'] = 4.95), /D-33/],
    ['a ceiling of 30', (a) => void (a['ceilingUsd'] = 30), /D-33/],
    ['an ownerConfirmedAt that is not an ISO time', (a) => void (a['ownerConfirmedAt'] = 'tomorrow'), /D-28/],
    ['an ownerConfirmedAt before the classification was checked', (a) => void (a['ownerConfirmedAt'] = '2026-11-10T11:00:00.000Z'), /D-28/],
    ['an order that lacks a run of the briefs', (a) => void (a['order'] = ['run-b']), /D-28/],
    ['an order that names a run twice', (a) => void (a['order'] = ['run-b', 'run-b']), /D-28/],
  ];
  for (const [name, edit, pattern] of refusals) {
    it(`refuses an authorization with ${name}, exit 2`, () => {
      const run = field(mutated(`refused-${name.replace(/\W+/g, '-')}.json`, edit));
      assert.equal(run.status, 2, run.stdout + run.stderr);
      assert.match(run.stderr, pattern);
    });
  }

  it('refuses every authorization file of plans 03-28 to 03-49 and the 03-49 answer-2-in-place file in particular; they stay on disk as history', () => {
    const phaseDir = join(ROOT, '.planning', 'phases', '03-decisions-independent-work-and-amendments');
    const older = readdirSync(phaseDir).filter((f) => /^03-(2[89]|3\d|4\d)-exit-authorization\.json$/.test(f));
    assert.ok(older.includes('03-49-exit-authorization.json'), older.join(', '));
    for (const file of older) {
      const run = field(join(phaseDir, file));
      assert.equal(run.status, 2, `${file}: ${run.stdout}${run.stderr}`);
    }
  });

  describe('authorize runs the gate for the brief it is about to start (D-31)', () => {
    const authorizeEnv = (): NodeJS.ProcessEnv => {
      const env: NodeJS.ProcessEnv = { ...process.env, AVARICE_CLAUDE_BIN: state.bin as string, AVARICE_PHASE3_LEDGER: join(fx().dir, 'ledger.jsonl') };
      delete env['AVARICE_LIVE_ADMIT_CLAUDE_VERSION'];
      return env;
    };
    const authorizeArgs = (auth: string, brief: string, evidence: string): string[] => ['authorize', '--authorization-file', auth, '--brief', brief, '--repo', fx().repo.path, '--config', CONFIG_DRAFT, '--evidence', evidence, '--pin', fx().repo.head];
    const digestOf = (key: string): string => String((briefsOf(fx().all)[key] as Json)['digest']);
    // An authorization built by hand over a classification file that leaves a finding of run 1 out: the gate, not the authorization, must catch it.
    const forgedAuthorization = (name: string, runKey: 'run1' | 'run2'): string => {
      const cls = join(fx().dir, `${name}-classification.json`);
      writeFileSync(cls, `${JSON.stringify(classifiedCopy(fx().all, (c) => void ((briefsOf(c)['run1'] as Json)['findings'] as Json[]).splice(1, 1)), null, 2)}\n`);
      const dir = join(fx().dir, name);
      mkdirSync(dir, { recursive: true });
      return writeFreshAuthorization(dir, {
        briefs: [{ path: relative(ROOT, runKey === 'run1' ? fx().run1 : fx().run2), digest: digestOf(runKey), run: 'run-a', expects: 'x' }],
        order: ['run-a'],
        briefCheck: { path: cls, sha256: sha256Of(cls), checkedAt: CHECKED_AT },
        host: { claudeBin: state.bin, claudeVersion: '2.1.319' },
      });
    };

    it('exits 2 and starts nothing when a finding of that brief is unclassified, naming the finding', () => {
      const evidence = join(fx().dir, 'evidence-gate-fail.json');
      const ran = runTools(authorizeArgs(forgedAuthorization('forged-run1', 'run1'), fx().run1, evidence), authorizeEnv());
      assert.equal(ran.status, 2, ran.stderr + ran.stdout);
      assert.match(ran.stderr, /D-31/);
      assert.match(ran.stderr, /src\/other\/Banner\.ts:2 COPY_FALLBACK/);
      assert.equal(existsSync(evidence), false);
      assert.doesNotMatch(ran.stdout, /authorized:/);
    });

    it('does not refuse another brief for a finding of this one: only the brief about to start is judged', () => {
      const evidence = join(fx().dir, 'evidence-gate-other.json');
      const ran = runTools(authorizeArgs(forgedAuthorization('forged-run2', 'run2'), fx().run2, evidence), authorizeEnv());
      assert.doesNotMatch(ran.stderr, /D-31/, ran.stderr + ran.stdout);
    });

    it('passes the gate for a fully classified brief and reaches the spend guard', () => {
      const evidence = join(fx().dir, 'evidence-gate-pass.json');
      const ran = runTools(authorizeArgs(state.auth as string, fx().run1, evidence), authorizeEnv());
      assert.doesNotMatch(ran.stderr, /D-31/, ran.stderr + ran.stdout);
      assert.equal(ran.status, 0, ran.stderr + ran.stdout);
      assert.match(ran.stdout, /authorized: /);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-53: the attempts of each run, Claude's classification of a stop and the owner's ruling, and the rule that decides whether authorize starts another attempt
// (D-26, D-27, D-29, D-33). The new exports are read through casts so a missing one fails its own case and not the loading of the file.
// ---------------------------------------------------------------------------------------------------------------

const minute53 = (n: number): string => new Date(Date.UTC(2026, 10, 10, 12, n)).toISOString();
const AUTH53 = {
  perRunCapUsd: 4.5,
  ceilingUsd: 25,
  claudeBin: '/nonexistent/claude',
  claudeVersion: '2.1.319',
  briefs: [
    { path: 'b2.md', digest: 'sha256:run2', run: 'run2', expects: 'amend-stale' },
    { path: 'b3.md', digest: 'sha256:run3', run: 'run3', expects: 'block-resume' },
    { path: 'b1.md', digest: 'sha256:run1', run: 'run1', expects: 'park' },
  ] as Json[],
  order: ['run2', 'run3', 'run1'],
  briefCheckPath: 'classification.json',
};
type Refusal53 = { code: number; text: string } | undefined;
const refusalOf = (evidence: Json | undefined, role: string, states: Record<string, string | undefined> = {}, auth = AUTH53): Refusal53 =>
  (exitTools as unknown as { startRefusal: (e: Json | undefined, a: typeof AUTH53, r: string, read: (id: string) => string | undefined) => Refusal53 }).startRefusal(evidence, auth, role, (id) => states[id]);
// One entry of an evidence file: the run's role, its attempt number, when it started, and what became of it.
const attempt53 = (run: string, n: number, startMinute: number, over: Json = {}): Json => ({ runId: `run_${run}_${n}`, run, attempt: n, briefDigest: `sha256:${run}`, startedAt: minute53(startMinute), atPause: { at: minute53(startMinute) }, stopOk: true, ...over });
const failed53 = (run: string, n: number, startMinute: number, over: Json = {}): Json => attempt53(run, n, startMinute, { finishedAt: minute53(startMinute + 3), passed: false, ...over });
const passed53 = (run: string, n: number, startMinute: number, over: Json = {}): Json => attempt53(run, n, startMinute, { finishedAt: minute53(startMinute + 3), passed: true, ...over });
const ruled53 = (cls: string, atMinute: number, over: Json = {}): Json => ({
  proposed: { by: 'claude', class: cls, stoppedBy: 'G2:gsd-verification', at: ['tests/e2e/x.spec.ts:5'], docsSystem: { conformant: true, ref: 'docs/system/checks-and-evidence.md' }, summary: 'the run stopped', proposedAt: minute53(atMinute - 1) },
  confirmed: { by: 'owner', class: cls, ref: 'owner reply', at: minute53(atMinute) },
  ...over,
});
const evidence53 = (...runs: Json[]): Json => ({ schema: 1, plan: '03-53', runs });

describe('exit evidence: the identity of an attempt is its run and its number (plan 03-53)', () => {
  const attemptFor = (digest: string, runs: Json[], runId = 'run_new'): Json | undefined =>
    (exitTools as unknown as { attemptFor: (a: typeof AUTH53, d: string, r: Json[], id: string) => Json | undefined }).attemptFor(AUTH53, digest, runs, runId);

  it('names the role and the expectation the authorization gives the brief digest, as attempt 1 on an empty file', () => {
    assert.deepEqual(attemptFor('sha256:run3', []), { run: 'run3', attempt: 1, expects: 'block-resume' });
  });

  it('counts the earlier entries of the same role, whatever their digest, and no entry of another role', () => {
    const runs = [failed53('run3', 1, 1, { briefDigest: 'sha256:an-older-draft' }), failed53('run2', 1, 2)];
    assert.deepEqual(attemptFor('sha256:run3', runs), { run: 'run3', attempt: 2, expects: 'block-resume' });
    assert.deepEqual(attemptFor('sha256:run1', runs), { run: 'run1', attempt: 1, expects: 'park' });
  });

  it('keeps the number of an entry the same run ID already holds when it is judged again', () => {
    const runs = [failed53('run3', 1, 1), attempt53('run3', 2, 5, { runId: 'run_new' })];
    assert.deepEqual(attemptFor('sha256:run3', runs, 'run_new'), { run: 'run3', attempt: 2, expects: 'block-resume' });
  });

  it('returns nothing for a digest the authorization does not name', () => {
    assert.equal(attemptFor('sha256:unknown', []), undefined);
  });

  it('evidence --stage start exits 2 and writes nothing when the brief maps to no entry of the authorization', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-start-unknown-'));
    try {
      const auth = writeFreshAuthorization(dir);
      const empty = join(dir, 'empty.json');
      writeFileSync(empty, '{}');
      const evidence = join(dir, 'evidence.json');
      const ran = runTools(['evidence', '--stage', 'start', '--run-id', 'run_X', '--brief', join(dir, 'missing.md'), '--repo', dir, '--authorization-file', auth, '--out', evidence, '--before', empty, '--after', empty]);
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, /not one of the briefs the owner approved/);
      assert.equal(existsSync(evidence), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("exit evidence: classify records Claude's proposal and the owner's ruling in one entry (plan 03-53; D-26, D-27)", () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  type WithClassification = (f: Json, id: string, p: Json) => Json | undefined;
  const withClassification = (f: Json, id: string, p: Json): Json | undefined => (exitTools as unknown as { withClassification: WithClassification }).withClassification(f, id, p);
  const makeFile = (): { dir: string; file: string; body: Json } => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-classify-'));
    dirs.push(dir);
    const body: Json = {
      schema: 1,
      plan: '03-53',
      exitRules: 'D-26..D-35',
      updatedAt: '2026-11-10T22:51:22Z',
      runs: [failed53('run2', 1, 1, { runId: 'run_AAAA' }), passed53('run3', 1, 6, { runId: 'run_PASS' }), failed53('run1', 1, 11, { runId: 'run_CCCC' })],
      supersedes: { file: '03-45-evidence-exit.json', runId: 'run_OLD' },
    };
    const file = join(dir, 'evidence.json');
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    return { dir, file, body };
  };
  const propose = (file: string, over: string[] = []): string[] => [
    'classify', '--evidence', file, '--run-id', 'run_AAAA', '--propose', '--class', 'brief-harness-defect', '--stopped-by', 'G2:gsd-verification', '--at', 'tests/e2e/x.spec.ts:5', '--at', 'src/a.ts:12',
    '--docs-system', 'conformant', '--docs-ref', 'docs/system/checks-and-evidence.md', '--summary', 'the brief asked for a file the contract protects', '--by', 'claude', ...over,
  ];
  // The argument list without one valued flag (every occurrence), and with another given in its place.
  const dropped = (args: string[], flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag) i += 1;
      else out.push(args[i] as string);
    }
    return out;
  };
  const swapped = (args: string[], flag: string, value: string): string[] => [...dropped(args, flag), flag, value];
  const confirm = (file: string, over: string[] = []): string[] => ['classify', '--evidence', file, '--run-id', 'run_AAAA', '--confirm', '--by', 'owner', '--ref', 'owner reply 2026-11-10 12:30', ...over];
  const read = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;
  const runsOf = (file: string): Json[] => read(file)['runs'] as Json[];

  it('withClassification sets the patch on the named run and changes nothing else; an unknown run has no entry', () => {
    const { body } = makeFile();
    const patch = { proposed: ruled53('product-defect', 20)['proposed'] as Json };
    const next = withClassification(body, 'run_AAAA', patch) as Json;
    const runs = next['runs'] as Json[];
    assert.deepEqual((runs[0]?.['classification'] as Json)['proposed'], patch.proposed);
    assert.deepEqual({ ...runs[0], classification: undefined }, { ...(body['runs'] as Json[])[0], classification: undefined });
    assert.deepEqual(runs.slice(1), (body['runs'] as Json[]).slice(1));
    assert.deepEqual({ ...next, runs: undefined }, { ...body, runs: undefined });
    assert.equal(withClassification(body, 'run_ZZZZ', patch), undefined);
  });

  it('--propose writes classification.proposed into that entry only, with the evidence Claude gives, and every other byte of the file is as it was', () => {
    const { file, body } = makeFile();
    const ran = runTools(propose(file));
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const written = read(file);
    const entry = (written['runs'] as Json[])[0] as Json;
    const proposed = (entry['classification'] as Json)['proposed'] as Json;
    assert.deepEqual(Object.keys(proposed).sort(), ['at', 'by', 'class', 'docsSystem', 'proposedAt', 'stoppedBy', 'summary']);
    assert.equal(proposed['by'], 'claude');
    assert.equal(proposed['class'], 'brief-harness-defect');
    assert.equal(proposed['stoppedBy'], 'G2:gsd-verification');
    assert.deepEqual(proposed['at'], ['tests/e2e/x.spec.ts:5', 'src/a.ts:12']);
    assert.deepEqual(proposed['docsSystem'], { conformant: true, ref: 'docs/system/checks-and-evidence.md' });
    assert.equal(proposed['summary'], 'the brief asked for a file the contract protects');
    assert.match(String(proposed['proposedAt']), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    assert.equal('confirmed' in (entry['classification'] as Json), false);
    assert.deepEqual({ ...entry, classification: undefined }, { ...(body['runs'] as Json[])[0], classification: undefined });
    assert.deepEqual((written['runs'] as Json[]).slice(1), (body['runs'] as Json[]).slice(1));
    assert.deepEqual({ ...written, runs: undefined }, { ...body, runs: undefined });
  });

  it('--propose records a nonconformant finding of docs/system when Claude says so', () => {
    const { file } = makeFile();
    const ran = runTools(swapped(propose(file), '--docs-system', 'nonconformant'));
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    assert.deepEqual((((runsOf(file)[0] as Json)['classification'] as Json)['proposed'] as Json)['docsSystem'], { conformant: false, ref: 'docs/system/checks-and-evidence.md' });
  });

  it('--confirm writes classification.confirmed with the proposed class, the owner and the reference, and keeps the proposal', () => {
    const { file } = makeFile();
    assert.equal(runTools(propose(file)).status, 0);
    const ran = runTools(confirm(file));
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const classification = (runsOf(file)[0] as Json)['classification'] as Json;
    const confirmed = classification['confirmed'] as Json;
    assert.deepEqual(Object.keys(confirmed).sort(), ['at', 'by', 'class', 'ref']);
    assert.equal(confirmed['by'], 'owner');
    assert.equal(confirmed['class'], 'brief-harness-defect');
    assert.equal(confirmed['ref'], 'owner reply 2026-11-10 12:30');
    assert.match(String(confirmed['at']), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    assert.equal((classification['proposed'] as Json)['class'], 'brief-harness-defect');
  });

  it('--confirm --class overrides the proposed class and names the class it overrides', () => {
    const { file } = makeFile();
    assert.equal(runTools(propose(file)).status, 0);
    const ran = runTools(confirm(file, ['--class', 'product-defect']));
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const confirmed = ((runsOf(file)[0] as Json)['classification'] as Json)['confirmed'] as Json;
    assert.equal(confirmed['class'], 'product-defect');
    assert.equal(confirmed['overrides'], 'brief-harness-defect');
  });

  const proposalRefusals: Array<[string, (args: string[]) => string[], RegExp]> = [
    ['a passed entry', (a) => swapped(a, '--run-id', 'run_PASS'), /passed/],
    ['an unknown run ID', (a) => swapped(a, '--run-id', 'run_ZZZZ'), /no entry/],
    ['a class other than the two', (a) => swapped(a, '--class', 'flaky'), /product-defect|brief-harness-defect/],
    ['no --at', (a) => dropped(a, '--at'), /--at/],
    ['an --at that is not path:line', (a) => swapped(a, '--at', 'tests/e2e/x.spec.ts'), /<path>:<line>/],
    ['an --at with a line that is not a number', (a) => swapped(a, '--at', 'tests/e2e/x.spec.ts:five'), /<path>:<line>/],
    ['a docs-ref outside docs/system/', (a) => swapped(a, '--docs-ref', 'docs/requirements.md'), /docs\/system/],
    ['a docs-ref that climbs out of docs/system/', (a) => swapped(a, '--docs-ref', 'docs/system/../requirements.md'), /docs\/system/],
    ['a --by that is not claude', (a) => swapped(a, '--by', 'owner'), /claude/],
    ['no --stopped-by', (a) => dropped(a, '--stopped-by'), /--stopped-by/],
    ['no --summary', (a) => dropped(a, '--summary'), /--summary/],
    ['a --docs-system that is neither conformant nor nonconformant', (a) => swapped(a, '--docs-system', 'maybe'), /conformant/],
  ];
  for (const [name, edit, pattern] of proposalRefusals) {
    it(`--propose exits 2 and leaves the file byte-identical for ${name}`, () => {
      const { file } = makeFile();
      const before = sha256Of(file);
      const ran = runTools(edit(propose(file)));
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, pattern);
      assert.equal(sha256Of(file), before);
    });
  }

  const confirmationRefusals: Array<[string, (args: string[]) => string[], RegExp]> = [
    ['a passed entry', (a) => swapped(a, '--run-id', 'run_PASS'), /passed/],
    ['an unknown run ID', (a) => swapped(a, '--run-id', 'run_ZZZZ'), /no entry/],
    ['a --by that is not owner', (a) => swapped(a, '--by', 'claude'), /owner/],
    ['no --ref', (a) => dropped(a, '--ref'), /--ref/],
    ['a class other than the two', (a) => [...a, '--class', 'flaky'], /product-defect|brief-harness-defect/],
  ];
  for (const [name, edit, pattern] of confirmationRefusals) {
    it(`--confirm exits 2 and leaves the file byte-identical for ${name}`, () => {
      const { file } = makeFile();
      assert.equal(runTools(propose(file)).status, 0);
      const before = sha256Of(file);
      const ran = runTools(edit(confirm(file)));
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, pattern);
      assert.equal(sha256Of(file), before);
    });
  }

  it('--confirm with no proposal exits 2 and leaves the file byte-identical', () => {
    const { file } = makeFile();
    const before = sha256Of(file);
    const ran = runTools(confirm(file));
    assert.equal(ran.status, 2, ran.stdout + ran.stderr);
    assert.match(ran.stderr, /no proposal/);
    assert.equal(sha256Of(file), before);
  });

  it('an entry the owner already ruled on takes neither a second proposal nor a second confirmation', () => {
    const { file } = makeFile();
    assert.equal(runTools(propose(file)).status, 0);
    assert.equal(runTools(confirm(file)).status, 0);
    const before = sha256Of(file);
    for (const args of [swapped(propose(file), '--class', 'product-defect'), confirm(file, ['--class', 'product-defect'])]) {
      const ran = runTools(args);
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, /already/);
    }
    assert.equal(sha256Of(file), before);
  });

  it('exactly one of --propose and --confirm is required', () => {
    const { file } = makeFile();
    const before = sha256Of(file);
    const neither = runTools(propose(file).filter((w) => w !== '--propose'));
    assert.equal(neither.status, 2, neither.stdout + neither.stderr);
    const both = runTools([...propose(file), '--confirm']);
    assert.equal(both.status, 2, both.stdout + both.stderr);
    assert.equal(sha256Of(file), before);
  });
});

describe("exit evidence: startRefusal admits one re-run of a stopped attempt, and only on the owner's ruling (plan 03-53; D-26, D-27, D-34)", () => {
  it('admits the first attempt of the first run in the order on an empty file, and on no file', () => {
    assert.equal(refusalOf(evidence53(), 'run2'), undefined);
    assert.equal(refusalOf(undefined, 'run2'), undefined);
  });

  it('refuses a role the authorization does not order', () => {
    const refused = refusalOf(evidence53(), 'run9');
    assert.equal(refused?.code, 2);
    assert.match(refused?.text ?? '', /run9/);
  });

  it('refuses the second attempt of run2 until the owner confirmed the first as a brief/harness defect', () => {
    const stopped = failed53('run2', 1, 1);
    const refused = refusalOf(evidence53(stopped), 'run2');
    assert.equal(refused?.code, 2);
    assert.match(refused?.text ?? '', /run2's previous attempt has no owner-confirmed classification/);

    const proposedOnly = failed53('run2', 1, 1, { classification: { proposed: ruled53('brief-harness-defect', 5)['proposed'] as Json } });
    assert.match(refusalOf(evidence53(proposedOnly), 'run2')?.text ?? '', /has no owner-confirmed classification/, "Claude's proposal alone admits nothing");
  });

  it("refuses while the previous attempt's run is open in the owner's ledger, naming the state, and admits it once cancelled, failed or closed", () => {
    const stopped = failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) });
    const file = evidence53(stopped);
    const open = refusalOf(file, 'run2', { run_run2_1: 'blocked_on_decision' });
    assert.equal(open?.code, 2);
    assert.match(open?.text ?? '', /is blocked_on_decision; the owner cancels it first/);
    assert.match(refusalOf(file, 'run2', {})?.text ?? '', /cannot be read from the owner's ledger/);
    for (const terminal of ['cancelled', 'failed', 'closed']) assert.equal(refusalOf(file, 'run2', { run_run2_1: terminal }), undefined, terminal);
  });

  it("admits a run after an attempt the owner confirmed as a product defect: the confirmation starts a new epoch, so the run's earlier attempt no longer blocks it", () => {
    const stopped = failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) });
    assert.equal(refusalOf(evidence53(stopped), 'run2', { run_run2_1: 'cancelled' }), undefined);
  });
});
