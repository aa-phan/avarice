// Shared retrieval counters are exact under a race (plan 04-28; CON-11, CS-16, S-16, T-04-78). Six processes hold the same store and each issues five searches against one run
// whose retrieval.searches limit is 10, all released at one start time. The ledger's all-or-nothing spend serializes them: exactly 10 of the 30 searches are granted in total,
// the other 20 are refused retrieval:searches-spent, and the row ends with used 10 and nothing reserved. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { budgetsOf, startedRun } from '../helpers/retrieval-fixtures.ts';

const PROCESSES = 6;
const ATTEMPTS = 5;
const LIMIT = 10;
const CHILD = join(import.meta.dirname, '..', 'helpers', 'retrieval-race-child.ts');

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Line {
  label: string;
  granted: boolean;
  rule?: string;
  error?: string;
}

function runChild(dbPath: string, runId: string, label: string, startAtMs: number): Promise<Line[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, dbPath, runId, label, String(ATTEMPTS), String(startAtMs)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`child ${label} exited ${String(code)}: ${err}`));
      else resolve(out.trim().split('\n').map((l) => JSON.parse(l) as Line));
    });
  });
}

describe('six processes search one run at once: the counter is exact (CS-16)', () => {
  it(`grants exactly ${LIMIT} of ${PROCESSES * ATTEMPTS} searches, refuses the rest as retrieval:searches-spent, and the row ends at used ${LIMIT}`, async () => {
    const s = startedRun(cleanup, [], { 'retrieval.searches': LIMIT });
    try {
      assert.equal(budgetsOf(s)['retrieval.searches']?.limit_value, LIMIT);
      const dbPath = join(s.roots.AVARICE_DATA_ROOT, 'state.db');
      const startAtMs = Date.now() + 1500;
      const lines = (await Promise.all(Array.from({ length: PROCESSES }, (_, i) => runChild(dbPath, s.runId, `p${i}`, startAtMs)))).flat();
      assert.equal(lines.length, PROCESSES * ATTEMPTS);
      const granted = lines.filter((l) => l.granted);
      assert.equal(granted.length, LIMIT, `the sum of successes equals the limit exactly: ${JSON.stringify(lines)}`);
      const refused = lines.filter((l) => !l.granted);
      assert.ok(refused.every((l) => l.rule === 'retrieval:searches-spent'), JSON.stringify(refused));
      const row = budgetsOf(s)['retrieval.searches'];
      assert.equal(row?.used, LIMIT);
      assert.equal(row?.reserved, 0);
      assert.ok(new Set(granted.map((l) => l.label)).size > 1, 'more than one process got a search, so the race was real');
    } finally {
      s.close();
    }
  });
});
