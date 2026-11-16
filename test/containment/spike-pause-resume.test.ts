// Spike S3-A (plan 03-13, RESEARCH Wave 0, flagged assumptions A2, A3, A4 and A10): the live pause and resume of a real contained
// `/gsd-quick --validate --text` unit, through the real ClaudeHostAdapter under the run purpose, on a generated scratch GSD project.
// SKIPPED unless AVARICE_LIVE=1, so `npm test` never starts the real claude and never spends.
//
//   AVARICE_LIVE=1 AVARICE_PHASE3_PLAN=03-13 AVARICE_LIVE_RESULTS=test/containment/live-run-phase3-spike.jsonl \
//     node --test --test-name-pattern="round-1|missing-session" test/containment/spike-pause-resume.test.ts
//   AVARICE_LIVE=1 AVARICE_PHASE3_PLAN=03-13 AVARICE_LIVE_RESULTS=test/containment/live-run-phase3-spike.jsonl \
//     node --test --test-name-pattern="round-2" test/containment/spike-pause-resume.test.ts
//
// What it measures: (A3) given the RUN_DECISION_SENTENCE and a brief whose acceptance criterion leaves a user-visible choice to the owner,
// does the unit's final text end in a question followed by numbered choices, and does the host outcome's question carry it; (A2, A10) does the
// paused session relaunch with `--resume <session>` under the full containment line and a fresh cost cap, re-read files before editing and
// finish the unit; what a resume of an unknown session does (the fresh-unit fallback trigger of plan 03-22); (A4) does the quick PLAN cite
// the item's acceptance IDs and how does it mark a checkpoint:decision.
//
// Spend: every start is guarded by the Phase 3 ledger (25 USD, D-05) and the spike's own 4.00 USD total (spike3Refusal); each cost is recorded
// in the Phase 3 ledger under plan 03-13. Every verdict is ground truth: the clone's changed paths and file contents, the quick directory,
// the ledger's hook decisions and the host's own tool events. The model's words are never a verdict, and the question text is never written
// to a results file (T-03-23): only whether it is present and how long it is.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectPause } from '../../src/domain/outcome.ts';
import { parseQuickPlan } from '../../src/domain/quick-record.ts';
import { SPIKE3_PLAN, promptItemOf, runLiveRunUnit } from '../helpers/live-harness.ts';
import type { CloneFacts, LiveRunUnitResult, RunUnitSpec } from '../helpers/live-harness.ts';
import type { ParsedTranscript } from '../helpers/live-harness.ts';

const LIVE = process.env['AVARICE_LIVE'] === '1';
const RESULTS = process.env['AVARICE_LIVE_RESULTS'] ?? join(tmpdir(), 'avarice-spike-s3a-results.jsonl');
const opts = { skip: LIVE ? false : 'set AVARICE_LIVE=1 to run the S3-A spike (the rounds spend model budget)' };
const roundOpts = { ...opts, timeout: 30 * 60_000 };

// The two rounds the plan allows, as the cap of each of their invocations; round 2 exists only when round 1 shows a silent pick.
export const ROUND1_CAP_USD = 1.5;
export const ROUND2_CAP_USD = 2.0;
export const MISSING_SESSION_CAP_USD = 0.1;

// The item whose acceptance criterion leaves a user-visible choice to the owner, and the answer the resume carries.
export const CHOICE_ITEM = 'B';
export const OWNER_ANSWER = '1';

// A brief with two items: A is independent and one line, B names a choice that is the owner's (a user-visible wording) and says the unit must ask.
export const SPIKE_BRIEF = [
  '---',
  'title: Slug fallback',
  'items: [{"id":"A","title":"Collapse repeated dashes in slugs","dependsOn":[],"size":"small","model":"sonnet","acceptance":["AC1"]},{"id":"B","title":"Choose the fallback word for a title with no letters or digits","dependsOn":[],"size":"small","model":"sonnet","acceptance":["AC2"]}]',
  '---',
  '## Behavior',
  'A slug never contains two dashes in a row. A title with no letters or digits gets a fallback word instead of an empty slug.',
  '',
  '## Acceptance criteria',
  '- AC1: Repeated separators collapse to one dash | verifiedBy: check:test',
  '- AC2: A title with no letters or digits slugifies to a fallback word. The owner chooses between the two wordings untitled and page, so the unit must ask the owner which wording and must not pick one itself | verifiedBy: check:test',
  '',
  '## Write',
  '- src/**',
  '- test/**',
  '',
  '## Target checks',
  '- test',
  '',
].join('\n');

const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function record(entry: Record<string, unknown>): void {
  appendFileSync(RESULTS, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
}

// The ground truth the verdicts read: does the behaviour the owner chooses exist in the source, as a word of either wording.
function choiceProbe(clone: string): Record<string, unknown> {
  const file = join(clone, 'src', 'slug.ts');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return { slugSourceHasFallbackWord: /\b(untitled|page)\b/i.test(text), slugSourceDigest: sha256(text) };
}

const toolsUsed = (parsed: ParsedTranscript): string[] => [...new Set(parsed.trace.map((t) => t.tool))];

// Whether each file the invocation edited or wrote was read earlier in the same invocation (the hook's read-before-edit record is per invocation).
function readBeforeEdit(parsed: ParsedTranscript): { edits: number; editsPrecededByRead: number } {
  const readPaths = new Set<string>();
  let edits = 0;
  let preceded = 0;
  for (const call of parsed.trace) {
    const path = typeof call.input['file_path'] === 'string' ? call.input['file_path'] : undefined;
    if (path === undefined) continue;
    if (call.tool === 'Read') readPaths.add(path);
    if (call.tool === 'Edit' || call.tool === 'Write') {
      edits += 1;
      if (readPaths.has(path)) preceded += 1;
    }
  }
  return { edits, editsPrecededByRead: preceded };
}

function hookCounts(decisions: ReadonlyArray<{ decision: string; rule: string }>): { hookAllows: number; hookDenies: number; hookDenyRules: Record<string, number> } {
  const denies = decisions.filter((d) => d.decision === 'deny');
  return {
    hookAllows: decisions.filter((d) => d.decision === 'allow').length,
    hookDenies: denies.length,
    hookDenyRules: Object.fromEntries([...new Set(denies.map((d) => d.rule))].map((rule) => [rule, denies.filter((d) => d.rule === rule).length])),
  };
}

// The facts of the quick PLAN a unit wrote, against the acceptance IDs of the item.
function planFacts(planText: string | null, itemAcceptanceIds: readonly string[]): Record<string, unknown> {
  const plan = parseQuickPlan(planText);
  if (plan === null) return { planPresent: false, citesAllItemAcceptance: false };
  return {
    planPresent: true,
    planBytes: planText === null ? 0 : Buffer.byteLength(planText),
    acceptanceRefs: plan.acceptanceRefs,
    citesAllItemAcceptance: itemAcceptanceIds.every((id) => plan.acceptanceRefs.includes(id)),
    decisionCheckpoints: plan.decisionCheckpoints.length,
    decisionCheckpointAutoSelect: plan.decisionCheckpoints.map((c) => c.hasAutoSelect),
    decisionCheckpointOptionIds: plan.decisionCheckpoints.map((c) => c.optionIds),
    filesModified: plan.filesModified,
    taskFiles: plan.taskFiles,
  };
}

function cloneSummary(facts: CloneFacts, itemAcceptanceIds: readonly string[]): Record<string, unknown> {
  return {
    changedPaths: facts.changedPaths,
    outsideWriteSet: facts.outsideWriteSet,
    headAfter: facts.headAfter,
    summaryFiles: facts.summaryFiles,
    quickFiles: facts.quickFiles,
    verificationStatus: facts.verificationStatus ?? null,
    probe: facts.probe,
    ...planFacts(facts.planText, itemAcceptanceIds),
  };
}

// The pause facts of a final text: presence and length only, never the text (T-03-23), and the structural reading detectPause gives it.
function questionFacts(question: string | undefined): Record<string, unknown> {
  const detection = detectPause(question === undefined ? {} : { finalTextTail: question });
  return { questionPresent: question !== undefined && question.trim() !== '', questionLength: question?.length ?? 0, pauseDetected: detection.paused, pauseSignal: detection.signal };
}

function firstSummary(run: LiveRunUnitResult, itemAcceptanceIds: readonly string[]): Record<string, unknown> {
  const outcome = run.outcome;
  const facts: CloneFacts = {
    changedPaths: run.changedPaths,
    outsideWriteSet: run.outsideWriteSet,
    headAfter: run.headAfter,
    summaryFiles: run.summaryFiles,
    quickFiles: run.quickFiles,
    planText: run.planText,
    verificationStatus: run.verificationStatus,
    probe: run.probe,
  };
  return {
    name: run.name,
    round: run.round,
    claudeVersion: run.claudeVersion,
    runId: run.fixture.runId,
    configureRecordedBeforeLaunch: run.configureRecordedBeforeLaunch,
    outcomeKind: outcome.ok ? outcome.value.kind : `error:${outcome.error.kind}`,
    sessionId: outcome.ok ? outcome.value.sessionId : null,
    resultSeen: outcome.ok ? (outcome.value.details?.resultSeen ?? null) : null,
    isError: outcome.ok ? (outcome.value.details?.isError ?? null) : null,
    exitCode: run.exitCode ?? null,
    streamSubtype: run.streamSubtype ?? null,
    numTurns: outcome.ok ? (outcome.value.details?.numTurns ?? null) : null,
    costUsd: run.costUsd,
    costAssumed: run.costAssumed,
    durationMs: run.durationMs,
    ...questionFacts(outcome.ok ? outcome.value.question : undefined),
    askedUserTool: run.askedUser,
    headMoved: run.headAfter !== run.headBefore,
    toolsUsed: toolsUsed(run.parsed),
    toolCalls: run.parsed.trace.length,
    subagentsSpawned: run.subagentsSpawned ?? null,
    ...hookCounts(run.hookDecisions),
    denials: run.denials.length,
    sourceUntouched: run.sourceUntouched,
    transcriptDigest: sha256(run.transcript),
    transcriptArtifact: outcome.ok ? (outcome.value.transcriptArtifact ?? null) : null,
    ...cloneSummary(facts, itemAcceptanceIds),
    evidenceDir: run.evidenceDir,
  };
}

// One real unit on item B and its resume, run once and shared by the pause and the resume test of the round (the resume needs the same clone,
// because the host keys a session to its working directory).
const rounds = new Map<number, Promise<Awaited<ReturnType<typeof runLiveRunUnit>>>>();
const kept: LiveRunUnitResult[] = [];

function roundRun(round: number, cap: number): Promise<Awaited<ReturnType<typeof runLiveRunUnit>>> {
  let existing = rounds.get(round);
  if (existing === undefined) {
    const spec: RunUnitSpec = {
      name: `round-${round}`,
      round,
      plan: SPIKE3_PLAN,
      model: 'sonnet',
      costCapUsd: cap,
      itemId: CHOICE_ITEM,
      project: { brief: SPIKE_BRIEF },
      probe: choiceProbe,
      resume: { answer: OWNER_ANSWER, itemId: CHOICE_ITEM, costCapUsd: cap },
    };
    existing = runLiveRunUnit(spec).then((run) => {
      if (!('skipped' in run)) kept.push(run);
      return run;
    });
    rounds.set(round, existing);
  }
  return existing;
}

// The evidence directories (redacted transcripts, round summaries) are kept, as spike S2-B kept them: the verdicts cite them by digest.
void kept;

async function pauseTest(t: TestContext, round: number, cap: number): Promise<void> {
  const run = await roundRun(round, cap);
  if ('skipped' in run) {
    record({ name: `round-${round} pause`, verdict: 'not run', reason: run.skipped });
    t.skip(run.skipped);
    return;
  }
  const ids = promptItemOf(run.fixture.contract, CHOICE_ITEM).acceptance.map((line) => line.split(':')[0] as string);
  const summary = firstSummary(run, ids);
  record({ ...summary, name: `round-${round} pause`, itemAcceptanceIds: ids });
  writeFileSync(join(run.evidenceDir, `round-${round}-pause-summary.json`), JSON.stringify(summary, null, 2));
  console.log(`# round-${round} pause: outcome ${String(summary['outcomeKind'])}, questionPresent ${String(summary['questionPresent'])}, signal ${String(summary['pauseSignal'])}, slug source has a fallback word ${String((run.probe as Record<string, unknown>)['slugSourceHasFallbackWord'])}; cost ${run.costUsd.toFixed(4)} USD; evidence ${run.evidenceDir}`);
  assert.ok(run.hostStarted, 'the host was never started');
  assert.ok(run.configureRecordedBeforeLaunch, 'gsd:configure was not recorded as completed before the unit was launched');
  assert.equal(run.sourceUntouched, true, "the user's repository changed");
}

async function resumeTest(t: TestContext, round: number, cap: number): Promise<void> {
  const run = await roundRun(round, cap);
  if ('skipped' in run) {
    record({ name: `round-${round} resume`, verdict: 'not run', reason: run.skipped });
    t.skip(run.skipped);
    return;
  }
  const resumed = run.resumed;
  if (resumed === undefined) {
    record({ name: `round-${round} resume`, verdict: 'not run', reason: 'the first invocation returned no outcome to resume' });
    t.skip('the first invocation returned no outcome to resume');
    return;
  }
  if (resumed.skipped !== undefined) {
    record({ name: `round-${round} resume`, verdict: 'not run', reason: resumed.skipped });
    t.skip(resumed.skipped);
    return;
  }
  const ids = promptItemOf(run.fixture.contract, CHOICE_ITEM).acceptance.map((line) => line.split(':')[0] as string);
  const outcome = resumed.outcome;
  const firstSession = run.outcome.ok ? run.outcome.value.sessionId : null;
  const firstCost = run.costUsd;
  const summary = {
    name: `round-${round} resume`,
    round,
    claudeVersion: run.claudeVersion,
    runId: run.fixture.runId,
    resumedSessionId: resumed.sessionId,
    sameSessionAsFirst: firstSession !== null && resumed.sessionId === firstSession,
    resumeAccepted: resumed.hostStarted,
    outcomeKind: outcome.ok ? outcome.value.kind : `error:${outcome.error.kind}`,
    reportedSessionId: outcome.ok ? outcome.value.sessionId : null,
    resultSeen: resumed.resultSeen ?? null,
    isError: resumed.isError ?? null,
    exitCode: resumed.exitCode ?? null,
    streamSubtype: resumed.streamSubtype ?? null,
    numTurns: outcome.ok ? (outcome.value.details?.numTurns ?? null) : null,
    costUsd: resumed.costUsd,
    costAssumed: resumed.costAssumed,
    firstInvocationCostUsd: firstCost,
    costCapUsd: cap,
    durationMs: resumed.durationMs,
    ...questionFacts(outcome.ok ? outcome.value.question : undefined),
    toolsUsed: toolsUsed(resumed.parsed),
    toolCalls: resumed.parsed.trace.length,
    ...readBeforeEdit(resumed.parsed),
    ...hookCounts(resumed.hookDecisions),
    askedUserTool: resumed.parsed.trace.some((c) => c.tool === 'AskUserQuestion'),
    headMoved: resumed.headAfter !== run.headBefore,
    transcriptDigest: sha256(resumed.transcript),
    transcriptArtifact: outcome.ok ? (outcome.value.transcriptArtifact ?? null) : null,
    ...cloneSummary(resumed, ids),
    evidenceDir: run.evidenceDir,
  };
  record(summary);
  writeFileSync(join(run.evidenceDir, `round-${round}-resume-summary.json`), JSON.stringify(summary, null, 2));
  console.log(`# round-${round} resume: accepted ${String(resumed.hostStarted)}, outcome ${String(summary.outcomeKind)}, resultSeen ${String(summary.resultSeen)}, summaries ${resumed.summaryFiles.length}, cost ${resumed.costUsd.toFixed(4)} USD; evidence ${run.evidenceDir}`);
  assert.ok(resumed.hostStarted, 'the resumed host was never started');
  assert.equal(run.sourceUntouched, true, "the user's repository changed");
}

test('round-1 pause: the real quick unit for the planted-choice item at a 1.50 USD cap (observation: it may pick silently)', roundOpts, async (t) => {
  await pauseTest(t, 1, ROUND1_CAP_USD);
});

test('round-1 resume: the paused session relaunched with --resume and the owner answer, under the full containment line and a fresh 1.50 USD cap', roundOpts, async (t) => {
  await resumeTest(t, 1, ROUND1_CAP_USD);
});

// A resume of a session ID that does not exist: the host is started (the marker appears), no model call is made, and the outcome says what the
// host printed. The fresh-unit fallback of plan 03-22 is triggered by exactly this ending.
test('missing-session: --resume of a random session ID at a 0.10 USD cap (the fresh-unit fallback trigger)', roundOpts, async (t) => {
  const session = randomUUID();
  const run = await runLiveRunUnit({
    name: 'missing-session',
    round: 1,
    plan: SPIKE3_PLAN,
    model: 'sonnet',
    costCapUsd: MISSING_SESSION_CAP_USD,
    project: { brief: SPIKE_BRIEF },
    probe: choiceProbe,
    resumeOnly: { sessionId: session, answer: OWNER_ANSWER, itemId: CHOICE_ITEM },
  });
  if ('skipped' in run) {
    record({ name: 'missing-session', verdict: 'not run', reason: run.skipped });
    t.skip(run.skipped);
    return;
  }
  {
    const outcome = run.outcome;
    const ids = promptItemOf(run.fixture.contract, CHOICE_ITEM).acceptance.map((line) => line.split(':')[0] as string);
    const summary: Record<string, unknown> = {
      ...firstSummary(run, ids),
      name: 'missing-session',
      requestedSessionIdWasUnknown: true,
      hostStarted: run.hostStarted,
      // The host's own words are searched for the one fixed phrase; the text itself is not stored.
      noConversationMessage: /No conversation found/i.test(run.transcript),
      hasResultEvent: outcome.ok ? (outcome.value.details?.resultSeen ?? null) : null,
      errorKind: outcome.ok ? null : outcome.error.kind,
    };
    record(summary);
    writeFileSync(join(run.evidenceDir, 'missing-session-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`# missing-session: host started ${String(run.hostStarted)}, outcome ${String(summary.outcomeKind)}, resultSeen ${String(summary.resultSeen)}, subtype ${String(summary.streamSubtype)}, no-conversation message ${String(summary.noConversationMessage)}; cost ${run.costUsd.toFixed(4)} USD`);
    assert.ok(run.hostStarted, 'the host was never started');
    assert.equal(run.sourceUntouched, true, "the user's repository changed");
  }
});

// Round 2 exists only when round 1 shows a silent pick (D-02): RUN_DECISION_SENTENCE is then changed once and these run at 2.00 USD.
test('round-2 pause: the real quick unit for the planted-choice item after the decision sentence was changed, at a 2.00 USD cap', roundOpts, async (t) => {
  await pauseTest(t, 2, ROUND2_CAP_USD);
});

test('round-2 resume: the paused session relaunched with --resume and the owner answer, at a fresh 2.00 USD cap', roundOpts, async (t) => {
  await resumeTest(t, 2, ROUND2_CAP_USD);
});
