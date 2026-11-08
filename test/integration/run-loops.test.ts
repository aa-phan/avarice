// Loop limits (CON-14) and concurrent read recording (NFR-5) through the real hook entry (src/hook/pre-tool-use.ts) run as child
// processes: after `consecutiveDenials` denials in a row the deny output also carries `continue: false`, after `consecutiveSearches`
// Grep or Glob calls with no read between them the next search is refused `ineffective-search`, and a `loop.limit` event records the stop.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { appendEventRow } from '../../src/adapters/sqlite/events.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import type { HookPolicy } from '../../src/domain/hook-decision.ts';
import { eventRows, makeHookFixture, runHook, runHookAsync, withDb } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

const LIMITS = { consecutiveDenials: 3, consecutiveSearches: 25 };

function runFixture(policy: Partial<HookPolicy> = {}): HookFixture {
  const fx = makeHookFixture({
    policy: { purpose: 'run', writeRoots: [], writeGlobs: ['src/**'], protectedGlobs: [], subagentTypes: ['gsd-executor'], readBeforeEdit: false, loopLimits: LIMITS, ...policy },
  });
  fixtures.push(fx);
  writeFileSync(join(fx.staging, 'src', 'a.ts'), 'a');
  return fx;
}

interface Output {
  continue?: boolean;
  stopReason?: string;
  hookSpecificOutput?: { permissionDecision: string; permissionDecisionReason: string };
}
const parse = (stdout: string): Output => (stdout === '' ? {} : (JSON.parse(stdout) as Output));

// A denied call: a Write outside every write glob. An allowed call: a Read of a file in the clone.
const denied = (fx: HookFixture): Output => parse(runHook(fx, 'pre', { tool_name: 'Write', tool_input: { file_path: join(fx.staging, 'outside.txt'), content: 'x' } }).stdout);
const allowed = (fx: HookFixture): Output => parse(runHook(fx, 'pre', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', 'a.ts') } }).stdout);
const search = (fx: HookFixture, tool: 'Grep' | 'Glob' = 'Grep'): Output => parse(runHook(fx, 'pre', { tool_name: tool, tool_input: { pattern: 'x', path: join(fx.staging, 'src') } }).stdout);

const limitEvents = (fx: HookFixture): Array<Record<string, unknown>> => eventRows(fx, 'loop.limit').map((r) => JSON.parse(r.data_json) as Record<string, unknown>);

// Seeds hook.decision events the way the hook writes them, in the order given, each with the timestamp given.
function seed(fx: HookFixture, rows: Array<{ decision: 'allow' | 'deny'; tool?: string; at: number; invocationId?: string }>): void {
  const db = new DatabaseSync(fx.ledgerPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const row of rows) {
      const invocationId = row.invocationId ?? 'inv_1';
      appendEventRow(db, {
        type: 'hook.decision',
        runId: 'run_1',
        invocationId,
        data: { onboardingId: 'onb_1', invocationId, tool: row.tool ?? 'Write', decision: row.decision, rule: row.decision === 'deny' ? 'outside-write-set' : 'write-set' },
        nowMs: row.at,
      });
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

describe('consecutive denials stop the invocation (CON-14)', () => {
  it('stops at the third consecutive denial and not at the second (boundary edge), recording one loop.limit event', () => {
    const fx = runFixture();
    const first = denied(fx);
    const second = denied(fx);
    assert.equal(first.continue, undefined);
    assert.equal(second.continue, undefined);
    assert.equal(second.hookSpecificOutput?.permissionDecision, 'deny');
    assert.deepEqual(limitEvents(fx), []);
    const third = denied(fx);
    assert.equal(third.continue, false);
    assert.equal(third.stopReason, 'AVARICE: 3 consecutive denials; the run is stopped for escalation');
    assert.equal(third.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(third.hookSpecificOutput?.permissionDecisionReason ?? '', /outside-write-set/);
    const events = limitEvents(fx);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { runId: 'run_1', invocationId: 'inv_1', reason: 'consecutive-denials', count: 3, limit: 3 });
    const [row] = eventRows(fx, 'loop.limit');
    assert.equal(row?.run_id, 'run_1');
    assert.equal(row?.invocation_id, 'inv_1');
  });

  it('is reset by one allowed call between denials (adjacency edge): deny, allow, deny, deny does not stop', () => {
    const fx = runFixture();
    const outputs = [denied(fx), allowed(fx), denied(fx), denied(fx)];
    for (const out of outputs) assert.equal(out.continue, undefined);
    assert.deepEqual(limitEvents(fx), []);
    assert.equal(denied(fx).continue, false, 'a further denial makes three in a row');
  });

  it('never emits continue false for an invocation with zero denials (empty edge)', () => {
    const fx = runFixture();
    for (let i = 0; i < 6; i += 1) assert.deepEqual(allowed(fx), {});
    assert.deepEqual(limitEvents(fx), []);
  });

  it('judges consecutiveness by the decision events seq, not by their timestamps (ordering edge)', () => {
    const now = Date.now();
    // Seq order: deny, deny, allow. Timestamp order would put the allow first: the allow carries the earliest timestamp.
    const a = runFixture();
    seed(a, [{ decision: 'deny', at: now + 60_000 }, { decision: 'deny', at: now + 120_000 }, { decision: 'allow', at: now - 60_000 }]);
    assert.equal(denied(a).continue, undefined, 'the allow is the latest by seq, so this is the first denial in a row');
    // Seq order: allow, deny, deny. The allow carries the latest timestamp, which would hide the two denials if time were the order.
    const b = runFixture();
    seed(b, [{ decision: 'allow', at: now + 60_000 }, { decision: 'deny', at: now - 60_000 }, { decision: 'deny', at: now - 120_000 }]);
    assert.equal(denied(b).continue, false, 'two denials precede this one by seq');
  });

  it('counts integers read from this invocation\'s ledger rows only (precision edge)', () => {
    const fx = runFixture();
    const now = Date.now();
    // Denials of another invocation (a killed one, a sibling) are not this invocation's run.
    seed(fx, [
      { decision: 'deny', at: now, invocationId: 'inv_other' },
      { decision: 'deny', at: now, invocationId: 'inv_other' },
      { decision: 'deny', at: now, invocationId: 'inv_other' },
    ]);
    assert.equal(denied(fx).continue, undefined);
    assert.equal(denied(fx).continue, undefined);
    assert.equal(denied(fx).continue, false);
    const [event] = limitEvents(fx);
    assert.ok(Number.isInteger(event?.['count']) && event?.['count'] === 3);
    assert.ok(Number.isInteger(event?.['limit']));
  });

  it('counts a denial that is not a path rule: a call refused for the budget is the same kind of denial', () => {
    const fx = makeHookFixture({
      limits: { toolCalls: 0 },
      policy: { purpose: 'run', writeRoots: [], writeGlobs: ['src/**'], protectedGlobs: [], loopLimits: LIMITS, readBeforeEdit: false },
    });
    fixtures.push(fx);
    writeFileSync(join(fx.staging, 'src', 'a.ts'), 'a');
    assert.equal(allowed(fx).continue, undefined);
    assert.equal(allowed(fx).continue, undefined);
    assert.equal(allowed(fx).continue, false);
  });

  it('leaves a policy without loopLimits alone: any number of denials, no continue false and no loop.limit event (onboarding unchanged)', () => {
    const fx = runFixture({ loopLimits: undefined });
    for (let i = 0; i < 5; i += 1) assert.equal(denied(fx).continue, undefined);
    assert.deepEqual(limitEvents(fx), []);
  });
});

describe('ineffective searches stop the invocation (CON-14)', () => {
  it('refuses the 26th search after 25 in a row with ineffective-search, continue false and a loop.limit event', () => {
    const fx = runFixture();
    for (let i = 0; i < 25; i += 1) assert.deepEqual(search(fx, i % 2 === 0 ? 'Grep' : 'Glob'), {}, `search ${i + 1}`);
    const next = search(fx);
    assert.equal(next.continue, false);
    assert.equal(next.stopReason, 'AVARICE: 25 consecutive searches without a read; the run is stopped for escalation');
    assert.match(next.hookSpecificOutput?.permissionDecisionReason ?? '', /ineffective-search/);
    assert.deepEqual(limitEvents(fx), [{ runId: 'run_1', invocationId: 'inv_1', reason: 'ineffective-search', count: 25, limit: 25 }]);
  });

  it('does not stop 24 searches, a Read, then 24 more: a read between them resets the count', () => {
    const fx = runFixture();
    for (let i = 0; i < 24; i += 1) assert.deepEqual(search(fx), {});
    assert.deepEqual(allowed(fx), {});
    for (let i = 0; i < 24; i += 1) assert.deepEqual(search(fx), {});
    assert.deepEqual(limitEvents(fx), []);
  });

  it('charges nothing for the refused search', () => {
    const fx = runFixture();
    for (let i = 0; i < 25; i += 1) search(fx);
    const used = (): number => withDb(fx.ledgerPath, (db) => Number((db.prepare("SELECT used FROM budgets WHERE name = 'toolCalls'").get() as { used: number }).used));
    assert.equal(used(), 25);
    search(fx);
    assert.equal(used(), 25);
  });

  it('is not an onboarding rule: without loopLimits any number of searches is allowed', () => {
    const fx = runFixture({ loopLimits: undefined });
    const now = Date.now();
    seed(fx, Array.from({ length: 30 }, (_, i) => ({ decision: 'allow' as const, tool: 'Grep', at: now + i })));
    assert.deepEqual(search(fx), {});
  });
});

describe('two hook processes record reads for one invocation at once (NFR-5)', () => {
  it('commits both rows with the digest each process read, over repeated pairs', async () => {
    const policy: Partial<HookPolicy> = { readBeforeEdit: true };
    const fx = runFixture(policy);
    const expected = new Map<string, string>();
    for (let round = 0; round < 6; round += 1) {
      const names = [`p${round}-one.ts`, `p${round}-two.ts`];
      for (const name of names) {
        const path = join(fx.staging, 'src', name);
        const text = `content of ${name}`;
        writeFileSync(path, text);
        expected.set(path, 'sha256:' + sha256Hex(text));
      }
      const results = await Promise.all(names.map((name) => runHookAsync(fx, 'post', { tool_name: 'Read', tool_input: { file_path: join(fx.staging, 'src', name) } })));
      for (const result of results) assert.equal(result.code, 0, result.stderr);
    }
    const rows = withDb(fx.ledgerPath, (db) => db.prepare('SELECT path, digest, invocation_id FROM hook_reads').all() as Array<{ path: string; digest: string; invocation_id: string }>);
    assert.equal(rows.length, expected.size);
    for (const row of rows) {
      assert.equal(row.invocation_id, 'inv_1');
      assert.equal(row.digest, expected.get(row.path), row.path);
    }
    assert.equal(eventRows(fx, 'tool.completed').length, 12, 'every completion is on the chain');
  });
});
