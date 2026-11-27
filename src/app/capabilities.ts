// The composition-time capability check (FR-16): every descriptor the composed dependencies publish, and the refusal a step gets
// when what it requires is not declared by one of them.
import { checkRequirements } from '../domain/capability-requirements.ts';
import type { StepName } from '../domain/capability-requirements.ts';
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from '../ports/capability.ts';
import type { AppDeps } from './deps.ts';

// Every descriptor present in the dependencies; an adapter composition did not supply publishes none.
export function descriptorsOf(deps: AppDeps): CapabilityDescriptor[] {
  const candidates: Array<{ descriptor: CapabilityDescriptor } | undefined> = [
    deps.host,
    deps.executor,
    deps.graph,
    deps.gsd,
    deps.context?.intel,
    deps.context?.graph,
    deps.context?.planning,
    deps.context?.gitFiles,
    deps.notify?.notifier,
    deps.artifacts,
    deps.staging,
    deps.runSource,
    deps.runWorkspace,
    deps.egress,
  ];
  // A hand-built AppDeps of a test may carry a partial adapter with no descriptor; it publishes none.
  return candidates.flatMap((adapter) => (adapter === undefined || adapter.descriptor === undefined ? [] : [adapter.descriptor]));
}

// `unsupported` naming the first missing capability and its reduced mode, or ok. The caller stops the step on an error; the step never starts.
export function requireCapabilities(deps: AppDeps, step: StepName): Result<void> {
  return checkRequirements(step, descriptorsOf(deps));
}
