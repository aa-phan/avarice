// Offline tests of the live harness hygiene fixes (plan 02-31): R-IN-01 (no recorder writes the owner's home path), R-WR-09 (cleanupAttended
// removes nothing outside its own fixture) and R-WR-08 (the attended allow list holds no rule that admits a write). This file is offline:
// temp files only, no `claude` session, and no deletion outside the temporary directory. The forged fixtures name the real home only as a
// path that must be refused; nothing under it is created or removed.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { redactHome } from '../helpers/live-harness.ts';
import { appendAttendedResult, attendedSettings, cleanupAttended } from '../helpers/live-attended.ts';
import type { AttendedFixture, AttendedLine } from '../helpers/live-attended.ts';

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

// ---- cleanupAttended (R-WR-09) --------------------------------------------------------------------------------------------------
//
// Every directory here is a temp directory. The real home is never passed to cleanupAttended: the checks take the home and the temporary
// directory as roots, so the tests stand in two temp directories for them and a refused fixture can only ever point at temp paths.

const TAG = 'avarice-live-attended-x-abcd1234';
const PARENTS = ['.local/share/avarice', '.local/share/avarice-work', '.config/avarice'];

describe('cleanupAttended (R-WR-09)', () => {
  let sandbox = '';
  let fakeHome = '';
  let fakeTmp = '';
  let keep: string | undefined;
  let disposed = 0;
  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-hygiene-clean-')));
    fakeHome = join(sandbox, 'home');
    fakeTmp = join(sandbox, 'tmp');
    mkdirSync(fakeHome);
    mkdirSync(fakeTmp);
    keep = process.env['AVARICE_LIVE_KEEP'];
    delete process.env['AVARICE_LIVE_KEEP'];
    disposed = 0;
  });
  afterEach(() => {
    if (keep === undefined) delete process.env['AVARICE_LIVE_KEEP'];
    else process.env['AVARICE_LIVE_KEEP'] = keep;
    rmSync(sandbox, { recursive: true, force: true });
  });

  const make = (path: string): string => {
    mkdirSync(path, { recursive: true });
    return path;
  };
  const forged = (over: Partial<Record<'profileDirs' | 'createdParents' | 'evidenceDir', unknown>>): AttendedFixture =>
    ({
      name: 'x',
      tag: TAG,
      repo: { dispose: () => void disposed++ },
      evidenceDir: make(join(fakeTmp, 'evidence')),
      profileDirs: [],
      createdParents: [],
      ...over,
    }) as unknown as AttendedFixture;
  const roots = (): { home: string; tmp: string } => ({ home: fakeHome, tmp: fakeTmp });
  const profile = (parent: string, name: string): string => make(join(fakeHome, parent, name));

  it('throws and deletes nothing for a profile directory that is not under a default parent', () => {
    const outside = make(join(sandbox, 'elsewhere', TAG));
    const f = forged({ profileDirs: [outside] });
    assert.throws(() => cleanupAttended(f, roots()), /not a direct child of a default AVARICE parent/);
    assert.ok(existsSync(outside) && existsSync(f.evidenceDir), 'a directory was removed');
    assert.equal(disposed, 0);
  });

  it('throws and deletes nothing for a profile directory that does not carry the fixture tag', () => {
    const mine = profile(PARENTS[0]!, TAG);
    const other = profile(PARENTS[1]!, 'personal-local');
    const f = forged({ profileDirs: [mine, other] });
    assert.throws(() => cleanupAttended(f, roots()), /does not carry the fixture tag/);
    assert.ok(existsSync(mine) && existsSync(other) && existsSync(f.evidenceDir), 'a directory was removed');
    assert.equal(disposed, 0);
  });

  it('throws and deletes nothing for a profile directory that is a link out of its parent', () => {
    const target = make(join(sandbox, 'target'));
    mkdirSync(join(fakeHome, PARENTS[0]!), { recursive: true });
    const link = join(fakeHome, PARENTS[0]!, TAG);
    symlinkSync(target, link);
    const f = forged({ profileDirs: [link] });
    assert.throws(() => cleanupAttended(f, roots()), /not a direct child of a default AVARICE parent/);
    assert.ok(existsSync(target) && existsSync(f.evidenceDir), 'a directory was removed');
    assert.equal(disposed, 0);
  });

  it('throws and deletes nothing for a created parent that is not one of the three default parents', () => {
    const mine = profile(PARENTS[0]!, TAG);
    const notDefault = make(join(fakeHome, '.local'));
    const f = forged({ profileDirs: [mine], createdParents: [notDefault] });
    assert.throws(() => cleanupAttended(f, roots()), /not one of the default AVARICE parents/);
    assert.ok(existsSync(mine) && existsSync(notDefault) && existsSync(f.evidenceDir), 'a directory was removed');
    assert.equal(disposed, 0);
  });

  it('throws and deletes nothing for an evidence directory outside the temporary directory', () => {
    const outside = make(join(sandbox, 'not-tmp'));
    const f = forged({ evidenceDir: outside });
    assert.throws(() => cleanupAttended(f, roots()), /not inside the temporary directory/);
    assert.ok(existsSync(outside), 'the evidence directory was removed');
    assert.equal(disposed, 0);
  });

  it('throws for an evidence directory that is the temporary directory itself', () => {
    const f = forged({ evidenceDir: fakeTmp });
    assert.throws(() => cleanupAttended(f, roots()), /not inside the temporary directory/);
    assert.ok(existsSync(fakeTmp), 'the temporary directory was removed');
    assert.equal(disposed, 0);
  });

  it('removes the evidence directory and disposes the repository for a fixture with no profile directories or created parents', () => {
    const f = forged({});
    cleanupAttended(f, roots());
    assert.ok(!existsSync(f.evidenceDir), 'the evidence directory is still there');
    assert.equal(disposed, 1);
  });

  it('removes its own profile directories, the parents it created, the evidence directory, and disposes the repository', () => {
    const dirs = [profile(PARENTS[0]!, TAG), profile(PARENTS[1]!, TAG), profile(PARENTS[2]!, TAG)];
    const created = PARENTS.map((p) => join(fakeHome, p));
    const f = forged({ profileDirs: dirs, createdParents: created });
    cleanupAttended(f, roots());
    for (const path of [...dirs, ...created, f.evidenceDir]) assert.ok(!existsSync(path), `${path} is still there`);
    assert.equal(disposed, 1);
  });

  it('skips a profile directory that is already gone', () => {
    const gone = join(fakeHome, PARENTS[0]!, TAG);
    const f = forged({ profileDirs: [gone] });
    cleanupAttended(f, roots());
    assert.ok(!existsSync(f.evidenceDir));
    assert.equal(disposed, 1);
  });
});

// ---- attendedSettings (R-WR-08) -------------------------------------------------------------------------------------------------

describe('attendedSettings allow list (R-WR-08)', () => {
  const allow = (): string[] => (attendedSettings('/tmp/r') as { permissions: { allow: string[] } }).permissions.allow;

  it('allows git only as the exact commands git status and git log --oneline', () => {
    const exact = allow().filter((rule) => rule.startsWith('Bash(git'));
    assert.deepEqual([...exact].sort(), ['Bash(git log --oneline)', 'Bash(git status)']);
  });

  it('holds no rule for cat, head, git diff or git show, and no git prefix rule', () => {
    for (const rule of allow()) {
      assert.ok(!/^Bash\((cat|head|git diff|git show)/.test(rule), `${rule} admits a write`);
      assert.ok(!(rule.startsWith('Bash(git') && rule.endsWith(':*)')), `${rule} is a git prefix rule`);
    }
  });

  it('keeps the rules the sessions need', () => {
    for (const rule of ['Skill', 'Read', 'Glob', 'Grep', 'Bash(avarice status:*)', 'Bash(avarice context:*)', 'Bash(ls:*)', 'Bash(npm test)', 'Bash(npm test:*)']) assert.ok(allow().includes(rule), `${rule} is missing`);
  });
});
