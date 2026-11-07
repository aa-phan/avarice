// T3 live suite for the `avarice-run` skill in attended sessions (plan 02-25, UAT gap G-02-9): the real `claude -p` on a generated scratch
// repository with the skill installed by the production `avarice install-host`. The live cases are SKIPPED unless AVARICE_LIVE=1, so
// `npm test` never starts the real claude and never spends.
//
//   AVARICE_LIVE=1 AVARICE_LIVE_KEEP=1 AVARICE_PHASE2_PLAN=02-25 node --test --test-name-pattern="live attended-" test/containment/live-attended-skill.test.ts
//
// Every session is gated by the Phase 2 ceiling and a 4.00 USD plan cap (D-15) and recorded in the Phase 2 ledger. Every verdict comes from
// the host's own events, its denial records, file digests and the production pause recogniser; the model's account of itself is never a
// verdict. A judged session is never re-run. One line per session goes to test/containment/live-attended-phase2.jsonl.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactSecrets } from '../../src/domain/secret-patterns.ts';
import { PLAN_CAP_USD, assertAttendedIntegrity, assertProfileGone, attendedForecast, attendedRefusal, appendAttendedResult, behaviorVerdicts, buildAttendedLine, caseSkipReason, cleanupAttended, isMarker, judgeCase, prepareAttendedFixture, readAttendedResults, runAttendedSession } from '../helpers/live-attended.ts';
import type { AttendedCase } from '../helpers/live-attended.ts';

const LIVE = process.env['AVARICE_LIVE'] === '1';
const opts = { skip: LIVE ? false : 'set AVARICE_LIVE=1 to run the live attended-session cases (they spend model budget)' };
const liveOpts = { ...opts, timeout: 10 * 60_000 };

// The case table, in run order: judged cases first in round-robin order across the behaviors, then the control. No prompt names a command
// or uses the word status.
export const ATTENDED_CASES: readonly AttendedCase[] = [
  {
    name: 'status-first-1',
    behavior: 'status-first',
    withSkill: true,
    prompt: 'This repository is managed by AVARICE and there is an AVARICE run on it. Tell me where that run stands and what I should look at next.',
  },
];

for (const c of ATTENDED_CASES) {
  test(`live attended-${c.name}: ${c.behavior}`, liveOpts, async (t) => {
    const skip = caseSkipReason(c.name, readAttendedResults(), process.env['AVARICE_LIVE_RERUN']);
    if (skip !== undefined) {
      t.skip(skip);
      return;
    }
    const refusal = attendedRefusal();
    if (refusal !== undefined) {
      t.skip(refusal);
      return;
    }
    const fixture = prepareAttendedFixture({ name: c.name, withSkill: c.withSkill });
    try {
      const session = await runAttendedSession(fixture, c.name, c.prompt);
      if ('skipped' in session) {
        t.skip(session.skipped);
        return;
      }
      assertAttendedIntegrity(fixture, c.name, c.behavior, session);
      const judgment = judgeCase(c, session);
      const line = buildAttendedLine(c, fixture, session, judgment);
      appendAttendedResult(line);
      t.diagnostic(`attended ${c.name}: ${judgment.verdict}: ${judgment.reason}`);
      t.diagnostic(`attended ${c.name}: cost ${line.costUsd.toFixed(4)} USD, host ${line.claudeVersion}, model ${String(line.model)}, skill listed ${String(line.skillListed)} (${String(line.skillListedField)}), host state changes ${JSON.stringify(line.hostStateChanges)}, evidence ${fixture.evidenceDir}`);
    } finally {
      cleanupAttended(fixture);
    }
    assertProfileGone(fixture);
  });
}

test('attended record is well formed', () => {
  const names = new Set(ATTENDED_CASES.map((c) => c.name));
  const records = readAttendedResults();
  for (const [index, line] of records.entries()) {
    const where = `line ${index + 1} (${String(line.case)})`;
    assert.ok(names.has(line.case), `${where}: a case that is not in the table`);
    if (isMarker(line)) {
      // An owner invalidation: it names an earlier line of the same case by its time and states why.
      assert.ok(records.slice(0, index).some((r) => !isMarker(r) && r.case === line.case && r.at === line.invalidates), `${where}: names no earlier line of its case`);
      assert.ok(line.reason.length > 0 && !Number.isNaN(Date.parse(line.at)), `${where}: reason and time`);
      continue;
    }
    assert.ok(['PASS', 'FAIL', 'NOT_EXERCISED'].includes(line.verdict), `${where}: verdict`);
    assert.equal(line.notExercised, line.verdict === 'NOT_EXERCISED', `${where}: notExercised disagrees with the verdict`);
    assert.equal(typeof line.reason, 'string', where);
    assert.ok(Number.isFinite(line.costUsd) && line.costUsd >= 0, `${where}: costUsd`);
    assert.equal(typeof line.claudeVersion, 'string', where);
    assert.ok(line.model === null || typeof line.model === 'string', `${where}: model`);
    assert.equal(typeof line.skillListed, 'boolean', where);
    assert.ok(Array.isArray(line.calls) && line.calls.length <= 40, `${where}: calls`);
    assert.ok(line.finalTextTail.length <= 600, `${where}: finalTextTail is longer than 600 characters`);
    assert.ok(Array.isArray(line.hostStateChanges), `${where}: hostStateChanges`);
    assert.equal(typeof line.evidenceDir, 'string', where);
    assert.ok(!Number.isNaN(Date.parse(line.at)), `${where}: at`);
    const text = JSON.stringify(line);
    assert.equal(redactSecrets(text), text, `${where}: the line carries something a secret pattern matches`);
  }
});

test('attended verdicts', (t) => {
  const lines = readAttendedResults();
  for (const s of behaviorVerdicts(ATTENDED_CASES, lines)) {
    t.diagnostic(`attended ${s.behavior}: ${s.verdict} ${s.passed}/${s.judged} (${s.notRun} not run)`);
  }
});

test('attended forecast', (t) => {
  t.diagnostic(`attended forecast: ${attendedForecast(ATTENDED_CASES, readAttendedResults()).toFixed(2)} of ${PLAN_CAP_USD.toFixed(2)} USD`);
});
