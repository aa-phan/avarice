// What a workflow step needs from the adapters, checked before the step starts (FR-16; docs/contracts-and-state.md "Capability
// descriptors"). Pure: the table and the check know descriptors only as the two facts they read, the port and the capabilities map.
import { err, ok } from './result.ts';
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

// The reduced mode of a step that stops because no adapter offers what it needs; each is what the owner does instead.
const NO_CONTAINED_HOST = 'none; no unit runs without a contained agent host';
const NO_SANDBOXED_CHECKS = 'none; checks run only in the OS sandbox with cancellation';
const NO_MAP_WORKFLOW = 'none; onboarding stops until an admitted gsd-core offers the map workflow';
const FULL_MAP_IN_STAGING = 'full map in staging';
// Planning initialization through GSD's ingest-docs is not driven by AVARICE; the owner runs the attended command and AVARICE records the result.
export const PLANNING_INIT_REDUCED_MODE = 'initialize planning attended with /gsd-new-project; AVARICE records the result';

// The capability keys are the ones the production adapters publish in their descriptors (agent-host: `contained-invocation`, `headless`,
// `resume`; executor: `remote`, `cancel`, `process-group-kill`; graph-tool: `extract-code`, `cluster`, `knowledge-pass`; gsd-onboarding:
// `init-onboard`, `map-full`, `map-fast`, `map-paths`, `stamp`, `verify-drift`, `ingest-docs`). A port without a descriptor today
// (ArtifactStore, StagingWorkspace, RunSource, RunWorkspace, EgressProxy) has no row until it gets one. Declared order is the order a
// refusal names a missing capability in. `adopt-map` is the name the mapping-mode decision already uses; no adapter declares it.
export const STEP_REQUIREMENTS: Readonly<Record<StepName, readonly StepRequirement[]>> = {
  'run.unit': [{ port: 'agent-host', capability: 'contained-invocation', reducedMode: NO_CONTAINED_HOST }],
  'run.check': [
    { port: 'executor', capability: 'cancel', reducedMode: NO_SANDBOXED_CHECKS },
    { port: 'executor', capability: 'process-group-kill', reducedMode: NO_SANDBOXED_CHECKS },
  ],
  'onboarding.map.skip': [],
  'onboarding.map.adopt': [{ port: 'gsd-onboarding', capability: 'adopt-map', reducedMode: FULL_MAP_IN_STAGING }],
  'onboarding.map.fast': [{ port: 'gsd-onboarding', capability: 'map-fast', reducedMode: NO_MAP_WORKFLOW }],
  'onboarding.map.full': [{ port: 'gsd-onboarding', capability: 'map-full', reducedMode: NO_MAP_WORKFLOW }],
  'onboarding.map.paths': [{ port: 'gsd-onboarding', capability: 'map-paths', reducedMode: FULL_MAP_IN_STAGING }],
  'onboarding.index.graph': [
    { port: 'graph-tool', capability: 'extract-code', reducedMode: 'index recorded absent' },
    { port: 'graph-tool', capability: 'cluster', reducedMode: 'index recorded absent' },
  ],
  'onboarding.planning.init': [
    { port: 'gsd-onboarding', capability: 'ingest-docs', reducedMode: PLANNING_INIT_REDUCED_MODE },
  ],
};

// A requirement is met when a descriptor of its port declares the capability `true`; `false` and absent are the same answer. A step
// with no requirements is never refused. The first requirement in declared order that is not met is the refusal; nothing is simulated.
export function checkRequirements(step: StepName, descriptors: readonly DescriptorFacts[]): Result<void> {
  for (const requirement of STEP_REQUIREMENTS[step]) {
    const met = descriptors.some((d) => d.port === requirement.port && d.capabilities[requirement.capability] === true);
    if (!met) {
      return err({ kind: 'unsupported', capability: `${requirement.port}.${requirement.capability}`, reducedMode: requirement.reducedMode });
    }
  }
  return ok(undefined);
}

// Extensions are `<provider>.<feature>`, for example `github.draftPr`; they never widen the core capabilities map.
const NAMESPACED_EXTENSION = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9.]*$/;

export function isNamespacedExtension(name: string): boolean {
  return NAMESPACED_EXTENSION.test(name);
}
