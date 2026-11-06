// The interactive shell (FR-27, ADR-013): `avarice` with no arguments, in a terminal, outside a run. A presentation layer over the command modules:
// every action calls the same command module the one-shot CLI calls, in this process, through main(), and the shell re-reads the ledger for each
// view. It keeps no state beyond the current view and the history file. Node built-ins only (`node:readline`, raw-mode key input, ANSI escapes):
// no socket, no listening port, no daemon and no signal sent to any process (NFR-1, T-02-64).
//
// Two input modes. On a terminal with a usable TERM the shell takes raw key presses, draws a full screen over the alternate screen buffer and
// redraws on resize. When TERM is `dumb` it reads whole lines and prints plain text with no escape characters. Both feed the same `Consumer`
// interface, so the menu, the prompts and the live views are written once. Input that arrives while an action is working (a command that takes
// a while, the gap between two prompts) is queued and replayed, as a terminal does with type-ahead.
//
// Everything printed from a command, a ledger row or the model passes through stripControl (T-02-62).
import { createInterface, emitKeypressEvents } from 'node:readline';
import type { Interface } from 'node:readline';
import { describeError } from '../../adapters/sqlite/db.ts';
import { DEFAULT_PROFILE, resolveProfile } from '../../adapters/fs/profile-paths.ts';
import { getStatus } from '../../app/status.ts';
import type { Io } from '../args.ts';
import { createDeps } from '../composition.ts';
import { EXIT_USAGE, main } from '../main.ts';
import type { MainOverrides, ShellInput, ShellOutput } from '../main.ts';
import { colourEnabled, errorLine, stripControl } from '../render/style.ts';
import { terminalWidth } from '../render/table.ts';
import { runCommandLine, SHELL_ACTIONS } from './actions.ts';
import type { ShellAction } from './actions.ts';
import { renderHome } from './home-view.ts';
import type { HomeView } from './home-view.ts';
import { LineEditor, printable } from './line-editor.ts';
import type { KeyInput } from './line-editor.ts';

export type Dispatch = (argv: readonly string[], overrides: MainOverrides) => Promise<number>;

export interface ShellOptions {
  stdin: ShellInput;
  stdout: ShellOutput;
  env: NodeJS.ProcessEnv;
  // What main() was given; the shell passes it on to every command it runs (the host and the executor of a test entry, the clock).
  overrides?: MainOverrides;
  // Where a refusal is written (the shell has no other error stream).
  io?: Io;
  // Runs one command. The default is main(), the one-shot dispatcher; tests pass a spy.
  dispatch?: Dispatch;
  // The actions of the menu. The default is SHELL_ACTIONS.
  actions?: readonly ShellAction[];
}

export interface PromptOptions {
  // Up and down recall earlier command lines.
  history?: boolean;
  // Tab completes command names.
  complete?: boolean;
}

// What an action sees of the shell: the prompts and views it may open, and the commands it may run.
export interface ActionContext {
  readonly env: NodeJS.ProcessEnv;
  // Asks for one line. Resolves undefined when the user cancels (Escape, Ctrl-C).
  prompt(label: string, options?: PromptOptions): Promise<string | undefined>;
  // Replaces the output pane under the menu with `text` (control characters removed).
  show(text: string): void;
  // Runs `main(argv)` in this process with its output captured, shows the output and returns the exit code. A non-zero code is shown as `exit N`.
  command(argv: readonly string[]): Promise<number>;
  // Reads the ledger again and returns the home view as it is now.
  reread(): HomeView;
  // Records one command-line entry in the history.
  remember(entry: string): void;
}

type InputEvent = { kind: 'key'; key: KeyInput } | { kind: 'line'; text: string };

interface Consumer {
  key(key: KeyInput): void;
  line(text: string): void;
}

type Ui = { kind: 'menu' } | { kind: 'prompt'; editor: LineEditor } | { kind: 'plain' };

const ESC = '\x1b';
const ENTER_SCREEN = `${ESC}[?1049h`;
const LEAVE_SCREEN = `${ESC}[?1049l`;
const HOME = `${ESC}[H`;
const CLEAR_LINE_END = `${ESC}[K`;
const CLEAR_BELOW = `${ESC}[J`;
const INVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultDispatch(argv: readonly string[], overrides: MainOverrides): Promise<number> {
  return main(argv, overrides);
}

class Session implements ActionContext {
  readonly env: NodeJS.ProcessEnv;
  private readonly stdin: ShellInput;
  private readonly stdout: ShellOutput;
  private readonly overrides: MainOverrides;
  private readonly dispatch: Dispatch;
  private readonly actions: readonly ShellAction[];
  // A terminal that takes raw keys and escape sequences; false for TERM=dumb.
  private readonly full: boolean;
  private readonly colour: boolean;

  private profile = DEFAULT_PROFILE;
  private home: HomeView;
  private ui: Ui = { kind: 'menu' };
  private selected = 0;
  private output = '';
  private consumer: Consumer | null = null;
  private queue: InputEvent[] = [];
  private rl: Interface | undefined;
  private finished = false;
  private resolveRun: (code: number) => void = () => undefined;
  private entries: string[] = [];

  constructor(options: ShellOptions) {
    this.env = options.env;
    this.stdin = options.stdin;
    this.stdout = options.stdout;
    this.overrides = options.overrides ?? {};
    this.dispatch = options.dispatch ?? defaultDispatch;
    this.actions = options.actions ?? SHELL_ACTIONS;
    this.full = options.stdout.isTTY === true && options.env['TERM'] !== 'dumb';
    this.colour = colourEnabled({ isTTY: options.stdout.isTTY, env: options.env });
    this.home = { profile: this.profile, store: { ok: true }, projects: [], nowMs: Date.now() };
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  start(): Promise<number> {
    const resolved = resolveProfile(this.env);
    if (resolved.ok) this.profile = resolved.value.profile;
    this.home = this.readHome();
    return new Promise<number>((resolve) => {
      this.resolveRun = resolve;
      this.stdout.on('resize', this.onResize);
      if (this.full) {
        this.stdout.write(ENTER_SCREEN);
        emitKeypressEvents(this.stdin);
        this.stdin.on('keypress', this.onKeypress);
        this.stdin.on('end', this.onEnd);
        this.stdin.setRawMode?.(true);
      } else {
        this.rl = createInterface({ input: this.stdin, terminal: false, crlfDelay: Infinity });
        this.rl.on('line', this.onLine);
        this.rl.on('close', this.onEnd);
      }
      this.stdin.resume();
      this.setConsumer(this.menuConsumer());
      this.paintMenu();
    });
  }

  // Leaves the terminal as it was found. Sends no signal to any process: a supervisor started from here keeps running (decision 4).
  private finish(code: number): void {
    if (this.finished) return;
    this.finished = true;
    this.stdout.off('resize', this.onResize);
    if (this.full) {
      this.stdin.off('keypress', this.onKeypress);
      this.stdin.off('end', this.onEnd);
      this.stdin.setRawMode?.(false);
      this.stdout.write(LEAVE_SCREEN);
    }
    this.rl?.close();
    this.stdin.pause();
    this.resolveRun(code);
  }

  // ---- input -------------------------------------------------------------------------------------------------------

  private readonly onKeypress = (str: string | undefined, key: KeyInput | undefined): void => {
    this.deliver({ kind: 'key', key: key ?? { sequence: str } });
  };

  private readonly onLine = (text: string): void => {
    this.deliver({ kind: 'line', text });
  };

  private readonly onEnd = (): void => {
    this.finish(0);
  };

  private readonly onResize = (): void => {
    if (this.full) this.draw();
  };

  private deliver(event: InputEvent): void {
    if (this.finished) return;
    this.queue.push(event);
    this.replay();
  }

  private setConsumer(consumer: Consumer | null): void {
    this.consumer = consumer;
    this.replay();
  }

  // Hands the queued events to the current consumer, in order, until the queue is empty or no consumer is listening.
  private replay(): void {
    while (!this.finished && this.consumer !== null && this.queue.length > 0) {
      const event = this.queue.shift() as InputEvent;
      if (event.kind === 'key') this.consumer.key(event.key);
      else this.consumer.line(event.text);
    }
  }

  // ---- the menu ----------------------------------------------------------------------------------------------------

  private menuConsumer(): Consumer {
    return {
      key: (key) => {
        if (key.ctrl === true) {
          if (key.name === 'c' || key.name === 'd') this.finish(0);
          return;
        }
        if (key.name === 'up' || key.name === 'down') {
          const n = this.actions.length;
          this.selected = (this.selected + (key.name === 'up' ? n - 1 : 1)) % n;
          this.draw();
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          const action = this.actions[this.selected];
          if (action !== undefined) this.activate(action);
          return;
        }
        const typed = key.sequence?.toLowerCase();
        const action = typed === undefined ? undefined : this.actions.find((a) => a.keys.includes(typed));
        if (action !== undefined) {
          this.selected = this.actions.indexOf(action);
          this.activate(action);
        }
      },
      line: (text) => {
        const entry = printable(text).trim();
        if (entry === '') {
          this.refresh();
          return;
        }
        const action = this.actions.find((a) => a.keys.includes(entry.toLowerCase()));
        // In line mode anything that is not a menu key is a command-line entry.
        if (action !== undefined) this.activate(action);
        else this.run(() => runCommandLine(this, entry));
      },
    };
  }

  private activate(action: ShellAction): void {
    this.run(() => action.run(this));
  }

  // Runs one action to its end. While it works, input is queued; the prompts and live views it opens take input themselves. When it ends the
  // shell reads the ledger again (decision 3) and returns to the menu.
  private run(body: () => Promise<'quit' | void>): void {
    this.consumer = null;
    void (async () => {
      let result: 'quit' | void = undefined;
      try {
        result = await body();
      } catch (e) {
        this.show(`${errorLine(undefined, `failed: ${message(e)}`)}\n`);
      }
      if (this.finished) return;
      if (result === 'quit') {
        this.finish(0);
        return;
      }
      this.refresh();
    })();
  }

  // Reads the ledger, shows the menu and listens for the next choice.
  private refresh(): void {
    this.home = this.readHome();
    this.ui = { kind: 'menu' };
    this.paintMenu();
    this.setConsumer(this.menuConsumer());
  }

  // ---- ActionContext -----------------------------------------------------------------------------------------------

  prompt(label: string, options: PromptOptions = {}): Promise<string | undefined> {
    void options;
    return new Promise((resolve) => {
      const editor = new LineEditor({ prompt: label });
      this.ui = { kind: 'prompt', editor };
      const done = (value: string | undefined): void => {
        this.ui = { kind: 'plain' };
        this.consumer = null;
        resolve(value);
      };
      this.consumer = {
        key: (key) => {
          const result = editor.handle(key);
          if (result.kind === 'pending') this.draw();
          else done(result.kind === 'submit' ? result.line : undefined);
        },
        line: (text) => done(printable(text)),
      };
      if (this.full) this.draw();
      else this.stdout.write(label);
      this.replay();
    });
  }

  show(text: string): void {
    this.output = stripControl(text).replace(/\n+$/, '');
    if (this.finished) return;
    if (this.full) this.draw();
    else this.stdout.write(`${this.output}\n`);
  }

  async command(argv: readonly string[]): Promise<number> {
    this.consumer = null;
    let captured = '';
    const io: Io = {
      out: (text) => void (captured += text),
      err: (text) => void (captured += text),
    };
    if (this.full) {
      this.output = `running ${stripControl(argv.join(' '))} ...`;
      this.ui = { kind: 'plain' };
      this.draw();
    }
    // The command sees the same overrides as the one-shot CLI (its host, its executor, its clock) and this shell's captured streams. The
    // terminal streams stay with the shell.
    const { stdin: _stdin, stdout: _stdout, ...rest } = this.overrides;
    let code: number;
    try {
      code = await this.dispatch(argv, { ...rest, env: this.env, io });
    } catch (e) {
      captured += `${errorLine(argv[0], `failed: ${message(e)}`)}\n`;
      code = 70;
    }
    this.show(code === 0 ? captured : `${captured.replace(/\n*$/, '\n')}exit ${code}\n`);
    return code;
  }

  reread(): HomeView {
    this.home = this.readHome();
    return this.home;
  }

  remember(entry: string): void {
    this.entries.push(entry);
  }

  // ---- reading the ledger ------------------------------------------------------------------------------------------

  // Every call opens the ledger read-only, reads, and closes it: the shell holds no connection between views (decision 3). A failure is
  // shown in the view as the failing query or error and does not close the shell.
  private readHome(): HomeView {
    const unavailable = (detail: string): HomeView => ({ profile: this.profile, store: { ok: false, detail }, projects: [], nowMs: Date.now() });
    try {
      const composed = createDeps(this.env, this.overrides, { readOnly: true });
      if (!composed.ok) return unavailable(composed.message);
      try {
        const { deps } = composed.value;
        const nowMs = deps.clock.nowMs();
        const status = getStatus(deps.ledger, nowMs);
        if (!status.ok) return unavailable(describeError(status.error));
        return { profile: deps.profile.profile, store: { ok: true }, projects: status.value, nowMs };
      } finally {
        composed.value.close();
      }
    } catch (e) {
      return unavailable(message(e));
    }
  }

  // ---- drawing -----------------------------------------------------------------------------------------------------

  private menuLines(): string[] {
    return this.actions.map((action, index) => {
      const text = `${index === this.selected ? '>' : ' '} ${action.keys[0] ?? ' '}  ${action.label}`;
      return index === this.selected && this.colour ? `${INVERSE}${text}${RESET}` : text;
    });
  }

  private paintMenu(): void {
    if (this.finished) return;
    if (this.full) {
      this.draw();
      return;
    }
    const home = renderHome(this.home, { width: terminalWidth(this.stdout.columns), colour: false });
    const menu = this.actions.map((a) => `${a.keys[0] ?? ' '}  ${a.label}`).join('\n');
    this.stdout.write(`${home}\n${menu}\nchoose a number, type a command, or q to quit: `);
  }

  // The output pane, cut to what the terminal can show under the other lines (the tail, with a note of what was left out).
  private outputLines(others: number): string[] {
    if (this.output === '') return [];
    const lines = this.output.split('\n');
    const rows = this.stdout.rows;
    if (rows === undefined || rows <= 0) return lines;
    const room = Math.max(3, rows - others - 1);
    return lines.length <= room ? lines : [`... ${lines.length - (room - 1)} earlier lines`, ...lines.slice(lines.length - (room - 1))];
  }

  // Full-screen mode: redraws the whole screen in place from the home position, so a resize or a keystroke never leaves old text behind.
  private draw(): void {
    if (this.finished || !this.full) return;
    const width = terminalWidth(this.stdout.columns);
    let lines: string[];
    let cursorBack = 0;
    const ui = this.ui;
    if (ui.kind === 'menu') {
      const home = renderHome(this.home, { width, colour: this.colour }).replace(/\n$/, '').split('\n');
      const menu = this.menuLines();
      const hint = 'up and down or a number to choose; : opens the command line; q quits';
      const output = this.outputLines(home.length + menu.length + 3);
      lines = [...home, '', ...menu, ...(output.length > 0 ? ['', ...output] : []), '', hint];
    } else if (ui.kind === 'prompt') {
      const output = this.outputLines(2);
      const typed = `${ui.editor.prompt}${ui.editor.text}`;
      lines = [...output, ...(output.length > 0 ? [''] : []), typed];
      cursorBack = Array.from(ui.editor.text).length - ui.editor.position;
    } else {
      lines = this.outputLines(1);
    }
    const body = lines.map((line) => `${line}${CLEAR_LINE_END}`).join('\n');
    this.stdout.write(`${HOME}${body}${CLEAR_BELOW}${cursorBack > 0 ? `${ESC}[${cursorBack}D` : ''}`);
  }
}

export async function runShell(options: ShellOptions): Promise<number> {
  // The shell's own refusal under a run (T-02-61): a contained invocation never reaches a command through it, whatever the caller checked.
  if (options.env['AVARICE_RUN'] !== undefined) {
    options.io?.err(`${errorLine(undefined, 'the interactive shell does not open inside a run (AVARICE_RUN is set)')}\n`);
    return EXIT_USAGE;
  }
  return new Session(options).start();
}
