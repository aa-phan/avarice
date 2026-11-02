// UnavailableAgentHost: the production host until the contained Claude Code adapter (plan 01-15) is
// admitted. It reports enforcement `none` and refuses every invocation, so onboarding blocks with
// `enforcement_failure` instead of running an agent without containment (ONB-12, CON-3, T-01-64).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';

export class UnavailableAgentHost implements AgentHost {
  readonly descriptor: CapabilityDescriptor = {
    port: 'agent-host',
    adapter: 'unavailable',
    version: '0.0.0',
    capabilities: { 'contained-invocation': false },
    attributes: { enforcement: 'none' },
    offline: true,
  };

  invoke(_req: InvocationRequest, _signal: AbortSignal): Promise<Result<InvocationOutcome>> {
    return Promise.resolve(
      err({
        kind: 'unsupported',
        capability: 'contained-invocation',
        reducedMode: 'none until the Claude Code host adapter is admitted',
      }),
    );
  }
}
