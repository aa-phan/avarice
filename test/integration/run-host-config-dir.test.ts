// The host configuration directory of a run (plan 03-43; owner decision 1 of 2026-11-10; SC3, AUT-3, AUT-5, AUT-12). `claude -p --resume` looks only in the
// configuration directory of the process that launches it, so a run started under one CLAUDE_CONFIG_DIR and answered from a terminal with another lost the
// session it had paused (the repeated exit, plan 03-42). The run now records its directory at start and every supervisor of the run uses it. The fake run host
// keeps its sessions per configuration directory (`sessionsPerConfigDir`), as the real one does. No test calls a real model, and every directory here is a
// temporary one: nothing reads or writes the owner's ~/.claude or ~/.claude-edu.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { locateGsdCore } from '../../src/adapters/gsd/locate.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { effectiveHostConfigDir, hostConfigDirProblem } from '../../src/cli/host-config-dir.ts';
import { supervisorEnv } from '../../src/cli/spawn-supervisor.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { decideMain, resumedHost, startBlocked, withSupervisorEntry } from '../helpers/decide-cli.ts';
import type { Blocked } from '../helpers/decide-cli.ts';
import { attemptsOfRun, itemStatesOf, runRowOf, s17Host } from '../helpers/independent-work.ts';
import { ledgerRows, profileEnv } from '../helpers/run-fixtures.ts';
import type { CliRoots } from '../helpers/run-cli.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = (label: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-hostdir-${label}-`)));
  cleanup.push(dir);
  return dir;
};

// ---- the rule ------------------------------------------------------------------------------------------------------------------------------

describe('effectiveHostConfigDir: the directory the host uses (the rule the composition applies)', () => {
  it('is CLAUDE_CONFIG_DIR when set and not empty, resolved to an absolute path (its real path when it exists)', () => {
    const real = tempDir('eff');
    assert.equal(effectiveHostConfigDir({ CLAUDE_CONFIG_DIR: real }, '/home/u'), real);
    assert.equal(effectiveHostConfigDir({ CLAUDE_CONFIG_DIR: join(real, 'a', '..') }, '/home/u'), real, 'a path with a dot-dot segment is resolved');
    assert.equal(effectiveHostConfigDir({ CLAUDE_CONFIG_DIR: '/x/conf' }, '/home/u'), '/x/conf', 'a directory that does not exist is only made absolute');
  });

  it('is <home>/.claude when the variable is unset or empty', () => {
    assert.equal(effectiveHostConfigDir({}, '/home/u'), '/home/u/.claude');
    assert.equal(effectiveHostConfigDir({ CLAUDE_CONFIG_DIR: '' }, '/home/u'), '/home/u/.claude');
  });
});

describe('hostConfigDirProblem: a directory this process can read and list', () => {
  it('is undefined for an existing, readable directory, and a short reason otherwise', () => {
    const dir = tempDir('problem');
    assert.equal(hostConfigDirProblem(dir), undefined);
    assert.equal(hostConfigDirProblem(join(dir, 'nowhere')), 'missing');
    writeFileSync(join(dir, 'file'), 'x');
    assert.equal(hostConfigDirProblem(join(dir, 'file')), 'not a directory');
    const closed = join(dir, 'closed');
    mkdirSync(closed);
    chmodSync(closed, 0o000);
    try {
      assert.equal(hostConfigDirProblem(closed), 'unreadable');
    } finally {
      chmodSync(closed, 0o700);
    }
  });
});

// ---- the run records it, every supervisor uses it ---------------------------------------------------------------------------------------------

// The four-item scenario in which item B asks, with the fake host keeping its sessions per configuration directory. `dir` is the start's directory.
const hostFor = (extra: FakeRunOptions = {}): FakeRunOptions => ({ ...s17Host(), sessionsPerConfigDir: true, ...extra });

const startUnder = (dir: string | undefined, env: Record<string, string | undefined> = {}): Blocked =>
  startBlocked(cleanup, hostFor(), [], { CLAUDE_CONFIG_DIR: dir, ...env });

const hostStepsOf = (roots: CliRoots, runId: string): Array<{ status: string; result: Record<string, unknown> }> =>
  ledgerRows<{ status: string; result_json: string }>(roots, "SELECT status, result_json FROM run_steps WHERE run_id = ? AND step = 'host:config-dir' ORDER BY rowid", runId).map((r) => ({
    status: r.status,
    result: JSON.parse(r.result_json) as Record<string, unknown>,
  }));

// What a run started before this fix looks like: no `host:config-dir` step.
function forgetHostDir(roots: CliRoots, runId: string): void {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare("DELETE FROM run_steps WHERE run_id = ? AND step = 'host:config-dir'").run(runId);
  } finally {
    db.close();
  }
}

const sessionsUnder = (dir: string, session: string): boolean => existsSync(join(dir, 'fake-sessions', session));

describe('start records the directory of the process that started the run (tracer)', () => {
  const dirA = tempDir('A');
  const b = startUnder(dirA);

  it('writes one completed `host:config-dir` step with the directory and where it came from', () => {
    assert.deepEqual(hostStepsOf(b.f.roots, b.runId), [{ status: 'completed', result: { claudeConfigDir: dirA, source: 'CLAUDE_CONFIG_DIR' } }]);
    assert.ok(sessionsUnder(dirA, b.firstSession), "B's first session is kept under the start's directory");
  });

  it('records <HOME>/.claude with source `default` when CLAUDE_CONFIG_DIR is not set', () => {
    const home = tempDir('home');
    mkdirSync(join(home, '.claude'));
    // The gsd-core the machine has, named explicitly: the lookup would otherwise probe the temporary home. The host keeps no sessions per directory here.
    const located = locateGsdCore(process.env);
    assert.ok(located.ok, 'this machine has an admitted gsd-core');
    const unset = startBlocked(cleanup, s17Host(), [], { CLAUDE_CONFIG_DIR: undefined, HOME: home, GSD_HOME: located.value.gsdCoreDir });
    assert.deepEqual(hostStepsOf(unset.f.roots, unset.runId), [{ status: 'completed', result: { claudeConfigDir: join(home, '.claude'), source: 'default' } }]);
  });

  it('is applied to the supervisor environment when given the run ID, and left as it is for a run with no step', () => {
    const composed = createDeps(profileEnv(b.f.roots));
    assert.ok(composed.ok, 'composition');
    try {
      const other = tempDir('other');
      const saved = process.env['CLAUDE_CONFIG_DIR'];
      process.env['CLAUDE_CONFIG_DIR'] = other;
      try {
        assert.equal(supervisorEnv(composed.value.deps, b.runId)['CLAUDE_CONFIG_DIR'], dirA, 'the recorded directory wins over the environment of the command');
        assert.equal(supervisorEnv(composed.value.deps)['CLAUDE_CONFIG_DIR'], other, 'given no run ID, the environment of the command passes as it did before');
        assert.equal(supervisorEnv(composed.value.deps, 'run_00000000000000000000000000')['CLAUDE_CONFIG_DIR'], other, 'a run with no step is left as it was');
      } finally {
        if (saved === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
        else process.env['CLAUDE_CONFIG_DIR'] = saved;
      }
    } finally {
      composed.value.close();
    }
  });
});

describe('a run started under directory A and answered from directory B resumes the session it paused in', () => {
  const dirA = tempDir('A');
  const dirB = tempDir('B');
  const b = startUnder(dirA);
  const recordB = join(b.f.roots.base, 'unit-B-resumed.json');

  it('resumes the recorded session under A: no fresh attempt, and the run reaches ready_for_review', async () => {
    const answered = await withSupervisorEntry({ ...resumedHost(recordB), sessionsPerConfigDir: true }, () => decideMain(b.f.roots, [b.decisionId, '2', '--wait']), { CLAUDE_CONFIG_DIR: dirB });
    assert.equal(answered.code, 0, answered.err + answered.out);
    assert.equal(runRowOf(b.f.roots, b.runId).state, 'ready_for_review');
    const request = JSON.parse(readFileSync(recordB, 'utf8')) as { resumeSessionId?: string };
    assert.equal(request.resumeSessionId, b.firstSession, 'the resume names the session B was delegated');
    assert.deepEqual(
      attemptsOfRun(b.f.roots, b.runId).map((a) => [a.item_id, a.reason]),
      [
        ['A', 'initial'],
        ['B', 'initial'],
        ['C', 'initial'],
        ['B', 'resume'],
        ['D', 'initial'],
      ],
      'no fresh `answer` attempt ran',
    );
    assert.equal(ledgerRows(b.f.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'resume:fallback'", b.runId).length, 0, 'no fallback was recorded');
    assert.deepEqual(
      itemStatesOf(b.f.roots, b.runId).map((x) => x.join(':')),
      ['A:done', 'B:done', 'C:done', 'D:done'],
    );
    assert.ok(!sessionsUnder(dirB, b.firstSession), 'the session was never under B');
  });
});

describe('control: a run with no recorded directory answered from directory B reproduces the repeated exit (the missing session, then a fresh attempt)', () => {
  const dirA = tempDir('A');
  const dirB = tempDir('B');
  const b = startUnder(dirA);

  it('the host finds no session under B, so the resume is discarded and a fresh `answer` attempt runs', async () => {
    forgetHostDir(b.f.roots, b.runId);
    const fresh: FakeRunOptions = { ...resumedHost(join(b.f.roots.base, 'unit-B-resumed.json')), sessionsPerConfigDir: true };
    const answered = await withSupervisorEntry(fresh, () => decideMain(b.f.roots, [b.decisionId, '2', '--wait']), { CLAUDE_CONFIG_DIR: dirB });
    assert.equal(answered.code, 0, answered.err + answered.out);
    const attempts = attemptsOfRun(b.f.roots, b.runId).map((a) => [a.item_id, a.reason, a.outcome]);
    assert.deepEqual(attempts.filter((a) => a[0] === 'B'), [
      ['B', 'initial', 'blocked:decision'],
      ['B', 'resume', 'discarded'],
      ['B', 'answer', 'committed'],
    ]);
    assert.equal(ledgerRows(b.f.roots, "SELECT 1 FROM run_steps WHERE run_id = ? AND step = 'resume:fallback'", b.runId).length, 1, 'the fallback was recorded');
  });
});
