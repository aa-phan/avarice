// The per-phase live-spend ceilings: Phase 2 (plan 02-01, D-15) and Phase 3 (plan 03-01, D-05), each one ledger and one 25 USD
// ceiling, checked before any live host start. Every new live spend is judged against the Phase 3 ledger.
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
  fitsCap,
  fitsPhase2Ceiling,
  fitsPhase3Ceiling,
  phase2Ceiling,
  phase2Spent,
  phase3Ceiling,
  phase3Spent,
  planGroupTotalRefusal,
  recordPhase2Spend,
  recordPhase3Spend,
  recordSpend,
  spendRefusal,
  spikeRefusal,
} from '../helpers/live-harness.ts';

const LEDGER_ENV = 'AVARICE_PHASE2_LEDGER';
const CEILING_ENV = 'AVARICE_PHASE2_CEILING_USD';
const SUITE_LEDGER_ENV = 'AVARICE_LIVE_LEDGER';
const P3_LEDGER_ENV = 'AVARICE_PHASE3_LEDGER';
const P3_CEILING_ENV = 'AVARICE_PHASE3_CEILING_USD';
const P3_PLAN_ENV = 'AVARICE_PHASE3_PLAN';
const KEYS = [LEDGER_ENV, CEILING_ENV, SUITE_LEDGER_ENV, P3_LEDGER_ENV, P3_CEILING_ENV, P3_PLAN_ENV];

let dir = '';
let ledger = '';
let ledger3 = '';
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
  it('states the ceiling as 25 USD and Phase 3 as the current spend phase', () => {
    assert.equal(PHASE3_CEILING_USD, 25);
    assert.equal(phase3Ceiling(), 25);
    assert.equal(CURRENT_SPEND_PHASE, 3);
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

  it('makes the per-suite fitsCap require the Phase 3 ceiling, and not the Phase 2 one', () => {
    assert.equal(fitsCap(0.4), true);
    writeFileSync(ledger3, line3(24.9));
    assert.equal(fitsCap(0.4), false);
    writeFileSync(ledger3, line3(1));
    assert.equal(fitsCap(0.4), true);
    writeFileSync(ledger, line(24.9));
    assert.equal(fitsCap(0.4), true);
  });

  it('words the skip as the D-05 ask-the-owner text when the Phase 3 ceiling is the limit', () => {
    assert.equal(spendRefusal(0.4), undefined);
    writeFileSync(ledger3, line3(24.9));
    assert.equal(spendRefusal(0.4), "not run: Phase 3 spend 24.9000 plus this case's cap 0.40 would pass the 25.00 USD ceiling (D-05); ask the owner");
    assert.match(spikeRefusal(0.4) ?? '', /Phase 3 spend .*\(D-05\)/);
  });

  it('records every host run of the per-suite recorder in the Phase 3 ledger under AVARICE_PHASE3_PLAN, and none in Phase 2', () => {
    process.env[P3_PLAN_ENV] = '03-01';
    recordSpend({ case: 'case-a', costUsd: 0.12, assumed: false }, '2.1.319');
    const lines = readFileSync(ledger3, 'utf8').split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    assert.equal(entry['plan'], '03-01');
    assert.equal(entry['case'], 'case-a');
    assert.equal(entry['claudeVersion'], '2.1.319');
    assert.equal(phase2Spent(), 0);
    delete process.env[P3_PLAN_ENV];
    recordSpend({ case: 'case-b', costUsd: 0.1, assumed: false });
    const second = readFileSync(ledger3, 'utf8').split('\n').filter((l) => l !== '');
    assert.equal((JSON.parse(second[1] as string) as Record<string, unknown>)['plan'], 'unknown');
  });
});

describe('Phase 3 plan-group total (owner decision 2 of 2026-11-09: 03-27, 03-35, 03-36 and 03-37 share 10.00 USD)', () => {
  it('names the group and states its total as 10 USD', () => {
    assert.deepEqual([...LIVE_PLAN_03_27_GROUP], ['03-27', '03-35', '03-36', '03-37']);
    assert.equal(LIVE_PLAN_03_27_TOTAL_USD, 10);
  });

  it('sums the spend of every plan of the group and fits a 0.50 USD cap at 9.50, refusing it at 9.51', () => {
    writeFileSync(ledger3, line3(5, '03-27') + line3(3, '03-35') + line3(1, '03-36') + line3(0.5, '03-37'));
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
    writeFileSync(ledger3, line3(5, '03-27') + line3(3, '03-35') + line3(1, '03-36') + line3(0.51, '03-37'));
    assert.notEqual(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
  });

  it('ignores the spend of plans outside the group', () => {
    writeFileSync(ledger3, line3(9, '03-13') + line3(9, '03-01') + line3(0.2, '03-27'));
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5), undefined);
  });

  it('fits at an empty ledger', () => {
    assert.equal(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 10), undefined);
    assert.notEqual(planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 10.01), undefined);
  });

  it('words the refusal with the group, the spend, the cap and the total', () => {
    writeFileSync(ledger3, line3(9.6, '03-27'));
    const text = planGroupTotalRefusal(LIVE_PLAN_03_27_GROUP, 10, 0.5) ?? '';
    assert.match(text, /^not run: /);
    assert.match(text, /03-27, 03-35, 03-36, 03-37/);
    assert.match(text, /9\.6000/);
    assert.match(text, /0\.50/);
    assert.match(text, /10\.00 USD/);
  });
});
