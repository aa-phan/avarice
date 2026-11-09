// The interactive shell (plan 02-19; FR-27, ADR-013): driven through injected streams only, never a real terminal. The home view, the
// refusal cases, the command line running in this process, the line mode of a dumb terminal, NO_COLOR, resize, a ledger that cannot be
// opened, the menu, completion and history. A real pseudo-terminal is test/integration/shell-tty.test.ts.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { COMMANDS, main } from '../../src/cli/main.ts';
import type { MainOverrides } from '../../src/cli/main.ts';
import { renderHome } from '../../src/cli/shell/home-view.ts';
import type { HomeView } from '../../src/cli/shell/home-view.ts';
import { completeCommand, LineEditor } from '../../src/cli/shell/line-editor.ts';
import type { EditorResult, KeyInput } from '../../src/cli/shell/line-editor.ts';
import { appendHistory, HISTORY_CAP, loadHistory } from '../../src/cli/shell/history.ts';
import { runShell } from '../../src/cli/shell/shell.ts';
import type { RunStatus } from '../../src/app/run-status.ts';
import type { ProjectStatus } from '../../src/app/status.ts';
import { fakeTerminal, HAS_ESC, HAS_SGR, waitFor } from '../helpers/shell-streams.ts';
import type { FakeTerminal } from '../helpers/shell-streams.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { commitConventions, makeRunRepo, onboardRunRepo, profileEnv, writeBrief } from '../helpers/run-fixtures.ts';
import { startRun } from '../../src/app/run-start.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The environment of a profile in a terminal that supports colour, outside a run.
function terminalEnv(roots: CliRoots, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = profileEnv(roots);
  delete env['NO_COLOR'];
  delete env['AVARICE_RUN'];
  env['TERM'] = 'xterm-256color';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// What the shell drew, without the cursor and erase sequences between the lines.
function withoutEscapes(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function newRoots(): CliRoots {
  const roots = makeRoots();
  cleanup.push(roots.base);
  return roots;
}

// A profile with one registered repository, so `status` has something to print.
function profileWithProject(): CliRoots {
  const roots = newRoots();
  const repo = makeScratchRepo({ files: { 'README.md': '# scratch\n' } });
  cleanup.push(repo.base);
  const added = runCli(['repo', 'add', repo.path], { roots });
  assert.equal(added.code, 0, added.stderr);
  return roots;
}

interface Capture {
  out: string;
  err: string;
  io: { out(text: string): void; err(text: string): void };
}

function capture(): Capture {
  const c: Capture = {
    out: '',
    err: '',
    io: {
      out: (text) => void (c.out += text),
      err: (text) => void (c.err += text),
    },
  };
  return c;
}

function startShell(term: FakeTerminal, env: NodeJS.ProcessEnv, extra: MainOverrides = {}): Promise<number> {
  return main([], { stdin: term.stdin, stdout: term.stdout, env, ...extra });
}

describe('bare `avarice` opens the shell only in a terminal outside a run (FR-27, ADR-013 decision 1)', () => {
  it('two terminals and no AVARICE_RUN: a home view, `:` then `status --json` prints the one-shot JSON, `q` exits 0', async () => {
    const roots = profileWithProject();
    const env = terminalEnv(roots);
    const oneShot = capture();
    assert.equal(await main(['status', '--json'], { env, io: oneShot.io }), 0);

    const term = fakeTerminal();
    const exited = startShell(term, env);
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    const firstLine = term.output().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').find((line) => line.trim() !== '');
    assert.equal(firstLine, 'shell: personal-local');
    assert.match(term.output(), /store: ok/);
    assert.match(term.output(), /open decisions: 0/);

    term.mark();
    term.type(':');
    term.type('status --json');
    term.type('\r');
    await waitFor(() => withoutEscapes(term.sinceMark()).includes(oneShot.out.trimEnd()), 'the status JSON');
    term.type('q');
    assert.equal(await exited, 0);
    assert.deepEqual(term.rawModes, [true, false], 'raw mode is entered once and restored on exit');
  });

  const refused: Array<{ name: string; term: () => FakeTerminal; env?: Record<string, string> }> = [
    { name: 'standard input is not a terminal', term: () => fakeTerminal({ inputIsTty: false }) },
    { name: 'standard output is not a terminal', term: () => fakeTerminal({ outputIsTty: false }) },
    { name: 'AVARICE_RUN is set', term: () => fakeTerminal(), env: { AVARICE_RUN: 'run_01HX' } },
    { name: 'neither stream is a terminal', term: () => fakeTerminal({ inputIsTty: false, outputIsTty: false }) },
  ];
  for (const c of refused) {
    it(`prints usage on standard error and exits 64 when ${c.name}`, async () => {
      const roots = newRoots();
      const term = c.term();
      const sink = capture();
      const code = await main([], { stdin: term.stdin, stdout: term.stdout, env: terminalEnv(roots, c.env), io: sink.io });
      assert.equal(code, 64);
      assert.match(sink.err, /usage: avarice <command>/);
      assert.match(sink.err, /no command given/);
      assert.equal(term.output(), '', 'nothing is drawn');
      assert.deepEqual(term.rawModes, [], 'raw mode is never entered');
    });
  }

  it('runShell itself refuses under AVARICE_RUN, so no command can run from it', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const sink = capture();
    const calls: string[][] = [];
    const code = await runShell({
      stdin: term.stdin,
      stdout: term.stdout,
      env: terminalEnv(roots, { AVARICE_RUN: 'run_01HX' }),
      io: sink.io,
      dispatch: (argv) => {
        calls.push([...argv]);
        return Promise.resolve(0);
      },
    });
    assert.equal(code, 64);
    assert.match(sink.err, /AVARICE_RUN/);
    assert.deepEqual(calls, []);
    assert.equal(term.output(), '');
  });

  it('`avarice <command>` stays one-shot with terminals present', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const sink = capture();
    const code = await main(['status'], { stdin: term.stdin, stdout: term.stdout, env: terminalEnv(roots), io: sink.io });
    assert.equal(code, 0);
    assert.match(sink.out, /^status: 0 project\(s\)/);
    assert.equal(term.output(), '');
    assert.deepEqual(term.rawModes, []);
  });
});

describe('the command line (ADR-013 decision 2)', () => {
  it('an empty entry redraws the view and runs nothing', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const calls: string[][] = [];
    const exited = runShell({
      stdin: term.stdin,
      stdout: term.stdout,
      env: terminalEnv(roots),
      dispatch: (argv) => {
        calls.push([...argv]);
        return Promise.resolve(0);
      },
    });
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    const drawn = (term.output().match(/shell: personal-local/g) ?? []).length;
    term.type(':');
    term.type('   ');
    term.type('\r');
    await waitFor(() => (term.output().match(/shell: personal-local/g) ?? []).length > drawn, 'the redraw');
    assert.deepEqual(calls, [], 'no command module was invoked');
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('runs the typed words through the dispatcher in this process, without the `avarice` prefix, and shows the output', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const calls: string[][] = [];
    const exited = runShell({
      stdin: term.stdin,
      stdout: term.stdout,
      env: terminalEnv(roots),
      dispatch: (argv, overrides) => {
        calls.push([...argv]);
        overrides.io?.out(`ran ${argv.join(' ')}\n`);
        return Promise.resolve(3);
      },
    });
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    term.type(':');
    term.type('avarice resume onb_123\r');
    await waitFor(() => term.output().includes('ran resume onb_123'), 'the command output');
    assert.deepEqual(calls, [['resume', 'onb_123']]);
    assert.match(term.output(), /exit 3/);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('prints model-derived and recorded strings through stripControl', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const exited = runShell({
      stdin: term.stdin,
      stdout: term.stdout,
      env: terminalEnv(roots, { NO_COLOR: '1' }),
      dispatch: (_argv, overrides) => {
        overrides.io?.out('title: \x1b]0;owned\x07\x1b[2Jfix it\x9b31m\n');
        return Promise.resolve(0);
      },
    });
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    term.type(':');
    term.type('status\r');
    await waitFor(() => term.output().includes('title: fix it'), 'the command output');
    assert.doesNotMatch(term.output(), /owned|\x9b/);
    term.type('q');
    await exited;
  });
});

// `contract amend` asks `apply contract v2? [y/N]`. Run from the shell it asks through the shell's own prompt, not through raw standard input,
// and the output the command printed before the question stays on screen above it (plan 03-15, D-18).
describe('a command that asks a question uses the shell prompt', () => {
  const QUESTION = 'apply contract v2? [y/N] ';
  // The text of the last full redraw: the shell repaints from the home position each time.
  const lastFrame = (term: FakeTerminal): string => withoutEscapes(term.output().split('\x1b[H').at(-1) ?? '');

  function asking(): { dispatch: NonNullable<Parameters<typeof runShell>[0]['dispatch']>; answers: Array<string | undefined>; asked: string[] } {
    const answers: Array<string | undefined> = [];
    const asked: string[] = [];
    return {
      answers,
      asked,
      dispatch: async (_argv, overrides) => {
        overrides.io?.out('budgets.costUsd.perRun: 10 -> 12\n');
        asked.push(QUESTION);
        const answer = await overrides.ask?.(QUESTION);
        answers.push(answer);
        overrides.io?.out(`answered ${String(answer)}\n`);
        return 0;
      },
    };
  }

  it('shows the output so far above the question; the line typed there is the answer', async () => {
    const roots = newRoots();
    const s = asking();
    const { term, exited } = await openShell(terminalEnv(roots), { dispatch: s.dispatch });
    term.type(':');
    await waitFor(() => screen(term).includes('avarice> '), 'the command-line prompt');
    term.type('contract amend run_1 --budget costUsdPerRun=12 --reason r\r');
    await waitFor(() => lastFrame(term).includes(QUESTION), 'the question');
    assert.match(lastFrame(term), /budgets\.costUsd\.perRun: 10 -> 12/, 'the diff is on screen with the question');
    term.type('y\r');
    await waitFor(() => screen(term).includes('answered y'), 'the answer reaching the command');
    assert.deepEqual(s.answers, ['y']);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Escape at the question answers nothing: the command sees undefined', async () => {
    const roots = newRoots();
    const s = asking();
    const { term, exited } = await openShell(terminalEnv(roots), { dispatch: s.dispatch });
    term.type(':');
    await waitFor(() => screen(term).includes('avarice> '), 'the command-line prompt');
    term.type('contract amend run_1\r');
    await waitFor(() => lastFrame(term).includes(QUESTION), 'the question');
    term.type('\x1b');
    await waitFor(() => screen(term).includes('answered undefined'), 'the cancelled answer');
    assert.deepEqual(s.answers, [undefined]);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('in line mode the output so far is printed once, before the question, and the next line is the answer', async () => {
    const roots = newRoots();
    const s = asking();
    const term = fakeTerminal();
    const exited = runShell({ stdin: term.stdin, stdout: term.stdout, env: terminalEnv(roots, { TERM: 'dumb' }), dispatch: s.dispatch });
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    term.type('contract amend run_1\n');
    await waitFor(() => term.output().includes(QUESTION), 'the question');
    assert.ok(term.output().indexOf('budgets.costUsd.perRun: 10 -> 12') < term.output().indexOf(QUESTION), 'the output comes before the question');
    term.type('y\n');
    await waitFor(() => term.output().includes('answered y'), 'the answer reaching the command');
    assert.equal((term.output().match(/budgets\.costUsd\.perRun: 10 -> 12/g) ?? []).length, 1, 'the diff is printed once');
    assert.deepEqual(s.answers, ['y']);
    term.type('q\n');
    assert.equal(await exited, 0);
  });
});

describe('TERM=dumb: line mode, no escape characters (ADR-013 decision 6)', () => {
  it('prints no ESC at all, never enters raw mode, and reads whole lines', async () => {
    const roots = profileWithProject();
    const term = fakeTerminal();
    const exited = startShell(term, terminalEnv(roots, { TERM: 'dumb' }));
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    term.type('status\n');
    await waitFor(() => term.output().includes('status: 1 project(s)'), 'the status output');
    term.type('q\n');
    assert.equal(await exited, 0);
    assert.doesNotMatch(term.output(), HAS_ESC);
    assert.deepEqual(term.rawModes, []);
  });

  it('an empty line redraws and runs nothing; end of input leaves the shell', async () => {
    const roots = newRoots();
    const term = fakeTerminal();
    const calls: string[][] = [];
    const exited = runShell({
      stdin: term.stdin,
      stdout: term.stdout,
      env: terminalEnv(roots, { TERM: 'dumb' }),
      dispatch: (argv) => {
        calls.push([...argv]);
        return Promise.resolve(0);
      },
    });
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    term.type('\n');
    term.stdin.end();
    assert.equal(await exited, 0);
    assert.deepEqual(calls, []);
  });
});

describe('NO_COLOR and resize', () => {
  it('prints no SGR colour sequence under NO_COLOR, and does print one without it', async () => {
    const roots = newRoots();
    const plain = fakeTerminal();
    const plainExit = startShell(plain, terminalEnv(roots, { NO_COLOR: '1' }));
    await waitFor(() => plain.output().includes('open decisions: 0'), 'the home view');
    plain.type('q');
    await plainExit;
    assert.doesNotMatch(plain.output(), HAS_SGR);

    const coloured = fakeTerminal();
    const colouredExit = startShell(coloured, terminalEnv(roots));
    await waitFor(() => coloured.output().includes('open decisions: 0'), 'the home view');
    coloured.type('q');
    await colouredExit;
    assert.match(coloured.output(), HAS_SGR);
  });

  it('redraws the view when the terminal is resized', async () => {
    const roots = newRoots();
    const term = fakeTerminal({ columns: 100 });
    const exited = startShell(term, terminalEnv(roots));
    await waitFor(() => term.output().includes('open decisions: 0'), 'the home view');
    const drawn = (term.output().match(/shell: personal-local/g) ?? []).length;
    term.resize(40);
    await waitFor(() => (term.output().match(/shell: personal-local/g) ?? []).length > drawn, 'the redraw after the resize');
    term.type('q');
    assert.equal(await exited, 0);
    assert.equal(term.stdout.listenerCount('resize'), 0, 'the resize listener is removed on exit');
  });
});

describe('a ledger that cannot be opened (ADR-013 decision 3)', () => {
  it('shows `store: unavailable (...)` and stays open until q', async () => {
    const roots = newRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true, mode: 0o700 });
    writeFileSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), 'this is not a database\n'.repeat(200));
    const term = fakeTerminal();
    const exited = startShell(term, terminalEnv(roots));
    await waitFor(() => term.output().includes('store: unavailable ('), 'the unavailable store line');
    const stripped = term.output().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    assert.match(stripped, /^shell: personal-local\nstore: unavailable \(.+\)/m);
    // Still open: a key that is not a menu item changes nothing, and `q` then leaves with 0.
    term.type('x');
    let settled = false;
    void exited.then(() => (settled = true));
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.equal(settled, false, 'the shell stays open');
    term.type('q');
    assert.equal(await exited, 0);
  });
});

function project(runs: Partial<RunStatus>[], extra: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    projectId: 'prj_1',
    repoPath: '/repo',
    onboardingId: null,
    state: 'unregistered',
    reason: null,
    recordVersion: null,
    onboardedRevision: null,
    mapping: null,
    indexes: {},
    ...(runs.length > 0
      ? {
          runs: runs.map(
            (r, i): RunStatus => ({
              runId: `run_${i}`,
              title: 'a title',
              state: 'running',
              reason: null,
              lastCheckpoint: null,
              branch: null,
              commit: null,
              clean: null,
              evidence: [],
              gates: [],
              openDecisions: 0,
              budgets: [],
              references: [],
              ...r,
            }),
          ),
        }
      : {}),
    ...extra,
  };
}

describe('renderHome (OPS-7 through the shared functions)', () => {
  const view = (projects: ProjectStatus[]): HomeView => ({ profile: 'personal-local', store: { ok: true }, projects, nowMs: Date.parse('2026-11-05T12:00:00Z') });

  it('leads with the result line, then store health, the runs and onboardings table, and the open decision count', () => {
    const text = renderHome(
      view([
        project(
          [
            { state: 'running', lastCheckpoint: { seq: 3, nextAction: 'launch:run', revision: null, at: '2026-11-05T11:59:00Z' }, budgets: [{ name: 'costUsd', used: 1.25, limit: 5 }], openDecisions: 1 },
            { state: 'ready_for_review', openDecisions: 2 },
          ],
          { onboardingId: 'onb_1', state: 'active' },
        ),
      ]),
      { width: 120, colour: false },
    );
    const lines = text.split('\n');
    assert.equal(lines[0], 'shell: personal-local');
    assert.equal(lines[1], 'store: ok');
    assert.match(text, /run_0\s+running\s+launch:run\s+1\.25 USD of 5\.00 USD/);
    assert.match(text, /run_1\s+ready_for_review\s+-\s+-/);
    assert.match(text, /onboarding\s+onb_1\s+active/);
    assert.match(text, /^open decisions: 3$/m);
    assert.doesNotMatch(text, HAS_ESC);
  });

  it('says so when there is nothing to list', () => {
    const text = renderHome(view([]), { width: 80, colour: false });
    assert.match(text, /no runs or onboardings/);
    assert.match(text, /^open decisions: 0$/m);
  });

  it('shows an interrupted run as paused, as status does', () => {
    const text = renderHome(
      view([project([{ state: 'running', interrupted: { state: 'running', presentedAs: 'paused', reason: 'supervisor interrupted', attemptId: null, step: 'launch:run', nextAction: 'launch:run', resumeCommand: 'avarice resume run_0' } }])]),
      { width: 120, colour: false },
    );
    assert.match(text, /paused \(supervisor interrupted\)/);
  });

  it('strips control characters from recorded strings and cuts rows to the width', () => {
    const text = renderHome(
      view([project([{ state: 'running', lastCheckpoint: { seq: 1, nextAction: '\x1b[31mred\x1b[0m-next-action-that-is-quite-long-indeed', revision: null, at: '2026-11-05T11:59:00Z' } }])]),
      { width: 50, colour: true },
    );
    assert.doesNotMatch(text, /\x1b\[31m/);
    for (const line of text.split('\n')) assert.ok(Array.from(line.replace(/\x1b\[[0-9;]*m/g, '')).length <= 50 || /run_0/.test(line), `line fits: ${line}`);
  });

  it('shows the unavailable store and nothing else under it', () => {
    const text = renderHome({ profile: 'personal-local', store: { ok: false, detail: 'unavailable: no such table: runs\nSELECT *' }, projects: [], nowMs: 0 }, { width: 80, colour: false });
    assert.equal(text, 'shell: personal-local\nstore: unavailable (unavailable: no such table: runs SELECT *)\n');
  });
});

// ---- the line editor, completion and history (Task 3) ---------------------------------------------------------------------------------------

function key(name: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { name, sequence: extra.sequence ?? '', ctrl: false, meta: false, ...extra };
}
function chars(editor: LineEditor, text: string): void {
  for (const ch of text) editor.handle({ name: ch, sequence: ch, ctrl: false, meta: false });
}
const enter = key('return', { sequence: '\r' });

describe('the line editor', () => {
  it('edits with the cursor keys, backspace and delete, and submits the line on Enter', () => {
    const editor = new LineEditor({ prompt: '> ' });
    chars(editor, 'staus');
    editor.handle(key('left'));
    editor.handle(key('left'));
    chars(editor, 't');
    assert.equal(editor.text, 'status');
    editor.handle(key('end'));
    editor.handle(key('backspace'));
    editor.handle(key('home'));
    editor.handle(key('delete'));
    assert.equal(editor.text, 'tatu');
    const result: EditorResult = editor.handle(enter);
    assert.deepEqual(result, { kind: 'submit', line: 'tatu' });
  });

  it('cancels on Escape, Ctrl-C and Ctrl-D at an empty line, and drops control characters from typed text', () => {
    for (const k of [key('escape', { sequence: '\x1b' }), key('c', { ctrl: true, sequence: '\x03' }), key('d', { ctrl: true, sequence: '\x04' })]) {
      const editor = new LineEditor({ prompt: '> ' });
      assert.deepEqual(editor.handle(k), { kind: 'cancel' });
    }
    const editor = new LineEditor({ prompt: '> ' });
    editor.handle({ name: undefined, sequence: 'a\x07b', ctrl: false, meta: false });
    assert.equal(editor.text, 'ab');
  });

  it('Ctrl-U clears the line and Ctrl-W removes a word', () => {
    const editor = new LineEditor({ prompt: '> ' });
    chars(editor, 'repo add /tmp/x');
    editor.handle(key('w', { ctrl: true, sequence: '\x17' }));
    assert.equal(editor.text, 'repo add ');
    editor.handle(key('u', { ctrl: true, sequence: '\x15' }));
    assert.equal(editor.text, '');
  });
});

// ---- the action menu (Task 2) ---------------------------------------------------------------------------------------------------------------

interface Spy {
  calls: string[][];
  dispatch: (argv: readonly string[], overrides: MainOverrides) => Promise<number>;
}

// A dispatcher that records what the shell ran and prints a line for it, instead of loading the command modules.
function spy(code = 0): Spy {
  const calls: string[][] = [];
  return {
    calls,
    dispatch: (argv, overrides) => {
      calls.push([...argv]);
      overrides.io?.out(`ran ${argv.join(' ')}\n`);
      return Promise.resolve(code);
    },
  };
}

const screen = (term: FakeTerminal): string => withoutEscapes(term.output());

async function openShell(env: NodeJS.ProcessEnv, extra: Partial<Parameters<typeof runShell>[0]> = {}): Promise<{ term: FakeTerminal; exited: Promise<number> }> {
  const term = fakeTerminal();
  const exited = runShell({ stdin: term.stdin, stdout: term.stdout, env, ...extra });
  await waitFor(() => term.output().includes('open decisions:'), 'the home view');
  return { term, exited };
}

describe('the action menu (ADR-013 decision 2)', () => {
  it('lists start, watch, resume, status, inbox, command line, decide and quit, numbered', async () => {
    const roots = newRoots();
    const { term, exited } = await openShell(terminalEnv(roots), spy());
    const text = screen(term);
    for (const line of ['1  Start a run', '2  Watch a run', '3  Resume a run', '4  Status', '5  Inbox', '6  Command line', '7  Decide', 'q  Quit']) assert.ok(text.includes(line), `the menu has "${line}"`);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('arrow keys move the selection and Enter activates it', async () => {
    const roots = newRoots();
    const { term, exited } = await openShell(terminalEnv(roots, { NO_COLOR: '1' }), spy());
    assert.match(screen(term), /> 1 {2}Start a run/);
    term.mark();
    term.type('\x1b[B');
    await waitFor(() => /> 2 {2}Watch a run/.test(withoutEscapes(term.sinceMark())), 'the selection to move down');
    term.mark();
    term.type('\x1b[A\x1b[A');
    await waitFor(() => /> q {2}Quit/.test(withoutEscapes(term.sinceMark())), 'the selection to wrap from the first item to Quit');
    term.type('\r');
    assert.equal(await exited, 0, 'Enter on Quit leaves the shell');
  });

  it('a number activates an item: 4 runs status and 5 runs inbox, through the same dispatcher as the command line', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('4');
    await waitFor(() => screen(term).includes('ran status'), 'status');
    term.type('5');
    await waitFor(() => screen(term).includes('ran inbox'), 'inbox');
    assert.deepEqual(s.calls, [['status'], ['inbox']]);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('6 opens the command line; Ctrl-C cancels it and runs nothing', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('6');
    await waitFor(() => screen(term).includes('avarice> '), 'the command-line prompt');
    term.mark();
    term.type('\x03');
    await waitFor(() => withoutEscapes(term.sinceMark()).includes('open decisions:'), 'the menu to return');
    assert.deepEqual(s.calls, []);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Start asks for a brief path, shows the policy routine and runs the start command module with it', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('1');
    await waitFor(() => screen(term).includes('brief path: '), 'the brief prompt');
    assert.match(screen(term), /policy: routine/);
    term.type('briefs/fix.md\r');
    await waitFor(() => screen(term).includes('ran start --brief briefs/fix.md --policy routine'), 'the start result');
    assert.deepEqual(s.calls, [['start', '--brief', 'briefs/fix.md', '--policy', 'routine']]);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Start with a cancelled or empty path runs nothing', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('1');
    await waitFor(() => screen(term).includes('brief path: '), 'the brief prompt');
    term.type('\x03');
    await waitFor(() => (screen(term).match(/Start a run/g) ?? []).length > 1, 'the menu to return');
    term.type('1');
    await waitFor(() => (screen(term).match(/brief path: /g) ?? []).length > 1, 'the brief prompt again');
    term.type('   \r');
    await waitFor(() => (screen(term).match(/Start a run/g) ?? []).length > 2, 'the menu to return again');
    assert.deepEqual(s.calls, []);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Watch and Resume with nothing to list say so and stay in the shell', async () => {
    const roots = newRoots();
    const { term, exited } = await openShell(terminalEnv(roots), spy());
    term.type('2');
    await waitFor(() => screen(term).includes('no runs to watch'), 'the empty watch list');
    term.type('3');
    await waitFor(() => screen(term).includes('nothing to resume'), 'the empty resume list');
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('in line mode a number picks an item and any other text is a command-line entry', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots, { TERM: 'dumb' }), s);
    term.type('4\ninbox --json\nq\n');
    assert.equal(await exited, 0);
    assert.deepEqual(s.calls, [['status'], ['inbox', '--json']]);
    assert.doesNotMatch(term.output(), HAS_ESC);
  });

  it('a failing action is shown and the shell stays open', async () => {
    const roots = newRoots();
    const { term, exited } = await openShell(terminalEnv(roots), {
      dispatch: () => Promise.reject(new Error('the dispatcher fell over')),
    });
    term.type('4');
    await waitFor(() => screen(term).includes('the dispatcher fell over'), 'the failure');
    term.type('q');
    assert.equal(await exited, 0);
  });
});

// A profile with one onboarded repository and one run stored in `contract_ready` with no supervisor: the shell lists it, offers it to resume,
// and watches it. The run is started through the application layer, as `start` does before it spawns a supervisor.
function profileWithRun(): { roots: CliRoots; runId: string } {
  const roots = newRoots();
  const repo = makeRunRepo();
  cleanup.push(repo.base);
  onboardRunRepo(roots, repo);
  commitConventions(repo);
  const brief = writeBrief(join(roots.base, 'briefs'));
  const composed = createDeps(profileEnv(roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    const started = startRun(composed.value.deps, { cwd: repo.path, briefPath: brief, policy: 'routine', budgetOverrides: {} });
    assert.ok(started.ok, JSON.stringify(started));
    return { roots, runId: started.value.runId };
  } finally {
    composed.value.close();
  }
}

describe('watch and resume read the ledger (ADR-013 decisions 3 and 4)', () => {
  // Not removed by the per-test cleanup: the fixture is shared by the cases below and removed in `after`.
  const fixture = profileWithRun();
  const shared = cleanup.splice(0);
  after(() => {
    for (const dir of shared) rmSync(dir, { recursive: true, force: true });
  });

  it('Watch lists the runs, then redraws about once a second with state, checkpoints and events, and `q` stops it with no timer left', async () => {
    let reads = 0;
    const clock = {
      nowMs: (): number => {
        reads += 1;
        return Date.now();
      },
    };
    const { term, exited } = await openShell(terminalEnv(fixture.roots), { overrides: { clock }, pollMs: 40 });
    term.type('2');
    await waitFor(() => screen(term).includes('run to watch (number or ID): '), 'the watch prompt');
    assert.ok(screen(term).includes(fixture.runId), 'the list names the run');
    term.type('1\r');
    await waitFor(() => screen(term).includes(`run ${fixture.runId}: `) && screen(term).includes('checkpoints:'), 'the live view');
    await waitFor(() => screen(term).includes('events:'), 'events in the view');
    assert.match(screen(term), /run\.created|contract\.stored/, 'the latest events are listed by type');
    const before = reads;
    await waitFor(() => reads >= before + 3, 'at least three polls while watching');
    term.mark();
    term.type('q');
    await waitFor(() => withoutEscapes(term.sinceMark()).includes('1  Start a run'), 'the menu after q');
    const after = reads;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    assert.equal(reads, after, 'no poll after the watch ended');
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Watch takes a run ID as well as a number, and refuses an unknown one without watching', async () => {
    const { term, exited } = await openShell(terminalEnv(fixture.roots), { pollMs: 40 });
    term.type('2');
    await waitFor(() => screen(term).includes('run to watch (number or ID): '), 'the watch prompt');
    term.type('run_nope\r');
    await waitFor(() => screen(term).includes('no run matches'), 'the refusal');
    term.type('2');
    await waitFor(() => (screen(term).match(/run to watch \(number or ID\): /g) ?? []).length > 1, 'the watch prompt again');
    term.type(`${fixture.runId}\r`);
    await waitFor(() => screen(term).includes('checkpoints:'), 'the live view by ID');
    term.type('q');
    await waitFor(() => (screen(term).match(/1 {2}Start a run/g) ?? []).length > 2, 'the menu after q');
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('Resume lists what can be resumed and runs the resume command module with the chosen ID', async () => {
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(fixture.roots), s);
    term.type('3');
    await waitFor(() => screen(term).includes('run or onboarding to resume (number or ID): '), 'the resume prompt');
    assert.ok(screen(term).includes(fixture.runId), 'the list names the run');
    term.type('1\r');
    await waitFor(() => screen(term).includes(`ran resume ${fixture.runId}`), 'the resume result');
    assert.deepEqual(s.calls, [['resume', fixture.runId]]);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('the ledger lists the latest events of a run, oldest first, at most `limit`, and none for an unknown run', () => {
    const composed = createDeps(profileEnv(fixture.roots), {}, { readOnly: true });
    assert.ok(composed.ok, 'composition');
    try {
      const { ledger } = composed.value.deps;
      const all = ledger.listRunEvents(fixture.runId, 100);
      assert.ok(all.ok && all.value.length >= 2, 'the run has events');
      const seqs = all.value.map((e) => e.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'oldest first');
      assert.ok(all.value.every((e) => typeof e.type === 'string' && typeof e.at === 'string' && typeof e.data === 'object'));
      const latest = ledger.listRunEvents(fixture.runId, 2);
      assert.ok(latest.ok);
      assert.deepEqual(latest.value.map((e) => e.seq), seqs.slice(-2), 'the latest two');
      const none = ledger.listRunEvents('run_unknown', 5);
      assert.ok(none.ok);
      assert.deepEqual(none.value, []);
    } finally {
      composed.value.close();
    }
  });

  it('the home view lists the run with its state', async () => {
    const { term, exited } = await openShell(terminalEnv(fixture.roots), spy());
    assert.match(screen(term), new RegExp(`run\\s+${fixture.runId}\\s+paused \\(supervisor interrupted\\)`));
    term.type('q');
    assert.equal(await exited, 0);
  });
});

// ---- the Decide action (plan 03-25; D-13, ADR-013) ---------------------------------------------------------------------------------------------

// Opens one blocking decision on the run, as a unit that asked would have; returns its ID. The rows are written through the ledger, as the
// supervisor does.
function openDecisionOn(roots: CliRoots, runId: string, issue: string, options: unknown = [{ key: '1', label: 'one', kind: 'choice' }, { key: '2', label: 'two', kind: 'choice' }]): string {
  const composed = createDeps(profileEnv(roots), {});
  assert.ok(composed.ok, 'composition');
  try {
    const { ledger } = composed.value.deps;
    const contract = ledger.getRunContract(runId);
    assert.ok(contract.ok && contract.value !== null, 'the run has a contract');
    const opened = ledger.openDecision({
      runId,
      contractVersion: contract.value.version,
      class: 'acceptance',
      issue,
      options,
      consequences: {},
      evidenceRefs: [],
      affectedItems: [],
      stateDigest: 'sha256:test',
      urgency: 'blocking',
      nowMs: Date.now(),
    });
    assert.ok(opened.ok, JSON.stringify(opened));
    return opened.value.decisionId;
  } finally {
    composed.value.close();
  }
}

describe('the Decide action (key 7 or d)', () => {
  it('with no open decision it says so and stays in the shell', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('7');
    await waitFor(() => screen(term).includes('no open decisions'), 'the empty decision list');
    assert.deepEqual(s.calls, []);
    term.type('q');
    assert.equal(await exited, 0);
  });

  const fixture = profileWithRun();
  const shared = cleanup.splice(0);
  after(() => {
    for (const dir of shared) rmSync(dir, { recursive: true, force: true });
  });
  const first = openDecisionOn(fixture.roots, fixture.runId, 'Which status code?\nthe second line is not shown in the list');
  const second = openDecisionOn(fixture.roots, fixture.runId, 'Which wording?');

  it('lists the open decisions with their ID, run, class and the first line of the issue, and picking 1 runs `decide <id>` through the shell', async () => {
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(fixture.roots), s);
    term.type('7');
    await waitFor(() => screen(term).includes('decision to answer (number or ID): '), 'the decision prompt');
    const text = screen(term);
    for (const wanted of [first, second, fixture.runId, 'acceptance', 'Which status code?', 'Which wording?']) assert.ok(text.includes(wanted), `the list shows ${wanted}`);
    assert.equal(text.includes('the second line is not shown'), false, 'only the first line of the issue is listed');
    term.type('1\r');
    await waitFor(() => screen(term).includes(`ran decide ${first}`), 'the decide command');
    assert.deepEqual(s.calls, [['decide', first]]);
    term.type('q');
    assert.equal(await exited, 0);
  });

  it('takes a decision ID as well as a number through the d key, refuses an unknown one and runs nothing for an empty entry', async () => {
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(fixture.roots), s);
    term.type('d');
    await waitFor(() => screen(term).includes('decision to answer (number or ID): '), 'the decision prompt');
    term.type('dec_nope\r');
    await waitFor(() => screen(term).includes('no decision matches'), 'the refusal');
    term.type('7');
    await waitFor(() => (screen(term).match(/decision to answer \(number or ID\): /g) ?? []).length > 1, 'the prompt again');
    term.type('\r');
    await waitFor(() => (screen(term).match(/1 {2}Start a run/g) ?? []).length > 2, 'the menu to return');
    assert.deepEqual(s.calls, []);
    term.type('7');
    await waitFor(() => (screen(term).match(/decision to answer \(number or ID\): /g) ?? []).length > 2, 'the prompt a third time');
    term.type(`${second}\r`);
    await waitFor(() => screen(term).includes(`ran decide ${second}`), 'the decide command by ID');
    assert.deepEqual(s.calls, [['decide', second]]);
    term.type('q');
    assert.equal(await exited, 0);
  });
});

// ---- completion and history (Task 3) --------------------------------------------------------------------------------------------------------

describe('completion (ADR-013 decision 2)', () => {
  it('completes the one candidate with a trailing space', () => {
    assert.deepEqual(completeCommand('stat', COMMANDS), { buffer: 'status ', candidates: ['status'] });
    assert.deepEqual(completeCommand('ins', COMMANDS), { buffer: 'install-host ', candidates: ['install-host'] });
    assert.deepEqual(completeCommand('status', COMMANDS), { buffer: 'status ', candidates: ['status'] });
  });

  it('lists the sorted candidates when ambiguous and extends the common prefix', () => {
    assert.deepEqual(completeCommand('st', COMMANDS), { buffer: 'sta', candidates: ['start', 'status'] });
    assert.deepEqual(completeCommand('sta', COMMANDS), { buffer: 'sta', candidates: ['start', 'status'] });
    assert.deepEqual(completeCommand('', COMMANDS)?.candidates, [...COMMANDS].sort());
    assert.deepEqual(completeCommand('s', COMMANDS)?.candidates, ['schedule', 'start', 'status', 'supervise']);
  });

  it('offers nothing for an unknown prefix or once a second word is being typed', () => {
    assert.equal(completeCommand('zzz', COMMANDS), undefined);
    assert.equal(completeCommand('status --j', COMMANDS), undefined);
    assert.equal(completeCommand('status ', COMMANDS), undefined);
  });

  it('Tab in the editor completes, shows the ambiguous candidates, and clears them on the next key', () => {
    const editor = new LineEditor({ prompt: '> ', commands: COMMANDS });
    chars(editor, 'st');
    editor.handle(key('tab', { sequence: '\t' }));
    assert.equal(editor.text, 'sta');
    assert.deepEqual(editor.candidates, ['start', 'status']);
    chars(editor, 't');
    assert.deepEqual(editor.candidates, []);
    editor.handle(key('tab', { sequence: '\t' }));
    assert.equal(editor.text, 'status ');
    assert.equal(editor.position, 7);
  });

  it('Tab does nothing in an editor without commands', () => {
    const editor = new LineEditor({ prompt: '> ' });
    chars(editor, 'st');
    editor.handle(key('tab', { sequence: '\t' }));
    assert.equal(editor.text, 'st');
    assert.deepEqual(editor.candidates, []);
  });

  it('in the shell, Tab on the command line completes `stat` to `status ` and Enter runs it; an ambiguous prefix shows the candidates', async () => {
    const roots = newRoots();
    const s = spy();
    const { term, exited } = await openShell(terminalEnv(roots), s);
    term.type('6');
    await waitFor(() => screen(term).includes('avarice> '), 'the command-line prompt');
    term.type('st\t');
    await waitFor(() => screen(term).includes('start  status'), 'the candidates of an ambiguous prefix');
    term.type('t\t\r');
    await waitFor(() => screen(term).includes('ran status'), 'the completed command');
    assert.deepEqual(s.calls, [['status']]);
    term.type('q');
    assert.equal(await exited, 0);
  });
});

describe('history (ADR-013 decision 2; ordering edge)', () => {
  it('recalls newest first with the up arrow, goes back down to the typed draft', () => {
    const editor = new LineEditor({ prompt: '> ', history: ['oldest', 'middle', 'newest'] });
    chars(editor, 'dr');
    editor.handle(key('up'));
    assert.equal(editor.text, 'newest');
    editor.handle(key('up'));
    assert.equal(editor.text, 'middle');
    editor.handle(key('up'));
    editor.handle(key('up'));
    assert.equal(editor.text, 'oldest', 'stops at the oldest entry');
    editor.handle(key('down'));
    editor.handle(key('down'));
    editor.handle(key('down'));
    assert.equal(editor.text, 'dr', 'the draft comes back');
  });

  it('up with no history leaves the text alone', () => {
    const editor = new LineEditor({ prompt: '> ' });
    chars(editor, 'abc');
    editor.handle(key('up'));
    editor.handle(key('down'));
    assert.equal(editor.text, 'abc');
  });

  it('keeps the file oldest first, creates it 0600 in the data root, one line per entry', () => {
    const roots = newRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    assert.deepEqual(loadHistory(roots.AVARICE_DATA_ROOT), []);
    assert.equal(appendHistory(roots.AVARICE_DATA_ROOT, 'status'), true);
    appendHistory(roots.AVARICE_DATA_ROOT, 'inbox --json');
    const path = join(roots.AVARICE_DATA_ROOT, 'shell-history');
    assert.equal(readFileSync(path, 'utf8'), 'status\ninbox --json\n');
    assert.deepEqual(loadHistory(roots.AVARICE_DATA_ROOT), ['status', 'inbox --json']);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it('tightens a history file that exists with a wider mode', () => {
    const roots = newRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    const path = join(roots.AVARICE_DATA_ROOT, 'shell-history');
    writeFileSync(path, 'old\n', { mode: 0o644 });
    chmodSync(path, 0o644);
    appendHistory(roots.AVARICE_DATA_ROOT, 'new');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(loadHistory(roots.AVARICE_DATA_ROOT), ['old', 'new']);
  });

  it('stores an entry without its control characters and skips one that is empty afterwards', () => {
    const roots = newRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    appendHistory(roots.AVARICE_DATA_ROOT, 'sta\x1b[31mtus\x07\nwith\x00more\x7f');
    assert.equal(appendHistory(roots.AVARICE_DATA_ROOT, '\x07\x1b'), true, 'an entry with nothing left is skipped, which is not a failure');
    appendHistory(roots.AVARICE_DATA_ROOT, '   ');
    assert.deepEqual(loadHistory(roots.AVARICE_DATA_ROOT), ['statuswithmore']);
    assert.equal(readFileSync(join(roots.AVARICE_DATA_ROOT, 'shell-history'), 'utf8'), 'statuswithmore\n');
  });

  it(`is capped at ${HISTORY_CAP} lines, dropping the oldest, and keeps its mode when it is rewritten`, () => {
    const roots = newRoots();
    mkdirSync(roots.AVARICE_DATA_ROOT, { recursive: true });
    for (let i = 1; i <= HISTORY_CAP + 5; i += 1) appendHistory(roots.AVARICE_DATA_ROOT, `entry ${i}`);
    const entries = loadHistory(roots.AVARICE_DATA_ROOT);
    assert.equal(entries.length, HISTORY_CAP);
    assert.equal(entries[0], 'entry 6');
    assert.equal(entries.at(-1), `entry ${HISTORY_CAP + 5}`);
    assert.equal(statSync(join(roots.AVARICE_DATA_ROOT, 'shell-history')).mode & 0o777, 0o600);
  });

  it('a missing or unreadable location is an empty history, and a failed append does not throw', () => {
    assert.deepEqual(loadHistory('/nonexistent/avarice-test-root'), []);
    assert.equal(appendHistory('/nonexistent/avarice-test-root', 'status'), false);
  });

  it('the shell appends one entry per command-line run and the next shell recalls it with the up arrow', async () => {
    const roots = newRoots();
    const env = terminalEnv(roots);
    const first = spy();
    const one = await openShell(env, first);
    one.term.type('6');
    await waitFor(() => screen(one.term).includes('avarice> '), 'the command-line prompt');
    one.term.type('status --json\r');
    await waitFor(() => screen(one.term).includes('ran status --json'), 'the first command');
    one.term.type('6');
    await waitFor(() => (screen(one.term).match(/avarice> /g) ?? []).length > 1, 'the command-line prompt again');
    one.term.type('\r');
    one.term.type('6');
    await waitFor(() => (screen(one.term).match(/avarice> /g) ?? []).length > 2, 'the command-line prompt a third time');
    one.term.type('inbox\r');
    await waitFor(() => screen(one.term).includes('ran inbox'), 'the second command');
    one.term.type('q');
    assert.equal(await one.exited, 0);
    const file = join(roots.AVARICE_DATA_ROOT, 'shell-history');
    assert.equal(readFileSync(file, 'utf8'), 'status --json\ninbox\n', 'one entry per run; the empty entry is not recorded');
    assert.equal(statSync(file).mode & 0o777, 0o600);

    const second = spy();
    const two = await openShell(env, second);
    two.term.type('6');
    await waitFor(() => screen(two.term).includes('avarice> '), 'the command-line prompt');
    two.term.type('\x1b[A');
    await waitFor(() => screen(two.term).includes('avarice> inbox'), 'the newest entry on the first up arrow');
    two.term.type('\x1b[A');
    await waitFor(() => screen(two.term).includes('avarice> status --json'), 'the older entry on the second up arrow');
    two.term.type('\r');
    await waitFor(() => screen(two.term).includes('ran status --json'), 'the recalled command');
    two.term.type('q');
    assert.equal(await two.exited, 0);
    assert.deepEqual(second.calls, [['status', '--json']]);
  });
});
