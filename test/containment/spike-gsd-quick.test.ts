// Spike S2-B (plan 02-09, RESEARCH A2): the real `/gsd-quick --validate --text` unit through the real ClaudeHostAdapter under the run
// purpose, on a generated scratch GSD project. SKIPPED unless AVARICE_LIVE=1, so `npm test` never starts the real claude and never spends.
//
//   AVARICE_LIVE=1 AVARICE_PHASE2_PLAN=02-09 node --test --test-name-pattern="configure|round-1" test/containment/spike-gsd-quick.test.ts
//   AVARICE_LIVE=1 AVARICE_PHASE2_PLAN=02-09 node --test --test-name-pattern="round-2" test/containment/spike-gsd-quick.test.ts
//
// Spend: at most 2 rounds of 2.00 USD each (4.00 USD in all, the plan's own total); every round is guarded by fitsPhase2Ceiling (D-15)
// and by the plan's own total in the Phase 2 ledger. Every verdict is ground truth: the clone's HEAD and changed paths, the quick
// directory's files, the ledger's hook decisions and the host's own tool events. The model's reply is never a verdict.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RUN_GSD_SETTINGS } from '../../src/app/run-gsd-config.ts';
import { applyRunSettings, configDigest, prepareRunUnit, runLiveRunUnit } from '../helpers/live-harness.ts';
import type { LiveRunUnitResult, RunUnitSpec } from '../helpers/live-harness.ts';

const LIVE = process.env['AVARICE_LIVE'] === '1';
const RESULTS = process.env['AVARICE_LIVE_RESULTS'] ?? join(tmpdir(), 'avarice-spike-s2b-results.jsonl');
const opts = { skip: LIVE ? false : 'set AVARICE_LIVE=1 to run the S2-B spike (the rounds spend model budget)' };
const roundOpts = { ...opts, timeout: 30 * 60_000 };

// The rounds a spike run is allowed: the plan's two.
export const ROUND_CAP_USD = 2.0;

function summarize(r: LiveRunUnitResult): Record<string, unknown> {
  const outcome = r.outcome;
  return {
    name: r.name,
    round: r.round,
    claudeVersion: r.claudeVersion,
    runId: r.fixture.runId,
    configure: r.configure,
    configureRecordedBeforeLaunch: r.configureRecordedBeforeLaunch,
    outcomeKind: outcome.ok ? outcome.value.kind : `error:${outcome.error.kind}`,
    exitCode: r.exitCode,
    streamSubtype: r.streamSubtype,
    costUsd: r.costUsd,
    costAssumed: r.costAssumed,
    durationMs: r.durationMs,
    subagentsSpawned: r.subagentsSpawned,
    agentToolCalls: r.agentToolCalls,
    askedUser: r.askedUser,
    headBefore: r.headBefore,
    headAfter: r.headAfter,
    changedPaths: r.changedPaths,
    outsideWriteSet: r.outsideWriteSet,
    summaryFiles: r.summaryFiles,
    verificationStatus: r.verificationStatus,
    sourceUntouched: r.sourceUntouched,
    toolsUsed: [...new Set(r.parsed.trace.map((t) => t.tool))],
    toolCalls: r.parsed.trace.length,
    hookDenyRules: Object.fromEntries([...new Set(r.hookDecisions.filter((d) => d.decision === 'deny').map((d) => d.rule))].map((rule) => [rule, r.hookDecisions.filter((d) => d.decision === 'deny' && d.rule === rule).length])),
    hookAllows: r.hookDecisions.filter((d) => d.decision === 'allow').length,
    denials: r.denials,
    evidenceDir: r.evidenceDir,
  };
}

function record(entry: Record<string, unknown>): void {
  appendFileSync(RESULTS, JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n');
}

// The pass bar of a round (plan 02-09 truths): a SUMMARY under .planning/quick, the in-scope file changed, the clone HEAD at its base
// (no commit by the model), no write outside the write set and no human prompt. An empty round (no in-scope change) never passes.
export function passBar(r: LiveRunUnitResult): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (!r.hostStarted) failures.push('the host never started');
  if (r.summaryFiles.length === 0) failures.push('no SUMMARY under .planning/quick');
  if (!r.changedPaths.some((c) => c.path === 'src/slug.ts')) failures.push('src/slug.ts was not changed (an empty round is not progress)');
  if (r.headAfter !== r.headBefore) failures.push('the clone HEAD moved (the model committed)');
  if (r.outsideWriteSet.length > 0) failures.push(`writes outside the write set: ${r.outsideWriteSet.join(', ')}`);
  if (r.askedUser) failures.push('the unit asked the user a question');
  return { passed: failures.length === 0, failures };
}

async function round(t: TestContext, spec: RunUnitSpec): Promise<LiveRunUnitResult | undefined> {
  const run = await runLiveRunUnit(spec);
  if ('skipped' in run) {
    record({ name: spec.name, verdict: 'not run', reason: run.skipped });
    t.skip(run.skipped);
    return undefined;
  }
  const bar = passBar(run);
  record({ ...summarize(run), passBar: bar });
  writeFileSync(join(run.evidenceDir, 'round-summary.json'), JSON.stringify({ ...summarize(run), passBar: bar }, null, 2));
  console.log(`# ${spec.name}: ${bar.passed ? 'PASS' : 'does not meet the bar'}${bar.failures.length > 0 ? ` (${bar.failures.join('; ')})` : ''}; cost ${run.costUsd.toFixed(4)} USD; evidence ${run.evidenceDir}`);
  return run;
}

test('configure: RUN_GSD_SETTINGS apply key by key through config-set and twice give the same config digest (idempotency edge, no spend)', opts, async () => {
  const fixture = prepareRunUnit();
  try {
    const first = await applyRunSettings(fixture, RUN_GSD_SETTINGS);
    const digestFirst = configDigest(fixture.clone);
    const second = await applyRunSettings(fixture, RUN_GSD_SETTINGS);
    const digestSecond = configDigest(fixture.clone);
    // RESEARCH A5: is `workflow.windows_enforce` a key config-set accepts? Recorded, never added to RUN_GSD_SETTINGS here.
    const windows = await applyRunSettings(fixture, [['workflow.windows_enforce', 'true']]);
    record({ name: 'configure', first, second, digestFirst, digestSecond, windowsEnforceProbe: windows });
    console.log(`# configure first: ${JSON.stringify(first)}`);
    console.log(`# configure A5 probe workflow.windows_enforce: ${JSON.stringify(windows)}`);
    assert.deepEqual(
      second.map((r) => [r.key, r.accepted]),
      first.map((r) => [r.key, r.accepted]),
      'the same keys are accepted and refused the second time',
    );
    assert.equal(digestSecond, digestFirst, 'applying the settings twice changed .planning/config.json');
    assert.notEqual(digestFirst, 'absent', 'no .planning/config.json was written');
  } finally {
    fixture.close();
  }
});

test('round-1: the real quick unit under the run purpose at a 2.00 USD cap (observation: it may fail its bar)', roundOpts, async (t) => {
  const run = await round(t, { name: 'round-1', round: 1, costCapUsd: ROUND_CAP_USD });
  if (run === undefined) return;
  assert.ok(run.hostStarted, 'the host was never started');
  assert.ok(run.configureRecordedBeforeLaunch, 'gsd:configure was not recorded as completed before the unit was launched');
  assert.equal(run.sourceUntouched, true, "the user's repository changed");
});

test('round-2: the real quick unit after the recorded denials were disposed of, at a 2.00 USD cap (the pass bar)', roundOpts, async (t) => {
  const run = await round(t, { name: 'round-2', round: 2, costCapUsd: ROUND_CAP_USD, ...round2Spec() });
  if (run === undefined) return;
  assert.equal(run.sourceUntouched, true, "the user's repository changed");
  assert.ok(run.configureRecordedBeforeLaunch, 'gsd:configure was not recorded as completed before the unit was launched');
  const bar = passBar(run);
  assert.deepEqual(bar.failures, [], `round 2 did not meet the bar: ${bar.failures.join('; ')}`);
});

// What round 2 changes against round 1 (settings, pre-launch directories, prompt), filled in from the round-1 evidence.
function round2Spec(): Partial<RunUnitSpec> {
  return {};
}
