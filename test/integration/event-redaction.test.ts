// SEC-3 / D-14 tracer: an event that carries a token is stored redacted, from the ledger writer and from the hook writer, and the
// events hash chain still verifies because row_hash is computed over the text that is stored.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { seedProcessRedactor } from '../../src/adapters/redaction/process-redactor.ts';
import { openDb } from '../../src/adapters/sqlite/db.ts';
import { SqliteLedger } from '../../src/adapters/sqlite/ledger.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { chainIsIntact, eventRows, makeHookFixture, runHook } from '../helpers/hook-fixture.ts';
import type { HookFixture } from '../helpers/hook-fixture.ts';

const fixtures: HookFixture[] = [];
function fixture(): HookFixture {
  const fx = makeHookFixture();
  fixtures.push(fx);
  return fx;
}
after(() => {
  for (const fx of fixtures) rmSync(fx.dir, { recursive: true, force: true });
});

// Built from parts so this file holds no complete secret-shaped literal.
const GITHUB_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4).slice(0, 36)}`;
const AWS_KEY = `AKIA${'IOSFODNN7EXAMPLE'}`;
const PEM = ['-----BEGIN RSA PRIVATE', ' KEY-----\nMIIEowIBAAKCAQEA0123456789abcdef\n-----END RSA PRIVATE', ' KEY-----'].join('');

function appendThroughLedger(fx: HookFixture, data: unknown): void {
  const opened = openDb(fx.ledgerPath);
  assert.ok(opened.ok);
  const ledger = new SqliteLedger(opened.value, (prefix) => `${prefix}x`);
  const receipt = ledger.appendEvent({ type: 'hook.deny', runId: 'run_1', data, nowMs: 1_000 });
  opened.value.close();
  assert.ok(receipt.ok, 'the event is appended');
}

describe('tracer: an event carrying a secret is stored redacted with a valid hash chain (SEC-3)', () => {
  it('stores a GitHub token in event data as [REDACTED:github-token] and the row_hash covers the stored text', () => {
    const fx = fixture();
    appendThroughLedger(fx, { target: GITHUB_TOKEN });
    const [row] = eventRows(fx, 'hook.deny');
    assert.ok(row);
    assert.ok(row.data_json.includes('[REDACTED:github-token]'), row.data_json);
    assert.ok(!row.data_json.includes(GITHUB_TOKEN), 'the token is not stored');
    assert.equal(row.row_hash, sha256Hex([row.prev_hash, row.ts, row.type, row.run_id ?? '', row.data_json].join('\n')));
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('stores a private key block inside a nested data string as [REDACTED:private-key]', () => {
    const fx = fixture();
    appendThroughLedger(fx, { outer: { items: ['ok', `key follows ${PEM} end`] } });
    const [row] = eventRows(fx, 'hook.deny');
    assert.ok(row);
    assert.ok(row.data_json.includes('[REDACTED:private-key]'), row.data_json);
    assert.ok(!row.data_json.includes('MIIEow'), 'the key body is not stored');
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('stores an event written by the PreToolUse hook entry redacted, on the same chain', () => {
    const fx = fixture();
    // The hook records the tool name it was called with; a name that carries a token must not reach the row.
    const result = runHook(fx, 'pre', { tool_name: `Unknown-${GITHUB_TOKEN}`, tool_input: {} });
    assert.ok(result.code === 0 || result.code === 2, result.stderr);
    const rows = eventRows(fx);
    assert.ok(rows.length > 0, 'the hook wrote an event');
    for (const row of rows) assert.ok(!row.data_json.includes(GITHUB_TOKEN), row.data_json);
    assert.ok(rows.some((r) => r.data_json.includes('[REDACTED:github-token]')));
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('stores the staging-relative target of a completed hook write redacted when its name holds an AWS key ID', () => {
    const fx = fixture();
    appendThroughLedger(fx, { before: true });
    const result = runHook(fx, 'post', { tool_name: 'Write', tool_input: { file_path: join(fx.writeRoot, `${AWS_KEY}.md`), content: 'x' } });
    assert.equal(result.code, 0, result.stderr);
    const [row] = eventRows(fx, 'tool.completed');
    assert.ok(row);
    assert.ok(row.data_json.includes('[REDACTED:aws-key]'), row.data_json);
    assert.ok(!row.data_json.includes(AWS_KEY));
    assert.ok(chainIsIntact(fx.ledgerPath));
  });

  it('stores a literal seeded at run time as [REDACTED:seeded] inside a longer string', () => {
    const fx = fixture();
    const literal = 's3cr3t-value-123';
    const seeded = seedProcessRedactor(literal);
    assert.ok(seeded.ok);
    appendThroughLedger(fx, { note: `prefix ${literal} suffix` });
    const [row] = eventRows(fx, 'hook.deny');
    assert.ok(row);
    assert.ok(row.data_json.includes('prefix [REDACTED:seeded] suffix'), row.data_json);
    assert.ok(!row.data_json.includes(literal));
    assert.ok(chainIsIntact(fx.ledgerPath));
  });
});
