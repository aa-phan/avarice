// FakeRemoteArtifactStore (plan 04-33; NFR-4, AC-7): an ArtifactStore that behaves like a content-addressed store reached over a lossy network, in this
// process. Every request and every response is serialized through JSON text (the bytes as base64), each call takes a seeded latency, 5% of responses
// are dropped and 2% are delivered twice. The blobs live in a LocalArtifactStore under a directory of their own: the "remote" holds them, the profile's
// data root does not.
//
// The port is synchronous (the ledger writes an artifact inside a transaction), so the latency is a blocking wait (Atomics.wait) and a dropped response
// is retried in a loop. The retry is safe because the store is content-addressed: a put of bytes the remote already holds is a no-op that returns the
// same digest, so the retry of a dropped put is absorbed by the remote and never writes a second blob. A duplicated response is discarded.
// After MAX_ATTEMPTS dropped responses in a row the call is `unavailable`. Importing the module runs nothing.
import { createHash } from 'node:crypto';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { err, ok } from '../../src/domain/result.ts';
import type { PortError, Result } from '../../src/domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../src/ports/artifact-store.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { SeededFaults, sleepSync } from './seeded-faults.ts';

export const STORE_MAX_ATTEMPTS = 3;

// The wire form of a response: a Result whose bytes are text.
type WireResult = { ok: true; value: unknown } | { ok: false; error: PortError };

export class FakeRemoteArtifactStore implements ArtifactStore {
  readonly faults: SeededFaults;
  private readonly remote: LocalArtifactStore;
  private readonly maxAttempts: number;

  // `remoteRoot` is the data root of the store that plays the remote (its blobs are under `<remoteRoot>/artifacts`).
  constructor(remoteRoot: string, faults: SeededFaults, options: { maxAttempts?: number } = {}) {
    this.remote = new LocalArtifactStore(remoteRoot);
    this.faults = faults;
    this.maxAttempts = options.maxAttempts ?? STORE_MAX_ATTEMPTS;
  }

  get descriptor(): CapabilityDescriptor {
    const inner = this.remote.descriptor;
    return { ...inner, adapter: 'fake-remote', capabilities: { ...inner.capabilities }, attributes: { transport: 'json', seed: String(this.faults.seed) }, offline: true };
  }

  put(bytes: Uint8Array, meta: ArtifactMeta): Result<{ digest: string; size: number }> {
    const request = JSON.stringify({ op: 'put', bytes: Buffer.from(bytes).toString('base64'), meta });
    return this.call('put', request, (wire) => {
      const body = JSON.parse(wire) as { bytes: string; meta: ArtifactMeta };
      return encode(this.remote.put(new Uint8Array(Buffer.from(body.bytes, 'base64')), body.meta));
    }, (value) => value as { digest: string; size: number }, digestOfRequest);
  }

  get(digest: string): Result<Uint8Array> {
    const request = JSON.stringify({ op: 'get', digest });
    return this.call('get', request, (wire) => {
      const result = this.remote.get((JSON.parse(wire) as { digest: string }).digest);
      return result.ok ? encode(ok({ bytes: Buffer.from(result.value).toString('base64') })) : encode(result);
    }, (value) => new Uint8Array(Buffer.from((value as { bytes: string }).bytes, 'base64')), () => digest);
  }

  has(digest: string): Result<boolean> {
    const request = JSON.stringify({ op: 'has', digest });
    return this.call('has', request, (wire) => encode(this.remote.has((JSON.parse(wire) as { digest: string }).digest)), (value) => value as boolean, () => digest);
  }

  // One round trip: serialize the request, let the remote answer it, take the latency, and retry while the response is lost.
  private call<T>(op: string, request: string, serve: (wire: string) => string, decode: (value: unknown) => T, keyOf: (wire: string) => string): Result<T> {
    const key = keyOf(request);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      sleepSync(this.faults.latencyMs());
      // The remote answers every request that reaches it; a retry of an idempotent request is answered the same way.
      const response = serve(request);
      sleepSync(this.faults.latencyMs());
      if (this.faults.drop()) {
        this.faults.record({ port: 'artifact-store', kind: 'drop', key });
        continue;
      }
      if (this.faults.duplicate()) this.faults.record({ port: 'artifact-store', kind: 'duplicate', key });
      const wire = JSON.parse(response) as WireResult;
      return wire.ok ? ok(decode(wire.value)) : err(wire.error);
    }
    return err({ kind: 'unavailable', cause: `fake remote artifact store: ${op} ${key}: the response was lost ${this.maxAttempts} times in a row` });
  }
}

function encode(result: Result<unknown>): string {
  return JSON.stringify(result);
}

// The digest a put request is about, for the event log: the SHA-256 of the bytes it carries.
function digestOfRequest(wire: string): string {
  const body = JSON.parse(wire) as { bytes: string };
  return `sha256:${createHash('sha256').update(Buffer.from(body.bytes, 'base64')).digest('hex')}`;
}
