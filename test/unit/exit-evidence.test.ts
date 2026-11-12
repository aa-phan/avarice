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

describe('exit-run-phase3.sh: the default evidence file of the replanned exit (plan 03-54; plans 03-41 and 03-44 introduced the variable)', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'exit-run-phase3.sh'), 'utf8');
  it('defaults to 03-57-evidence-exit.json and plan 03-57; 03-29, 03-42, 03-45 and 03-48 are named only as history in the header', () => {
    assert.match(script, /^EVID_DEFAULT=.*03-57-evidence-exit\.json"$/m);
    assert.match(script, /^\s*export AVARICE_PHASE3_PLAN="\$\{AVARICE_PHASE3_PLAN:-03-57\}"$/m);
    const lines = script.split('\n');
    for (const history of ['03-29-evidence-exit.json', '03-42-evidence-exit.json', '03-45-evidence-exit.json', '03-48-evidence-exit.json']) {
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
// conventions) and a protected e2e spec that asserts its value on line 5; plus two briefs that compile against it (the run 1 brief as plan 03-52 knew it, and a
// copy). The brief is the frozen copy test/fixtures/exit-gate-run1-brief.md, not the live brief: plan 03-55 redrafted the live one (D-32), and these cases
// need the fixture to keep exactly the three findings below.
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
  const text = readFileSync(join(ROOT, 'test', 'fixtures', 'exit-gate-run1-brief.md'), 'utf8').replace('baseRevision: 9f1cd8d', `baseRevision: ${repo.head.slice(0, 7)}`);
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
      // run1 is the second run of this authorization's order (D-33), so the first run's pass is on record.
      const evidence = join(fx().dir, 'evidence-gate-pass.json');
      writeFileSync(evidence, `${JSON.stringify({ schema: 1, runs: [{ runId: 'run_B1', run: 'run-b', attempt: 1, startedAt: minute53(1), passed: true, finishedAt: minute53(4) }] })}\n`);
      const ran = runTools(authorizeArgs(state.auth as string, fx().run1, evidence), authorizeEnv());
      assert.doesNotMatch(ran.stderr, /D-31/, ran.stderr + ran.stdout);
      assert.equal(ran.status, 0, ran.stderr + ran.stdout);
      assert.match(ran.stdout, /authorized: .*run-a attempt 1/);
    });

    describe('authorize applies startRefusal: the order, the previous attempt and the stop-loss (plan 03-53)', () => {
      const evidenceWith = (name: string, runs: Json[]): { path: string; before: string } => {
        const path = join(fx().dir, name);
        const before = `${JSON.stringify({ schema: 1, runs })}\n`;
        writeFileSync(path, before);
        return { path, before };
      };

      it('exits 2 and starts nothing when the run before it in the order has no recorded outcome (D-33)', () => {
        const { path, before } = evidenceWith('evidence-order.json', []);
        const ran = runTools(authorizeArgs(state.auth as string, fx().run1, path), authorizeEnv());
        assert.equal(ran.status, 2, ran.stderr + ran.stdout);
        assert.match(ran.stderr, /run-a starts only after run-b's outcome is recorded \(D-33\)/);
        assert.doesNotMatch(ran.stdout, /authorized:/);
        assert.equal(readFileSync(path, 'utf8'), before);
      });

      it("exits 75, 'stop and ask the owner', for a run that has failed twice, whatever the digests and the classification (D-29)", () => {
        const stopped = (n: number, digest: string): Json => ({ runId: `run_A${n}`, run: 'run-a', attempt: n, briefDigest: digest, startedAt: minute53(n * 10), passed: false, finishedAt: minute53(n * 10 + 3) });
        const { path, before } = evidenceWith('evidence-stop-loss.json', [stopped(1, 'sha256:an-older-draft'), stopped(2, 'sha256:another-draft')]);
        const ran = runTools(authorizeArgs(state.auth as string, fx().run1, path), authorizeEnv());
        assert.equal(ran.status, 75, ran.stderr + ran.stdout);
        assert.match(ran.stderr, /stop-loss \(D-29\): run-a has failed twice; return to the owner before spending again/);
        assert.doesNotMatch(ran.stdout, /authorized:/);
        assert.equal(readFileSync(path, 'utf8'), before);
      });

      it("exits 2 for a re-run whose previous attempt the owner confirmed but whose run the owner's ledger cannot show over", () => {
        const { path } = evidenceWith('evidence-rerun.json', [{ runId: 'run_B1', run: 'run-b', attempt: 1, startedAt: minute53(1), passed: false, finishedAt: minute53(4), classification: ruled53('brief-harness-defect', 8) }]);
        const ran = runTools(authorizeArgs(state.auth as string, fx().run2, path), authorizeEnv());
        assert.equal(ran.status, 2, ran.stderr + ran.stdout);
        assert.match(ran.stderr, /run-b's previous attempt run_B1 cannot be read from the owner's ledger; the owner cancels it first \(D-34\)/);
      });

      // Plan 03-66 (D-36, D-37, D-39): the tracer from the stop-loss to a recorded reset. Claude proposes with the proofs; only the owner's confirmation lifts the stop.
      describe('a reset lifts the stop-loss of its run only once the owner has confirmed it (plan 03-66)', () => {
        const TEST_FILE = 'test/unit/exit-evidence.test.ts';
        const stoppedB = (n: number, startMinute: number, ruledAt: number): Json => ({
          runId: `run_B${n}`,
          run: 'run-b',
          attempt: n,
          startedAt: minute53(startMinute),
          passed: false,
          finishedAt: minute53(startMinute + 3),
          classification: ruled53('product-defect', ruledAt),
        });
        // The proof files of one scenario each, and the parity report, in the shapes the tools read (D-37).
        const writeProofs = (tag = 'a'): { red: string[]; green: string[]; parity: string } => {
          const command = `node --test --test-reporter=tap ${TEST_FILE}`;
          const red = [1, 2].map((n) => {
            const path = join(fx().dir, `reset-${tag}-red-${n}.json`);
            writeFileSync(path, JSON.stringify({ command, exitCode: 1, output: `TAP version 13\nnot ok 1 - scenario ${n} before its fix\n1..1\n# tests 1\n# pass 0\n# fail 1\n` }));
            return path;
          });
          const green = [1, 2].map((n) => {
            const path = join(fx().dir, `reset-${tag}-green-${n}.json`);
            writeFileSync(path, JSON.stringify({ command, exitCode: 0, output: `TAP version 13\nok 1 - scenario ${n} after its fix\n1..1\n# tests 1\n# pass 1\n# fail 0\n` }));
            return path;
          });
          const parity = join(fx().dir, `reset-${tag}-parity.json`);
          writeFileSync(
            parity,
            JSON.stringify({ schema: 1, plan: '03-65', checkedAt: minute53(20), pin: fx().repo.head, briefs: [{ path: 'run2.md', digest: digestOf('run2') }], spentUsd: 0, modelHostLaunched: false, checkout: { unchanged: true }, mismatches: [], parity: true, problems: [] }),
          );
          return { red, green, parity };
        };
        const proposeArgs = (evidence: string, proofs: { red: string[]; green: string[]; parity: string }): string[] => [
          'reset', '--propose', '--by', 'claude', '--evidence', evidence, '--authorization-file', state.auth as string, '--run', 'run-b', '--parity', proofs.parity, '--pin', fx().repo.head,
          '--defect', 'run_B1', '--test', TEST_FILE, '--red', proofs.red[0] as string, '--green', proofs.green[0] as string,
          '--defect', 'run_B2', '--test', TEST_FILE, '--red', proofs.red[1] as string, '--green', proofs.green[1] as string,
          '--summary', 'both product defects are fixed and proven offline',
        ];

        it('exits 75 for two failed attempts, still after the proposal, and no longer after the owner confirms it: the next rule answers', () => {
          const { path } = evidenceWith('evidence-reset.json', [stoppedB(1, 1, 8), stoppedB(2, 10, 18)]);
          const ask = (): { status: number | null; stdout: string; stderr: string } => runTools(authorizeArgs(state.auth as string, fx().run2, path), authorizeEnv());
          const before = ask();
          assert.equal(before.status, 75, before.stderr + before.stdout);
          assert.match(before.stderr, /stop-loss \(D-29\): run-b has failed twice; return to the owner before spending again/);
          const runsBefore = (JSON.parse(readFileSync(path, 'utf8')) as Json)['runs'];

          const proposed = runTools(proposeArgs(path, writeProofs()));
          assert.equal(proposed.status, 0, proposed.stderr + proposed.stdout);
          assert.match(proposed.stdout, /reset: proposed for run-b/);
          const proposal = ask();
          assert.equal(proposal.status, 75, proposal.stderr + proposal.stdout);

          const confirmed = runTools(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-b', '--ref', 'owner reply at the checkpoint']);
          assert.equal(confirmed.status, 0, confirmed.stderr + confirmed.stdout);
          assert.match(confirmed.stdout, /reset: confirmed for run-b/);
          const after = ask();
          assert.equal(after.status, 2, after.stderr + after.stdout);
          assert.match(after.stderr, /run-b's previous attempt run_B1 cannot be read from the owner's ledger; the owner cancels it first \(D-34\)/);
          assert.doesNotMatch(after.stderr, /stop-loss/);

          const file = JSON.parse(readFileSync(path, 'utf8')) as Json;
          assert.deepEqual(file['runs'], runsBefore);
          const resets = file['resets'] as Json[];
          assert.equal(resets.length, 1);
          assert.equal((resets[0]?.['proposed'] as Json)['by'], 'claude');
          assert.equal((resets[0]?.['confirmed'] as Json)['by'], 'owner');
        });

        // Task 2: every refusal is exit 2 with the evidence file byte-identical.
        describe('refuses, exit 2 and the evidence file byte-identical (D-27, D-36, D-37)', () => {
          const fresh = (name: string): { path: string; before: () => string } => {
            const { path } = evidenceWith(name, [stoppedB(1, 1, 8), stoppedB(2, 10, 18)]);
            return { path, before: () => readFileSync(path, 'utf8') };
          };
          const refused = (args: string[], path: string, pattern: RegExp): void => {
            const before = readFileSync(path, 'utf8');
            const ran = runTools(args);
            assert.equal(ran.status, 2, ran.stderr + ran.stdout);
            assert.match(ran.stderr, pattern);
            assert.equal(readFileSync(path, 'utf8'), before);
          };

          it('a proposal by the owner', () => {
            const { path } = fresh('evidence-reset-by-owner.json');
            const args = proposeArgs(path, writeProofs('by-owner'));
            args[args.indexOf('claude')] = 'owner';
            refused(args, path, /--by must be claude/);
          });

          it('a proposal whose green proof holds a failing test', () => {
            const { path } = fresh('evidence-reset-green-fails.json');
            const proofs = writeProofs('green-fails');
            writeFileSync(proofs.green[1] as string, JSON.stringify({ command: `node --test --test-reporter=tap ${TEST_FILE}`, exitCode: 0, output: 'TAP version 13\nnot ok 1 - still failing\n# tests 1\n# pass 0\n# fail 0\n' }));
            refused(proposeArgs(path, proofs), path, /scenario run_B2: the green proof/);
          });

          it('a proposal with three --defect and two --red', () => {
            const { path } = fresh('evidence-reset-unequal.json');
            const args = [...proposeArgs(path, writeProofs('unequal')), '--defect', 'run_B3'];
            refused(args, path, /the same number of times/);
          });

          it('a proposal for a run that has no failed attempt left to reset', () => {
            const { path } = evidenceWith('evidence-reset-none.json', [stoppedB(1, 1, 8)]);
            const args = proposeArgs(path, writeProofs('none'));
            args[args.indexOf('run-b')] = 'run-a';
            refused(args, path, /nothing to reset/);
          });

          it('a confirmation by claude, with an empty --ref, and for a run with no pending proposal', () => {
            const { path } = fresh('evidence-reset-confirm-refused.json');
            const proposed = runTools(proposeArgs(path, writeProofs('confirm-refused')));
            assert.equal(proposed.status, 0, proposed.stderr + proposed.stdout);
            refused(['reset', '--confirm', '--by', 'claude', '--evidence', path, '--run', 'run-b', '--ref', 'owner reply'], path, /--by must be owner/);
            refused(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-b', '--ref', ''], path, /--ref is required/);
            refused(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-a', '--ref', 'owner reply'], path, /no pending reset proposal/);
          });

          it('a confirmation after a proof file was rewritten since the proposal', () => {
            const { path } = fresh('evidence-reset-rewritten.json');
            const proofs = writeProofs('rewritten');
            const proposed = runTools(proposeArgs(path, proofs));
            assert.equal(proposed.status, 0, proposed.stderr + proposed.stdout);
            writeFileSync(proofs.green[0] as string, JSON.stringify({ command: `node --test --test-reporter=tap ${TEST_FILE}`, exitCode: 0, output: 'TAP version 13\nok 1 - rewritten\n# tests 1\n# pass 1\n# fail 0\n' }));
            refused(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-b', '--ref', 'owner reply'], path, /reset-rewritten-green-1\.json changed since the proposal \(D-37\)/);
          });

          it('a confirmation once the run has no pending proposal because its latest reset is confirmed', () => {
            const { path } = fresh('evidence-reset-twice.json');
            assert.equal(runTools(proposeArgs(path, writeProofs('twice'))).status, 0);
            assert.equal(runTools(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-b', '--ref', 'owner reply']).status, 0);
            refused(['reset', '--confirm', '--by', 'owner', '--evidence', path, '--run', 'run-b', '--ref', 'owner reply again'], path, /no pending reset proposal/);
          });
        });
      });
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

describe('exit evidence: the order 2, 3, 1, the product-defect epoch, the two-failure stop-loss and the run-role invariant (plan 03-53; D-26, D-29, D-33)', () => {
  const epochOf = (evidence: Json): string | null => (exitTools as unknown as { epochOf: (e: Json) => string | null }).epochOf(evidence);
  const CANCELLED_ALL = new Proxy({} as Record<string, string>, { get: () => 'cancelled' });

  describe('the order of the authorization (D-33)', () => {
    it('refuses run3 while run2 has no entry, and while its only entry has no recorded outcome', () => {
      for (const file of [evidence53(), evidence53(attempt53('run2', 1, 1)), evidence53(failed53('run2', 1, 1))]) {
        const refused = refusalOf(file, 'run3');
        assert.equal(refused?.code, 2);
        assert.match(refused?.text ?? '', /run3 starts only after run2's outcome is recorded \(D-33\)/);
      }
    });

    it("admits run3 once run2 passed, or once run2's stop is owner-confirmed as a brief/harness defect", () => {
      assert.equal(refusalOf(evidence53(passed53('run2', 1, 1)), 'run3'), undefined);
      assert.equal(refusalOf(evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) })), 'run3'), undefined);
    });

    it('needs the outcome of the latest attempt of the earlier run, not of its first', () => {
      const file = evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) }), attempt53('run2', 2, 10));
      assert.match(refusalOf(file, 'run3')?.text ?? '', /run3 starts only after run2's outcome is recorded/);
    });

    it('needs the outcomes of both run2 and run3 before run1, naming the first run of the order that lacks one', () => {
      assert.match(refusalOf(evidence53(passed53('run2', 1, 1)), 'run1')?.text ?? '', /run1 starts only after run3's outcome is recorded/);
      assert.match(refusalOf(evidence53(passed53('run3', 1, 1)), 'run1')?.text ?? '', /run1 starts only after run2's outcome is recorded/);
      assert.equal(refusalOf(evidence53(passed53('run2', 1, 1), passed53('run3', 1, 5)), 'run1'), undefined);
    });
  });

  describe('a confirmed product defect starts a new epoch (D-26, T-03-135)', () => {
    it('epochOf is null with no confirmed product defect, a proposal alone and a brief/harness confirmation start none, and the latest confirmation wins', () => {
      assert.equal(epochOf(evidence53()), null);
      assert.equal(epochOf(evidence53(failed53('run2', 1, 1, { classification: { proposed: ruled53('product-defect', 8)['proposed'] as Json } }))), null);
      assert.equal(epochOf(evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) }))), null);
      assert.equal(epochOf(evidence53(failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }))), minute53(8));
      assert.equal(epochOf(evidence53(failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run3', 1, 10, { classification: ruled53('product-defect', 20) }))), minute53(20));
    });

    it('lets a run that passed before the epoch start again, and judges the order again over the entries started after it', () => {
      const file = evidence53(passed53('run2', 1, 1), failed53('run3', 1, 5, { classification: ruled53('product-defect', 20) }));
      assert.equal(refusalOf(file, 'run2', CANCELLED_ALL), undefined, 'run2 passed before the epoch, so it is run again');
      const run3 = refusalOf(file, 'run3', CANCELLED_ALL);
      assert.equal(run3?.code, 2);
      assert.match(run3?.text ?? '', /run3 starts only after run2's outcome is recorded \(D-33\)/, "run2's pass before the epoch satisfies nothing");
      const again = evidence53(passed53('run2', 1, 1), failed53('run3', 1, 5, { classification: ruled53('product-defect', 20) }), passed53('run2', 2, 25));
      assert.equal(refusalOf(again, 'run3', CANCELLED_ALL), undefined, 'run2 passed again after the epoch, and run3 may start its next attempt');
    });

    it('refuses a run that already passed after the epoch, and not one that passed before it', () => {
      const file = evidence53(passed53('run2', 1, 1), failed53('run3', 1, 5, { classification: ruled53('product-defect', 20) }), passed53('run2', 2, 25));
      const refused = refusalOf(file, 'run2', CANCELLED_ALL);
      assert.equal(refused?.code, 2);
      assert.match(refused?.text ?? '', /run2 already passed in this exit; a run is never repeated by hand \(D-03\)/);
    });
  });

  describe('already passed (D-26, D-03)', () => {
    it('refuses a run that passed in the current epoch, whatever its place in the order', () => {
      for (const [role, file] of [
        ['run2', evidence53(passed53('run2', 1, 1))],
        ['run3', evidence53(passed53('run2', 1, 1), passed53('run3', 1, 5))],
        ['run2', evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) }), passed53('run2', 2, 10))],
      ] as Array<[string, Json]>) {
        const refused = refusalOf(file, role, CANCELLED_ALL);
        assert.equal(refused?.code, 2, role);
        assert.equal(refused?.text, `${role} already passed in this exit; a run is never repeated by hand (D-03)`);
      }
    });
  });

  describe('the stop-loss (D-29)', () => {
    const STOP_LOSS = 'stop-loss (D-29): run2 has failed twice; return to the owner before spending again';

    it('refuses with code 75 the third start of a run whose two attempts both failed and were confirmed as brief/harness defects', () => {
      const file = evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('brief-harness-defect', 18) }));
      assert.deepEqual(refusalOf(file, 'run2', CANCELLED_ALL), { code: 75, text: STOP_LOSS });
    });

    it('counts across a product-defect epoch: a failure before it and one after it are two', () => {
      const file = evidence53(failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('brief-harness-defect', 18) }));
      assert.deepEqual(refusalOf(file, 'run2', CANCELLED_ALL), { code: 75, text: STOP_LOSS });
    });

    it('applies whatever the classification, and before the missing-confirmation rule', () => {
      assert.deepEqual(refusalOf(evidence53(failed53('run2', 1, 1), failed53('run2', 2, 10)), 'run2', CANCELLED_ALL), { code: 75, text: STOP_LOSS });
      const stopped = failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) });
      assert.deepEqual(refusalOf(evidence53(stopped, failed53('run2', 2, 10, { classification: ruled53('product-defect', 18) })), 'run2', CANCELLED_ALL), { code: 75, text: STOP_LOSS });
    });

    it('counts failed attempts only: one stop and one attempt still running is not two failures', () => {
      const file = evidence53(failed53('run2', 1, 1, { classification: ruled53('brief-harness-defect', 8) }), attempt53('run2', 2, 10));
      assert.equal(refusalOf(file, 'run2', CANCELLED_ALL)?.code, 2);
    });

    it("counts a run's own failures: another run's two failures do not stop it", () => {
      const file = evidence53(failed53('run3', 1, 1), failed53('run3', 2, 10));
      assert.equal(refusalOf(file, 'run2', CANCELLED_ALL), undefined);
    });
  });

  describe('the run role is the identity, not the brief digest (assumption delta invariant)', () => {
    it('refuses the third start of run1 under a new digest Z after two failures under digests X and Y, by the stop-loss', () => {
      const redrafted = { ...AUTH53, briefs: [...AUTH53.briefs.filter((b) => b['run'] !== 'run1'), { path: 'b1.md', digest: 'sha256:Z', run: 'run1', expects: 'park' }] };
      const file = evidence53(
        passed53('run2', 1, 1),
        passed53('run3', 1, 5),
        failed53('run1', 1, 10, { briefDigest: 'sha256:X', classification: ruled53('brief-harness-defect', 16) }),
        failed53('run1', 2, 18, { briefDigest: 'sha256:Y', classification: ruled53('brief-harness-defect', 24) }),
      );
      const identity = (exitTools as unknown as { attemptFor: (a: typeof AUTH53, d: string, r: Json[], id: string) => { run: string; attempt: number } | undefined }).attemptFor(redrafted, 'sha256:Z', file['runs'] as Json[], '');
      assert.deepEqual(identity && { run: identity.run, attempt: identity.attempt }, { run: 'run1', attempt: 3 });
      const refused = refusalOf(file, identity?.run ?? '', CANCELLED_ALL, redrafted);
      assert.equal(refused?.code, 75);
      assert.match(refused?.text ?? '', /stop-loss \(D-29\): run1 has failed twice/);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-66: the two-failure stop-loss counts within the run's own epoch, and an owner-confirmed reset with D-37's proofs begins a new one (D-29, D-36 to D-39).
// The new exports are read through casts so a missing one fails its own case and not the loading of the file.
// ---------------------------------------------------------------------------------------------------------------

// A valid confirmed reset of one run, as `reset --propose` and then `reset --confirm` write it: one scenario per covered attempt, a clean parity report and the
// owner's confirmation at `confirmMinute`. `over` replaces top-level keys of the record.
const reset66 = (run: string, confirmMinute: number, covers: string[], over: Json = {}): Json => ({
  run,
  covers,
  proposed: {
    by: 'claude',
    at: minute53(confirmMinute - 2),
    summary: 'the fixes hold offline',
    pin: '9f1cd8d',
    scenarios: covers.map((runId) => ({
      runId,
      test: 'test/integration/scenario.test.ts',
      red: { path: `${runId}-red.json`, sha256: `sha256-red-${runId}` },
      green: { path: `${runId}-green.json`, sha256: `sha256-green-${runId}` },
    })),
    parity: { path: 'parity.json', sha256: 'sha256-parity', checkedAt: minute53(confirmMinute - 3), pin: '9f1cd8d', parity: true, problems: [] },
  },
  confirmed: { by: 'owner', ref: 'owner reply', at: minute53(confirmMinute) },
  ...over,
});
const withoutConfirmation = (reset: Json): Json => Object.fromEntries(Object.entries(reset).filter(([key]) => key !== 'confirmed'));
const withProposed = (reset: Json, patch: Json): Json => ({ ...reset, proposed: { ...(reset['proposed'] as Json), ...patch } });
const stopLossEpochOf = (evidence: Json | undefined, role: string): string | null =>
  (exitTools as unknown as { stopLossEpochOf: (e: Json | undefined, r: string) => string | null }).stopLossEpochOf(evidence, role);

describe("exit evidence: the stop-loss counts within the run's epoch, and an owner-confirmed reset begins a new one (plan 03-66; D-29, D-36 to D-39)", () => {
  const CANCELLED_ALL = new Proxy({} as Record<string, string>, { get: () => 'cancelled' });
  const NO_RESET = 'stop-loss (D-29): run2 has failed twice; return to the owner before spending again';
  const SINCE_RESET = (minute: number): string => `stop-loss (D-29, D-36): run2 has failed twice since its reset at ${minute53(minute)}; return to the owner before spending again`;
  const BOTH = ['run_run2_1', 'run_run2_2'];
  // run2's two stops, each ruled a product defect by the owner (minutes 8 and 18).
  const twoProductDefects = (): Json[] => [failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('product-defect', 18) })];
  const withResets = (runs: Json[], resets: Json[]): Json => ({ ...evidence53(...runs), resets });

  it('refuses the third start of a run with two failed attempts and no reset, with the text of plan 03-53 (D-29)', () => {
    assert.deepEqual(refusalOf(evidence53(...twoProductDefects()), 'run2', CANCELLED_ALL), { code: 75, text: NO_RESET });
  });

  it('admits a start after a recorded, owner-confirmed reset of the run (D-39)', () => {
    const file = withResets(twoProductDefects(), [reset66('run2', 30, BOTH)]);
    assert.equal(stopLossEpochOf(file, 'run2'), minute53(30));
    assert.equal(refusalOf(file, 'run2', CANCELLED_ALL), undefined);
  });

  it('admits one failed attempt after the reset, whatever its ruling, and refuses the second with the per-epoch text (D-36, D-39)', () => {
    for (const ruling of ['product-defect', 'brief-harness-defect']) {
      const one = withResets([...twoProductDefects(), failed53('run2', 3, 40, { classification: ruled53(ruling, 48) })], [reset66('run2', 30, BOTH)]);
      assert.equal(refusalOf(one, 'run2', CANCELLED_ALL), undefined, ruling);
    }
    const two = withResets([...twoProductDefects(), failed53('run2', 3, 40, { classification: ruled53('product-defect', 48) }), failed53('run2', 4, 50, { classification: ruled53('brief-harness-defect', 58) })], [reset66('run2', 30, BOTH)]);
    assert.deepEqual(refusalOf(two, 'run2', CANCELLED_ALL), { code: 75, text: SINCE_RESET(30) });
  });

  it('counts an attempt that started exactly at the reset, and never counts one before it again', () => {
    const atTheReset = withResets([...twoProductDefects(), failed53('run2', 3, 30), failed53('run2', 4, 40)], [reset66('run2', 30, BOTH)]);
    assert.deepEqual(refusalOf(atTheReset, 'run2', CANCELLED_ALL), { code: 75, text: SINCE_RESET(30) });
    const justBefore = withResets([...twoProductDefects(), failed53('run2', 3, 29, { classification: ruled53('brief-harness-defect', 30) }), failed53('run2', 4, 40, { classification: ruled53('brief-harness-defect', 48) })], [reset66('run2', 30, BOTH)]);
    assert.equal(refusalOf(justBefore, 'run2', CANCELLED_ALL), undefined);
  });

  it('lifts nothing for a proposal that the owner has not confirmed, and stopLossEpochOf is null for no file, no resets key and an empty list', () => {
    const proposalOnly = withResets(twoProductDefects(), [withoutConfirmation(reset66('run2', 30, BOTH))]);
    assert.equal(stopLossEpochOf(proposalOnly, 'run2'), null);
    assert.deepEqual(refusalOf(proposalOnly, 'run2', CANCELLED_ALL), { code: 75, text: NO_RESET });
    assert.equal(stopLossEpochOf(undefined, 'run2'), null);
    assert.equal(stopLossEpochOf(evidence53(...twoProductDefects()), 'run2'), null);
    assert.equal(stopLossEpochOf(withResets(twoProductDefects(), []), 'run2'), null);
  });

  it("is per run: a reset of run3 leaves run2's two failures at code 75, and a reset of run2 leaves run3's", () => {
    const run3Failures = [failed53('run3', 1, 20, { classification: ruled53('product-defect', 24) }), failed53('run3', 2, 26, { classification: ruled53('product-defect', 32) })];
    const resetOfRun3 = withResets([...twoProductDefects(), ...run3Failures], [reset66('run3', 40, ['run_run3_1', 'run_run3_2'])]);
    assert.equal(stopLossEpochOf(resetOfRun3, 'run3'), minute53(40));
    assert.equal(stopLossEpochOf(resetOfRun3, 'run2'), null);
    assert.deepEqual(refusalOf(resetOfRun3, 'run2', CANCELLED_ALL), { code: 75, text: NO_RESET });
    const resetOfRun2 = withResets([...twoProductDefects(), ...run3Failures], [reset66('run2', 40, BOTH)]);
    assert.equal(stopLossEpochOf(resetOfRun2, 'run3'), null);
    assert.equal(refusalOf(resetOfRun2, 'run3', CANCELLED_ALL)?.code, 75);
  });

  it('begins the epoch at the reset the owner confirmed later, and no longer counts the failures between two resets', () => {
    const runs = [...twoProductDefects(), failed53('run2', 3, 40, { classification: ruled53('brief-harness-defect', 48) }), failed53('run2', 4, 50, { classification: ruled53('brief-harness-defect', 58) })];
    const file = withResets(runs, [reset66('run2', 60, [...BOTH, 'run_run2_3', 'run_run2_4']), reset66('run2', 30, BOTH)]);
    assert.equal(stopLossEpochOf(file, 'run2'), minute53(60));
    assert.equal(refusalOf(file, 'run2', CANCELLED_ALL), undefined);
    assert.equal(stopLossEpochOf(withResets(runs, [reset66('run2', 30, BOTH), reset66('run2', 60, BOTH)]), 'run2'), minute53(60));
  });

  it('counts a hand-edited reset as no reset when it lacks a field the proposal writes or names another party as the owner', () => {
    const valid = reset66('run2', 30, BOTH);
    const edited: Array<[string, Json]> = [
      ['a confirmation by claude', { ...valid, confirmed: { by: 'claude', ref: 'owner reply', at: minute53(30) } }],
      ['an empty confirmation reference', { ...valid, confirmed: { by: 'owner', ref: '', at: minute53(30) } }],
      ['a confirmation without a time', { ...valid, confirmed: { by: 'owner', ref: 'owner reply' } }],
      ['no scenarios', withProposed(valid, { scenarios: [] })],
      ['a scenario without a green proof', withProposed(valid, { scenarios: [{ runId: 'run_run2_1', test: 'test/x.test.ts', red: { path: 'r.json', sha256: 'a' } }] })],
      ['a parity report that is not true', withProposed(valid, { parity: { ...((valid['proposed'] as Json)['parity'] as Json), parity: false } })],
      ['a parity report with a problem', withProposed(valid, { parity: { ...((valid['proposed'] as Json)['parity'] as Json), problems: ['x'] } })],
      ['a proposal by the owner', withProposed(valid, { by: 'owner' })],
    ];
    for (const [name, reset] of edited) {
      const file = withResets(twoProductDefects(), [reset]);
      assert.equal(stopLossEpochOf(file, 'run2'), null, name);
      assert.deepEqual(refusalOf(file, 'run2', CANCELLED_ALL), { code: 75, text: NO_RESET }, name);
    }
  });
});

// D-37's three proofs, judged before a proposal is written (plan 03-66, Task 2). The input is pure: the parsed proof bodies and the facts the command reads from the checkout.
interface ResetInput66 {
  evidence: Json | undefined;
  order: string[];
  role: string;
  briefDigest: string | undefined;
  pin: string;
  parity: Json | undefined;
  scenarios: Array<{ runId: string; test: string; testTracked: boolean; red: Json | undefined; green: Json | undefined; redSha256: string; greenSha256: string }>;
}
const judgeResetProposal = (input: ResetInput66): string[] => (exitTools as unknown as { judgeResetProposal: (i: ResetInput66) => string[] }).judgeResetProposal(input);

describe("exit evidence: a reset is proposed only with D-37's three proofs, after a product-defect ruling, and never twice on one reproduction (plan 03-66; D-36, D-37)", () => {
  const SCENARIO_TEST = 'test/integration/scenario.test.ts';
  const COMMAND = `node --test --test-reporter=tap ${SCENARIO_TEST}`;
  const redBody = (n: number): Json => ({ command: COMMAND, exitCode: 1, output: `TAP version 13\nnot ok 1 - scenario ${n}\n1..1\n# tests 1\n# pass 0\n# fail 1\n` });
  const greenBody = (n: number): Json => ({ command: COMMAND, exitCode: 0, output: `TAP version 13\nok 1 - scenario ${n}\n1..1\n# tests 1\n# pass 1\n# fail 0\n` });
  const validInput = (): ResetInput66 => ({
    evidence: evidence53(failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('product-defect', 18) })),
    order: [...AUTH53.order],
    role: 'run2',
    briefDigest: 'sha256:run2',
    pin: '9f1cd8d',
    parity: {
      schema: 1,
      plan: '03-65',
      checkedAt: minute53(20),
      pin: '9f1cd8d0123456789abcdef0123456789abcdef0',
      briefs: [{ path: 'b2.md', digest: 'sha256:run2' }],
      spentUsd: 0,
      modelHostLaunched: false,
      checkout: { unchanged: true },
      mismatches: [],
      parity: true,
      problems: [],
    },
    scenarios: ['run_run2_1', 'run_run2_2'].map((runId, i) => ({ runId, test: SCENARIO_TEST, testTracked: true, red: redBody(i), green: greenBody(i), redSha256: `red-${i}`, greenSha256: `green-${i}` })),
  });
  const mutated = (edit: (i: ResetInput66) => void): ResetInput66 => {
    const input = validInput();
    edit(input);
    return input;
  };
  const scenarioOf = (i: ResetInput66, n: number): ResetInput66['scenarios'][number] => i.scenarios[n] as ResetInput66['scenarios'][number];
  const parityOf = (i: ResetInput66): Json => i.parity as Json;
  const evidenceOf = (i: ResetInput66): Json => i.evidence as Json;
  const withReset = (i: ResetInput66, reset: Json): void => void (evidenceOf(i)['resets'] = [reset]);

  it('returns no problem for a complete input, and an earlier unconfirmed proposal of the run is not a problem', () => {
    assert.deepEqual(judgeResetProposal(validInput()), []);
    assert.deepEqual(judgeResetProposal(mutated((i) => withReset(i, withoutConfirmation(reset66('run2', 30, ['run_run2_1']))))), []);
  });

  const refusals: Array<[string, (i: ResetInput66) => void, RegExp]> = [
    ['a product-defect attempt with no scenario', (i) => void i.scenarios.pop(), /no red-to-green scenario for run_run2_2 \(D-37\)/],
    ['a scenario that names a run ID which is not a failed attempt of the run in its epoch', (i) => void (scenarioOf(i, 1).runId = 'run_run2_9'), /run_run2_9, which is not a failed product-defect attempt of run2/],
    ['two scenarios for one attempt', (i) => void (scenarioOf(i, 1).runId = 'run_run2_1'), /run_run2_1 is named by more than one scenario/],
    ['a test outside test/', (i) => void (scenarioOf(i, 0).test = 'src/lib/x.test.ts'), /not a relative path under test\//],
    ['a test path holding ..', (i) => void (scenarioOf(i, 0).test = 'test/../src/x.test.ts'), /not a relative path under test\//],
    ['an absolute test path', (i) => void (scenarioOf(i, 0).test = '/tmp/test/x.test.ts'), /not a relative path under test\//],
    ['a test that is not tracked', (i) => void (scenarioOf(i, 0).testTracked = false), /not tracked/],
    ['a missing red proof', (i) => void (scenarioOf(i, 0).red = undefined), /scenario run_run2_1: the red proof is missing/],
    ['a red proof with exit code 0', (i) => void (scenarioOf(i, 0).red = { ...redBody(0), exitCode: 0 }), /the red proof's exit code is 0/],
    ['a red proof with `# fail 0`', (i) => void (scenarioOf(i, 0).red = { ...redBody(0), output: 'TAP version 13\n# tests 1\n# pass 1\n# fail 0\n' }), /the red proof does not show a failing test/],
    ['a red proof whose command does not name the test', (i) => void (scenarioOf(i, 0).red = { ...redBody(0), command: 'node --test --test-reporter=tap test/other.test.ts' }), /the red proof's command does not name test\/integration\/scenario\.test\.ts/],
    ['a missing green proof', (i) => void (scenarioOf(i, 1).green = undefined), /scenario run_run2_2: the green proof is missing/],
    ['a green proof with exit code 1', (i) => void (scenarioOf(i, 1).green = { ...greenBody(1), exitCode: 1 }), /the green proof's exit code is 1/],
    ['a green proof with `# fail 2`', (i) => void (scenarioOf(i, 1).green = { ...greenBody(1), output: 'TAP version 13\n# tests 2\n# pass 0\n# fail 2\n' }), /the green proof does not show `# fail 0`/],
    ['a green proof with a `not ok` line', (i) => void (scenarioOf(i, 1).green = { ...greenBody(1), output: 'TAP version 13\n    not ok 1 - x\n# tests 1\n# pass 1\n# fail 0\n' }), /the green proof has a not ok line/],
    ['a green proof with `# pass 0`', (i) => void (scenarioOf(i, 1).green = { ...greenBody(1), output: 'TAP version 13\n# tests 0\n# pass 0\n# fail 0\n' }), /the green proof does not show a passing test/],
    ['a green proof whose command does not name the test', (i) => void (scenarioOf(i, 1).green = { ...greenBody(1), command: 'node --test --test-reporter=tap test/other.test.ts' }), /the green proof's command does not name test\/integration\/scenario\.test\.ts/],
    ['two scenarios that share one red proof', (i) => void (scenarioOf(i, 1).redSha256 = 'red-0'), /share one red proof/],
    ['a missing parity report', (i) => void (i.parity = undefined), /the parity report is missing/],
    ['a parity report of schema 2', (i) => void (parityOf(i)['schema'] = 2), /parity report.*schema 1/],
    ['a parity report with parity false', (i) => void (parityOf(i)['parity'] = false), /parity report.*parity is not true/],
    ['a parity report with a problem', (i) => void (parityOf(i)['problems'] = ['x']), /parity report lists a problem/],
    ['a parity report with a mismatch', (i) => void (parityOf(i)['mismatches'] = ['build']), /parity report lists a mismatch/],
    ['a parity report that records spend', (i) => void (parityOf(i)['spentUsd'] = 0.1), /parity report records spend/],
    ['a parity report whose checkout changed', (i) => void (parityOf(i)['checkout'] = { unchanged: false }), /parity report.*checkout/],
    ['a parity report at another pin', (i) => void (parityOf(i)['pin'] = 'abc1234'), /parity report is at pin abc1234, not 9f1cd8d/],
    ['a parity report checked before a covered ruling', (i) => void (parityOf(i)['checkedAt'] = minute53(10)), /parity report was checked before the owner's ruling/],
    ['a parity report whose briefs lack the run', (i) => void (parityOf(i)['briefs'] = [{ path: 'b3.md', digest: 'sha256:run3' }]), /parity report does not cover the brief of run2 \(sha256:run2\)/],
    ['a latest failed attempt confirmed as a brief/harness defect', (i) => void (evidenceOf(i)['runs'] = [failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('brief-harness-defect', 18) })]), /only an owner-confirmed product defect resets the count \(D-36\)/],
    ['a latest failed attempt with no owner ruling', (i) => void (evidenceOf(i)['runs'] = [failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10)]), /run_run2_2 has no owner ruling.*\(D-27, D-36\)/],
    ['no failed attempt after the last confirmed reset', (i) => withReset(i, reset66('run2', 30, ['run_run2_1', 'run_run2_2'])), /nothing to reset/],
    [
      'a red proof an earlier confirmed reset already cites',
      (i) => withReset(i, reset66('run2', 5, ['x'], { proposed: { ...(reset66('run2', 5, ['x'])['proposed'] as Json), scenarios: [{ runId: 'x', test: 'test/a.test.ts', red: { path: 'old.json', sha256: 'red-0' }, green: { path: 'g.json', sha256: 'g' } }] } })),
      /already proved by an earlier reset: a repeat of the same failure still counts \(D-36\)/,
    ],
    ['an attempt of the run that is neither passed nor failed', (i) => void (evidenceOf(i)['runs'] = [...(evidenceOf(i)['runs'] as Json[]), attempt53('run2', 3, 40)]), /run_run2_3 is neither passed nor failed/],
    ['a role that is not in the order', (i) => void (i.role = 'run9'), /run9 is not a run of the authorization/],
  ];
  for (const [name, edit, pattern] of refusals) {
    it(`refuses ${name}`, () => {
      const problems = judgeResetProposal(mutated(edit));
      assert.ok(
        problems.some((p) => pattern.test(p)),
        `${pattern}: ${JSON.stringify(problems)}`,
      );
    });
  }
});

// What a reset does not change (plan 03-66, Task 3): D-26's epoch and the verdict are computed without reading `resets`, and every writer of the evidence file keeps the list.
describe("exit evidence: a reset changes neither D-26's epoch nor the verdict, and every writer keeps the resets list (plan 03-66; D-26, D-38)", () => {
  const AUTH66 = {
    ...AUTH53,
    briefs: [
      { path: 'b2.md', digest: 'sha256:run2', run: 'run2', expects: 'amend-stale' },
      { path: 'b3.md', digest: 'sha256:run3', run: 'run3', expects: 'silence' },
      { path: 'b1.md', digest: 'sha256:run1', run: 'run1', expects: 'block-resume' },
    ] as Json[],
  };
  const dirs: string[] = [];
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const epochOf = (e: Json): string | null => (exitTools as unknown as { epochOf: (e: Json) => string | null }).epochOf(e);
  const verdictOf = (e: Json): unknown => (exitTools as unknown as { exitVerdict: (e: Json, a: typeof AUTH66) => unknown }).exitVerdict(e, AUTH66);
  // One finished entry that meets every condition of its role (the shape plan 03-54's verdict counts).
  const cleanOf = (role: string, n: number, startMinute: number): Json => {
    const runId = `run_${role}_${n}`;
    const decisions =
      role === 'run2'
        ? { contract: { version: 2, authorizedBy: 'owner:tester', reason: 'r', diff: [{ path: 'files.write' }] }, decisions: [{ decisionId: 'dec_old', state: 'stale', origin: { origin: 'pause' } }, { decisionId: 'dec_new', state: 'answered', origin: { origin: 'pause' } }] }
        : role === 'run3'
          ? { contract: { version: 1 }, silence: { problems: [] }, decisions: [{ decisionId: 'dec_3', state: 'answered', origin: { origin: 'pause' } }] }
          : { contract: { version: 1 }, decisions: [{ decisionId: 'dec_1', state: 'answered', origin: { origin: 'pause' } }] };
    return passed53(role, n, startMinute, { runId, problems: [], finalState: 'ready_for_review', resumed: true, checkout: { equal: true, newRefs: [`refs/heads/avarice/${runId}`], removedOrChangedRefs: [] }, ...decisions });
  };
  const RESET = reset66('run2', 30, ['run_run2_1', 'run_run2_2']);
  const stops = (): Json[] => [failed53('run2', 1, 1, { classification: ruled53('product-defect', 8) }), failed53('run2', 2, 10, { classification: ruled53('product-defect', 18) })];
  const files: Array<[string, Json[]]> = [
    ['run2 failed twice as product defects, with a confirmed reset', stops()],
    ['the same plus a passed run2 attempt 3 and a passed run3', [...stops(), cleanOf('run2', 3, 40), cleanOf('run3', 1, 50)]],
    ['the same plus a failed run3', [...stops(), cleanOf('run2', 3, 40), cleanOf('run3', 1, 50), failed53('run3', 2, 60, { classification: ruled53('product-defect', 68) })]],
  ];
  for (const [name, runs] of files) {
    it(`leaves epochOf and exitVerdict as they are without the list: ${name}`, () => {
      const withReset: Json = { ...evidence53(...runs), resets: [RESET] };
      const without = evidence53(...runs);
      assert.deepEqual(epochOf(withReset), epochOf(without));
      assert.deepEqual(verdictOf(withReset), verdictOf(without));
      assert.notEqual(stopLossEpochOf(withReset, 'run2'), null, 'the reset is a valid one, so the two epochs are different notions');
    });
  }

  it('keeps the list in evidenceFileBody and in withClassification', () => {
    const file: Json = { ...evidence53(failed53('run2', 1, 1)), resets: [RESET] };
    assert.deepEqual(evidenceFileBody(file, '03-66', [failed53('run2', 1, 1)], minute53(5))['resets'], [RESET]);
    const classified = (exitTools as unknown as { withClassification: (f: Json, id: string, p: Json) => Json | undefined }).withClassification(file, 'run_run2_1', { proposed: { by: 'claude' } });
    assert.deepEqual(classified?.['resets'], [RESET]);
  });

  it('keeps the list when the verdict and the supplement subcommands rewrite the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-reset-writers-'));
    dirs.push(dir);
    const auth = writeFreshAuthorization(dir, { briefs: AUTH66.briefs, order: ['run2', 'run3', 'run1'] });
    const evidence = join(dir, 'evidence.json');
    const other = join(dir, 'other-evidence.json');
    writeFileSync(evidence, `${JSON.stringify({ ...evidence53(...stops()), resets: [RESET] }, null, 2)}\n`);
    writeFileSync(other, `${JSON.stringify({ schema: 1, plan: '03-48', runs: [{ runId: 'run_OLD', items: [], decisions: [], problems: [], checkout: { equal: true, newRefs: [] }, passed: false, state: 'blocked_on_decision' }] })}\n`);
    const read = (): Json => JSON.parse(readFileSync(evidence, 'utf8')) as Json;
    const verdict = runTools(['verdict', '--evidence', evidence, '--authorization-file', auth]);
    assert.ok(verdict.status === 0 || verdict.status === 1, verdict.stderr + verdict.stdout);
    assert.deepEqual(read()['resets'], [RESET]);
    assert.equal(typeof read()['verdict'], 'string');
    const supplement = runTools(['supplement', '--evidence', evidence, '--from', other, '--run-id', 'run_OLD', '--note', 'an older run']);
    assert.equal(supplement.status, 0, supplement.stderr + supplement.stdout);
    assert.deepEqual(read()['resets'], [RESET]);
    assert.equal((read()['supplementary'] as Json[]).length, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-54: each run's expectations are judged by code. Run 2 (`expects: amend-stale`) is the one run whose amendment and stale original are its expected path
// (SC3, SC4); any other amendment is refused (D-28); D-35's `not run: not required` report is judged live at both stages.
// ---------------------------------------------------------------------------------------------------------------

describe("exit evidence: run 2's amendment and stale original are its expected path, and no other run's (plan 03-54; D-28, SC3, SC4)", () => {
  const SESSION = '11111111-2222-4333-8444-555555555555';
  const OWNER = 'owner:tester';
  const staleOriginal = (over: Json = {}): Json => pauseDecision({ decisionId: 'dec_OLD', state: 'stale', contractVersion: 1, answeredBy: OWNER, answerChannel: 'terminal', answer: '1', ...over });
  const successor = (over: Json = {}): Json =>
    pauseDecision({ decisionId: 'dec_NEW', state: 'answered', contractVersion: 2, supersedes: 'dec_OLD', answeredBy: OWNER, answerChannel: 'terminal', answer: '2', ...over });
  const amended = (over: Json = {}): Json => ({ version: 2, authorizedBy: OWNER, reason: 'the stale answer named a wording the amendment replaced', diff: [{ path: 'files.write', added: ['src/lib/graduation.ts'] }], ...over });
  const finished = (over: Json = {}): Parameters<typeof judgeFinish>[0] =>
    ({
      state: 'ready_for_review',
      items: [
        { itemId: 'A', state: 'done', gsdSession: 'a' },
        { itemId: 'B', state: 'done', gsdSession: SESSION },
        { itemId: 'C', state: 'done', gsdSession: 'c' },
      ],
      decisions: [pauseDecision({ state: 'answered', answeredBy: OWNER, answerChannel: 'terminal', answer: '1' })],
      attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'resume' }],
      invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: [SESSION], answeredDecisionId: 'dec_NEW' }],
      pauseSessions: { A: 'a', B: SESSION, C: null },
      requiredChecks: [{ name: 'test', status: 'passed' }],
      acceptance: [{ id: 'AC1', satisfied: true }],
      commit: 'abc',
      clean: true,
      gates: [{ gate: 'G4', passed: true }],
      commits: [{ itemId: 'A' }, { itemId: 'B' }, { itemId: 'C' }],
      askUserQuestion: 0,
      owner: 'tester',
      pauseDecisionIds: ['dec_OLD'],
      ...over,
    }) as Parameters<typeof judgeFinish>[0];
  const run2 = (over: Json = {}): Parameters<typeof judgeFinish>[0] => finished({ expects: 'amend-stale', contract: amended(), decisions: [staleOriginal(), successor()], ...over });

  it('accepts the expected path: version 2 by the owner with a reason and a files.write diff, the stale original with its answer kept, one answered successor, the resumed session', () => {
    const judged = judgeFinish(run2());
    assert.deepEqual(judged.problems, []);
    assert.equal(judged.resume['resumed'], true);
    assert.equal(judged.resume['itemId'], 'B');
  });

  const refusals: Array<[string, Json, RegExp]> = [
    ['no amendment (contract version 1)', { contract: { version: 1 } }, /no amendment/],
    ['no contract to read', { contract: null }, /no amendment/],
    ['version 3', { contract: amended({ version: 3 }) }, /version 3/],
    ['an amendment authorized by someone other than the owner', { contract: amended({ authorizedBy: 'owner:someone-else' }) }, /authorized_by/],
    ['an amendment with an empty reason', { contract: amended({ reason: '  ' }) }, /no reason/],
    ['a diff that does not name files.write', { contract: amended({ diff: [{ path: 'budgets.costUsd', from: 1, to: 2 }] }) }, /files\.write/],
    ['no stale decision', { decisions: [successor()] }, /no decision is stale/],
    ['a stale decision whose answer was not kept', { decisions: [staleOriginal({ answer: null }), successor()] }, /answer/],
    ['a successor that does not supersede the stale decision', { decisions: [staleOriginal(), successor({ supersedes: null })] }, /supersede/],
    ['a successor answered by someone other than the owner', { decisions: [staleOriginal(), successor({ answeredBy: 'owner:someone-else' })] }, /not owner:tester/],
    ['a successor answered on the inbox and not the terminal', { decisions: [staleOriginal(), successor({ answerChannel: 'inbox' })] }, /not terminal/],
    ['two answered decisions', { decisions: [staleOriginal(), successor(), successor({ decisionId: 'dec_EXTRA' })] }, /2 decision\(s\) are answered, not one/],
  ];
  for (const [name, over, pattern] of refusals) {
    it(`lists one problem for ${name}`, () => {
      const problems = judgeFinish(run2(over)).problems;
      assert.equal(problems.length, 1, problems.join(' | '));
      assert.match(problems[0] as string, pattern);
    });
  }

  it('still judges the resume of the successor: a fresh unit that merely carries the answer is not a resume', () => {
    const problems = judgeFinish(run2({ attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'answer' }] })).problems;
    assert.ok(problems.some((p) => p.includes('no attempt with reason resume')), problems.join(' | '));
  });

  it('keeps every other finish check for run 2', () => {
    const bad = judgeFinish(run2({ requiredChecks: [{ name: 'test', status: 'failed' }], clean: false, commit: null, gates: [] }));
    for (const part of ['required check test', 'clean tree', 'no handed-off commit', 'G4']) assert.ok(bad.problems.some((p) => p.includes(part)), part);
  });

  it('refuses a contract above version 1 for the runs that expect block-resume or silence, and passes version 1', () => {
    for (const expects of ['block-resume', 'silence']) {
      const problems = judgeFinish(finished({ expects, contract: amended() })).problems;
      assert.deepEqual(problems, ['the contract was amended (version 2); only run 2 expects an amendment (D-28)'], expects);
      assert.deepEqual(judgeFinish(finished({ expects, contract: { version: 1 } })).problems, [], `${expects}: version 1`);
    }
  });

  it('never accepts a relax record under an expectation, for any run', () => {
    const relax = { by: 'owner', ref: 'STATE.md', decisions: ['dec_EXTRA'], at: '2026-11-10T23:40:00Z' };
    assert.deepEqual(judgeFinish(finished({ expects: 'block-resume', relax })).problems, ['a relax record is not accepted in the exit (D-28)']);
    assert.deepEqual(judgeFinish(run2({ relax })).problems, ['a relax record is not accepted in the exit (D-28)']);
  });

  it('judges as before when no expectation is given: the relaxed amendment still needs its relax record', () => {
    const problems = judgeFinish(finished({ contract: amended(), decisions: [pauseDecision({ state: 'answered', answeredBy: OWNER, answerChannel: 'terminal' })] })).problems;
    assert.ok(problems.some((p) => p.includes('amended') && p.includes('relax record')), problems.join(' | '));
  });
});

describe('exit evidence: the status reports the declared checks that do not run as not run (plan 03-54; D-35, T-03-139)', () => {
  const E2E = { checksNotRunExpected: ['test:e2e'] };
  const reports = (...names: string[]): Json => ({ statusView: { checksNotRun: names.map((name) => ({ name, reason: 'not required' })) } });
  const D35 = 'status does not report test:e2e as not run: not required (D-35)';
  const SESSION = '11111111-2222-4333-8444-555555555555';
  const finished = (over: Json = {}): Parameters<typeof judgeFinish>[0] =>
    ({
      state: 'ready_for_review',
      items: [{ itemId: 'A', state: 'done' }, { itemId: 'B', state: 'done', gsdSession: SESSION }],
      decisions: [pauseDecision({ state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', answer: '1' })],
      attempts: [{ attemptId: 'att_B1', itemId: 'B', reason: 'initial' }, { attemptId: 'att_B2', itemId: 'B', reason: 'resume' }],
      invocations: [{ attemptId: 'att_B2', requestedSession: SESSION, initSessions: [SESSION], answeredDecisionId: 'dec_AAAA' }],
      pauseSessions: { A: 'a', B: SESSION },
      requiredChecks: [{ name: 'test', status: 'passed' }],
      acceptance: [{ id: 'AC1', satisfied: true }],
      commit: 'abc',
      clean: true,
      gates: [{ gate: 'G4', passed: true }],
      commits: [{ itemId: 'A' }, { itemId: 'B' }],
      askUserQuestion: 0,
      owner: 'tester',
      ...over,
    }) as Parameters<typeof judgeFinish>[0];

  for (const [stage, judge] of [
    ['start', (over: Json): string[] => judgeStart(stopped(over))],
    ['finish', (over: Json): string[] => judgeFinish(finished(over)).problems],
  ] as Array<[string, (over: Json) => string[]]>) {
    it(`${stage}: lists no problem when the status names exactly the expected checks as not run`, () => {
      assert.deepEqual(judge({ ...E2E, ...reports('test:e2e') }), []);
    });

    it(`${stage}: names D-35 when the status carries no checksNotRun key, none of the expected name, or a null status view`, () => {
      assert.deepEqual(judge({ ...E2E, statusView: {} }), [D35]);
      assert.deepEqual(judge({ ...E2E, ...reports('lint') }).length, 1);
      assert.match(judge({ ...E2E, ...reports('lint') })[0] as string, /\(D-35\)$/);
      assert.deepEqual(judge({ ...E2E, statusView: null }), [D35]);
      assert.deepEqual(judge({ ...E2E }), [D35]);
    });

    it(`${stage}: names D-35 when the status reports a check that is not in the expected list, and for a contract that runs every check`, () => {
      assert.deepEqual(judge({ ...E2E, ...reports('test:e2e', 'lint') }), ['status reports test:e2e, lint as not run, but the contract expects test:e2e (D-35)']);
      assert.deepEqual(judge({ checksNotRunExpected: [], statusView: {} }), []);
      assert.deepEqual(judge({ checksNotRunExpected: [], ...reports('test:e2e') }), ['status reports test:e2e as not run, but the contract expects none (D-35)']);
    });

    it(`${stage}: judges nothing about D-35 when no expected list is given`, () => {
      assert.deepEqual(judge({}), []);
      assert.deepEqual(judge({ statusView: {} }), []);
    });
  }
});

describe('exit evidence: the finish stage records the expected not-run list beside the status view, from the run\'s own contract (plan 03-54; D-35)', () => {
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

  it('writes checksNotRunExpected, equal to what the live status reports, and judges no D-35 or amendment problem for a run that expects block-resume', { timeout: 120_000 }, () => {
    const { f, runId } = state.s as ReturnType<typeof startBlockedS17>;
    const dir = mkdtempSync(join(tmpdir(), 'exit-d35-'));
    dirs.push(dir);
    const auth = writeFreshAuthorization(dir);
    const snap = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', TOOLS_SCRIPT, 'snapshot', '--repo', f.repo.path], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(snap.status, 0, snap.stderr);
    const evidence = join(dir, 'evidence.json');
    const record = { runId, run: 'run3', attempt: 1, expects: 'block-resume', atPause: { at: '2026-11-10T06:23:43Z', state: 'blocked_on_decision', items: [] }, checkoutBeforeSnapshot: JSON.parse(snap.stdout), decisions: [{ decisionId: 'dec_PAUSE_ANSWERED', state: 'open' }] };
    writeFileSync(evidence, `${JSON.stringify({ schema: 1, plan: '03-54', runs: [record] })}\n`);
    const ran = runTools(['evidence', '--stage', 'finish', '--run-id', runId, '--brief', join(dir, 'b.md'), '--repo', f.repo.path, '--authorization-file', auth, '--out', evidence, '--wait-max-minutes', '1'], {
      ...profileEnv(f.roots),
      AVARICE_PHASE3_LEDGER: join(dir, 'ledger.jsonl'),
    });
    assert.equal(ran.status, 1, ran.stderr + ran.stdout);
    const entry = ((JSON.parse(readFileSync(evidence, 'utf8')) as Json)['runs'] as Json[]).find((r) => r['runId'] === runId) as Json;
    const expected = entry['checksNotRunExpected'] as string[];
    assert.ok(Array.isArray(expected), 'the entry records checksNotRunExpected');
    const reported = (((entry['statusView'] as Json)['checksNotRun'] as Array<{ name: string }> | undefined) ?? []).map((c) => c.name);
    assert.deepEqual(expected, reported, 'the live status reports exactly the checks the contract does not run');
    const problems = entry['problems'] as string[];
    assert.equal(problems.some((p) => p.includes('D-35')), false, problems.join(' | '));
    assert.equal(problems.some((p) => p.includes('only run 2 expects an amendment')), false, problems.join(' | '));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-54 Task 2: run 3's silence. A failed banner, a failed digest and the passing of time are not an answer (AUT-4); the decision stays open and listed (AUT-6, SC2).
// The new exports are read through casts so a missing one fails its own case and not the loading of the file.
// ---------------------------------------------------------------------------------------------------------------

describe("exit evidence: judgeSilence judges run 3's silence from the rows the owner's ledger holds (plan 03-54; SC2, AUT-4, AUT-6, T-03-136)", () => {
  const judgeSilence = (facts: Json): string[] => (exitTools as unknown as { judgeSilence: (f: Json) => string[] }).judgeSilence(facts);
  const banner = (over: Json = {}): Json => ({ notificationId: 'ntf_B1', kind: 'decisions', state: 'failed', lastError: 'osascript-missing', attempts: 3, ...over });
  const digestRow = (over: Json = {}): Json => ({ notificationId: 'ntf_D1', kind: 'digest', state: 'failed', lastError: 'osascript-missing', attempts: 3, createdAt: '2026-11-10T12:30:00.000Z', ...over });
  const silent = (over: Json = {}): Json => ({
    notifications: [banner()],
    digestRows: [digestRow()],
    decision: { decisionId: 'dec_S', state: 'open', answeredAt: null, answeredBy: null, answer: null, answerChannel: null },
    inboxDecision: { decisionId: 'dec_S', notification: { state: 'failed', attempts: 3, lastError: 'osascript-missing' } },
    statusState: 'blocked_on_decision',
    elapsedSeconds: 76,
    batchWindowMinutes: 1,
    ...over,
  });

  it('lists no problem when every blocking banner and the digest failed, the decision is open and unanswered, inbox lists it with a failed banner and status shows it blocked', () => {
    assert.deepEqual(judgeSilence(silent()), []);
  });

  it('judges the batch window plus 15 seconds from the block: 75 seconds pass for a one minute window, 74 do not', () => {
    assert.deepEqual(judgeSilence(silent({ elapsedSeconds: 75 })), []);
    const early = judgeSilence(silent({ elapsedSeconds: 74 }));
    assert.equal(early.length, 1, early.join(' | '));
    assert.match(early[0] as string, /74 s .*75 s|75 s/);
    assert.equal(judgeSilence(silent({ batchWindowMinutes: 10, elapsedSeconds: 614 })).length, 1);
    assert.deepEqual(judgeSilence(silent({ batchWindowMinutes: 10, elapsedSeconds: 615 })), []);
  });

  const refusals: Array<[string, Json, RegExp]> = [
    ['a delivered banner', { notifications: [banner({ state: 'delivered', lastError: null })] }, /delivered/],
    ['a pending banner', { notifications: [banner({ state: 'pending', lastError: null, attempts: 0 })] }, /pending/],
    ['a banner that failed for another reason than the missing osascript', { notifications: [banner({ lastError: 'osascript-failed' })] }, /osascript-failed/],
    ['no blocking banner row at all', { notifications: [] }, /no blocking banner/],
    ['a delivered banner among failed ones', { notifications: [banner(), banner({ notificationId: 'ntf_B2', state: 'delivered', lastError: null })] }, /delivered/],
    ['an answered decision', { decision: { decisionId: 'dec_S', state: 'answered', answeredAt: '2026-11-10T12:31:00.000Z', answeredBy: 'owner:tester', answer: '1', answerChannel: 'terminal' } }, /not open and unanswered/],
    ['an open decision whose answer columns are not null', { decision: { decisionId: 'dec_S', state: 'open', answeredAt: null, answeredBy: null, answer: '1', answerChannel: null } }, /answer/],
    ['a decision row that cannot be read', { decision: undefined }, /decision/],
    ['no digest row', { digestRows: [] }, /no digest row/],
    ['a digest row that was delivered', { digestRows: [digestRow({ state: 'delivered', lastError: null })] }, /digest/],
    ['an inbox that does not list the decision', { inboxDecision: undefined }, /inbox does not list/],
    ['an inbox that shows the banner as delivered', { inboxDecision: { decisionId: 'dec_S', notification: { state: 'delivered', attempts: 1 } } }, /notification state delivered/],
    ['a run that is no longer blocked on the decision', { statusState: 'ready_for_review' }, /ready_for_review.*blocked_on_decision|blocked_on_decision/],
  ];
  for (const [name, over, pattern] of refusals) {
    it(`lists one problem for ${name}`, () => {
      const problems = judgeSilence(silent(over));
      assert.equal(problems.length, 1, problems.join(' | '));
      assert.match(problems[0] as string, pattern);
    });
  }

  it('judges the latest digest row when more than one covers the decision, and only banners of kind decisions as blocking banners', () => {
    const earlierDelivered = digestRow({ notificationId: 'ntf_D0', state: 'delivered', lastError: null, createdAt: '2026-11-10T11:30:00.000Z' });
    assert.deepEqual(judgeSilence(silent({ digestRows: [earlierDelivered, digestRow()] })), []);
    assert.equal(judgeSilence(silent({ digestRows: [digestRow(), { ...earlierDelivered, createdAt: '2026-11-10T13:00:00.000Z' }] })).length, 1);
    assert.deepEqual(judgeSilence(silent({ notifications: [banner(), { notificationId: 'ntf_R', kind: 'review', state: 'delivered', lastError: null, attempts: 1 }] })), []);
  });
});

describe('exit evidence: runSilence waits for the banners to be final and the window to pass, runs the digest once, and answers nothing (plan 03-54; AUT-4)', () => {
  type Seams = {
    read: () => Json;
    digest: () => { exit: number | null; stdout: string; stderr: string };
    nowMs: () => number;
    pause: (ms: number) => Promise<void>;
  };
  const runSilence = (seams: Seams, options: Json): Promise<{ block: Json; problems: string[] }> =>
    (exitTools as unknown as { runSilence: (s: Seams, o: Json) => Promise<{ block: Json; problems: string[] }> }).runSilence(seams, options);
  const BLOCKED_AT = Date.parse('2026-11-10T12:00:00.000Z');
  const row = (state: string, lastError: string | null): Json => ({ notificationId: 'ntf_B1', kind: 'decisions', state, lastError, attempts: state === 'pending' ? 0 : 3 });
  const facts = (bannerState: string, digestRows: Json[] = []): Json => ({
    notifications: [row(bannerState, bannerState === 'failed' ? 'osascript-missing' : null)],
    digestRows,
    decision: { decisionId: 'dec_S', state: 'open', openedAt: '2026-11-10T12:00:00.000Z', answeredAt: null, answeredBy: null, answer: null, answerChannel: null },
    inboxDecision: { decisionId: 'dec_S', notification: { state: bannerState, attempts: 3, lastError: 'osascript-missing' } },
    statusState: 'blocked_on_decision',
    batchWindowMinutes: 1,
  });
  const failedDigest: Json = { notificationId: 'ntf_D1', kind: 'digest', state: 'failed', lastError: 'osascript-missing', attempts: 3, createdAt: '2026-11-10T12:02:00.000Z' };
  // A clock the pauses move: every poll advances it by the pause asked for, so no test waits.
  const harness = (reads: Array<(digested: boolean) => Json>): { seams: Seams; log: string[]; digests: () => number } => {
    let now = BLOCKED_AT + 5_000;
    let digested = 0;
    let n = 0;
    const log: string[] = [];
    const seams: Seams = {
      read: () => {
        const make = reads[Math.min(n, reads.length - 1)] as (d: boolean) => Json;
        n += 1;
        return make(digested > 0);
      },
      digest: () => {
        digested += 1;
        log.push('digest');
        return { exit: 70, stdout: '', stderr: 'exit-run: digest failed: the banner was not delivered (osascript-missing)' };
      },
      nowMs: () => now,
      pause: (ms) => {
        log.push(`pause ${ms}`);
        now += ms;
        return Promise.resolve();
      },
    };
    return { seams, log, digests: () => digested };
  };

  it('polls every 3 seconds until the banner row is final and 75 seconds have passed since the block, runs the digest once, and records the block', async () => {
    const h = harness([() => facts('pending'), () => facts('pending'), (d) => facts('failed', d ? [failedDigest] : [])]);
    const { block, problems } = await runSilence(h.seams, { maxWaitMs: 600_000 });
    assert.deepEqual(problems, []);
    assert.equal(h.digests(), 1);
    const pauses = h.log.filter((l) => l.startsWith('pause'));
    assert.ok(pauses.length >= 2 && pauses.every((p) => p === 'pause 3000'), h.log.join(','));
    assert.equal(h.log.at(-1), 'digest', 'the digest is the last thing the step does before it reads the rows again');
    assert.ok(Number(block['elapsedSeconds']) >= 75, String(block['elapsedSeconds']));
    assert.equal(block['digestExit'], 70);
    assert.equal(block['decisionOpen'], true);
    assert.equal(block['answerColumnsNull'], true);
    assert.equal(block['inboxNotificationState'], 'failed');
    assert.equal(block['statusState'], 'blocked_on_decision');
    assert.deepEqual(block['problems'], []);
    assert.equal((block['digestRow'] as Json)['state'], 'failed');
    assert.equal((block['notifications'] as Json[]).length, 1);
    assert.match(String(block['waitedUntil']), /^\d{4}-\d\d-\d\dT/);
  });

  it('does not run the digest before the window has passed, even when the banner is already final', async () => {
    const h = harness([() => facts('failed'), () => facts('failed'), (d) => facts('failed', d ? [failedDigest] : [])]);
    await runSilence(h.seams, { maxWaitMs: 600_000 });
    const first = h.log.indexOf('digest');
    assert.ok(first > 0, 'it waited before the digest');
    assert.ok(h.log.slice(0, first).every((l) => l.startsWith('pause')));
  });

  it('gives up after the longest wait, still runs the digest once, and lists the banner that never became final as a problem', async () => {
    const h = harness([() => facts('pending')]);
    const { block, problems } = await runSilence(h.seams, { maxWaitMs: 12_000 });
    assert.equal(h.digests(), 1);
    assert.ok(problems.some((p) => p.includes('pending')), problems.join(' | '));
    assert.deepEqual(block['problems'], problems);
    assert.equal(block['decisionOpen'], true, 'it answered nothing');
  });

  it('records an answered decision as a problem and never calls anything that answers: the seams hold no way to', async () => {
    const h = harness([(d) => ({ ...facts('failed', d ? [failedDigest] : []), decision: { decisionId: 'dec_S', state: 'answered', openedAt: '2026-11-10T12:00:00.000Z', answeredAt: 'x', answeredBy: 'owner:tester', answer: '1', answerChannel: 'terminal' } })]);
    const { block, problems } = await runSilence(h.seams, { maxWaitMs: 600_000 });
    assert.ok(problems.some((p) => p.includes('not open and unanswered')), problems.join(' | '));
    assert.equal(block['decisionOpen'], false);
    assert.equal(block['answerColumnsNull'], false);
    assert.deepEqual(Object.keys(h.seams).sort(), ['digest', 'nowMs', 'pause', 'read']);
  });
});

describe('exit evidence: the silence subcommand refuses before it reads any profile (plan 03-54)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const setup = (entry: Json | undefined): { auth: string; evidence: string; before: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-silence-'));
    dirs.push(dir);
    const auth = writeFreshAuthorization(dir);
    const evidence = join(dir, 'evidence.json');
    writeFileSync(evidence, `${JSON.stringify({ schema: 1, plan: '03-54', runs: entry === undefined ? [] : [entry] }, null, 2)}\n`);
    return { auth, evidence, before: sha256Of(evidence) };
  };
  const started = (over: Json = {}): Json => ({ runId: 'run_S', run: 'run3', attempt: 1, expects: 'silence', atPause: { at: '2026-11-10T12:00:00Z', state: 'blocked_on_decision', items: [] }, checkoutBeforeSnapshot: { digest: {} }, decisions: [{ decisionId: 'dec_S', state: 'open' }], ...over });
  // An environment whose profile cannot exist: a refusal that reached the ledger would fail on it, and one that does not never looks.
  const noProfile = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, AVARICE_DATA_ROOT: join(dir, 'no-data'), AVARICE_CONFIG_HOME: join(dir, 'no-config'), AVARICE_WORK_ROOT: join(dir, 'no-work') });

  it('exits 2 for missing flags, and for an authorization that authorizes nothing', () => {
    const s = setup(started());
    assert.equal(runTools(['silence', '--run-id', 'run_S', '--out', s.evidence]).status, 2);
    const bad = runTools(['silence', '--run-id', 'run_S', '--authorization-file', join(tmpdir(), 'no-such-authorization.json'), '--out', s.evidence]);
    assert.equal(bad.status, 2, bad.stderr);
    assert.equal(sha256Of(s.evidence), s.before);
  });

  const refusals: Array<[string, Json | undefined, RegExp]> = [
    ['a run the evidence file has no entry for', undefined, /no entry|no start-stage record/],
    ['an entry that does not expect silence', started({ expects: 'block-resume' }), /expects/],
    ['an entry that records no expectation', started({ expects: undefined }), /expects/],
    ['an entry with no start-stage record', { runId: 'run_S', run: 'run3', expects: 'silence' }, /start-stage record/],
  ];
  for (const [name, entry, pattern] of refusals) {
    it(`exits 2 and leaves the evidence file byte-identical for ${name}`, () => {
      const s = setup(entry);
      const ran = runTools(['silence', '--run-id', 'run_S', '--authorization-file', s.auth, '--out', s.evidence], noProfile(join(s.evidence, '..')));
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, pattern);
      assert.equal(sha256Of(s.evidence), s.before);
    });
  }
});

describe('exit-run-phase3.sh --silence (plan 03-54)', () => {
  const script = join(ROOT, 'scripts', 'exit-run-phase3.sh');
  it('refuses to spend without the authorization file, exits 2 and starts nothing', () => {
    const ran = spawnSync('bash', [script, '--silence', 'run_00000000000000000000000000'], { encoding: 'utf8', env: { ...process.env, AVARICE_CLAUDE_BIN: '/nonexistent/claude' } });
    assert.equal(ran.status, 2, ran.stderr);
    assert.match(ran.stderr, /refusing to spend without --authorization-file/);
  });

  it('exits 2 with the usage line when it is given no run ID', () => {
    const ran = spawnSync('bash', [script, '--silence'], { encoding: 'utf8' });
    assert.equal(ran.status, 2, ran.stderr);
    assert.match(ran.stderr, /usage:/);
  });

  it('names --silence in the usage and in the header', () => {
    const text = readFileSync(script, 'utf8');
    assert.match(text, /^# {3}scripts\/exit-run-phase3\.sh --silence RUNID --authorization-file F$/m);
    assert.match(text, /echo "\s+scripts\/exit-run-phase3\.sh --silence RUNID --authorization-file F/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Plan 03-54 Task 3: the exit record. `verdict` says 3 of 3 only when three clean runs exist in the current epoch (D-26); a correct stop is evidence that never counts (D-28);
// a superseded run's facts are kept as supplementary evidence that never counts either (D-34, T-03-138). The new exports are read through casts.
// ---------------------------------------------------------------------------------------------------------------

describe('exit evidence: exitVerdict counts only clean runs of the current epoch, one per role (plan 03-54; D-26, D-28, D-34, T-03-138)', () => {
  type Verdict = { verdict: string; counted: Array<{ role: string; runId: string; attempt: number }>; correctStops: Json[]; notCounted: Array<{ runId: string; role: string | null; attempt: number | null; reason: string }> };
  const AUTH54 = {
    ...AUTH53,
    briefs: [
      { path: 'b2.md', digest: 'sha256:run2', run: 'run2', expects: 'amend-stale' },
      { path: 'b3.md', digest: 'sha256:run3', run: 'run3', expects: 'silence' },
      { path: 'b1.md', digest: 'sha256:run1', run: 'run1', expects: 'block-resume' },
    ] as Json[],
  };
  const exitVerdict = (evidence: Json, auth: Pick<typeof AUTH53, 'order' | 'briefs'> = AUTH54): Verdict => (exitTools as unknown as { exitVerdict: (e: Json, a: typeof AUTH54) => Verdict }).exitVerdict(evidence, auth as typeof AUTH54);
  // One finished entry that meets every condition of its role: ready_for_review, resumed, pause-origin decisions, equal checkout digests and only its own run branch added.
  const clean = (role: string, n: number, startMinute: number, over: Json = {}): Json => {
    const runId = `run_${role}_${n}`;
    const extra: Json =
      role === 'run2'
        ? { contract: { version: 2, authorizedBy: 'owner:tester', reason: 'r', diff: [{ path: 'files.write' }] }, decisions: [{ decisionId: 'dec_old', state: 'stale', origin: { origin: 'pause' } }, { decisionId: 'dec_new', state: 'answered', origin: { origin: 'pause' } }] }
        : role === 'run3'
          ? { contract: { version: 1 }, silence: { problems: [] }, decisions: [{ decisionId: 'dec_3', state: 'answered', origin: { origin: 'pause' } }] }
          : { contract: { version: 1 }, decisions: [{ decisionId: 'dec_1', state: 'answered', origin: { origin: 'pause' } }] };
    return passed53(role, n, startMinute, {
      runId,
      problems: [],
      finalState: 'ready_for_review',
      resumed: true,
      checkout: { equal: true, newRefs: [`refs/heads/avarice/${runId}`], removedOrChangedRefs: [] },
      ...extra,
      ...over,
    });
  };
  const three = (): Json[] => [clean('run2', 1, 1), clean('run3', 1, 6), clean('run1', 1, 11)];
  const proposal = (conformant: boolean): Json => ({ by: 'claude', class: 'brief-harness-defect', stoppedBy: 'G2:gsd-verification', at: ['tests/e2e/x.spec.ts:5'], docsSystem: { conformant, ref: 'docs/system/checks-and-evidence.md' }, summary: 'the brief asked for a file the contract protects', proposedAt: minute53(1) });
  const correctStop = (role: string, n: number, startMinute: number, over: Json = {}): Json =>
    failed53(role, n, startMinute, { classification: { proposed: proposal(true), confirmed: { by: 'owner', class: 'brief-harness-defect', ref: 'owner reply', at: minute53(startMinute + 5) } }, ...over });

  it('says exit: 3/3 ready_for_review when each role of the order has a clean run in the current epoch', () => {
    const result = exitVerdict(evidence53(...three()));
    assert.equal(result.verdict, 'exit: 3/3 ready_for_review');
    assert.deepEqual(result.counted, [{ role: 'run2', runId: 'run_run2_1', attempt: 1 }, { role: 'run3', runId: 'run_run3_1', attempt: 1 }, { role: 'run1', runId: 'run_run1_1', attempt: 1 }]);
    assert.deepEqual(result.correctStops, []);
    assert.deepEqual(result.notCounted, []);
  });

  it('counts the latest clean attempt of a role, and lists a correct stop before it as evidence that does not count', () => {
    const result = exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6), correctStop('run1', 1, 11), clean('run1', 2, 20)));
    assert.equal(result.verdict, 'exit: 3/3 ready_for_review');
    assert.deepEqual(result.counted.map((c) => `${c.role}:${c.attempt}`), ['run2:1', 'run3:1', 'run1:2']);
    assert.deepEqual(result.correctStops.map((c) => c['runId']), ['run_run1_1']);
    assert.equal(result.notCounted.length, 0, 'a correct stop is listed under correctStops, not twice');
  });

  it('says exit: 2/3 and lists the correct stop when a role has only a stop that the owner confirmed as a brief/harness defect with docs/system conformant', () => {
    const result = exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6), correctStop('run1', 1, 11)));
    assert.equal(result.verdict, 'exit: 2/3 ready_for_review');
    assert.deepEqual(result.counted.map((c) => c.role), ['run2', 'run3']);
    assert.equal(result.correctStops.length, 1);
    const stop = result.correctStops[0] as Json;
    assert.equal(stop['runId'], 'run_run1_1');
    assert.equal(stop['role'], 'run1');
    assert.equal(stop['class'], 'brief-harness-defect');
    assert.equal(stop['stoppedBy'], 'G2:gsd-verification');
    assert.deepEqual(stop['at'], ['tests/e2e/x.spec.ts:5']);
    assert.equal(stop['docsRef'], 'docs/system/checks-and-evidence.md');
  });

  it('lists a stop that is not a correct stop under notCounted with its reason: unconfirmed, a product defect, or a proposal that does not say docs/system conformant', () => {
    const unconfirmed = exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6), failed53('run1', 1, 11)));
    assert.equal(unconfirmed.verdict, 'exit: 2/3 ready_for_review');
    assert.deepEqual(unconfirmed.correctStops, []);
    assert.match(unconfirmed.notCounted[0]?.reason ?? '', /no owner-confirmed classification/);
    const product = exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6), failed53('run1', 1, 11, { classification: ruled53('product-defect', 16) })));
    assert.deepEqual(product.correctStops, []);
    assert.match(product.notCounted.find((n) => n.runId === 'run_run1_1')?.reason ?? '', /product defect/);
    const nonconformant = exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6), correctStop('run1', 1, 11, { classification: { proposed: proposal(false), confirmed: { by: 'owner', class: 'brief-harness-defect', ref: 'r', at: minute53(16) } } })));
    assert.deepEqual(nonconformant.correctStops, []);
    assert.match(nonconformant.notCounted[0]?.reason ?? '', /docs\/system/);
  });

  it('does not count a pass from before the latest owner-confirmed product defect: the epoch starts at the confirmation, and every role passes again', () => {
    const file = evidence53(clean('run2', 1, 1), clean('run3', 1, 6), failed53('run1', 1, 11, { classification: ruled53('product-defect', 20) }));
    const result = exitVerdict(file);
    assert.equal(result.verdict, 'exit: 0/3 ready_for_review');
    assert.deepEqual(result.counted, []);
    assert.ok(result.notCounted.some((n) => n.runId === 'run_run2_1' && /before the epoch/.test(n.reason)), JSON.stringify(result.notCounted));
    const again = exitVerdict(evidence53(...(file['runs'] as Json[]), clean('run2', 2, 30), clean('run3', 2, 35), clean('run1', 2, 40)));
    assert.equal(again.verdict, 'exit: 3/3 ready_for_review');
    assert.deepEqual(again.counted.map((c) => `${c.role}:${c.attempt}`), ['run2:2', 'run3:2', 'run1:2']);
  });

  const unmet: Array<[string, string, Json, RegExp]> = [
    ['an entry that did not pass', 'run1', { passed: false }, /no owner-confirmed classification/],
    ['an entry with problems', 'run1', { problems: ['required check test is failed at the final revision'] }, /problem/],
    ['a run that did not end ready_for_review', 'run1', { finalState: 'blocked_on_decision' }, /ready_for_review/],
    ['a run whose paused item did not resume its own session', 'run1', { resumed: false }, /resume/],
    ['a decision that did not come from the unit pausing', 'run1', { decisions: [{ decisionId: 'dec_1', state: 'answered', origin: { origin: 'G1:owner-choice-unasked' } }] }, /pause/],
    ['checkout digests that differ', 'run1', { checkout: { equal: false, newRefs: ['refs/heads/avarice/run_run1_1'], removedOrChangedRefs: [] } }, /checkout/],
    ['a ref added other than the run branch', 'run1', { checkout: { equal: true, newRefs: ['refs/heads/avarice/run_run1_1', 'refs/heads/other'], removedOrChangedRefs: [] } }, /branch|ref/],
    ['no run branch added', 'run1', { checkout: { equal: true, newRefs: [], removedOrChangedRefs: [] } }, /branch|ref/],
    ['run 2 with no amendment', 'run2', { contract: { version: 1 } }, /version 2/],
    ['run 2 with no stale decision', 'run2', { decisions: [{ decisionId: 'dec_new', state: 'answered', origin: { origin: 'pause' } }] }, /stale/],
    ['run 3 with no silence block', 'run3', { silence: undefined }, /silence/],
    ['run 3 with a silence block that lists a problem', 'run3', { silence: { problems: ['only 10 s have passed'] } }, /silence/],
  ];
  for (const [name, role, over, pattern] of unmet) {
    it(`does not count ${name}, and says why`, () => {
      const runs = three().map((r) => (r['run'] === role ? { ...r, ...over } : r));
      const result = exitVerdict(evidence53(...runs));
      assert.equal(result.verdict, 'exit: 2/3 ready_for_review');
      assert.ok(!result.counted.some((c) => c.role === role), JSON.stringify(result.counted));
      const reason = result.notCounted.find((n) => n.role === role)?.reason ?? '';
      assert.match(reason, pattern);
    });
  }

  it('reads the expectation of a role from the authorization, not from its name', () => {
    const swapped = { ...AUTH54, briefs: AUTH54.briefs.map((b) => (b['run'] === 'run1' ? { ...b, expects: 'silence' } : b)) };
    const result = exitVerdict(evidence53(...three()), swapped);
    assert.equal(result.verdict, 'exit: 2/3 ready_for_review', 'run1 now expects a silence block it does not have');
  });

  it('says n/3 for a file with no run at all, and never 3/3 for an order of fewer than three roles', () => {
    assert.equal(exitVerdict(evidence53()).verdict, 'exit: 0/3 ready_for_review');
    const two = { ...AUTH54, order: ['run2', 'run3'], briefs: AUTH54.briefs.slice(0, 2) };
    assert.equal(exitVerdict(evidence53(clean('run2', 1, 1), clean('run3', 1, 6)), two).verdict, 'exit: 2/3 ready_for_review');
  });

  it('ignores the supplementary list: a supplementary run counts toward nothing', () => {
    const file = { ...evidence53(clean('run2', 1, 1), clean('run3', 1, 6)), supplementary: [{ runId: 'run_OLD', countsToward3of3: false, resume: { resumed: true } }] };
    const result = exitVerdict(file);
    assert.equal(result.verdict, 'exit: 2/3 ready_for_review');
    assert.equal(result.notCounted.some((n) => n.runId === 'run_OLD'), false);
  });
});

describe('exit evidence: verdict writes the exit record and supplement keeps a superseded run as evidence that never counts (plan 03-54; D-28, D-34)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const BRIEFS = [
    { path: 'b2.md', digest: 'sha256:run2', run: 'run2', expects: 'amend-stale' },
    { path: 'b3.md', digest: 'sha256:run3', run: 'run3', expects: 'silence' },
    { path: 'b1.md', digest: 'sha256:run1', run: 'run1', expects: 'block-resume' },
  ];
  const cleanEntry = (role: string, startMinute: number, over: Json = {}): Json => {
    const runId = `run_${role}_1`;
    return {
      ...passed53(role, 1, startMinute, { runId }),
      problems: [],
      finalState: 'ready_for_review',
      resumed: true,
      checkout: { equal: true, newRefs: [`refs/heads/avarice/${runId}`], removedOrChangedRefs: [] },
      contract: { version: role === 'run2' ? 2 : 1 },
      decisions: [...(role === 'run2' ? [{ decisionId: 'dec_old', state: 'stale', origin: { origin: 'pause' } }] : []), { decisionId: `dec_${role}`, state: 'answered', origin: { origin: 'pause' } }],
      ...(role === 'run3' ? { silence: { problems: [] } } : {}),
      ...over,
    };
  };
  const make = (runs: Json[], extra: Json = {}): { dir: string; auth: string; evidence: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'exit-verdict-'));
    dirs.push(dir);
    const auth = writeFreshAuthorization(dir, { briefs: BRIEFS, order: ['run2', 'run3', 'run1'] });
    const evidence = join(dir, 'evidence.json');
    writeFileSync(evidence, `${JSON.stringify({ schema: 1, plan: '03-57', decision: 'D-26..D-35', updatedAt: '2026-11-10T12:00:00.000Z', exitRules: 'D-26..D-35', runs, supersedes: { file: '03-48-evidence-exit.json', runId: 'run_OLD' }, ...extra }, null, 2)}\n`);
    return { dir, auth, evidence };
  };
  const read = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

  it('verdict writes verdict, verdictRuns, correctStops and verdictAt, keeps every other key, and exits 0 for 3/3', () => {
    const { auth, evidence } = make([cleanEntry('run2', 1), cleanEntry('run3', 6), cleanEntry('run1', 11)]);
    const before = read(evidence);
    const ran = runTools(['verdict', '--evidence', evidence, '--authorization-file', auth]);
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const after = read(evidence);
    assert.equal(after['verdict'], 'exit: 3/3 ready_for_review');
    assert.deepEqual(after['verdictRuns'], [{ role: 'run2', runId: 'run_run2_1', attempt: 1 }, { role: 'run3', runId: 'run_run3_1', attempt: 1 }, { role: 'run1', runId: 'run_run1_1', attempt: 1 }]);
    assert.deepEqual(after['correctStops'], []);
    assert.match(String(after['verdictAt']), /^\d{4}-\d\d-\d\dT/);
    for (const key of ['schema', 'plan', 'decision', 'exitRules', 'runs', 'supersedes']) assert.deepEqual(after[key], before[key], key);
    assert.match(ran.stdout, /exit: 3\/3 ready_for_review/);
  });

  it('verdict writes exit: 2/3 with the correct stop listed and exits 1', () => {
    const stop = failed53('run1', 1, 11, {
      runId: 'run_stop',
      classification: { proposed: { by: 'claude', class: 'brief-harness-defect', stoppedBy: 'G2', at: ['a.ts:1'], docsSystem: { conformant: true, ref: 'docs/system/x.md' }, summary: 's', proposedAt: minute53(12) }, confirmed: { by: 'owner', class: 'brief-harness-defect', ref: 'r', at: minute53(15) } },
    });
    const { auth, evidence } = make([cleanEntry('run2', 1), cleanEntry('run3', 6), stop]);
    const ran = runTools(['verdict', '--evidence', evidence, '--authorization-file', auth]);
    assert.equal(ran.status, 1, ran.stderr + ran.stdout);
    const after = read(evidence);
    assert.equal(after['verdict'], 'exit: 2/3 ready_for_review');
    assert.deepEqual((after['verdictRuns'] as Json[]).map((r) => r['role']), ['run2', 'run3']);
    assert.deepEqual((after['correctStops'] as Json[]).map((c) => c['runId']), ['run_stop']);
    assert.match(ran.stdout, /exit: 2\/3 ready_for_review/);
  });

  it('verdict exits 2 and leaves the file byte-identical for an unreadable evidence file or an authorization that authorizes nothing', () => {
    const { auth, evidence } = make([]);
    const before = sha256Of(evidence);
    assert.equal(runTools(['verdict', '--evidence', join(tmpdir(), 'no-such-evidence.json'), '--authorization-file', auth]).status, 2);
    assert.equal(runTools(['verdict', '--evidence', evidence, '--authorization-file', join(tmpdir(), 'no-such-authorization.json')]).status, 2);
    assert.equal(runTools(['verdict', '--evidence', evidence]).status, 2);
    assert.equal(sha256Of(evidence), before);
  });

  // The facts of old run 1 as plan 03-48 recorded them, in the keys supplement copies.
  const OLD_RUN: Json = {
    runId: 'run_OLD',
    brief: 'test/benchmark/phase3/p3-run1-copy-fallback.md',
    briefDigest: 'sha256:old',
    items: [{ itemId: 'A', state: 'done' }, { itemId: 'B', state: 'done' }],
    decisions: [{ decisionId: 'dec_OLD', class: 'acceptance', state: 'answered', answeredBy: 'owner:tester', answerChannel: 'terminal', origin: { origin: 'pause', signalKind: 'pause' }, issue: 'which wording?' }],
    resume: { resumed: true, itemId: 'B' },
    problems: ['the run stopped again on decision dec_NEXT'],
    checkout: { equal: true, newRefs: [] },
    costUsd: 1.17,
    passed: false,
    state: 'blocked_on_decision',
  };
  const makeOther = (dir: string, runs: Json[] = [OLD_RUN]): string => {
    const other = join(dir, 'other-evidence.json');
    writeFileSync(other, `${JSON.stringify({ schema: 1, plan: '03-48', runs })}\n`);
    return other;
  };
  const supplementArgs = (evidence: string, other: string, runId = 'run_OLD'): string[] => ['supplement', '--evidence', evidence, '--from', other, '--run-id', runId, '--note', 'old run 1: B resumed its own session; stopped at G2'];

  it('supplement appends the superseded run to supplementary, marked countsToward3of3 false, and keeps every other byte of the file', () => {
    const { dir, evidence } = make([cleanEntry('run2', 1)]);
    const before = read(evidence);
    const other = makeOther(dir);
    const ran = runTools(supplementArgs(evidence, other));
    assert.equal(ran.status, 0, ran.stderr + ran.stdout);
    const after = read(evidence);
    const list = after['supplementary'] as Json[];
    assert.equal(list.length, 1);
    const record = list[0] as Json;
    assert.deepEqual(Object.keys(record).sort(), ['brief', 'briefDigest', 'checkout', 'costUsd', 'countsToward3of3', 'decisions', 'fromFile', 'items', 'note', 'problems', 'resume', 'runId']);
    assert.equal(record['runId'], 'run_OLD');
    assert.equal(record['countsToward3of3'], false);
    assert.equal(record['brief'], OLD_RUN['brief']);
    assert.equal(record['briefDigest'], 'sha256:old');
    assert.deepEqual(record['items'], OLD_RUN['items']);
    assert.deepEqual(record['decisions'], [{ id: 'dec_OLD', state: 'answered', class: 'acceptance', origin: 'pause', answeredBy: 'owner:tester', answerChannel: 'terminal' }]);
    assert.deepEqual(record['resume'], OLD_RUN['resume']);
    assert.deepEqual(record['problems'], OLD_RUN['problems']);
    assert.deepEqual(record['checkout'], OLD_RUN['checkout']);
    assert.equal(record['costUsd'], 1.17);
    assert.equal(record['note'], 'old run 1: B resumed its own session; stopped at G2');
    assert.match(String(record['fromFile']), /other-evidence\.json$/);
    for (const key of ['schema', 'plan', 'decision', 'exitRules', 'runs', 'supersedes']) assert.deepEqual(after[key], before[key], key);
  });

  it('a supplementary run is never counted: the verdict after a supplement is the verdict before it', () => {
    const { dir, auth, evidence } = make([cleanEntry('run2', 1), cleanEntry('run3', 6)]);
    assert.equal(runTools(supplementArgs(evidence, makeOther(dir))).status, 0);
    const ran = runTools(['verdict', '--evidence', evidence, '--authorization-file', auth]);
    assert.equal(ran.status, 1, ran.stderr + ran.stdout);
    assert.equal(read(evidence)['verdict'], 'exit: 2/3 ready_for_review');
    assert.equal((read(evidence)['supplementary'] as Json[]).length, 1);
  });

  const supplementRefusals: Array<[string, (dir: string, evidence: string) => string[], RegExp, Json[]?]> = [
    ['a run ID that is an entry of the file', (dir, evidence) => supplementArgs(evidence, makeOther(dir), 'run_run2_1'), /is an entry of/],
    ['a run ID the other file does not hold', (dir, evidence) => supplementArgs(evidence, makeOther(dir), 'run_ABSENT'), /holds no entry|not in/],
    ['an empty note', (dir, evidence) => [...supplementArgs(evidence, makeOther(dir)).slice(0, -1), '  '], /--note/],
    ['an evidence file that is not one', (dir, evidence) => supplementArgs(evidence, join(dir, 'missing.json')), /not an evidence file/],
    ['a missing flag', (_dir, evidence) => ['supplement', '--evidence', evidence, '--run-id', 'run_OLD', '--note', 'n'], /--from/],
  ];
  for (const [name, args, pattern] of supplementRefusals) {
    it(`supplement exits 2 and leaves the file byte-identical for ${name}`, () => {
      const { dir, evidence } = make([cleanEntry('run2', 1)]);
      const before = sha256Of(evidence);
      const ran = runTools(args(dir, evidence));
      assert.equal(ran.status, 2, ran.stdout + ran.stderr);
      assert.match(ran.stderr, pattern);
      assert.equal(sha256Of(evidence), before);
    });
  }

  it('supplement refuses a second supplement of the same run and leaves the file byte-identical', () => {
    const { dir, evidence } = make([cleanEntry('run2', 1)]);
    const other = makeOther(dir);
    assert.equal(runTools(supplementArgs(evidence, other)).status, 0);
    const before = sha256Of(evidence);
    const again = runTools(supplementArgs(evidence, other));
    assert.equal(again.status, 2, again.stdout + again.stderr);
    assert.match(again.stderr, /already/);
    assert.equal(sha256Of(evidence), before);
  });
});
