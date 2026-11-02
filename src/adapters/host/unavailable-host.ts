// UnavailableAgentHost: placeholder until the implementation commit.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';

export class UnavailableAgentHost implements AgentHost {
  readonly descriptor: CapabilityDescriptor = {
    port: 'agent-host',
    adapter: 'unavailable',
    version: '0.0.0',
    capabilities: {},
    attributes: {},
    offline: true,
  };

  invoke(_req: InvocationRequest, _signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    return Promise.resolve(err({ kind: 'internal', cause: 'UnavailableAgentHost is not implemented yet' }));
  }
}
