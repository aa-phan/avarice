// The interactive shell starts, watches and resumes a run, and the detached supervisor outlives it (plan 02-19; FR-27, SC 6, ADR-013 decision 4,
// T-02-64). The shell runs in this process with injected terminal streams; its `start` and `resume` spawn a real detached `avarice supervise`
// (the test entry, with the fake run host playing the unit through the real hook entry). Nothing here calls a real model, opens a socket or
// signals a supervisor: the only signals are the SIGKILL of the fault points that build the interrupted run for the resume case.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { runShell } from '../../src/cli/shell/shell.ts';
import { REPO_ROOT, makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { RUN_EXPIRY_WAIT_MS, RUN_LEASE_TTL_MS, rows, runRunWithFault, sleepSync } from '../helpers/fault-run.ts';
import type { FakeRunOptions } from '../helpers/fake-run-host.ts';
import { FIXED_SLUG, RUN_CONVENTIONS_WITH_COMMANDS, commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { fakeTerminal, waitFor } from '../helpers/shell-streams.ts';
import type { FakeTerminal } from '../helpers/shell-streams.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const FIX: FakeRunOptions = { edits: { 'src/slug.ts': FIXED_SLUG }, summary: true, verification: 'passed' };

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
  brief: string;
}

function fixture(): Fixture {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS_WITH_COMMANDS);
  return { roots, repo, brief: writeBrief(join(roots.base, 'briefs')) };
}

function terminalEnv(roots: CliRoots): NodeJS.ProcessEnv {
  const env = profileEnv(roots);
  delete env['NO_COLOR'];
  delete env['AVARICE_RUN'];
  env['TERM'] = 'xterm-256color';
  return env;
}

// The shell spawns its supervisor from the script that is running (process.argv[1]), from the data root, with this process's environment. Inside a
// test that script is the test runner, so for the duration of `body` the entry is the test CLI (production main() with the fake run host), the
// host options travel in AVARICE_FAKE_HOST, and the working directory is the repository (`start` resolves the project from it).
async function withSupervisorEntry<T>(f: Fixture, host: FakeRunOptions, body: () => Promise<T>): Promise<T> {
  const saved = { argv1: process.argv[1], execArgv: process.execArgv, cwd: process.cwd(), fake: process.env['AVARICE_FAKE_HOST'], ttl: process.env['AVARICE_LEASE_TTL_MS'] };
  process.argv[1] = TEST_CLI;
  process.execArgv = ['--disable-warning=ExperimentalWarning'];
  process.env['AVARICE_FAKE_HOST'] = JSON.stringify({ run: host });
  process.env['AVARICE_LEASE_TTL_MS'] = String(RUN_LEASE_TTL_MS);
  process.chdir(f.repo.path);
  try {
    return await body();
  } finally {
    process.argv[1] = saved.argv1 as string;
    process.execArgv = saved.execArgv;
    process.chdir(saved.cwd);
    if (saved.fake === undefined) delete process.env['AVARICE_FAKE_HOST'];
    else process.env['AVARICE_FAKE_HOST'] = saved.fake;
    if (saved.ttl === undefined) delete process.env['AVARICE_LEASE_TTL_MS'];
    else process.env['AVARICE_LEASE_TTL_MS'] = saved.ttl;
  }
}

const screen = (term: FakeTerminal): string => term.output().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const stateOf = (roots: CliRoots, runId: string): string => rows<{ state: string }>(roots, 'SELECT state FROM runs WHERE run_id = ?', runId)[0]?.state ?? 'missing';

async function waitForState(roots: CliRoots, runId: string, state: string): Promise<void> {
  await waitFor(() => stateOf(roots, runId) === state, `run ${runId} to reach ${state} (is ${stateOf(roots, runId)})`, 120_000);
}

function supervisorPid(roots: CliRoots, runId: string, step: 'supervisor:spawn' | 'supervisor:resume'): number {
  const row = rows<{ result_json: string }>(roots, 'SELECT result_json FROM run_steps WHERE run_id = ? AND step = ? ORDER BY attempt DESC LIMIT 1', runId, step)[0];
  assert.ok(row, `the ledger records ${step}`);
  return (JSON.parse(row.result_json) as { pid: number }).pid;
}

// Samples the active resources of this process while a test runs: a listening server of any kind shows up as a TCPServerWrap or a PipeServerWrap.
function watchForServers(): { stop(): string[] } {
  const seen = new Set<string>();
  const timer = setInterval(() => {
    for (const name of process.getActiveResourcesInfo()) if (name === 'TCPServerWrap' || name === 'PipeServerWrap') seen.add(name);
  }, 10);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      return [...seen];
    },
  };
}

describe('a run started from the shell keeps going after the shell exits (SC 6, T-02-64)', () => {
  const f = fixture();

  it('Start, Watch until launch:run appears, quit the shell: the supervisor is alive and the run reaches ready_for_review', async () => {
    const servers = watchForServers();
    const runId = await withSupervisorEntry(f, { ...FIX, delayMs: 3000 }, async () => {
      const term = fakeTerminal();
      const exited = runShell({ stdin: term.stdin, stdout: term.stdout, env: terminalEnv(f.roots), pollMs: 100 });
      await waitFor(() => term.output().includes('open decisions:'), 'the home view');
      term.type('1');
      await waitFor(() => screen(term).includes('brief path: '), 'the brief prompt');
      term.type(`${f.brief}\r`);
      await waitFor(() => /run run_[0-9A-Z]{26}: contract_ready/.test(screen(term)), 'the start result');
      const id = /run (run_[0-9A-Z]{26}): contract_ready/.exec(screen(term))?.[1] as string;
      assert.match(screen(term), /policy: routine/);

      term.type('2');
      await waitFor(() => screen(term).includes('run to watch (number or ID): '), 'the watch prompt');
      term.mark();
      term.type('1\r');
      await waitFor(() => /#\d+ launch:run/.test(term.sinceMark().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')), 'the launch:run checkpoint in the live view', 120_000);
      assert.match(term.sinceMark().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), new RegExp(`run ${id}: running`));
      term.type('q');
      await waitFor(() => (screen(term).match(/1 {2}Start a run/g) ?? []).length >= 3, 'the menu after q');
      term.type('q');
      assert.equal(await exited, 0);
      return id;
    });

    // The shell has exited. It sent no signal, so the supervisor it started is still working.
    const pid = supervisorPid(f.roots, runId, 'supervisor:spawn');
    assert.ok(isAlive(pid), `supervisor ${pid} is alive after the shell exited`);
    assert.notEqual(stateOf(f.roots, runId), 'ready_for_review', 'the run was still unfinished when the shell exited');
    await waitForState(f.roots, runId, 'ready_for_review');
    assert.deepEqual(servers.stop(), [], 'the shell never opened a server');

    // A second shell, opened on the finished profile, watches the run: the view ends by itself at a stop state and returns to the menu.
    const again = fakeTerminal();
    const exited = runShell({ stdin: again.stdin, stdout: again.stdout, env: terminalEnv(f.roots), pollMs: 100 });
    await waitFor(() => again.output().includes('open decisions:'), 'the home view of the second shell');
    assert.match(screen(again), new RegExp(`run\\s+${runId}\\s+ready_for_review`));
    again.type('2');
    await waitFor(() => screen(again).includes('run to watch (number or ID): '), 'the watch prompt');
    again.type('1\r');
    await waitFor(() => screen(again).includes(`run ${runId}: ready_for_review`) && (screen(again).match(/1 {2}Start a run/g) ?? []).length >= 3, 'the watch to end by itself at the stop state');
    again.type('q');
    assert.equal(await exited, 0);
  });
});

describe('a killed run is resumed from the shell and keeps going after the shell exits (FR-7, SC 6)', () => {
  const f = fixture();

  it('Resume continues a run killed at launch:run; the supervisor outlives the shell and the run reaches ready_for_review', async () => {
    const killed = runRunWithFault(f.roots, f.repo, f.brief, 'after-checkpoint:launch:run', FIX);
    const { runId } = killed;
    sleepSync(RUN_EXPIRY_WAIT_MS);
    assert.notEqual(stateOf(f.roots, runId), 'ready_for_review');

    const servers = watchForServers();
    await withSupervisorEntry(f, { ...FIX, delayMs: 2500 }, async () => {
      const term = fakeTerminal();
      const exited = runShell({ stdin: term.stdin, stdout: term.stdout, env: terminalEnv(f.roots), pollMs: 100 });
      await waitFor(() => term.output().includes('open decisions:'), 'the home view');
      assert.match(screen(term), new RegExp(`run\\s+${runId}\\s+paused \\(supervisor interrupted\\)\\s+launch:run`));
      term.type('3');
      await waitFor(() => screen(term).includes('run or onboarding to resume (number or ID): '), 'the resume prompt');
      assert.ok(screen(term).includes(runId), 'the list names the interrupted run');
      term.type('1\r');
      await waitFor(() => screen(term).includes(`run ${runId}: resuming from`), 'the resume result');
      term.type('q');
      assert.equal(await exited, 0);
    });

    const pid = supervisorPid(f.roots, runId, 'supervisor:resume');
    assert.ok(isAlive(pid), `supervisor ${pid} is alive after the shell exited`);
    await waitForState(f.roots, runId, 'ready_for_review');
    assert.deepEqual(servers.stop(), [], 'the shell never opened a server');
  });
});
