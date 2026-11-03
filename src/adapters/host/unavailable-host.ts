// UnavailableAgentHost: the host composition keeps when the contained Claude Code adapter cannot be admitted (no
// admitted `claude`, no sandbox, no hook entry, no GSD preamble: plan 01-15). It reports enforcement `none` and
// refuses every invocation, so onboarding blocks with `enforcement_failure` instead of running an agent without
// containment (ONB-12, CON-3, T-01-64). The reason composition could not admit the real host is part of the
// descriptor, so adapter_configs says why this profile ran without one.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { AgentHost, InvocationOutcome, InvocationRequest } from '../../ports/agent-host.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';

const MAX_REASON_CHARS = 200;

export class UnavailableAgentHost implements AgentHost {
  readonly descriptor: CapabilityDescriptor;

  constructor(reason?: string) {
    this.descriptor = {
      port: 'agent-host',
      adapter: 'unavailable',
      version: '0.0.0',
      capabilities: { 'contained-invocation': false },
      attributes: { enforcement: 'none', ...(reason !== undefined && reason !== '' ? { reason: reason.slice(0, MAX_REASON_CHARS) } : {}) },
      offline: true,
    };
  }

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
