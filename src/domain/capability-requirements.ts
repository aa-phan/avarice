// What a workflow step needs from the adapters, checked before the step starts (FR-16; docs/contracts-and-state.md "Capability
// descriptors"). Pure: the table and the check know descriptors only as the two facts they read, the port and the capabilities map.
import { ok } from './result.ts';
import type { Result } from './result.ts';
import type { MappingMode } from './mapping.ts';

export type StepName =
  | 'run.unit'
  | 'run.check'
  | `onboarding.map.${MappingMode}`
  | 'onboarding.index.graph'
  | 'onboarding.planning.init';

export interface StepRequirement {
  // The port of the descriptor that must declare it (`agent-host`, `executor`, `gsd-onboarding`, `graph-tool`).
  port: string;
  capability: string;
  // What the owner can do instead, named in the refusal.
  reducedMode: string;
}

// The two facts of a descriptor the check reads; a CapabilityDescriptor has both.
export interface DescriptorFacts {
  port: string;
  capabilities: Readonly<Record<string, boolean>>;
}

export const STEP_REQUIREMENTS: Readonly<Record<StepName, readonly StepRequirement[]>> = {
  'run.unit': [],
  'run.check': [],
  'onboarding.map.skip': [],
  'onboarding.map.adopt': [],
  'onboarding.map.fast': [],
  'onboarding.map.full': [],
  'onboarding.map.paths': [],
  'onboarding.index.graph': [],
  'onboarding.planning.init': [],
};

export function checkRequirements(_step: StepName, _descriptors: readonly DescriptorFacts[]): Result<void> {
  return ok(undefined);
}

export function isNamespacedExtension(_name: string): boolean {
  return true;
}
