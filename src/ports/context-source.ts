// ContextSource port (docs/contracts-and-state.md "ContextSource"). A source answers a question about a repository
// from an index, in two steps: `find` returns handles (what exists, how large, why it matched) and no content
// (FR-22), and `read` returns the content of the handles the assembler picked within a token budget. A source never
// reads a whole file. The four local adapters are `gsd-intel` and `gsd-graph` (the indexes onboarding built, through GSD's
// own readers), `gsd-planning` (sections of the planning files, read-only from the staging copy) and `git-files` (a scoped
// search of tracked files, then bounded snippets).
import type { ContextReadScope } from '../domain/context-adapters.ts';
import type { ReadRule } from '../domain/retrieval-rules.ts';
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

// The spec's freshness vocabulary.
export type Freshness = 'fresh' | 'stale' | 'changed' | 'deleted' | 'access_revoked' | 'unavailable';

// A reference to something an adapter read: which provider, what it is, what revision it was read at, and how fresh
// that revision is (docs/contracts-and-state.md "ExternalRef").
export interface ExternalRef {
  // `gsd-intel`, `gsd-graph`, `gsd-planning` or `git-files`.
  provider: string;
  // `intel-entry`, `graph-node`, `section` or `snippet`.
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
    // The run's clone, when the question is asked for a run: `git-files` searches there instead of the repository.
    worktreePath?: string;
  };
  // Where a search may return hits from; absent means the default scope (everything tracked except secrets and `.git`). Only `git-files` reads it.
  readScope?: ContextReadScope;
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
  // How far a read of this handle expands along its edges (docs/contracts-and-state.md "ContextSource").
  readRule?: ReadRule;
  // The best edge tier the item has (graph items); absent when it has no edge in the answer.
  confidence?: ContextConfidence;
  // Text that came from a document or from a model reading one: a consumer prints it as data, never as instruction.
  untrusted?: boolean;
  // For a stale item: whether the cited path exists at the repository's current HEAD (`git cat-file -e`).
  confirmed?: boolean;
  // The repository path the item cites, when it cites one: what the assembler confirms with `git-files` when the item is stale.
  citedPath?: string;
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
  citedPath?: string;
}

// What a refresh is told about the project it is judged against: the same two paths and the same index revision a `find` is given, without a term.
export type ContextRefreshQuery = Omit<ContextQuery, 'term'>;

export interface ContextSource {
  readonly descriptor: CapabilityDescriptor;
  find(query: ContextQuery, budget: TokenBudget): Promise<Result<ContextHandle[]>>;
  // Only handles this source returned from its latest `find`.
  read(handles: readonly ContextHandle[], budget: TokenBudget): Promise<Result<ContextItem[]>>;
  // Judges a reference recorded earlier against the index and the repository as they are now (docs/contracts-and-state.md "Reference freshness"), and returns
  // it with its new `freshness` and `retrievedAt`. `revision` is the revision the source is at now: the caller decides whether to keep the revision it recorded
  // (a changed or deleted reference keeps the one the pack was built from). `changed`: the index was rebuilt since the reference was recorded. `deleted`: the
  // path the reference cites is gone at the repository's HEAD. `stale`: HEAD moved past the index. `unavailable`: HEAD or the index diff cannot be read.
  // Reads no file and writes nothing; an error is returned only when the question cannot be asked at all.
  refresh(ref: ExternalRef, query: ContextRefreshQuery): Promise<Result<ExternalRef>>;
}

// `git-files` also answers whether a path exists at the current revision of the tree it searches: the assembler asks it to confirm each path a stale index
// item cites (docs/contracts-and-state.md "ContextSource"). `undefined` when it cannot be told.
export interface GitFilesSource extends ContextSource {
  pathExists(workspace: ContextQuery['workspace'], path: string): boolean | undefined;
}
