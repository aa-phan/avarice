// The actions of the interactive shell menu (ADR-013 decisions 2 to 4). Each action is a small async function over the ActionContext of
// shell.ts; the work itself is done by the command modules, which the context runs in this process through main().
import { errorLine } from '../render/style.ts';
import type { ActionContext } from './shell.ts';
import { printable } from './line-editor.ts';

export interface ShellAction {
  id: string;
  // The keys that activate it; the first is shown in the menu.
  keys: readonly string[];
  label: string;
  // Resolves 'quit' to leave the shell.
  run(ctx: ActionContext): Promise<'quit' | void>;
}

// Splits a command line into words. Single and double quotes group words (the quotes are dropped); there are no escapes. Returns the
// error text for an unterminated quote.
export function splitWords(line: string): string[] | string {
  const words: string[] = [];
  let current = '';
  let started = false;
  let quote: string | null = null;
  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote !== null) return `unterminated ${quote} in the command line`;
  if (started) words.push(current);
  return words;
}

// One command-line entry, in the one-shot grammar without the `avarice` prefix (`status --json`, `resume onb_123`). An empty entry runs nothing.
export async function runCommandLine(ctx: ActionContext, line: string): Promise<'quit' | void> {
  const entry = printable(line).trim();
  if (entry === '') return;
  const words = splitWords(entry);
  if (typeof words === 'string') {
    ctx.show(`${errorLine(undefined, words)}\n`);
    return;
  }
  // A habit from the one-shot form: `avarice status` typed inside the shell means `status`.
  if (words[0] === 'avarice') words.shift();
  if (words.length === 0) return;
  if (words.length === 1 && (words[0] === 'quit' || words[0] === 'exit')) return 'quit';
  ctx.remember(entry);
  await ctx.command(words);
}

const commandLine: ShellAction = {
  id: 'command-line',
  keys: [':'],
  label: 'Command line',
  run: async (ctx) => {
    const line = await ctx.prompt('avarice> ', { history: true, complete: true });
    if (line === undefined) return;
    return runCommandLine(ctx, line);
  },
};

const quit: ShellAction = {
  id: 'quit',
  keys: ['q'],
  label: 'Quit',
  run: () => Promise.resolve('quit'),
};

export const SHELL_ACTIONS: readonly ShellAction[] = [commandLine, quit];
