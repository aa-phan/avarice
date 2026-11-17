// FakeRemoteExecutor (plan 04-33; NFR-4, AC-7): a CommandExecutor that behaves like one reached over a lossy network, in this process. Every call and
// every response is serialized through JSON text, each takes a seeded latency, 5% of responses are dropped and 2% are delivered twice. The commands
// themselves run on a real executor behind it, so the portability proof exercises what a remote worker would: serialization, delay, loss and duplicates.
//
// The fake is the "server" and the "client" at once, as a real remote adapter would be split:
// - The server runs each command at most once. It keeps the response text under the invocation key, so the retry of a call whose response was dropped
//   asks for the stored answer instead of running the command again (T-04-90). The client forgets the key once it has the answer.
// - The client retries a dropped response up to MAX_ATTEMPTS times and then reports `timeout` with an unknown side effect: the command may have run.
// - A duplicated response is delivered a second time under the same key and discarded.
// Importing the module runs nothing.
import { createHash } from 'node:crypto';
import { err } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import { SeededFaults, callId, sleep } from './seeded-faults.ts';

// A dropped response is retried this many times in all; a link that loses this many in a row is a partition, which this proof does not claim to show.
export const EXECUTOR_MAX_ATTEMPTS = 6;

export interface FakeRemoteExecutorOptions {
  maxAttempts?: number;
}

// The key the server stores a response under: the invocation identifier, and a digest of the call so two different commands that carry the same identifier
// (a test builds many with one) never read each other's answer.
export function invocationKey(cmd: CommandSpec, wire: string): string {
  return `${cmd.invocationId}#${createHash('sha256').update(wire).digest('hex').slice(0, 12)}`;
}

export class FakeRemoteExecutor implements CommandExecutor {
  readonly faults: SeededFaults;
  private readonly inner: CommandExecutor;
  private readonly maxAttempts: number;
  private calls = 0;
  // The server: the response text of a command by invocation key, kept from the first run until the client has received it.
  private readonly server = new Map<string, Promise<string>>();

  constructor(inner: CommandExecutor, faults: SeededFaults, options: FakeRemoteExecutorOptions = {}) {
    this.inner = inner;
    this.faults = faults;
    this.maxAttempts = options.maxAttempts ?? EXECUTOR_MAX_ATTEMPTS;
  }

  // The inner adapter's own facts (enforcement, cancel, process-group-kill) are what a worker would report; the fake is remote and says how it was seeded.
  get descriptor(): CapabilityDescriptor {
    const inner = this.inner.descriptor;
    return {
      ...inner,
      adapter: 'fake-remote-executor',
      capabilities: { ...inner.capabilities, remote: true },
      attributes: { ...(inner.attributes ?? {}), transport: 'json', seed: String(this.faults.seed) },
    };
  }

  async run(cmd: CommandSpec, signal?: AbortSignal): Promise<Result<CommandResult>> {
    // The request crosses the wire as text. A spec that cannot be serialized is invalid, not run.
    let wire: string;
    try {
      wire = JSON.stringify(cmd);
    } catch (error) {
      return err({ kind: 'invalid', field: 'cmd', reason: `cannot be serialized: ${error instanceof Error ? error.message : String(error)}` });
    }
    const key = invocationKey(cmd, wire);
    const call = callId((this.calls += 1));
    const started = Date.now();
    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        await sleep(this.faults.latencyMs());
        const response = await this.serve(key, call, wire, signal);
        await sleep(this.faults.latencyMs());
        if (this.faults.drop()) {
          // The response never arrives. The client cannot tell a lost request from a lost response, so it asks again by key.
          this.faults.record({ port: 'executor', kind: 'drop', key, call });
          continue;
        }
        if (this.faults.duplicate()) {
          // The same response arrives twice; the second copy is for a key the client has already settled, so it is discarded.
          this.faults.record({ port: 'executor', kind: 'duplicate', key, call });
        }
        this.server.delete(key);
        return JSON.parse(response) as Result<CommandResult>;
      }
    } catch (error) {
      this.server.delete(key);
      return err({ kind: 'internal', cause: `fake remote executor: ${error instanceof Error ? error.message : String(error)}` });
    }
    // Every attempt lost its response. The command ran (the server holds its answer), but this client never learned how it ended.
    return err({ kind: 'timeout', afterMs: Date.now() - started, sideEffect: 'unknown' });
  }

  // The server side of one call: the first request for a key runs the command; any later request for the key gets the stored answer.
  private serve(key: string, call: string, wire: string, signal: AbortSignal | undefined): Promise<string> {
    const known = this.server.get(key);
    if (known !== undefined) return known;
    const answer = (async (): Promise<string> => {
      this.faults.record({ port: 'executor', kind: 'inner-call', key, call });
      const result = await this.inner.run(JSON.parse(wire) as CommandSpec, signal);
      return JSON.stringify(result);
    })();
    this.server.set(key, answer);
    return answer;
  }
}
