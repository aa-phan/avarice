// CLI dispatch. Commands load from src/cli/commands/{name}.ts through the COMMANDS allowlist (T-01-61):
// only these names are ever imported, from this fixed directory. A later plan adds a command by adding
// its file; this file does not change.
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.ts';
import type { CommandExtras, CommandModule, Io } from './args.ts';
import type { SchedulerSeam } from '../adapters/schedule/launchd.ts';
import { createDeps, EXIT_INTERNAL } from './composition.ts';
import type { DepsOverrides } from './composition.ts';
import type { AppDeps } from '../app/deps.ts';
import { describeError } from '../adapters/sqlite/db.ts';
import { errorLine } from './render/style.ts';
import { processAncestry } from '../adapters/proc/ancestry.ts';
import type { ProcessEntry } from '../adapters/proc/ancestry.ts';
import type { Result } from '../domain/result.ts';
import type { IdentityContext } from './identity.ts';
import { parseProfileName, profileClass, selectProfile } from '../domain/profile.ts';
import { EXIT_PROFILE_REFUSED, readRepositoryContext } from './profile-gate.ts';

export const COMMANDS = ['init', 'repo', 'onboard', 'start', 'supervise', 'status', 'inbox', 'resume', 'context', 'install-host', 'contract', 'decide', 'digest', 'schedule', 'cancel', 'approve'] as const;
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
  // Test seam: replaces the reader of the process ancestry. Only main.ts names it; production passes nothing and reads the real process table.
  ancestry?(): Result<ProcessEntry[]>;
  // Test seam: aims `schedule` at a temporary agents directory, a fake launchctl and a chosen program line. Only main.ts names it; production
  // passes nothing, so the agent is written under ~/Library/LaunchAgents for the running Node binary and CLI entry.
  scheduler?: SchedulerSeam;
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
  // What a command that must not run inside a run is told about where it runs (CS-11): the terminal facts of the streams this process (or the
  // shell's test streams) holds, and a reader of the process ancestry that walks the real process table unless a test supplies a chain.
  const identity: IdentityContext = {
    terminal: { stdinIsTty: (overrides.stdin ?? process.stdin).isTTY === true, stdoutIsTty: (overrides.stdout ?? process.stdout).isTTY === true },
    ancestry: overrides.ancestry ?? (() => processAncestry(process.pid)),
  };
  const usageError = mod.usage?.(args, env, identity);
  if (usageError !== undefined) {
    io.err(`${errorLine(name, usageError)}\n${USAGE}`);
    return EXIT_USAGE;
  }

  // D-16, D-17: which profile this command runs under is decided here, before any directory or store exists. A name that does not
  // follow the grammar ends the command with the usage exit and creates nothing.
  const flag = args.flags['profile'];
  const envProfile = env['AVARICE_PROFILE'];
  if (flag === true) {
    io.err(`${errorLine(name, '--profile needs a profile name')}\n`);
    return EXIT_USAGE;
  }
  if (flag !== undefined) {
    const named = parseProfileName(flag);
    if (!named.ok) {
      io.err(`${errorLine(name, describeError(named.error))}\n`);
      return EXIT_USAGE;
    }
  }
  const envDefault = envProfile !== undefined && envProfile !== '' ? envProfile : undefined;
  // S-9: the repository the command works on may be bound to a profile, and may belong to an enterprise one. Both are read from files in
  // the config home and from git, never from a store, so a refusal below has opened nothing.
  const repository = readRepositoryContext(env, mod.repository?.(args), process.cwd());
  if (!repository.ok) {
    io.err(`${errorLine(name, repository.message)}\n`);
    return repository.code;
  }
  const { bound, enterprise } = repository.value;
  const selected = selectProfile({ ...(flag !== undefined ? { flag } : {}), ...(bound !== undefined ? { bound } : {}), ...(envDefault !== undefined ? { envDefault } : {}) });
  if (!selected.ok) {
    if (selected.error.kind === 'denied') {
      io.err(`${errorLine(name, `refused: repository bound to ${bound ?? ''}; run it under that profile (--profile ${bound ?? ''}) or leave --profile out`)}\n`);
      return EXIT_PROFILE_REFUSED;
    }
    io.err(`${errorLine(name, `AVARICE_PROFILE: ${describeError(selected.error)}`)}\n`);
    return EXIT_USAGE;
  }
  // D-16: a repository that an enterprise profile claims by its remote is never run under a personal profile and never re-bound to one.
  if (enterprise !== undefined && profileClass(selected.value) === 'personal') {
    io.err(`${errorLine(name, `refused: the repository's remote belongs to ${enterprise}, not to ${selected.value}; run it under ${enterprise} (--profile ${enterprise})`)}\n`);
    return EXIT_PROFILE_REFUSED;
  }

  const composed = createDeps(env, overrides, { readOnly: mod.readOnly === true, gsd: mod.needsGsd === true, profile: selected.value });
  if (!composed.ok) {
    io.err(`${errorLine(name, composed.message)}\n`);
    return composed.code;
  }
  try {
    // A command that needs an answer asks through the io; the shell and the tests supply a way to ask, the one-shot CLI reads standard input.
    const scheduler = overrides.scheduler;
    const extras: CommandExtras = scheduler === undefined ? {} : { scheduler };
    return await mod.run(args, composed.value.deps, overrides.ask === undefined ? io : { ...io, ask: overrides.ask }, extras);
  } catch (e) {
    io.err(`${errorLine(name, `failed: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    return EXIT_INTERNAL;
  } finally {
    composed.value.close();
  }
}
