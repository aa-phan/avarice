// The osascript adapter of the Notifier port (plan 03-16; D-22, T-03-29, T-03-30). The banner text is passed as arguments after `--` and is
// never part of the AppleScript, so a hostile body stays one literal argument. Every case runs a fake script (test/helpers/fake-osascript.mjs
// or a file made under a temp directory), never the real osascript, so no banner is ever posted during a test.
import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalNotifier, osascriptArgs } from '../../src/adapters/notify/local-notifier.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';

const FAKE_OSASCRIPT = join(REPO_ROOT, 'test', 'helpers', 'fake-osascript.mjs');
const HOSTILE = 'x" & (do shell script "echo pwned") & "';
const SCRIPT_LINES = ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run'];

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

const FAKE_VARIABLES = ['FAKE_OSASCRIPT_LOG', 'FAKE_OSASCRIPT_EXIT', 'FAKE_OSASCRIPT_SLEEP_MS'] as const;
afterEach(() => {
  for (const name of FAKE_VARIABLES) delete process.env[name];
});

function logFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-notifier-'));
  cleanup.push(dir);
  return join(dir, 'osascript.log');
}

const recorded = (log: string): string[][] =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);

describe('osascriptArgs (T-03-29)', () => {
  it('keeps the three -e lines identical for any body and puts the text only after `--`', () => {
    const plain = osascriptArgs({ title: 'AVARICE', body: 'run_1: 1 decision waiting. Run: avarice inbox' });
    const hostile = osascriptArgs({ title: 'AVARICE', body: HOSTILE });
    assert.deepEqual(plain.slice(0, 6), SCRIPT_LINES);
    assert.deepEqual(hostile.slice(0, 6), SCRIPT_LINES);
    assert.equal(hostile[6], '--');
    assert.deepEqual(hostile.slice(7), [HOSTILE, 'AVARICE']);
    assert.equal(hostile.length, 9);
    // The hostile text appears in exactly one argument, and in none of the script lines.
    assert.equal(hostile.filter((a) => a.includes('pwned')).length, 1);
    assert.equal(hostile.slice(0, 6).some((a) => a.includes('pwned')), false);
  });

  it('puts the title after the body, whatever characters the title holds', () => {
    const args = osascriptArgs({ title: '--', body: '-e' });
    assert.deepEqual(args.slice(6), ['--', '-e', '--']);
  });
});

describe('LocalNotifier', () => {
  it('describes itself as the offline banner adapter of the notifier port', () => {
    const d = new LocalNotifier({ osascriptPath: FAKE_OSASCRIPT }).descriptor;
    assert.deepEqual([d.port, d.adapter, d.offline], ['notifier', 'local-osascript', true]);
    assert.equal(d.capabilities['banner'], true);
  });

  it('delivers: the script receives the hostile body byte for byte as one argument, then the title', async () => {
    chmodSync(FAKE_OSASCRIPT, 0o755);
    const log = logFile();
    process.env['FAKE_OSASCRIPT_LOG'] = log;
    const result = await new LocalNotifier({ osascriptPath: FAKE_OSASCRIPT }).deliver({ title: 'AVARICE', body: HOSTILE });
    assert.deepEqual(result, { ok: true, value: undefined });
    const calls = recorded(log);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [...SCRIPT_LINES, '--', HOSTILE, 'AVARICE']);
    assert.equal((calls[0] as string[])[7], HOSTILE, 'the recorded argument equals the input string');
  });

  it('returns osascript-missing for a path that does not exist', async () => {
    const result = await new LocalNotifier({ osascriptPath: join(tmpdir(), 'avarice-no-such-osascript') }).deliver({ title: 'AVARICE', body: 'x' });
    assert.deepEqual(result, { ok: false, error: { kind: 'unavailable', cause: 'osascript-missing' } });
  });

  it('returns osascript-failed for a script that exits 1, and for a file that is not executable', async () => {
    chmodSync(FAKE_OSASCRIPT, 0o755);
    process.env['FAKE_OSASCRIPT_EXIT'] = '1';
    const failed = await new LocalNotifier({ osascriptPath: FAKE_OSASCRIPT }).deliver({ title: 'AVARICE', body: 'x' });
    assert.deepEqual(failed, { ok: false, error: { kind: 'unavailable', cause: 'osascript-failed' } });
    const dir = mkdtempSync(join(tmpdir(), 'avarice-notifier-'));
    cleanup.push(dir);
    const plain = join(dir, 'not-executable');
    writeFileSync(plain, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
    const refused = await new LocalNotifier({ osascriptPath: plain }).deliver({ title: 'AVARICE', body: 'x' });
    assert.deepEqual(refused, { ok: false, error: { kind: 'unavailable', cause: 'osascript-failed' } });
  });

  it('returns osascript-timeout for a script that outlives a 200 ms timeout, and ends it', async () => {
    chmodSync(FAKE_OSASCRIPT, 0o755);
    process.env['FAKE_OSASCRIPT_SLEEP_MS'] = '5000';
    const started = Date.now();
    const result = await new LocalNotifier({ osascriptPath: FAKE_OSASCRIPT, timeoutMs: 200 }).deliver({ title: 'AVARICE', body: 'x' });
    assert.deepEqual(result, { ok: false, error: { kind: 'unavailable', cause: 'osascript-timeout' } });
    assert.ok(Date.now() - started < 4000, 'the call did not wait for the script');
  });
});
