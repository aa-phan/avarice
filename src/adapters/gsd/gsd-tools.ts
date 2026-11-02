// gsd-tools runner (T-01-20). Runs `{node} {gsdCoreDir}/bin/gsd-tools.cjs ...args` through execFile (no shell,
// argv array) with a rebuilt environment: the safe-git variables, so GSD's own git calls cannot run hooks,
// filters or fsmonitor commands, and a short allowlist next to them. Output is JSON; `@file:` output (GSD's
// spill for large results) is dereferenced; exit 69 is `unavailable`.
import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import { safeGitEnv } from '../git/safe-git.ts';

// Operation budgets table: 15 s default for a gsd-tools verb.
export const DEFAULT_GSD_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_SPILL_BYTES = 16 * 1024 * 1024;
const EXIT_UNAVAILABLE = 69;

// Environment names a GSD process (and the contained host, plan 01-15) may inherit from AVARICE's own, next to
// the safe-git variables. USER and LOGNAME are needed for the host's macOS credential lookup (spike S0-C);
// CLAUDE_CONFIG_DIR is a path, not a credential.
export const GSD_ENV_PASSTHROUGH: readonly string[] = ['HOME', 'LANG', 'TMPDIR', 'USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR'];

// PATH for a GSD process: gsd-core's bin first (so `gsd_run` resolves, spike S0-C), then the system tools.
export function gsdPath(gsdCoreDir: string): string {
  return [join(gsdCoreDir, 'bin'), '/usr/bin', '/bin', '/opt/homebrew/bin'].join(':');
}

export function gsdEnv(base: NodeJS.ProcessEnv, gsdCoreDir: string): Record<string, string> {
  const env: Record<string, string> = { ...safeGitEnv(base) };
  for (const name of GSD_ENV_PASSTHROUGH) {
    const value = base[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  env['PATH'] = gsdPath(gsdCoreDir);
  return env;
}

export function gsdToolsPath(gsdCoreDir: string): string {
  return join(gsdCoreDir, 'bin', 'gsd-tools.cjs');
}

export interface RunGsdOptions {
  // Working directory: for every mutating verb this is the staging workspace.
  cwd: string;
  timeoutMs?: number;
  // The environment the child's is built from; defaults to this process's.
  env?: NodeJS.ProcessEnv;
}

// Output that GSD spilled to a file: `@file:<absolute path>`.
function readSpill(text: string): Result<string> {
  const path = text.slice('@file:'.length).trim();
  if (!isAbsolute(path)) return err({ kind: 'internal', cause: 'gsd-tools spilled its output to a relative path' });
  try {
    if (statSync(path).size > MAX_SPILL_BYTES) return err({ kind: 'internal', cause: 'gsd-tools spilled more than the size limit' });
    return ok(readFileSync(path, 'utf8'));
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot read the spilled gsd-tools output: ${(e as NodeJS.ErrnoException).code ?? 'unreadable'}` });
  }
}

export function parseGsdOutput(stdout: string): Result<unknown> {
  let text = stdout.trim();
  if (text.startsWith('@file:')) {
    const spilled = readSpill(text);
    if (!spilled.ok) return spilled;
    text = spilled.value.trim();
  }
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return err({ kind: 'internal', cause: `gsd-tools printed output that is not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})` });
  }
}

export function runGsd(gsdCoreDir: string, args: readonly string[], options: RunGsdOptions): Promise<Result<unknown>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GSD_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [gsdToolsPath(gsdCoreDir), ...args],
      {
        cwd: options.cwd,
        env: gsdEnv(options.env ?? process.env, gsdCoreDir),
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = error as NodeJS.ErrnoException & { killed?: boolean };
          if (failure.killed === true) {
            resolve(err({ kind: 'timeout', afterMs: timeoutMs, sideEffect: 'unknown' }));
            return;
          }
          const reason = String(stderr).trim().split('\n')[0] ?? '';
          if (typeof failure.code === 'number') {
            resolve(
              failure.code === EXIT_UNAVAILABLE
                ? err({ kind: 'unavailable', cause: `gsd-tools ${args[0] ?? ''} exited ${EXIT_UNAVAILABLE}: ${reason}` })
                : err({ kind: 'internal', cause: `gsd-tools ${args[0] ?? ''} exited ${failure.code}: ${reason}` }),
            );
            return;
          }
          resolve(err({ kind: 'unavailable', cause: `gsd-tools could not run: ${String(failure.code ?? failure.message)}` }));
          return;
        }
        resolve(parseGsdOutput(String(stdout)));
      },
    );
    // A verb never reads standard input.
    child.stdin?.end();
  });
}
