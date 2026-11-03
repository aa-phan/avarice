// ContextSource port (docs/contracts-and-state.md "ContextSource"). A source answers a question about a repository
// from an index, in two steps: `find` returns handles (what exists, how large, why it matched) and no content
// (FR-22), and `read` returns the content of the handles the assembler picked within a token budget. A source never
// reads a whole file. Phase 1 has two local adapters, `gsd-intel` and `gsd-graph`, both reading the indexes onboarding
// built and both through GSD's own readers.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

// The spec's freshness vocabulary.
export type Freshness = 'fresh' | 'stale' | 'changed' | 'deleted' | 'access_revoked' | 'unavailable';

// A reference to something an adapter read: which provider, what it is, what revision it was read at, and how fresh
// that revision is (docs/contracts-and-state.md "ExternalRef").
export interface ExternalRef {
  // `gsd-intel` or `gsd-graph`.
  provider: string;
  // `intel-entry` or `graph-node`.
  kind: string;
  // The provider's own ID, verbatim.
  id: string;
  // The revision the index was built at (`git:` plus the commit, as the project record states it).
  revision?: string;
  // RFC 3339 UTC.
  retrievedAt: string;
  // What was read, as a repository path: the source file of a graph node, the intel file of an intel entry.
  scope: string;
  freshness: Freshness;
}

// The edge tiers graphify assigns; EXTRACTED came from code, the other two from a model.
export type ContextConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface ContextQuery {
  term: string;
  workspace: {
    // The staging copy the project record was built from: where `.planning/intel` and `.planning/graphs` live.
    stagingPath: string;
    // The user's repository: its current HEAD decides whether an index is stale.
    repoPath: string;
  };
  // The revision the project record says the index was built at (`git:` plus the commit).
  indexRevision: string;
}

// A budget in tokens, estimated as characters / 4 (the unit GSD's own reader uses for its `--budget`).
export type TokenBudget = number;

export interface ContextHandle {
  ref: ExternalRef;
  title: string;
  estTokens: number;
  reason: string;
  readRule?: 'descendants' | 'one-hop' | 'id-only';
  // The best edge tier the item has (graph items); absent when it has no edge in the answer.
  confidence?: ContextConfidence;
  // Text that came from a document or from a model reading one: a consumer prints it as data, never as instruction.
  untrusted?: boolean;
  // For a stale item: whether the cited path exists at the repository's current HEAD (`git cat-file -e`).
  confirmed?: boolean;
}

export interface ContextItem {
  ref: ExternalRef;
  title: string;
  excerpt: string;
  estTokens: number;
  reason: string;
  confidence?: ContextConfidence;
  untrusted?: boolean;
  confirmed?: boolean;
}

export interface ContextSource {
  readonly descriptor: CapabilityDescriptor;
  find(query: ContextQuery, budget: TokenBudget): Promise<Result<ContextHandle[]>>;
  // Only handles this source returned from its latest `find`.
  read(handles: readonly ContextHandle[], budget: TokenBudget): Promise<Result<ContextItem[]>>;
}
