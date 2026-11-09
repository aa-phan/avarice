// CLI dispatch. Commands load from src/cli/commands/{name}.ts through the COMMANDS allowlist (T-01-61):
// only these names are ever imported, from this fixed directory. A later plan adds a command by adding
// its file; this file does not change.
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.ts';
import type { CommandModule, Io } from './args.ts';
import { createDeps, EXIT_INTERNAL } from './composition.ts';
import type { DepsOverrides } from './composition.ts';
import type { AppDeps } from '../app/deps.ts';
import { errorLine } from './render/style.ts';

export const COMMANDS = ['init', 'repo', 'onboard', 'start', 'supervise', 'status', 'inbox', 'resume', 'context', 'install-host', 'contract'] as const;
export const EXIT_USAGE = 64;

// The terminal the interactive shell (FR-27, ADR-013) reads keys from and draws on. `isTTY` is how a stream says it is a terminal;
// `setRawMode` exists only on a real terminal input; `columns` and `rows` are the size a terminal reports.
export type ShellInput = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?(mode: boolean): unknown };
export type ShellOutput = NodeJS.WritableStream & { isTTY?: boolean; columns?: number; rows?: number };

export interface MainOverrides extends DepsOverrides {
  env?: NodeJS.ProcessEnv;
  io?: Io;
  // Standard input and output for the no-argument shell; the process streams when absent. Tests inject streams that claim to be a terminal.
  stdin?: ShellInput;
  stdout?: ShellOutput;
  // Answers the question of a command that needs a yes or no (`contract amend`). The interactive shell passes its own line prompt so the
  // question appears in the shell; a test passes a scripted answer. Absent, the command reads one line from standard input.
  ask?(question: string): Promise<string | undefined>;
}

const USAGE = `usage: avarice <command> [options]

commands:
  ${COMMANDS.join('\n  ')}
`;

function isCommand(name: string): name is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(name);
}

function defaultIo(): Io {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
  };
}

export async function main(argv: readonly string[], overrides: MainOverrides = {}): Promise<number> {
  const io = overrides.io ?? defaultIo();
  const env = overrides.env ?? process.env;
  const name = argv[0];
  if (name === '--help' || name === '-h') {
    io.out(USAGE);
    return 0;
  }
  // FR-27, ADR-013 decision 1: bare `avarice` opens the interactive shell when both standard streams are terminals and no run marker is
  // set; in every other case it keeps the usage and exit 64. The shell module loads only here, so no one-shot command pays for it.
  if (argv.length === 0) {
    const stdin = overrides.stdin ?? process.stdin;
    const stdout = overrides.stdout ?? process.stdout;
    if (stdin.isTTY === true && stdout.isTTY === true && env['AVARICE_RUN'] === undefined) {
      const { runShell } = await import('./shell/shell.ts');
      return runShell({ stdin, stdout, env, overrides, io });
    }
  }
  if (name === undefined || !isCommand(name)) {
    io.err(`${errorLine(undefined, name === undefined ? 'no command given' : `unknown command '${name}'`)}\n${USAGE}`);
    return EXIT_USAGE;
  }

  const url = new URL(`./commands/${name}.ts`, import.meta.url);
  let mod: CommandModule<AppDeps>;
  try {
    mod = (await import(url.href)) as CommandModule<AppDeps>;
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const message = e instanceof Error ? e.message : String(e);
    if (code === 'ERR_MODULE_NOT_FOUND' && message.includes(`Cannot find module '${fileURLToPath(url)}'`)) {
      io.err(`${errorLine(name, 'not available in this build')}\n${USAGE}`);
      return EXIT_USAGE;
    }
    io.err(`${errorLine(name, `cannot load: ${message}`)}\n`);
    return EXIT_INTERNAL;
  }
  if (typeof mod.run !== 'function') {
    io.err(`${errorLine(name, 'the command module does not export run()')}\n`);
    return EXIT_INTERNAL;
  }

  const args = parseArgs(argv.slice(1), { boolean: mod.booleanFlags ?? [] });
  const usageError = mod.usage?.(args, env);
  if (usageError !== undefined) {
    io.err(`${errorLine(name, usageError)}\n${USAGE}`);
    return EXIT_USAGE;
  }

  const composed = createDeps(env, overrides, { readOnly: mod.readOnly === true, gsd: mod.needsGsd === true });
  if (!composed.ok) {
    io.err(`${errorLine(name, composed.message)}\n`);
    return composed.code;
  }
  try {
    // A command that needs an answer asks through the io; the shell and the tests supply a way to ask, the one-shot CLI reads standard input.
    return await mod.run(args, composed.value.deps, overrides.ask === undefined ? io : { ...io, ask: overrides.ask });
  } catch (e) {
    io.err(`${errorLine(name, `failed: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    return EXIT_INTERNAL;
  } finally {
    composed.value.close();
  }
}
