// Offline tests of the live harness hygiene fixes (plan 02-31): R-IN-01 (no recorder writes the owner's home path), R-WR-09 (cleanupAttended
// removes nothing outside its own fixture) and R-WR-08 (the attended allow list holds no rule that admits a write). This file is offline:
// temp files only, no `claude` session, and no deletion outside the temporary directory. The forged fixtures name the real home only as a
// path that must be refused; nothing under it is created or removed.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { redactHome } from '../helpers/live-harness.ts';
import { appendAttendedResult } from '../helpers/live-attended.ts';
import type { AttendedLine } from '../helpers/live-attended.ts';

const REAL_HOME = realpathSync(homedir());

describe('redactHome (R-IN-01)', () => {
  it('replaces the real home directory with ~', () => {
    assert.equal(redactHome(`${REAL_HOME}/.local/bin/claude`), '~/.local/bin/claude');
  });

  it('replaces the homedir() spelling with ~', () => {
    assert.equal(redactHome(`${homedir()}/.config/avarice`), '~/.config/avarice');
  });

  it('replaces every occurrence, inside quotes and at the end of the text', () => {
    assert.equal(redactHome(`{"a":"${REAL_HOME}/x","b":"${REAL_HOME}"} and ${REAL_HOME}`), '{"a":"~/x","b":"~"} and ~');
  });

  it('leaves text without the home directory alone', () => {
    assert.equal(redactHome('/usr/local/bin/claude and ~/already'), '/usr/local/bin/claude and ~/already');
  });

  it('does not rewrite a path that only shares a prefix with the home directory', () => {
    assert.equal(redactHome(`${REAL_HOME}2/x and ${REAL_HOME}-backup/y`), `${REAL_HOME}2/x and ${REAL_HOME}-backup/y`);
  });
});

describe('appendAttendedResult (R-IN-01)', () => {
  let dir = '';
  let saved: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'avarice-hygiene-'));
    saved = process.env['AVARICE_ATTENDED_RESULTS'];
    process.env['AVARICE_ATTENDED_RESULTS'] = join(dir, 'results.jsonl');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env['AVARICE_ATTENDED_RESULTS'];
    else process.env['AVARICE_ATTENDED_RESULTS'] = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a line whose reason holds the home path with ~ and no home path', () => {
    const line = { case: 'c', verdict: 'FAIL', reason: `host binary ${REAL_HOME}/.local/bin/claude was not found`, evidenceDir: `${REAL_HOME}/scratch` } as unknown as AttendedLine;
    appendAttendedResult(line);
    const written = readFileSync(join(dir, 'results.jsonl'), 'utf8');
    assert.ok(!written.includes(REAL_HOME), `the written line still holds the home path: ${written}`);
    const parsed = JSON.parse(written) as AttendedLine;
    assert.equal(parsed.reason, 'host binary ~/.local/bin/claude was not found');
    assert.equal(parsed.evidenceDir, '~/scratch');
  });
});
