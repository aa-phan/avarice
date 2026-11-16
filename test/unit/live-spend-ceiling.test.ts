// The per-phase live-spend ceilings: Phase 2 (plan 02-01, D-15) and Phase 3 (plan 03-01, D-05), each one ledger and one 25 USD
// ceiling, and Phase 4 (plan 04-01, D-03), one ledger and one 40 USD ceiling, checked before any live host start. Every new live spend is
// judged against the Phase 4 ledger.
// Offline: the ledger and the suite ledger point at temp files, so nothing here starts a host or spends.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CURRENT_SPEND_PHASE,
  LIVE_PLAN_03_27_GROUP,
  LIVE_PLAN_03_27_TOTAL_USD,
  PHASE2_CEILING_USD,
  PHASE3_CEILING_USD,
  PHASE4_CEILING_USD,
  currentSpendLedger,
  fitsCap,
  fitsPhase2Ceiling,
  fitsPhase3Ceiling,
  fitsPhase4Ceiling,
  phase2Ceiling,
  phase2Spent,
  phase3Ceiling,
  phase3Spent,
  phase4Ceiling,
  phase4Spent,
  planGroupTotalRefusal,
  recordPhase2Spend,
  recordPhase3Spend,
  recordPhase4Spend,
  recordSpend,
  spendRefusal,
  spentByPlan,
  spikeRefusal,
} from '../helpers/live-harness.ts';

const LEDGER_ENV = 'AVARICE_PHASE2_LEDGER';
const CEILING_ENV = 'AVARICE_PHASE2_CEILING_USD';
const SUITE_LEDGER_ENV = 'AVARICE_LIVE_LEDGER';
const P3_LEDGER_ENV = 'AVARICE_PHASE3_LEDGER';
const P3_CEILING_ENV = 'AVARICE_PHASE3_CEILING_USD';
const P3_PLAN_ENV = 'AVARICE_PHASE3_PLAN';
const P4_LEDGER_ENV = 'AVARICE_PHASE4_LEDGER';
const P4_CEILING_ENV = 'AVARICE_PHASE4_CEILING_USD';
const P4_PLAN_ENV = 'AVARICE_PHASE4_PLAN';
const KEYS = [LEDGER_ENV, CEILING_ENV, SUITE_LEDGER_ENV, P3_LEDGER_ENV, P3_CEILING_ENV, P3_PLAN_ENV, P4_LEDGER_ENV, P4_CEILING_ENV, P4_PLAN_ENV];

let dir = '';
let ledger = '';
let ledger3 = '';
let ledger4 = '';
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'avarice-phase2-ledger-'));
  ledger = join(dir, 'live-spend-phase2.jsonl');
  process.env[LEDGER_ENV] = ledger;
  ledger3 = join(dir, 'live-spend-phase3.jsonl');
  process.env[P3_LEDGER_ENV] = ledger3;
  delete process.env[P3_CEILING_ENV];
  delete process.env[P3_PLAN_ENV];
  ledger4 = join(dir, 'live-spend-phase4.jsonl');
  process.env[P4_LEDGER_ENV] = ledger4;
  delete process.env[P4_CEILING_ENV];
  delete process.env[P4_PLAN_ENV];
  process.env[SUITE_LEDGER_ENV] = join(dir, 'suite-ledger.jsonl');
  delete process.env[CEILING_ENV];
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const line = (costUsd: number, plan = '02-01'): string => JSON.stringify({ plan, case: 'c', costUsd, claudeVersion: '2.1.318', at: '2026-11-05T00:00:00.000Z' }) + '\n';

describe('Phase 2 live-spend ledger and ceiling (D-15)', () => {
  it('states the ceiling as 25 USD', () => {
    assert.equal(PHASE2_CEILING_USD, 25);
    assert.equal(phase2Ceiling(), 25);
  });

  it('reads a missing ledger as 0 spend, and a case under the ceiling fits (empty edge)', () => {
    assert.equal(phase2Spent(), 0);
    assert.equal(fitsPhase2Ceiling(0.4), true);
    assert.equal(fitsPhase2Ceiling(25), true);
    assert.equal(fitsPhase2Ceiling(25.01), false);
  });

  it('sums costUsd over every line of the ledger', () => {
    writeFileSync(ledger, line(1.25) + line(0.5, '02-09') + line(0.0214));
    assert.ok(Math.abs(phase2Spent() - 1.7714) < 1e-9);
  });

  it('throws an Error naming the line number for a malformed line, never reading it as 0', () => {
    writeFileSync(ledger, line(1) + '{not json\n' + line(2));
    assert.throws(() => phase2Spent(), (e: Error) => e instanceof Error && /line 2/.test(e.message));
    writeFileSync(ledger, line(1) + line(2) + JSON.stringify({ plan: 'p', case: 'c' }) + '\n');
    assert.throws(() => phase2Spent(), (e: Error) => e instanceof Error && /line 3/.test(e.message));
    writeFileSync(ledger, JSON.stringify({ plan: 'p', case: 'c', costUsd: 'free' }) + '\n');
    assert.throws(() => phase2Spent(), (e: Error) => e instanceof Error && /line 1/.test(e.message));
  });

  it('fits a 0.40 USD case at a recorded 24.60 and refuses it at 24.61', () => {
    writeFileSync(ledger, line(24.6));
    assert.equal(fitsPhase2Ceiling(0.4), true);
    writeFileSync(ledger, line(24.61));
    assert.equal(fitsPhase2Ceiling(0.4), false);
  });

  it('lets AVARICE_PHASE2_CEILING_USD lower the ceiling, never raise it, and ignores a non-number', () => {
    process.env[CEILING_ENV] = '10';
    assert.equal(phase2Ceiling(), 10);
    writeFileSync(ledger, line(9.7));
    assert.equal(fitsPhase2Ceiling(0.4), false);
    process.env[CEILING_ENV] = '40';
    assert.equal(phase2Ceiling(), 25);
    process.env[CEILING_ENV] = 'lots';
    assert.equal(phase2Ceiling(), 25);
    process.env[CEILING_ENV] = '-3';
    assert.equal(phase2Ceiling(), 25);
  });

  it('appends one JSON line with an ISO timestamp and never rewrites earlier lines', () => {
    writeFileSync(ledger, line(3));
    const first = readFileSync(ledger, 'utf8');
    recordPhase2Spend({ plan: '02-01', case: '01-edit-src', costUsd: 0.0029, claudeVersion: '2.1.318' });
    recordPhase2Spend({ plan: '02-01', case: '02-write-src', costUsd: 0.0023, claudeVersion: '2.1.318' });
    const text = readFileSync(ledger, 'utf8');
    assert.ok(text.startsWith(first), 'earlier lines were rewritten');
    const lines = text.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 3);
    const entry = JSON.parse(lines[1] as string) as Record<string, unknown>;
    assert.equal(entry['plan'], '02-01');
    assert.equal(entry['case'], '01-edit-src');
    assert.equal(entry['costUsd'], 0.0029);
    assert.equal(entry['claudeVersion'], '2.1.318');
    assert.ok(typeof entry['at'] === 'string' && !Number.isNaN(Date.parse(entry['at'])) && new Date(entry['at']).toISOString() === entry['at']);
    assert.ok(Math.abs(phase2Spent() - 3.0052) < 1e-9);
  });

  it('refuses to record a cost that is not a finite non-negative number', () => {
    assert.throws(() => recordPhase2Spend({ plan: '02-01', case: 'x', costUsd: Number.NaN, claudeVersion: 'v' }));
    assert.throws(() => recordPhase2Spend({ plan: '02-01', case: 'x', costUsd: -1, claudeVersion: 'v' }));
    assert.equal(phase2Spent(), 0);
  });

  it('keeps the Phase 2 ledger independent of the Phase 3 ledger', () => {
    writeFileSync(ledger, line(24.9));
    assert.equal(fitsPhase2Ceiling(0.4), false);
    assert.equal(fitsPhase3Ceiling(0.4), true);
    assert.equal(phase3Spent(), 0);
  });
});

const line3 = (costUsd: number, plan = '03-01'): string => JSON.stringify({ plan, case: 'c', costUsd, claudeVersion: '2.1.319', at: '2026-11-08T00:00:00.000Z' }) + '\n';

describe('Phase 3 live-spend ledger and ceiling (D-05)', () => {
  it('states the ceiling as 25 USD', () => {
    assert.equal(PHASE3_CEILING_USD, 25);
    assert.equal(phase3Ceiling(), 25);
  });

  it('reads a missing ledger as 0 spend, and a case under the ceiling fits (empty edge)', () => {
    assert.equal(phase3Spent(), 0);
    assert.equal(fitsPhase3Ceiling(0.4), true);
    assert.equal(fitsPhase3Ceiling(25), true);
    assert.equal(fitsPhase3Ceiling(25.01), false);
  });

  it('sums costUsd over every line of the ledger', () => {
    writeFileSync(ledger3, line3(1.25) + line3(0.5, '03-13') + line3(0.0214));
    assert.ok(Math.abs(phase3Spent() - 1.7714) < 1e-9);
  });

  it('throws an Error naming the line number for a malformed line, never reading it as 0', () => {
    writeFileSync(ledger3, line3(1) + '{not json\n' + line3(2));
    assert.throws(() => phase3Spent(), (e: Error) => e instanceof Error && /line 2/.test(e.message) && /Phase 3/.test(e.message));
    writeFileSync(ledger3, line3(1) + line3(2) + JSON.stringify({ plan: 'p', case: 'c' }) + '\n');
    assert.throws(() => phase3Spent(), (e: Error) => e instanceof Error && /line 3/.test(e.message));
    writeFileSync(ledger3, JSON.stringify({ plan: 'p', case: 'c', costUsd: 'free' }) + '\n');
    assert.throws(() => phase3Spent(), (e: Error) => e instanceof Error && /line 1/.test(e.message));
    assert.throws(() => fitsPhase3Ceiling(0.4), (e: Error) => e instanceof Error);
  });

  it('fits a 0.40 USD case at a recorded 24.60 and refuses it at 24.61', () => {
    writeFileSync(ledger3, line3(24.6));
    assert.equal(fitsPhase3Ceiling(0.4), true);
    writeFileSync(ledger3, line3(24.61));
    assert.equal(fitsPhase3Ceiling(0.4), false);
  });

  it('lets AVARICE_PHASE3_CEILING_USD lower the ceiling, never raise it, and ignores a non-number', () => {
    process.env[P3_CEILING_ENV] = '10';
    assert.equal(phase3Ceiling(), 10);
    writeFileSync(ledger3, line3(9.7));
    assert.equal(fitsPhase3Ceiling(0.4), false);
    process.env[P3_CEILING_ENV] = '40';
    assert.equal(phase3Ceiling(), 25);
    process.env[P3_CEILING_ENV] = 'lots';
    assert.equal(phase3Ceiling(), 25);
    process.env[P3_CEILING_ENV] = '-3';
    assert.equal(phase3Ceiling(), 25);
    // The Phase 2 variable does not move the Phase 3 ceiling.
    delete process.env[P3_CEILING_ENV];
    process.env[CEILING_ENV] = '5';
    assert.equal(phase3Ceiling(), 25);
  });

  it('appends one JSON line with an ISO timestamp and never rewrites earlier lines', () => {
    writeFileSync(ledger3, line3(3));
    const first = readFileSync(ledger3, 'utf8');
    recordPhase3Spend({ plan: '03-01', case: '01-edit-src', costUsd: 0.0029, claudeVersion: '2.1.319' });
    recordPhase3Spend({ plan: '03-01', case: '02-write-src', costUsd: 0.0023, claudeVersion: '2.1.319' });
    const text = readFileSync(ledger3, 'utf8');
    assert.ok(text.startsWith(first), 'earlier lines were rewritten');
    const lines = text.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 3);
    const entry = JSON.parse(lines[1] as string) as Record<string, unknown>;
    assert.equal(entry['plan'], '03-01');
    assert.equal(entry['case'], '01-edit-src');
    assert.equal(entry['costUsd'], 0.0029);
    assert.equal(entry['claudeVersion'], '2.1.319');
    assert.ok(typeof entry['at'] === 'string' && !Number.isNaN(Date.parse(entry['at'])) && new Date(entry['at']).toISOString() === entry['at']);
    assert.ok(Math.abs(phase3Spent() - 3.0052) < 1e-9);
  });

  it('refuses to record a cost that is not a finite non-negative number', () => {
    assert.throws(() => recordPhase3Spend({ plan: '03-01', case: 'x', costUsd: Number.NaN, claudeVersion: 'v' }));
    assert.throws(() => recordPhase3Spend({ plan: '03-01', case: 'x', costUsd: -1, claudeVersion: 'v' }));
    assert.equal(phase3Spent(), 0);
  });
});

const line4 = (costUsd: number, plan = '04-01'): string => JSON.stringify({ plan, case: 'c', costUsd, claudeVersion: '2.1.320', at: '2026-11-16T00:00:00.000Z' }) + '\n';

describe('Phase 4 live-spend ledger and ceiling (D-03)', () => {
  it('states the ceiling as 40 USD and Phase 4 as the current spend phase', () => {
    assert.equal(PHASE4_CEILING_USD, 40);
    assert.equal(phase4Ceiling(), 40);
    assert.equal(CURRENT_SPEND_PHASE, 4);
  });

  it('reads a missing ledger as 0 spend, and a case under the ceiling fits (empty edge)', () => {
    assert.equal(phase4Spent(), 0);
    assert.equal(fitsPhase4Ceiling(0.4), true);
    assert.equal(fitsPhase4Ceiling(40), true);
    assert.equal(fitsPhase4Ceiling(40.01), false);
  });

  it('fits a 0.40 USD case at a recorded 39.50 and refuses a 0.60 USD case there', () => {
    writeFileSync(ledger4, line4(39.5));
    assert.equal(fitsPhase4Ceiling(0.4), true);
    assert.equal(fitsPhase4Ceiling(0.6), false);
    assert.equal(fitsCap(0.4), true);
    assert.equal(fitsCap(0.6), false);
  });

  it('lets AVARICE_PHASE4_CEILING_USD lower the ceiling, never raise it, and ignores a non-number', () => {
    process.env[P4_CEILING_ENV] = '30';
    assert.equal(phase4Ceiling(), 30);
    writeFileSync(ledger4, line4(29.7));
    assert.equal(fitsPhase4Ceiling(0.4), false);
    process.env[P4_CEILING_ENV] = '50';
    assert.equal(phase4Ceiling(), 40);
    process.env[P4_CEILING_ENV] = 'lots';
    assert.equal(phase4Ceiling(), 40);
    process.env[P4_CEILING_ENV] = '-3';
    assert.equal(phase4Ceiling(), 40);
    // The Phase 3 variable does not move the Phase 4 ceiling.
    delete process.env[P4_CEILING_ENV];
    process.env[P3_CEILING_ENV] = '5';
    assert.equal(phase4Ceiling(), 40);
  });

  it('throws an Error naming the line number for a corrupt line, never reading it as 0', () => {
    writeFileSync(ledger4, line4(1) + '{not json\n' + line4(2));
    assert.throws(() => phase4Spent(), (e: Error) => e instanceof Error && /line 2/.test(e.message) && /Phase 4/.test(e.message));
    assert.throws(() => fitsPhase4Ceiling(0.4), (e: Error) => e instanceof Error);
    assert.throws(() => fitsCap(0.4), (e: Error) => e instanceof Error);
    writeFileSync(ledger4, JSON.stringify({ plan: 'p', case: 'c', costUsd: 'free' }) + '\n');
    assert.throws(() => phase4Spent(), (e: Error) => e instanceof Error && /line 1/.test(e.message));
  });

  it('appends one JSON line with an ISO timestamp and never rewrites earlier lines', () => {
    writeFileSync(ledger4, line4(3));
    const first = readFileSync(ledger4, 'utf8');
    recordPhase4Spend({ plan: '04-31', case: 'case-a', costUsd: 0.0029, claudeVersion: '2.1.320' });
    recordPhase4Spend({ plan: '04-31', case: 'case-b', costUsd: 0.0023, claudeVersion: '2.1.320' });
    const text = readFileSync(ledger4, 'utf8');
    assert.ok(text.startsWith(first), 'earlier lines were rewritten');
    const lines = text.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 3);
    const entry = JSON.parse(lines[1] as string) as Record<string, unknown>;
    assert.equal(entry['plan'], '04-31');
    assert.equal(entry['case'], 'case-a');
    assert.equal(entry['claudeVersion'], '2.1.320');
    assert.ok(typeof entry['at'] === 'string' && new Date(entry['at']).toISOString() === entry['at']);
    assert.ok(Math.abs(phase4Spent() - 3.0052) < 1e-9);
  });

  it('refuses to record a cost that is not a finite non-negative number', () => {
    assert.throws(() => recordPhase4Spend({ plan: '04-31', case: 'x', costUsd: Number.NaN, claudeVersion: 'v' }));
    assert.throws(() => recordPhase4Spend({ plan: '04-31', case: 'x', costUsd: -1, claudeVersion: 'v' }));
    assert.equal(phase4Spent(), 0);
  });

  it('makes the per-suite fitsCap require the Phase 4 ceiling, and not the Phase 2 or Phase 3 one', () => {
    assert.equal(fitsCap(0.4), true);
    writeFileSync(ledger4, line4(39.9));
    assert.equal(fitsCap(0.4), false);
    writeFileSync(ledger4, line4(1));
    assert.equal(fitsCap(0.4), true);
    writeFileSync(ledger, line(24.9));
    writeFileSync(ledger3, line3(24.9));
    assert.equal(fitsCap(0.4), true);
  });

  it('words the skip as the D-03 ask-the-owner text when the Phase 4 ceiling is the limit', () => {
    assert.equal(spendRefusal(0.4), undefined);
    writeFileSync(ledger4, line4(39.9));
    assert.equal(spendRefusal(0.4), "not run: Phase 4 spend 39.9000 plus this case's cap 0.40 would pass the 40.00 USD ceiling (D-03); ask the owner");
    assert.match(spikeRefusal(0.4) ?? '', /Phase 4 spend .*\(D-03\)/);
  });

  it('names Phase 4, the 40.00 USD ceiling, D-03 and the owner in the refusal for a 0.60 USD case at 39.50', () => {
    writeFileSync(ledger4, line4(39.5));
    const text = spendRefusal(0.6) ?? '';
    assert.match(text, /Phase 4/);
    assert.match(text, /40\.00 USD ceiling/);
    assert.match(text, /\(D-03\)/);
    assert.match(text, /ask the owner/);
  });

  it('records every host run of the per-suite recorder in the Phase 4 ledger under AVARICE_PHASE4_PLAN, and none in Phase 2 or Phase 3', () => {
    process.env[P4_PLAN_ENV] = '04-31';
    recordSpend({ case: 'case-a', costUsd: 0.12, assumed: false }, '2.1.320');
    const lines = readFileSync(ledger4, 'utf8').split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    assert.equal(entry['plan'], '04-31');
    assert.equal(entry['case'], 'case-a');
    assert.equal(entry['claudeVersion'], '2.1.320');
    assert.equal(phase2Spent(), 0);
    assert.equal(phase3Spent(), 0);
    delete process.env[P4_PLAN_ENV];
    recordSpend({ case: 'case-b', costUsd: 0.1, assumed: false });
    const second = readFileSync(ledger4, 'utf8').split('\n').filter((l) => l !== '');
    assert.equal((JSON.parse(second[1] as string) as Record<string, unknown>)['plan'], 'unknown');
  });

  it('keeps the Phase 2 and Phase 3 ledgers readable beside the Phase 4 ledger', () => {
    writeFileSync(ledger, line(2));
    writeFileSync(ledger3, line3(3));
    writeFileSync(ledger4, line4(4));
    assert.equal(phase2Spent(), 2);
    assert.equal(phase3Spent(), 3);
    assert.equal(phase4Spent(), 4);
    assert.equal(fitsPhase2Ceiling(23), true);
    assert.equal(fitsPhase3Ceiling(22), true);
    assert.equal(fitsPhase3Ceiling(22.01), false);
  });

  it('points the current ledger at the Phase 4 default file when no override is set', () => {
    delete process.env[P4_LEDGER_ENV];
    assert.ok(currentSpendLedger.path().endsWith('live-spend-phase4.jsonl'), currentSpendLedger.path());
  });

  it('sums only the entries of the named plan in spentByPlan', () => {
    writeFileSync(ledger4, line4(1.5, '04-31') + line4(2, '04-34') + line4(0.25, '04-31') + line4(9, '04-310'));
    assert.ok(Math.abs(spentByPlan('04-31') - 1.75) < 1e-9);
    assert.equal(spentByPlan('04-34'), 2);
    assert.equal(spentByPlan('04-99'), 0);
  });
});

describe('Phase 3 plan-group total, judged against the current ledger (owner decision 2 of 2026-11-09: 03-27, 03-35, 03-36, 03-37, 03-38 and 03-39 share 10.00 USD)', () => {
  it('names the group and states its total as 10 USD', () => {
    assert.deepEqual([...LIVE_PLAN_03_27_GROUP], ['03-27', '03-35', '03-36', '03-37', '03-38', '03-39']);
    assert.equal(LIVE_PLAN_03_27_TOTAL_USD, 10);
  });

  it('sums the spend of every plan of the group and fits a 0.50 USD cap at 9.50, refusing it at 9.51', () => {
    writeFileSync(ledger4, line4(5, '03-27') + line4(3, '03-35') + line4(1, '03-36') + line4(0.3, '03-37') + line4(0.1, '03-38') + line4(0.1, '03-39'));
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
    writeFileSync(ledger4, line4(5, '03-27') + line4(3, '03-35') + line4(1, '03-36') + line4(0.3, '03-37') + line4(0.1, '03-38') + line4(0.11, '03-39'));
    assert.notEqual(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
  });

  it('ignores the spend of plans outside the group', () => {
    writeFileSync(ledger4, line4(9, '03-13') + line4(9, '03-01') + line4(0.2, '03-27'));
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
  });

  it('fits at an empty ledger', () => {
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 10), undefined);
    assert.notEqual(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 10.01), undefined);
  });

  it('words the refusal with the group, the spend, the cap and the total', () => {
    writeFileSync(ledger4, line4(9.6, '03-27'));
    const text = planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5) ?? '';
    assert.match(text, /^not run: /);
    assert.match(text, /03-27, 03-35, 03-36, 03-37, 03-38, 03-39/);
    assert.match(text, /9\.6000/);
    assert.match(text, /0\.50/);
    assert.match(text, /10\.00 USD/);
  });
});
