// ArtifactStore port (docs/contracts-and-state.md "ArtifactStore"). Identity is the SHA-256 of the
// content; metadata (kind, run, retention) lives in the ledger, not in the store. A partial write never
// appears under its digest, and put of existing content is a no-op returning the same digest.
import type { Result } from '../domain/result.ts';

export interface ArtifactMeta {
  kind: string;
  runId?: string;
}

export interface ArtifactStore {
  // Digest has the form `sha256:` followed by 64 lowercase hex characters.
  put(bytes: Uint8Array, meta: ArtifactMeta): Result<{ digest: string; size: number }>;
  // not_found when absent; internal when the stored bytes no longer match the digest.
  get(digest: string): Result<Uint8Array>;
  has(digest: string): Result<boolean>;
}
