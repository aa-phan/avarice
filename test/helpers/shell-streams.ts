// Injected terminal streams for the interactive shell tests (plan 02-19). Node has no built-in pseudo-terminal, so the unit and integration
// tests drive runShell with a readable stream that claims to be a TTY and a writable sink that records what the shell prints. The real
// pseudo-terminal check is test/integration/shell-tty.test.ts.
import { PassThrough, Writable } from 'node:stream';
import type { ShellInput, ShellOutput } from '../../src/cli/main.ts';

export interface FakeTerminal {
  stdin: ShellInput & PassThrough;
  stdout: ShellOutput & Writable;
  // Everything the shell wrote to standard output so far.
  output(): string;
  // What was written since the last call to `mark()`.
  sinceMark(): string;
  mark(): void;
  // Writes keystrokes (or whole lines) to the shell's standard input.
  type(text: string): void;
  // Every value the shell passed to setRawMode, in order.
  rawModes: boolean[];
  // Changes the reported terminal width and emits `resize`.
  resize(columns: number): void;
}

export interface FakeTerminalOptions {
  inputIsTty?: boolean;
  outputIsTty?: boolean;
  columns?: number;
}

export function fakeTerminal(options: FakeTerminalOptions = {}): FakeTerminal {
  const rawModes: boolean[] = [];
  const stdin = new PassThrough() as ShellInput & PassThrough;
  stdin.isTTY = options.inputIsTty ?? true;
  stdin.setRawMode = (mode: boolean): void => void rawModes.push(mode);
  let text = '';
  let marked = 0;
  const stdout = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      text += chunk.toString();
      callback();
    },
  }) as ShellOutput & Writable;
  stdout.isTTY = options.outputIsTty ?? true;
  stdout.columns = options.columns ?? 100;
  return {
    stdin,
    stdout,
    output: () => text,
    sinceMark: () => text.slice(marked),
    mark: () => {
      marked = text.length;
    },
    type: (keys) => void stdin.write(keys),
    rawModes,
    resize: (columns) => {
      stdout.columns = columns;
      stdout.emit('resize');
    },
  };
}

// Polls until `predicate` holds, failing with `what` after `timeoutMs`.
export async function waitFor(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
  }
}

// The ANSI sequences the shell may print: any ESC, and the SGR colour sequences among them.
export const HAS_ESC = /\x1b/;
export const HAS_SGR = /\x1b\[[0-9;]*m/;
