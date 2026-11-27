// Shared retrieval counters are exact under a race (plan 04-28; CON-11, CS-16, S-16, T-04-78). Six processes hold the same store and each issues five searches against one run
// whose retrieval.searches limit is 10, all released at one start time. The ledger's all-or-nothing spend serializes them: exactly 10 of the 30 searches are granted in total,
// the other 20 are refused retrieval:searches-spent, and the row ends with used 10 and nothing reserved. No model is called. Each child prints when its calls started and returned,
// and the test fails ("the race was not exercised") unless, in one of up to 5 runs, calls of different processes overlapped or their grants interleaved.
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

// A line of a child: one search, with when the process left the barrier, when it made the call and when the call returned (ms since the epoch).
interface Line {
  label: string;
  granted: boolean;
  rule?: string;
  error?: string;
  leftBarrierAt: number;
  calledAt: number;
  returnedAt: number;
}

// What shows that the processes ran at the same time and not one after the other: the interval of a call of one process intersects the interval of a call of another, or the
// grants, ordered by when their calls returned, interleave (some process's grants are not one run in that order).
function raceEvidence(lines: readonly Line[]): { overlapping: number; interleaved: boolean } {
  let overlapping = 0;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const x = lines[i] as Line;
      const y = lines[j] as Line;
      if (x.label !== y.label && x.calledAt < y.returnedAt && y.calledAt < x.returnedAt) overlapping += 1;
    }
  }
  const order = lines.filter((l) => l.granted).sort((x, y) => x.returnedAt - y.returnedAt).map((l) => l.label);
  const closed = new Set<string>();
  let interleaved = false;
  order.forEach((label, index) => {
    if (closed.has(label)) interleaved = true;
    const previous = order[index - 1];
    if (previous !== undefined && previous !== label) closed.add(previous);
  });
  return { overlapping, interleaved };
}

// A race that does not happen proves nothing about an exact counter, so the run is repeated up to this many times and fails when no run raced.
const RUNS = 5;

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
  it(`grants exactly ${LIMIT} of ${PROCESSES * ATTEMPTS} searches, refuses the rest as retrieval:searches-spent, and the row ends at used ${LIMIT}, in a run where the processes raced`, async () => {
    const tried: string[] = [];
    let raced = false;
    for (let run = 0; run < RUNS && !raced; run += 1) {
      const s = startedRun(cleanup, [], { 'retrieval.searches': LIMIT });
      try {
        assert.equal(budgetsOf(s)['retrieval.searches']?.limit_value, LIMIT);
        const dbPath = join(s.roots.AVARICE_DATA_ROOT, 'state.db');
        const startAtMs = Date.now() + 1500;
        const lines = (await Promise.all(Array.from({ length: PROCESSES }, (_, i) => runChild(dbPath, s.runId, `p${i}`, startAtMs)))).flat();
        assert.equal(lines.length, PROCESSES * ATTEMPTS);
        // The counter is exact in every run, raced or not; only the evidence of a race is retried.
        const granted = lines.filter((l) => l.granted);
        assert.equal(granted.length, LIMIT, `the sum of successes equals the limit exactly: ${JSON.stringify(lines)}`);
        const refused = lines.filter((l) => !l.granted);
        assert.ok(refused.every((l) => l.rule === 'retrieval:searches-spent'), JSON.stringify(refused));
        const row = budgetsOf(s)['retrieval.searches'];
        assert.equal(row?.used, LIMIT);
        assert.equal(row?.reserved, 0);
        const evidence = raceEvidence(lines);
        tried.push(`run ${run}: ${evidence.overlapping} overlapping call pairs, grants ${evidence.interleaved ? 'interleaved' : 'in one run per process'}`);
        raced = evidence.overlapping > 0 || evidence.interleaved;
      } finally {
        s.close();
      }
    }
    assert.ok(raced, `the race was not exercised: the processes' calls never overlapped and their grants never interleaved (${tried.join('; ')})`);
  });
});
