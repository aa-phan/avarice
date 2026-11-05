// SandboxedExecutor: the local CommandExecutor (T-01-36). Every command runs as
// `/usr/bin/sandbox-exec -p {profile} {argv...}`: network denied, writes limited to the declared paths, reads
// of the named paths denied, only the given environment, its own process group. When the sandbox cannot be
// used (probe failed) nothing is spawned and the result is `unavailable`; there is no unsandboxed fallback.
// `sandbox-exec` is deprecated by Apple but works on supported macOS; it stays behind this port so the
// backend can change.
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import { DEFAULT_OUTPUT_LIMIT_BYTES, TRUNCATION_MARKER } from '../../ports/command-executor.ts';
import type { CommandExecutor, CommandResult, CommandSpec, CommandStatus } from '../../ports/command-executor.ts';
import { realpathNearest } from '../fs/profile-paths.ts';
import { buildSeatbeltProfile } from './seatbelt-profile.ts';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const PROBE_PROFILE = '(version 1)(allow default)';
// The first probe attempt and its one retry (WR-07).
const PROBE_TIMEOUTS_MS: readonly [number, number] = [5_000, 15_000];
// SIGTERM at the timeout, SIGKILL this long after.
const KILL_GRACE_MS = 5_000;
// After the leader exits, how long to wait for its output pipes to close before settling anyway.
const PIPE_GRACE_MS = 2_000;
// sandbox-exec's own failures: 65 profile did not compile, 71 sandbox could not be applied.
const SANDBOX_EXEC_FAILURES = new Set([65, 71]);

export interface SandboxedExecutorOptions {
  // The sandbox launcher. Tests point it at /usr/bin/false to prove the refusal; production never sets it.
  sandboxExecPath?: string;
  // The timeouts of the first probe attempt and its one retry. Tests shorten them; production never sets it.
  probeTimeoutsMs?: readonly [number, number];
}

// One probe per launcher path per process.
const probes = new Map<string, boolean>();

function probe(sandboxExecPath: string, timeouts: readonly [number, number]): boolean {
  const known = probes.get(sandboxExecPath);
  if (known !== undefined) return known;
  const ran = spawnSync(sandboxExecPath, ['-p', PROBE_PROFILE, '/usr/bin/true'], { stdio: 'ignore', timeout: timeouts[0] });
  const works = ran.error === undefined && ran.status === 0;
  probes.set(sandboxExecPath, works);
  return works;
}

interface Capture {
  chunks: Buffer[];
  size: number;
  truncated: boolean;
}

function collect(capture: Capture, chunk: Buffer, limit: number): void {
  if (capture.truncated) return;
  const room = limit - capture.size;
  if (chunk.length <= room) {
    capture.chunks.push(chunk);
    capture.size += chunk.length;
    return;
  }
  if (room > 0) {
    capture.chunks.push(chunk.subarray(0, room));
    capture.size += room;
  }
  capture.truncated = true;
}

function text(capture: Capture): string {
  const body = Buffer.concat(capture.chunks).toString('utf8');
  return capture.truncated ? body + TRUNCATION_MARKER : body;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // group already gone
  }
}

// After SIGKILL a member can sit in the exiting state, reparented to launchd and not yet reaped; macOS answers
// EPERM for it rather than ESRCH. run() resolves only once the group is gone, or after this bound.
const GROUP_GONE_WAIT_MS = 2000;
const GROUP_POLL_MS = 25;

function groupGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function waitGroupGone(pid: number): Promise<void> {
  const deadline = Date.now() + GROUP_GONE_WAIT_MS;
  while (!groupGone(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, GROUP_POLL_MS));
  }
}

export class SandboxedExecutor implements CommandExecutor {
  readonly #sandboxExecPath: string;
  readonly #probeTimeoutsMs: readonly [number, number];

  constructor(options: SandboxedExecutorOptions = {}) {
    this.#sandboxExecPath = options.sandboxExecPath ?? SANDBOX_EXEC;
    this.#probeTimeoutsMs = options.probeTimeoutsMs ?? PROBE_TIMEOUTS_MS;
  }

  // The probe runs on first use of the descriptor or of run(), so a read-only command that never runs anything
  // does not pay for it.
  get descriptor(): CapabilityDescriptor {
    const enforced = probe(this.#sandboxExecPath, this.#probeTimeoutsMs);
    return {
      port: 'executor',
      adapter: 'local-sandbox-exec',
      version: '1',
      capabilities: { remote: false, cancel: true, 'process-group-kill': true },
      attributes: { enforcement: enforced ? 'enforced' : 'none' },
      offline: true,
    };
  }

  run(cmd: CommandSpec, signal?: AbortSignal): Promise<Result<CommandResult>> {
    const invalid = (field: string, reason: string): Promise<Result<CommandResult>> => Promise.resolve(err({ kind: 'invalid', field, reason }));
    if (cmd.argv.length === 0 || cmd.argv.some((a) => typeof a !== 'string')) return invalid('argv', 'must name a command');
    if (!isAbsolute(cmd.cwd)) return invalid('cwd', 'must be an absolute path');
    try {
      if (!statSync(cmd.cwd).isDirectory()) return invalid('cwd', 'is not a directory');
    } catch {
      return invalid('cwd', 'does not exist');
    }
    if (!Number.isFinite(cmd.timeoutMs) || cmd.timeoutMs <= 0) return invalid('timeoutMs', 'must be positive');

    if (!probe(this.#sandboxExecPath, this.#probeTimeoutsMs)) {
      return Promise.resolve(err({ kind: 'unavailable', cause: `the sandbox (${this.#sandboxExecPath}) cannot be used here; the command was not run` }));
    }
    let cwdReal: string;
    try {
      cwdReal = realpathNearest(cmd.cwd);
    } catch {
      return invalid('cwd', 'cannot be resolved');
    }
    const profile = buildSeatbeltProfile({ writePaths: cmd.writePaths, denyReadPaths: cmd.denyReadPaths, protectedPaths: [cwdReal] });
    if (!profile.ok) return Promise.resolve(profile);
    return this.#spawn(cmd, profile.value, signal);
  }

  #spawn(cmd: CommandSpec, profile: string, abort?: AbortSignal): Promise<Result<CommandResult>> {
    const limit = cmd.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    const started = Date.now();
    return new Promise((resolve) => {
      if (abort?.aborted === true) {
        resolve(ok({ exitCode: null, signal: null, status: 'cancelled', durationMs: 0, stdout: '', stderr: '', truncated: false }));
        return;
      }
      const stdout: Capture = { chunks: [], size: 0, truncated: false };
      const stderr: Capture = { chunks: [], size: 0, truncated: false };
      let ended: 'timed_out' | 'cancelled' | undefined;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let pipeTimer: NodeJS.Timeout | undefined;
      let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;

      const child = spawn(this.#sandboxExecPath, ['-p', profile, ...cmd.argv], {
        cwd: cmd.cwd,
        env: { ...cmd.env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (spawnError?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (pipeTimer !== undefined) clearTimeout(pipeTimer);
        abort?.removeEventListener('abort', onAbort);
        if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL');
        const out = text(stdout);
        const errText = spawnError !== undefined ? spawnError : text(stderr);
        let result: Result<CommandResult>;
        if (spawnError === undefined && exit !== undefined && ended === undefined && exit.code !== null && SANDBOX_EXEC_FAILURES.has(exit.code) && errText.startsWith('sandbox-exec:')) {
          result = err({ kind: 'unavailable', cause: `the sandbox refused the command: ${errText.split('\n')[0] ?? ''}` });
        } else {
          let status: CommandStatus;
          if (spawnError !== undefined) status = 'spawn_error';
          else if (ended !== undefined) status = ended;
          else status = exit !== undefined && exit.code === 0 ? 'passed' : 'failed';
          result = ok({
            exitCode: exit?.code ?? null,
            signal: exit?.signal ?? null,
            status,
            durationMs: Date.now() - started,
            stdout: out,
            stderr: errText,
            truncated: stdout.truncated || stderr.truncated,
          });
        }
        if (child.pid === undefined) resolve(result);
        else void waitGroupGone(child.pid).then(() => resolve(result));
      };

      const terminate = (reason: 'timed_out' | 'cancelled'): void => {
        if (ended !== undefined || settled) return;
        ended = reason;
        if (child.pid !== undefined) killGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => {
          if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL');
        }, KILL_GRACE_MS);
      };
      const timer = setTimeout(() => terminate('timed_out'), cmd.timeoutMs);
      const onAbort = (): void => terminate('cancelled');
      abort?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk, limit));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk, limit));
      child.on('error', (e) => finish(`could not start ${this.#sandboxExecPath}: ${(e as NodeJS.ErrnoException).code ?? e.message}`));
      child.on('exit', (code, sig) => {
        exit = { code, signal: sig };
        // Stragglers of a timed-out or cancelled command are killed at once; the pipes get a short grace.
        if (ended !== undefined && child.pid !== undefined) killGroup(child.pid, 'SIGKILL');
        pipeTimer = setTimeout(() => finish(), PIPE_GRACE_MS);
      });
      child.on('close', () => finish());
    });
  }
}
