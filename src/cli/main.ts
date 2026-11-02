// CLI dispatch. Commands load from src/cli/commands/{name}.ts through the COMMANDS allowlist (T-01-61):
// only these names are ever imported, from this fixed directory. A later plan adds a command by adding
// its file; this file does not change.
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.ts';
import type { CommandModule, Io } from './args.ts';
import { createDeps, EXIT_INTERNAL } from './composition.ts';
import type { DepsOverrides } from './composition.ts';
import type { AppDeps } from '../app/deps.ts';

export const COMMANDS = ['init', 'repo', 'onboard', 'status', 'resume', 'context'] as const;
export const EXIT_USAGE = 64;

export interface MainOverrides extends DepsOverrides {
  env?: NodeJS.ProcessEnv;
  io?: Io;
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
  if (name === undefined || !isCommand(name)) {
    io.err(`${name === undefined ? 'avarice: no command given' : `avarice: unknown command '${name}'`}\n${USAGE}`);
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
      io.err(`avarice: '${name}' is not available in this build\n${USAGE}`);
      return EXIT_USAGE;
    }
    io.err(`avarice: cannot load '${name}': ${message}\n`);
    return EXIT_INTERNAL;
  }
  if (typeof mod.run !== 'function') {
    io.err(`avarice: command module '${name}' does not export run()\n`);
    return EXIT_INTERNAL;
  }

  const composed = createDeps(env, overrides, { readOnly: mod.readOnly === true });
  if (!composed.ok) {
    io.err(composed.message + '\n');
    return composed.code;
  }
  try {
    const args = parseArgs(argv.slice(1), { boolean: mod.booleanFlags ?? [] });
    return await mod.run(args, composed.value.deps, io);
  } catch (e) {
    io.err(`avarice: ${name} failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_INTERNAL;
  } finally {
    composed.value.close();
  }
}
