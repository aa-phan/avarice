// The Phase 2 live-spend ceiling (plan 02-01, D-15): one ledger, one 25 USD ceiling, checked before any live host start.
// Offline: the ledger and the suite ledger point at temp files, so nothing here starts a host or spends.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PHASE2_CEILING_USD, fitsCap, fitsPhase2Ceiling, phase2Ceiling, phase2Spent, recordPhase2Spend, spendRefusal } from '../helpers/live-harness.ts';

const LEDGER_ENV = 'AVARICE_PHASE2_LEDGER';
const CEILING_ENV = 'AVARICE_PHASE2_CEILING_USD';
const SUITE_LEDGER_ENV = 'AVARICE_LIVE_LEDGER';
const KEYS = [LEDGER_ENV, CEILING_ENV, SUITE_LEDGER_ENV];

let dir = '';
let ledger = '';
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  dir = mkdtempSync(join(tmpdir(), 'avarice-phase2-ledger-'));
  ledger = join(dir, 'live-spend-phase2.jsonl');
  process.env[LEDGER_ENV] = ledger;
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

  it('makes the existing per-suite fitsCap also require the Phase 2 ceiling', () => {
    assert.equal(fitsCap(0.4), true);
    writeFileSync(ledger, line(24.9));
    assert.equal(fitsCap(0.4), false);
    writeFileSync(ledger, line(1));
    assert.equal(fitsCap(0.4), true);
  });

  it('words the skip as the D-15 ask-the-owner text when the Phase 2 ceiling is the limit', () => {
    assert.equal(spendRefusal(0.4), undefined);
    writeFileSync(ledger, line(24.9));
    assert.equal(spendRefusal(0.4), "not run: Phase 2 spend 24.9000 plus this case's cap 0.40 would pass the 25.00 USD ceiling (D-15); ask the owner");
  });
});
