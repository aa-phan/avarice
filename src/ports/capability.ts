// Capability descriptor (docs/contracts-and-state.md "Capability descriptors"). Each adapter publishes a
// static descriptor; the composition root checks it against what a workflow step requires before the
// step starts (src/domain/capability-requirements.ts, FR-16).
//
// Extensions (FR-17): an extension name is `<provider>.<feature>`, for example `github.draftPr`. It is never a key of `capabilities`, so
// an adapter's own feature can never widen the core map a step is checked against; `isNamespacedExtension` is the rule and
// test/unit/extensions-namespace.test.ts holds every production descriptor to it.
export interface CapabilityDescriptor {
  // Port name, for example 'agent-host' or 'artifact-store'.
  port: string;
  // Adapter name, for example 'claude-code' or 'unavailable'.
  adapter: string;
  // Adapter semver.
  version: string;
  capabilities: Record<string, boolean>;
  // Non-boolean facts, for example { enforcement: 'enforced' | 'restricted' | 'none' }.
  attributes?: Record<string, string>;
  // Namespaced extensions, for example 'github.draftPr'.
  extensions?: string[];
  // Usable with no network.
  offline: boolean;
}
