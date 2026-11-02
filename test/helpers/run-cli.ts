// Spawns a CLI entry as a child process with the three profile roots pointing into a temp directory.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const PRODUCTION_ENTRY = join(REPO_ROOT, 'bin', 'avarice.ts');

export interface CliRoots {
  base: string;
  AVARICE_CONFIG_HOME: string;
  AVARICE_DATA_ROOT: string;
  AVARICE_WORK_ROOT: string;
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

export interface RunCliOptions {
  entry?: string;
  env?: Record<string, string | undefined>;
  // Command prefix, for example the macOS sandbox wrapper.
  wrap?: readonly string[];
  timeoutMs?: number;
}

export function makeRoots(): CliRoots {
  const base = mkdtempSync(join(tmpdir(), 'avarice-cli-'));
  return {
    base,
    AVARICE_CONFIG_HOME: join(base, 'config'),
    AVARICE_DATA_ROOT: join(base, 'data'),
    AVARICE_WORK_ROOT: join(base, 'work'),
  };
}

export function runCli(argv: readonly string[], options: RunCliOptions & { roots?: CliRoots } = {}): CliResult {
  const roots = options.roots ?? makeRoots();
  const env: Record<string, string | undefined> = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    ...options.env,
  };
  // A child of `node --test` must not inherit the parent runner's context.
  delete env['NODE_TEST_CONTEXT'];
  const command = [...(options.wrap ?? []), process.execPath, '--disable-warning=ExperimentalWarning', options.entry ?? PRODUCTION_ENTRY, ...argv];
  const result = spawnSync(command[0] as string, command.slice(1), {
    encoding: 'utf8',
    env: env as NodeJS.ProcessEnv,
    timeout: options.timeoutMs ?? 60_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal };
}
