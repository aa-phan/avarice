// Plan 04-06 Task 1 (FR-16, T-04-14): a step names what it needs from the adapters, and a step whose requirement is not declared is
// refused `unsupported` with the reduced mode before it starts. A capability set to false is absent. Nothing is simulated.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STEP_REQUIREMENTS, checkRequirements } from '../../src/domain/capability-requirements.ts';
import type { DescriptorFacts, StepName } from '../../src/domain/capability-requirements.ts';
import { descriptorsOf, requireCapabilities } from '../../src/app/capabilities.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { GsdOnboardingAdapter } from '../../src/adapters/gsd/gsd-onboarding.ts';
import { UnavailableAgentHost } from '../../src/adapters/host/unavailable-host.ts';
import type { CommandExecutor } from '../../src/ports/command-executor.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import type { PortError } from '../../src/domain/result.ts';

const host = (capabilities: Record<string, boolean>): DescriptorFacts => ({ port: 'agent-host', capabilities });

function refusal(result: { ok: boolean; error?: PortError }): Extract<PortError, { kind: 'unsupported' }> {
  assert.equal(result.ok, false, 'the step is refused');
  const error = result.error as PortError;
  assert.equal(error.kind, 'unsupported');
  return error as Extract<PortError, { kind: 'unsupported' }>;
}

// The real GSD adapter: building it runs nothing, and its descriptor is the one composition publishes (`map-paths: false`).
function realGsd(): GsdOnboardingAdapter {
  const executor = { descriptor: { port: 'executor', adapter: 'stub', version: '0', capabilities: {}, offline: true } } as unknown as CommandExecutor;
  return new GsdOnboardingAdapter({ gsdCoreDir: '/nonexistent/gsd-core', version: '1.17.0', packageName: '@opengsd/gsd-core' }, { executor, dataRoot: '/nonexistent/data', home: '/nonexistent/home' });
}

const depsWith = (parts: Partial<AppDeps>): AppDeps => parts as unknown as AppDeps;

describe('tracer: a run step requiring a capability the host lacks is refused unsupported with its reduced mode (FR-16)', () => {
  it('run.unit on a host that does not declare contained-invocation names that capability and the documented reduced mode', () => {
    const refused = refusal(checkRequirements('run.unit', [host({ headless: true })]));
    assert.equal(refused.capability, 'agent-host.contained-invocation');
    const row = STEP_REQUIREMENTS['run.unit'][0];
    assert.ok(row !== undefined, 'run.unit has a requirement row');
    assert.equal(refused.reducedMode, row.reducedMode);
    assert.ok((refused.reducedMode ?? '').length > 0, 'the reduced mode is stated');
  });

  it('run.unit passes on a host that declares contained-invocation', () => {
    assert.equal(checkRequirements('run.unit', [host({ 'contained-invocation': true })]).ok, true);
  });

  it('a host composition that kept the refusing UnavailableAgentHost is refused through requireCapabilities, before any invocation', () => {
    const refused = refusal(requireCapabilities(depsWith({ host: new UnavailableAgentHost('no claude') }), 'run.unit'));
    assert.equal(refused.capability, 'agent-host.contained-invocation');
  });
});

describe('checkRequirements', () => {
  it('a capability present with value false is treated exactly as absent (adjacency)', () => {
    const asFalse = checkRequirements('run.unit', [host({ 'contained-invocation': false })]);
    const asAbsent = checkRequirements('run.unit', [host({})]);
    assert.deepEqual(asFalse, asAbsent);
    refusal(asFalse);
  });

  it('a step whose requirement list is empty is never unsupported, with no descriptor at all (empty)', () => {
    assert.deepEqual(STEP_REQUIREMENTS['onboarding.map.skip'], []);
    assert.equal(checkRequirements('onboarding.map.skip', []).ok, true);
  });

  it('a descriptor with an empty capabilities map fails every requirement it is asked for (empty)', () => {
    const steps = (Object.keys(STEP_REQUIREMENTS) as StepName[]).filter((s) => STEP_REQUIREMENTS[s].length > 0);
    assert.ok(steps.length >= 6, 'most steps have requirements');
    for (const step of steps) {
      const descriptors = STEP_REQUIREMENTS[step].map((r): DescriptorFacts => ({ port: r.port, capabilities: {} }));
      refusal(checkRequirements(step, descriptors));
    }
  });

  it('with several capabilities missing, the error names the first in the step declared order, not the map order (ordering)', () => {
    const declared = STEP_REQUIREMENTS['run.check'];
    assert.ok(declared.length >= 2, 'run.check names at least two capabilities');
    const first = declared[0];
    const last = declared[declared.length - 1];
    assert.ok(first !== undefined && last !== undefined);
    // Both are missing; the descriptor lists its keys in the opposite order.
    const executor: DescriptorFacts = { port: first.port, capabilities: { [last.capability]: false, [first.capability]: false } };
    assert.equal(refusal(checkRequirements('run.check', [executor])).capability, `${first.port}.${first.capability}`);
    // Only the later one is missing: it is named.
    const partial: DescriptorFacts = { port: first.port, capabilities: Object.fromEntries(declared.slice(0, -1).map((r) => [r.capability, true])) };
    assert.equal(refusal(checkRequirements('run.check', [partial])).capability, `${last.port}.${last.capability}`);
  });

  it('no descriptor for the required port is the same refusal as a missing capability', () => {
    assert.equal(refusal(checkRequirements('run.unit', [{ port: 'executor', capabilities: { 'contained-invocation': true } }])).capability, 'agent-host.contained-invocation');
  });

  it('every requirement names a port and capability the production adapters can publish (no invented keys)', () => {
    const published: Record<string, readonly string[]> = {
      'agent-host': ['contained-invocation', 'headless', 'resume'],
      executor: ['remote', 'cancel', 'process-group-kill'],
      'graph-tool': ['extract-code', 'cluster', 'knowledge-pass'],
      // `adopt-map` is the name the mapping-mode decision already uses for an adopted map; no adapter declares it today.
      'gsd-onboarding': ['init-onboard', 'map-full', 'map-fast', 'map-paths', 'stamp', 'verify-drift', 'ingest-docs', 'adopt-map'],
    };
    for (const [step, rows] of Object.entries(STEP_REQUIREMENTS)) {
      for (const row of rows) {
        assert.ok((published[row.port] ?? []).includes(row.capability), `${step}: ${row.port}.${row.capability}`);
        assert.ok(row.reducedMode.length > 0, `${step}: ${row.port}.${row.capability} has a reduced mode`);
      }
    }
  });
});

describe('requireCapabilities against the composed dependencies', () => {
  it('onboarding.map.paths on the real GSD descriptor (map-paths: false) names gsd-onboarding.map-paths and "full map in staging"', () => {
    const refused = refusal(requireCapabilities(depsWith({ gsd: realGsd() }), 'onboarding.map.paths'));
    assert.equal(refused.capability, 'gsd-onboarding.map-paths');
    assert.equal(refused.reducedMode, 'full map in staging');
  });

  it('onboarding.map.full and onboarding.map.fast pass on the real GSD descriptor', () => {
    const deps = depsWith({ gsd: realGsd() });
    assert.equal(requireCapabilities(deps, 'onboarding.map.full').ok, true);
    assert.equal(requireCapabilities(deps, 'onboarding.map.fast').ok, true);
  });

  it('onboarding.planning.init stays unsupported and names the manual equivalent, not a phase number', () => {
    const refused = refusal(requireCapabilities(depsWith({ gsd: realGsd() }), 'onboarding.planning.init'));
    assert.equal(refused.capability, 'gsd-onboarding.ingest-docs');
    assert.equal(refused.reducedMode, 'initialize planning attended with /gsd-new-project; AVARICE records the result');
  });

  it('onboarding.index.graph is refused when the graph tool does not declare extract-code, naming "index recorded absent"', () => {
    const graph = { descriptor: { port: 'graph-tool', adapter: 'g', version: '1', capabilities: { 'extract-code': false, cluster: true }, offline: true } };
    const refused = refusal(requireCapabilities(depsWith({ graph } as unknown as Partial<AppDeps>), 'onboarding.index.graph'));
    assert.equal(refused.capability, 'graph-tool.extract-code');
    assert.equal(refused.reducedMode, 'index recorded absent');
  });

  it('a step that needs an adapter composition did not supply is refused, never skipped', () => {
    refusal(requireCapabilities(depsWith({}), 'onboarding.map.full'));
  });

  it('descriptorsOf collects every present descriptor and ignores absent adapters', () => {
    const gsd = realGsd();
    const intel = { descriptor: { port: 'context-source', adapter: 'gsd-intel', version: '1', capabilities: {}, offline: true } };
    const notifier = { descriptor: { port: 'notifier', adapter: 'n', version: '1', capabilities: {}, offline: true } };
    const hostPort = new UnavailableAgentHost();
    const collected: CapabilityDescriptor[] = descriptorsOf(depsWith({ host: hostPort, gsd, context: { intel }, notify: { notifier } } as unknown as Partial<AppDeps>));
    assert.deepEqual(collected.map((d) => d.port).sort(), ['agent-host', 'context-source', 'gsd-onboarding', 'notifier']);
    assert.deepEqual(descriptorsOf(depsWith({})), []);
  });
});
