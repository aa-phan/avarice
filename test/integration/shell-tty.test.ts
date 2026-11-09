// The interactive shell under a real pseudo-terminal (plan 02-19; FR-27, ADR-013 decision 1). Node has no built-in pseudo-terminal, so the unit
// tests drive the shell with injected streams; this file runs the test CLI entry on a real terminal and checks what the injected streams cannot:
// raw mode on a terminal device, the alternate screen, escape sequences from real key bytes, and a clean exit.
//
// Two harnesses, each skipped with a reason when its tool is missing:
//   - macOS `script -q /dev/null node <entry>` (the plan's harness). `script` needs its own standard input to be a file or a terminal, and it
//     sends end-of-file to the terminal as soon as that file is read, so it can queue keys but cannot type after the screen is up. It proves
//     that the shell opens and ends cleanly on a terminal, and that a shell without a terminal prints usage.
//   - test/helpers/pty-drive.py (python3's pty module), which relays keys as the test sends them and never sends end-of-file. It drives the shell
//     the way a person does: wait for the screen, press a key, wait for the result, and leave with `q`, so an exit 0 can only come from the key.
// What neither covers (resize of a live terminal, colours in an emulator, how the screen looks) is a manual check for verify-work.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, ledgerRows, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { waitFor } from '../helpers/shell-streams.ts';

const SCRIPT = '/usr/bin/script';
const PTY_DRIVE = join(REPO_ROOT, 'test', 'helpers', 'pty-drive.py');
const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const NODE_ARGS = [process.execPath, '--disable-warning=ExperimentalWarning', TEST_CLI];

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function newRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

function terminalEnv(roots: CliRoots): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
    TERM: 'xterm-256color',
  };
  // A child of `node --test` must not inherit the parent runner's context; the shell must not see a run marker or NO_COLOR.
  delete env['NODE_TEST_CONTEXT'];
  delete env['NO_COLOR'];
  delete env['AVARICE_RUN'];
  return env;
}

const plain = (text: string): string => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const ENTER_SCREEN = '\x1b[?1049h';
const LEAVE_SCREEN = '\x1b[?1049l';

interface PtyResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
}

// ---- under script ---------------------------------------------------------------------------------------------------------------------------

// Runs the test CLI with no arguments under `script -q /dev/null`, with `keys` queued as the terminal's input. A shell that does not exit within
// the time is killed and the failure reports what it printed.
function underScript(roots: CliRoots, keys: string, timeoutMs = 60_000): Promise<PtyResult> {
  const dir = mkdtempSync(join(tmpdir(), 'avarice-pty-'));
  cleanup.push(dir);
  const keyFile = join(dir, 'keys');
  writeFileSync(keyFile, keys);
  const input = openSync(keyFile, 'r');
  return new Promise<PtyResult>((resolve, reject) => {
    const child = spawn(SCRIPT, ['-q', '/dev/null', ...NODE_ARGS], { env: terminalEnv(roots), stdio: [input, 'pipe', 'pipe'] });
    closeSync(input);
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the shell did not exit within ${timeoutMs} ms; it printed ${JSON.stringify(output)}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}

describe('the shell under `script`', { skip: existsSync(SCRIPT) ? false : '/usr/bin/script is not available on this machine, so no pseudo-terminal can be created' }, () => {
  it('opens on a terminal, draws the home view on the alternate screen, and exits 0 with the screen restored', async () => {
    const result = await underScript(newRoots(), 'q');
    assert.equal(result.code, 0, `exit code (output ${JSON.stringify(result.output)})`);
    const text = plain(result.output);
    assert.match(text, /shell: personal-local/);
    assert.match(text, /store: ok/);
    assert.match(text, /open decisions: 0/);
    assert.match(text, /1 {2}Start a run/);
    assert.ok(result.output.includes(ENTER_SCREEN), 'the shell entered the alternate screen');
    assert.ok(result.output.endsWith(LEAVE_SCREEN), 'the shell left the alternate screen as its last act');
  });
});

describe('the same entry without a pseudo-terminal', () => {
  it('prints usage on standard error and exits 64 when standard input and output are pipes', () => {
    const result = runCli([], { roots: newRoots(), entry: TEST_CLI });
    assert.equal(result.code, 64, result.stderr);
    assert.match(result.stderr, /usage: avarice <command>/);
    assert.equal(result.stdout, '');
  });
});

// ---- on a driven terminal -------------------------------------------------------------------------------------------------------------------

const HAS_PYTHON = existsSync(PTY_DRIVE) && spawnSync('python3', ['-c', 'import pty, os; os.waitstatus_to_exitcode'], { stdio: 'ignore' }).status === 0;

interface Driven {
  output(): string;
  screen(): string;
  type(keys: string): void;
  exited: Promise<PtyResult>;
  kill(): void;
}

function onTerminal(roots: CliRoots): Driven {
  const child = spawn('python3', [PTY_DRIVE, '30', '100', ...NODE_ARGS], { env: terminalEnv(roots), stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  child.stdin.on('error', () => undefined);
  const exited = new Promise<PtyResult>((resolve) => child.on('close', (code, signal) => resolve({ code, signal, output })));
  return {
    output: () => output,
    screen: () => plain(output),
    type: (keys) => void child.stdin.write(keys),
    exited,
    kill: () => void child.kill('SIGKILL'),
  };
}

describe('the shell on a driven terminal', { skip: HAS_PYTHON ? false : 'python3 with the pty module is not available, so the driven terminal cannot be created' }, () => {
  it('takes real key bytes: a number runs status, `:` opens the command line, Tab completes, Enter runs, Ctrl-C cancels, and `q` alone ends it with 0', async () => {
    const term = onTerminal(newRoots());
    try {
      await waitFor(() => term.screen().includes('open decisions: 0'), `the home view (got ${JSON.stringify(term.screen())})`, 30_000);
      assert.ok(term.output().includes(ENTER_SCREEN));

      term.type('4');
      await waitFor(() => term.screen().includes('status: 0 project(s)'), 'status after pressing 4');

      term.type(':');
      await waitFor(() => term.screen().includes('avarice> '), 'the command-line prompt');
      term.type('stat\t');
      await waitFor(() => term.screen().includes('avarice> status '), 'Tab to complete stat to status');
      term.type('--json\r');
      await waitFor(() => /^\[\]$/m.test(term.screen()), 'the status JSON from the command line');

      term.type(':');
      await waitFor(() => (term.screen().match(/avarice> /g) ?? []).length >= 3, 'the command-line prompt again');
      term.type('\x03');
      await waitFor(() => (term.screen().match(/1 {2}Start a run/g) ?? []).length >= 4, 'Ctrl-C to cancel the prompt');

      term.type('\x1b[B\x1b[A');
      term.type('q');
      const result = await Promise.race([term.exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the shell did not leave on q; screen ${JSON.stringify(term.screen())}`)), 20_000))]);
      assert.equal(result.code, 0);
      assert.ok(result.output.endsWith(LEAVE_SCREEN), 'the shell left the alternate screen as its last act');
    } finally {
      term.kill();
    }
  });

  it('Enter on the Quit item leaves too, and a number that is not an item changes nothing', async () => {
    const term = onTerminal(newRoots());
    try {
      await waitFor(() => term.screen().includes('open decisions: 0'), 'the home view', 30_000);
      term.type('9');
      term.type('\x1b[A');
      await waitFor(() => /> q {2}Quit/.test(term.screen()), 'the up arrow to wrap to Quit');
      term.type('\r');
      const result = await Promise.race([term.exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the shell did not leave on Enter')), 20_000))]);
      assert.equal(result.code, 0);
    } finally {
      term.kill();
    }
  });
});

// `contract amend` from the shell's command line (plan 03-15, D-18): there is no menu action for it. The command runs in the shell's process on the
// real terminal, so the terminal and process-ancestry checks see a person at a terminal, and its confirmation is asked through the shell's prompt.
describe('contract amend from the command line of the shell on a driven terminal', { skip: HAS_PYTHON ? false : 'python3 with the pty module is not available, so the driven terminal cannot be created' }, () => {
  it('shows the diff and the confirmation prompt; answering y records contract version 2 and n records nothing', async () => {
    const roots = newRoots();
    const repo = makeRunRepo();
    cleanup.push(repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo);
    const composed = createDeps(profileEnv(roots), {});
    assert.ok(composed.ok, 'composition');
    let runId: string;
    try {
      const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: writeBrief(join(roots.base, 'briefs')), policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      runId = started.value.runId;
    } finally {
      composed.value.close();
    }
    const versions = (): number[] => ledgerRows<{ version: number }>(roots, 'SELECT version FROM contracts WHERE run_id = ? ORDER BY version', runId).map((c) => c.version);
    const lastFrame = (term: Driven): string => plain(term.output().split('\x1b[H').at(-1) ?? '');

    const term = onTerminal(roots);
    try {
      await waitFor(() => term.screen().includes('open decisions: 0'), 'the home view', 30_000);
      assert.doesNotMatch(term.screen(), /amend/i, 'the menu has no amend action');

      term.type(':');
      await waitFor(() => term.screen().includes('avarice> '), 'the command-line prompt');
      term.type(`contract amend ${runId} --budget costUsdPerRun=12 --reason 'room to resume'\r`);
      await waitFor(() => lastFrame(term).includes('apply contract v2? [y/N] '), 'the confirmation prompt of the shell', 30_000);
      assert.match(lastFrame(term), /budgets\.costUsd\.perRun: 10 -> 12/, 'the diff is on screen with the question');
      assert.deepEqual(versions(), [1], 'nothing is written before the answer');
      term.type('n\r');
      await waitFor(() => term.screen().includes('not amended'), 'the declined amendment');
      assert.deepEqual(versions(), [1]);

      const mark = term.screen().length;
      term.type(':');
      await waitFor(() => term.screen().slice(mark).includes('avarice> '), 'the command-line prompt again');
      term.type(`contract amend ${runId} --budget costUsdPerRun=12 --reason 'room to resume'\r`);
      await waitFor(() => term.screen().slice(mark).includes('apply contract v2? [y/N] '), 'the confirmation prompt again', 30_000);
      term.type('y\r');
      await waitFor(() => term.screen().includes('contract v2 recorded'), 'the recorded amendment', 30_000);
      assert.deepEqual(versions(), [1, 2]);
      assert.equal(ledgerRows<{ limit_value: number }>(roots, "SELECT limit_value FROM budgets WHERE run_id = ? AND name = 'costUsd'", runId)[0]?.limit_value, 12);

      term.type('q');
      const result = await Promise.race([term.exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the shell did not leave on q; screen ${JSON.stringify(term.screen())}`)), 20_000))]);
      assert.equal(result.code, 0);
    } finally {
      term.kill();
    }
  });
});

// The Decide action (plan 03-25; D-13, ADR-013): key 7 lists the open decisions, the choice runs `decide <id>` in the shell's process on the real
// terminal, and the command's question is asked through the shell's own prompt. The answer is recorded as the OS user on the terminal channel.
describe('the Decide action of the shell on a driven terminal', { skip: HAS_PYTHON ? false : 'python3 with the pty module is not available, so the driven terminal cannot be created' }, () => {
  it('lists the open decision, asks the answer through the shell prompt and records `answered (1)` by the OS user on the terminal channel', async () => {
    const roots = newRoots();
    const repo = makeRunRepo();
    cleanup.push(repo.base);
    onboardRunRepo(roots, repo);
    commitConventions(repo);
    const composed = createDeps(profileEnv(roots), {});
    assert.ok(composed.ok, 'composition');
    let decisionId: string;
    try {
      const { deps } = composed.value;
      const started = startRun(deps, { cwd: repo.path, briefPath: writeBrief(join(roots.base, 'briefs')), policy: 'routine', budgetOverrides: {} });
      assert.ok(started.ok, JSON.stringify(started));
      const contract = deps.ledger.getRunContract(started.value.runId);
      assert.ok(contract.ok && contract.value !== null, 'the run has a contract');
      const opened = deps.ledger.openDecision({
        runId: started.value.runId,
        contractVersion: contract.value.version,
        class: 'acceptance',
        issue: 'Which status code?',
        options: [
          { key: '1', label: '404', kind: 'choice' },
          { key: '2', label: '410', kind: 'choice' },
        ],
        consequences: {},
        evidenceRefs: [],
        affectedItems: [],
        stateDigest: 'sha256:test',
        urgency: 'blocking',
        nowMs: Date.now(),
      });
      assert.ok(opened.ok, JSON.stringify(opened));
      decisionId = opened.value.decisionId;
    } finally {
      composed.value.close();
    }
    const row = (): { state: string; answer: string | null; answered_by: string | null; answer_channel: string | null } =>
      ledgerRows<{ state: string; answer: string | null; answered_by: string | null; answer_channel: string | null }>(roots, 'SELECT state, answer, answered_by, answer_channel FROM decisions WHERE decision_id = ?', decisionId)[0] as {
        state: string;
        answer: string | null;
        answered_by: string | null;
        answer_channel: string | null;
      };

    const term = onTerminal(roots);
    try {
      await waitFor(() => term.screen().includes('open decisions: 1'), 'the home view with one open decision', 30_000);
      assert.match(term.screen(), /7 {2}Decide/);

      term.type('7');
      await waitFor(() => term.screen().includes('decision to answer (number or ID): '), 'the decision prompt');
      assert.ok(term.screen().includes(decisionId), 'the list names the decision');
      term.type('1\r');
      await waitFor(() => term.screen().includes('answer (1, 2'), 'the answer prompt of the decide command, asked by the shell', 30_000);
      assert.equal(row().state, 'open', 'nothing is written before the answer');
      term.type('1\r');
      await waitFor(() => term.screen().includes(`decision ${decisionId} answered (1)`), 'the answered decision', 30_000);
      assert.deepEqual(row(), { state: 'answered', answer: '1', answered_by: `owner:${userInfo().username}`, answer_channel: 'terminal' });

      term.type('q');
      const result = await Promise.race([term.exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the shell did not leave on q; screen ${JSON.stringify(term.screen())}`)), 20_000))]);
      assert.equal(result.code, 0);
    } finally {
      term.kill();
    }
  });
});
