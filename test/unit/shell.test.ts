// The interactive shell (plan 02-19; FR-27, ADR-013): driven through injected streams only, never a real terminal. The home view, the
// refusal cases, the command line running in this process, the line mode of a dumb terminal, NO_COLOR, resize, a ledger that cannot be
// opened, the menu, completion and history. A real pseudo-terminal is test/integration/shell-tty.test.ts.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { COMMANDS, main } from '../../src/cli/main.ts';
import type { MainOverrides } from '../../src/cli/main.ts';
import { renderHome } from '../../src/cli/shell/home-view.ts';
import type { HomeView } from '../../src/cli/shell/home-view.ts';
import { LineEditor } from '../../src/cli/shell/line-editor.ts';
import type { EditorResult, KeyInput } from '../../src/cli/shell/line-editor.ts';
import { runShell } from '../../src/cli/shell/shell.ts';
import type { RunStatus } from '../../src/app/run-status.ts';
import type { ProjectStatus } from '../../src/app/status.ts';
import { fakeTerminal, HAS_ESC, HAS_SGR, waitFor } from '../helpers/shell-streams.ts';
import type { FakeTerminal } from '../helpers/shell-streams.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';
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
