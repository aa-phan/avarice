// SandboxedExecutor (stub: plan 01-13 RED).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../ports/command-executor.ts';

export interface SandboxedExecutorOptions {
  sandboxExecPath?: string;
}

export class SandboxedExecutor implements CommandExecutor {
  readonly descriptor: CapabilityDescriptor = { port: 'executor', adapter: 'local-sandbox-exec', version: '1', capabilities: {}, offline: true };

  constructor(_options: SandboxedExecutorOptions = {}) {}

  run(_cmd: CommandSpec, _signal?: AbortSignal): Promise<Result<CommandResult>> {
    return Promise.resolve(err({ kind: 'unavailable', cause: 'not implemented' }));
  }
}
