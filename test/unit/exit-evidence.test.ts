// The judging helpers of the Phase 3 live exit (plan 03-29; D-02, D-03, D-05): where a decision came from, what a run that must stop on the planted
// decision looks like, what a resumed run must show, the spend guard and the transcript readers. Pure functions: nothing here starts a model or
// touches the portfolio.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  evidenceFileBody,
  initSessions,
  judgeFinish,
  judgeStart,
  livePlan,
  originOf,
  pinnedByOf,
  promptScopeOf,
  runStateOf,
  spendGuard,
  supersededRunRefusal,
  toolUseCounts,
} from '../../scripts/exit-run-phase3-tools.ts';
import { cancelCli, startBlockedS17 } from '../helpers/cancel-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';

type Json = Record<string, unknown>;
const ROOT = resolve(import.meta.dirname, '../..');

const choice = (key: string): Json => ({ key, label: `wording ${key}`, kind: 'choice' });
const pauseDecision = (over: Json = {}): Json => ({
  decisionId: 'dec_AAAA',
  state: 'open',
  class: 'human',
  contractVersion: 1,
  affectedItems: ['B'],
  options: [choice('1'), choice('2'), { key: 'text', label: 'free text', kind: 'text' }],
  origin: { origin: 'pause' },
  ...over,
});
const items = (over: Record<string, Json> = {}): Json[] => [
  { itemId: 'A', state: 'done', dependsOn: [], attempts: 1, ...(over['A'] ?? {}) },
  { itemId: 'B', state: 'blocked_on_decision', dependsOn: [], attempts: 1, ...(over['B'] ?? {}) },
  { itemId: 'C', state: 'ready', dependsOn: ['B'], attempts: 0, ...(over['C'] ?? {}) },
];
const stopped = (over: Json = {}): Parameters<typeof judgeStart>[0] => ({ state: 'blocked_on_decision', reason: 'decision', items: items(), decisions: [pauseDecision()], notifications: [{}], askUserQuestion: 0, ...over }) as Parameters<typeof judgeStart>[0];

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

  it('refuses a failed required check, an unsatisfied criterion, a dirty tree and a missing G4 or commit', () => {
    const bad = judgeFinish(finished({ requiredChecks: [{ name: 'test', status: 'failed' }], acceptance: [{ id: 'AC2', satisfied: false }], clean: false, commit: null, gates: [] }));
    for (const part of ['required check test', 'acceptance criterion AC2', 'clean tree', 'no handed-off commit', 'G4']) assert.ok(bad.problems.some((p) => p.includes(part)), part);
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

describe('exit-run-phase3.sh: the default evidence file of the repeated exit (plan 03-41)', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'exit-run-phase3.sh'), 'utf8');
  it('defaults to 03-42-evidence-exit.json and records under plan 03-42; 03-29 is named only as history in the header', () => {
    assert.match(script, /^EVID_DEFAULT=.*03-42-evidence-exit\.json"$/m);
    assert.match(script, /^\s*export AVARICE_PHASE3_PLAN="\$\{AVARICE_PHASE3_PLAN:-03-42\}"$/m);
    const lines = script.split('\n');
    assert.equal(lines.filter((l) => !l.startsWith('#') && l.includes('03-29-evidence-exit.json')).length, 0);
    assert.ok(lines.some((l) => l.startsWith('#') && l.includes('03-29-evidence-exit.json')));
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
    const auth = join(dir, 'auth.json');
    writeFileSync(auth, JSON.stringify({ selection: 'approve', perRunCapUsd: 5.62, ceilingUsd: 25, host: { claudeBin: '/nonexistent/claude', claudeVersion: '2.1.319' }, briefs: [] }));
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
