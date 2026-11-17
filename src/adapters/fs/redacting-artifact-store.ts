// RedactingArtifactStore: an ArtifactStore that redacts text artifacts before they are stored (SEC-3, D-14, T-04-49).
// Skeleton: stores bytes as given until the redaction lands.
import type { Redactor } from '../../domain/redactor.ts';
import type { Result } from '../../domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../ports/artifact-store.ts';

export const REDACTED_TEXT_KINDS: readonly string[] = [];

export class RedactingArtifactStore implements ArtifactStore {
  readonly #inner: ArtifactStore;

  constructor(inner: ArtifactStore, _redactor: Redactor) {
    this.#inner = inner;
  }

  put(bytes: Uint8Array, meta: ArtifactMeta): Result<{ digest: string; size: number }> {
    return this.#inner.put(bytes, meta);
  }

  get(digest: string): Result<Uint8Array> {
    return this.#inner.get(digest);
  }

  has(digest: string): Result<boolean> {
    return this.#inner.has(digest);
  }
}
