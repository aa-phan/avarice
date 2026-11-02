// SQLite runtime gate (ADR-001; spike "SQLite on the minimum Node"): the WAL-reset fix landed in 3.51.3,
// 3.50.7 and 3.44.6, so a runtime whose bundled SQLite is older on its line is refused.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSqliteVersion } from '../../src/domain/runtime-support.ts';
import { describeError, openDb } from '../../src/adapters/sqlite/db.ts';

describe('checkSqliteVersion', () => {
  for (const version of ['3.51.3', '3.51.4', '3.53.4', '3.52.0', '3.50.7', '3.50.9', '3.44.6', '3.44.9', '4.0.0']) {
    it(`accepts ${version}`, () => {
      assert.deepEqual(checkSqliteVersion(version), { ok: true, value: undefined });
    });
  }

  for (const version of ['3.47.2', '3.51.2', '3.51.0', '3.50.6', '3.44.5', '3.44.0', '3.45.0', '3.49.9', '3.43.9', '3.8.0']) {
    it(`rejects ${version}`, () => {
      const r = checkSqliteVersion(version);
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error.kind, 'unsupported');
      if (r.error.kind !== 'unsupported') return;
      assert.equal(r.error.capability, 'sqlite-wal-reset-fix');
      assert.equal(r.error.reducedMode, 'none');
    });
  }

  for (const version of ['', 'abc', '3.51', '3.51.x', '3.51.3-rc1', '-3.51.3']) {
    it(`rejects the unparseable version ${JSON.stringify(version)}`, () => {
      assert.equal(checkSqliteVersion(version).ok, false);
    });
  }
});

describe('openDb runtime gate', () => {
  it('opens on this runtime', () => {
    const r = openDb(':memory:');
    assert.ok(r.ok, r.ok ? '' : describeError(r.error));
    r.value.close();
  });

  it('refuses a runtime whose SQLite lacks the fix, before opening the store, with the actionable message', () => {
    for (const readOnly of [false, true]) {
      const r = openDb('/nonexistent-dir/state.db', { readOnly, sqliteVersionProbe: () => '3.47.2' });
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error.kind, 'unsupported');
      const message = describeError(r.error);
      assert.match(message, new RegExp(`Node ${process.version.replace(/\./g, '\\.')} bundles SQLite 3\\.47\\.2 without the WAL-reset fix`));
      assert.match(message, /install Node 22\.22\.3 or newer/);
    }
  });

  it('accepts a probe that reports a fixed version', () => {
    const r = openDb(':memory:', { sqliteVersionProbe: () => '3.51.3' });
    assert.ok(r.ok);
    r.value.close();
  });
});
