// RedactingArtifactStore: an ArtifactStore that redacts text artifacts before they are stored (SEC-3, D-14, T-04-49). The bytes of a
// listed text kind are decoded as UTF-8, passed through the Redactor and re-encoded, and the inner store hashes what it is given, so
// the digest `put` returns is the digest of the redacted bytes. A map document or map snapshot is stored as given: validation already
// refuses a map with a secret hit, and rewriting accepted map bytes would change their recorded digests. A payload that is not valid
// UTF-8 is stored as given (redaction applies to text only). A kind that is not listed is stored as given; a test scans the code for the
// kinds it stores, so a new kind cannot be added without deciding which of the two it is.
import type { Redactor } from '../../domain/redactor.ts';
import type { Result } from '../../domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../ports/artifact-store.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';

// Every text kind the code stores, except `map-document` and `map-snapshot`. `context-pack`, `manual-context` and `manual-evidence` are
// the kinds the context-pack and manual-input writers store.
export const REDACTED_TEXT_KINDS: readonly string[] = [
  'transcript',
  'transcript-summary',
  'check-output',
  'test-inventory',
  'knowledge-manifest',
  'gsd-quick-record',
  'context-pack',
  'manual-context',
  'manual-evidence',
  // The outputs of a restricted run (plan 04-23): the plan, the patch and the question list a host without required enforcement wrote.
  'restricted-plan',
  'restricted-patch',
  'restricted-decisions',
];

const REDACTED = new Set(REDACTED_TEXT_KINDS);
// ignoreBOM keeps a leading byte order mark in the text, so re-encoding an unchanged text gives back the same bytes.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

export class RedactingArtifactStore implements ArtifactStore {
  // The inner store's descriptor, marked redacted: what is recorded is the store a caller actually gets, text kinds redacted before they are stored.
  readonly descriptor: CapabilityDescriptor;
  readonly #inner: ArtifactStore;
  readonly #redactor: Redactor;

  constructor(inner: ArtifactStore, redactor: Redactor) {
    this.#inner = inner;
    this.#redactor = redactor;
    this.descriptor = { ...inner.descriptor, attributes: { ...inner.descriptor.attributes, redacted: 'true' } };
  }

  put(bytes: Uint8Array, meta: ArtifactMeta): Result<{ digest: string; size: number }> {
    if (!REDACTED.has(meta.kind)) return this.#inner.put(bytes, meta);
    let text: string;
    try {
      text = strictUtf8.decode(bytes);
    } catch {
      return this.#inner.put(bytes, meta);
    }
    const redacted = this.#redactor.redact(text);
    return this.#inner.put(redacted === text ? bytes : encoder.encode(redacted), meta);
  }

  get(digest: string): Result<Uint8Array> {
    return this.#inner.get(digest);
  }

  has(digest: string): Result<boolean> {
    return this.#inner.has(digest);
  }
}
