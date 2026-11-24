// When a bindings lock is stale (plan 04-59; GWR-05, SEC-1, T-04-155). A lock names the process that wrote it and the time it wrote it. A process ID can be
// reused after a crash, so a live ID is not proof that the writer is alive: the lock is stale when the process now holding the ID started after the lock was
// written. The rule is a pure function so its edges are tested without planting processes; the process start time is read from `ps` elapsed time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS_STALE_AGE_MS, lockIsStale, parseEtimeSeconds, readProcessStartMs } from '../../src/adapters/fs/profile-bindings.ts';

const WROTE_AT = Date.parse('2026-11-23T10:00:00.000Z');
const holder = { pid: 4242, startedAt: new Date(WROTE_AT).toISOString() };

describe('lockIsStale (GWR-05)', () => {
  it('a holder whose process no longer exists is stale', () => {
    assert.equal(lockIsStale({ holder, alive: false, processStartMs: undefined, lockAgeMs: 0 }), true);
  });

  it('a live holder that started after the lock was written by more than 2 seconds is stale (its ID was reused)', () => {
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: WROTE_AT + 2001, lockAgeMs: 10 }), true);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: WROTE_AT + 3_600_000, lockAgeMs: 10 }), true);
  });

  it('a live holder that started at or before the lock time plus 2 seconds is held', () => {
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: WROTE_AT + 2000, lockAgeMs: 10 }), false);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: WROTE_AT, lockAgeMs: 10 }), false);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: WROTE_AT - 5000, lockAgeMs: 10 }), false);
  });

  it('a start time that cannot be read falls back to the age of the lock file: older than 60 seconds is stale, else held', () => {
    assert.equal(BINDINGS_STALE_AGE_MS, 60_000);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: undefined, lockAgeMs: 60_000 }), false);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: undefined, lockAgeMs: 60_001 }), true);
    assert.equal(lockIsStale({ holder, alive: true, processStartMs: undefined, lockAgeMs: 5 }), false);
  });

  it('a startedAt that is not a time is treated as an unknown comparison and falls back to the age', () => {
    const garbled = { pid: 4242, startedAt: 'not a time' };
    assert.equal(lockIsStale({ holder: garbled, alive: true, processStartMs: WROTE_AT + 3_600_000, lockAgeMs: 5 }), false);
    assert.equal(lockIsStale({ holder: garbled, alive: true, processStartMs: WROTE_AT + 3_600_000, lockAgeMs: 60_001 }), true);
  });

  it('a lock whose holder cannot be read is stale only when it is older than the wait of a writer (2 seconds)', () => {
    assert.equal(lockIsStale({ holder: undefined, alive: false, processStartMs: undefined, lockAgeMs: 2000 }), false);
    assert.equal(lockIsStale({ holder: undefined, alive: false, processStartMs: undefined, lockAgeMs: 2001 }), true);
  });
});

describe('parseEtimeSeconds (the elapsed time ps prints)', () => {
  it('reads [[dd-]hh:]mm:ss into seconds', () => {
    assert.equal(parseEtimeSeconds('05:07'), 307);
    assert.equal(parseEtimeSeconds('01:02:03'), 3723);
    assert.equal(parseEtimeSeconds('2-01:02:03'), 176523);
    assert.equal(parseEtimeSeconds('  00:00\n'), 0);
  });

  it('is undefined for text that is not that shape', () => {
    for (const text of ['', 'abc', '5', '1:2:3:4', '-01:02', '01:2', '1-02', '00:61', '01:02:03 extra', '0x:01']) assert.equal(parseEtimeSeconds(text), undefined, JSON.stringify(text));
  });
});

describe('readProcessStartMs', () => {
  it('reads the start time of this very process to within a few seconds of when it started', () => {
    const now = Date.now();
    const start = readProcessStartMs(process.pid, now);
    assert.ok(start !== undefined, 'ps answered');
    const expected = now - process.uptime() * 1000;
    assert.ok(Math.abs(start - expected) < 3000, `read ${String(start)}, expected about ${String(expected)}`);
  });

  it('is undefined for a process that does not exist', () => {
    assert.equal(readProcessStartMs(2 ** 22 + 12345, Date.now()), undefined);
  });
});
