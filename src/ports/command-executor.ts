// CommandExecutor port (docs/contracts-and-state.md "CommandExecutor"). Runs one command with an explicit
// environment, a timeout and an output limit, and reports how it ended. The local adapter confines every command in an
// OS sandbox: no sandbox means `unavailable`, never an unsandboxed run (docs/containment.md "Checks and probes
// run sandboxed"). Callers name what a command may write and read; everything else is denied.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

// Default per-stream output limit; the rest is dropped and `truncated` is set.
export const DEFAULT_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024;
// Marker appended to a stream that hit its limit.
export const TRUNCATION_MARKER = '\n[avarice: output truncated]\n';

export interface CommandSpec {
  // No shell string: argv[0] is resolved on `env.PATH`.
  argv: readonly string[];
  // Absolute in Phase 1 (a workspace path). The tree under it is writable only through `writePaths`.
  cwd: string;
  // The whole environment of the command; nothing is inherited.
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  // Per stream; DEFAULT_OUTPUT_LIMIT_BYTES when absent.
  outputLimitBytes?: number;
  invocationId: string;
  // Absolute paths the command may write (each is its own subtree). Everything else is read-only.
  writePaths: readonly string[];
  // Absolute paths the command may not read.
  denyReadPaths: readonly string[];
}

export type CommandStatus = 'passed' | 'failed' | 'timed_out' | 'cancelled' | 'spawn_error';

export interface CommandResult {
  exitCode: number | null;
  // Name of the signal that ended the command, when one did.
  signal: string | null;
  status: CommandStatus;
  durationMs: number;
  stdout: string;
  stderr: string;
  // A stream reached outputLimitBytes and was cut.
  truncated: boolean;
}

export interface CommandExecutor {
  readonly descriptor: CapabilityDescriptor;
  // `unavailable` when the sandbox cannot run (nothing was spawned); `invalid` for a malformed spec.
  run(cmd: CommandSpec, signal?: AbortSignal): Promise<Result<CommandResult>>;
}
