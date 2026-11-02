// Test-only CommandExecutor for a process that already runs inside a `sandbox-exec` sandbox (the offline
// wrapper of test/helpers/offline.ts). `sandbox-exec` cannot nest, so the production SandboxedExecutor would
// report `unavailable` there. This executor runs the command directly and relies on the outer sandbox, which
// denies the network for the whole process tree. It confines nothing else, so it is only ever injected by
// test-cli.ts when AVARICE_TEST_OUTER_SANDBOX is set; bin/avarice.ts never imports it.
import { execFile } from 'node:child_process';
import { err, ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';

export class InheritedSandboxExecutor implements CommandExecutor {
  readonly descriptor: CapabilityDescriptor = {
    port: 'executor',
    adapter: 'local-sandbox-exec',
    version: '1',
    capabilities: { remote: false, cancel: false },
    attributes: { enforcement: 'inherited' },
    offline: true,
  };

  run(cmd: CommandSpec): Promise<Result<CommandResult>> {
    const [file, ...args] = cmd.argv;
    if (file === undefined) return Promise.resolve(err({ kind: 'invalid', field: 'argv', reason: 'must name a command' }));
    const started = Date.now();
    return new Promise((resolve) => {
      execFile(file, args, { cwd: cmd.cwd, env: { ...cmd.env }, encoding: 'utf8', timeout: cmd.timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals }) | null;
        const status = failure === null ? 'passed' : failure.killed === true ? 'timed_out' : typeof failure.code === 'number' ? 'failed' : 'spawn_error';
        resolve(
          ok({
            exitCode: failure === null ? 0 : typeof failure.code === 'number' ? failure.code : null,
            signal: failure?.signal ?? null,
            status,
            durationMs: Date.now() - started,
            stdout: String(stdout),
            stderr: String(stderr),
            truncated: false,
          }),
        );
      });
    });
  }
}
