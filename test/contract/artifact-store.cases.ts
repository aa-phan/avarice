// The ArtifactStore contract (plan 04-33; NFR-4): the behaviours every adapter of the port must show, as one case list. test/contract/local.test.ts runs it
// against the LocalArtifactStore and test/contract/fake-remote.test.ts against the fake-remote store, so the two meet one contract. A Phase 7 adapter (the
// `s3` store) joins by adding a runner that passes its own factory to `runArtifactContract` (see test/contract/README.md).
//
// This module only defines cases and one registration function; importing it runs nothing (a bare `node --test` loads every file under test/).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactStore } from '../../src/ports/artifact-store.ts';

// What a case needs of the adapter under test beyond the port: how many blobs it holds, and a way to corrupt one in place. Both reach into the adapter's own
// storage (a directory, a bucket), which the port deliberately does not expose.
export interface StoreUnderTest {
  store: ArtifactStore;
  blobCount(): number;
  // Replaces the stored bytes of `digest` with other bytes of the same length, without going through the port.
  tamper(digest: string): void;
}

export interface ArtifactCase {
  name: string;
  run(subject: StoreUnderTest): void;
}

const sha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const META = { kind: 'contract-test' } as const;

export const ARTIFACT_CASES: readonly ArtifactCase[] = [
  {
    name: 'put returns the sha256 digest and the size of the bytes',
    run({ store }) {
      const bytes = bytesOf('hello artifact\n');
      const put = store.put(bytes, META);
      assert.ok(put.ok, JSON.stringify(put));
      assert.equal(put.value.digest, sha256(bytes));
      assert.match(put.value.digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(put.value.size, bytes.length);
    },
  },
  {
    name: 'put of the same bytes returns the same digest and stores no second blob',
    run({ store, blobCount }) {
      const bytes = bytesOf('stored once');
      const first = store.put(bytes, META);
      assert.ok(first.ok, JSON.stringify(first));
      assert.equal(blobCount(), 1);
      const second = store.put(new Uint8Array(bytes), { kind: 'another-kind', runId: 'run_x' });
      assert.ok(second.ok, JSON.stringify(second));
      assert.deepEqual(second.value, first.value);
      assert.equal(blobCount(), 1, 'a put of existing content is a no-op');
    },
  },
  {
    name: 'put stores empty content and distinct content under distinct digests',
    run({ store, blobCount }) {
      const empty = store.put(new Uint8Array(0), META);
      assert.ok(empty.ok, JSON.stringify(empty));
      assert.equal(empty.value.size, 0);
      assert.equal(empty.value.digest, sha256(new Uint8Array(0)));
      const other = store.put(bytesOf('x'), META);
      assert.ok(other.ok);
      assert.notEqual(other.value.digest, empty.value.digest);
      assert.equal(blobCount(), 2);
    },
  },
  {
    name: 'get returns exactly the bytes that were put, including bytes that are not text',
    run({ store }) {
      const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
      const put = store.put(bytes, META);
      assert.ok(put.ok);
      const got = store.get(put.value.digest);
      assert.ok(got.ok, JSON.stringify(got));
      assert.deepEqual(Array.from(got.value), Array.from(bytes));
    },
  },
  {
    name: 'get of a digest that was never put is not_found',
    run({ store }) {
      const missing = sha256(bytesOf('never stored'));
      const got = store.get(missing);
      assert.ok(!got.ok);
      assert.equal(got.error.kind, 'not_found');
    },
  },
  {
    name: 'get of a blob whose stored bytes no longer match its digest is internal, never the wrong bytes',
    run({ store, tamper }) {
      const put = store.put(bytesOf('original bytes'), META);
      assert.ok(put.ok);
      tamper(put.value.digest);
      const got = store.get(put.value.digest);
      assert.ok(!got.ok, 'the corrupt bytes were not returned');
      assert.equal(got.error.kind, 'internal');
    },
  },
  {
    name: 'put of content whose stored blob was corrupted repairs it',
    run({ store, tamper }) {
      const bytes = bytesOf('repair me please');
      const put = store.put(bytes, META);
      assert.ok(put.ok);
      tamper(put.value.digest);
      const again = store.put(bytes, META);
      assert.ok(again.ok, JSON.stringify(again));
      const got = store.get(put.value.digest);
      assert.ok(got.ok, JSON.stringify(got));
      assert.deepEqual(Array.from(got.value), Array.from(bytes));
    },
  },
  {
    name: 'has is true for a stored digest and false for one that is not',
    run({ store }) {
      const put = store.put(bytesOf('present'), META);
      assert.ok(put.ok);
      assert.deepEqual(store.has(put.value.digest), { ok: true, value: true });
      assert.deepEqual(store.has(sha256(bytesOf('absent'))), { ok: true, value: false });
    },
  },
  {
    name: 'a malformed digest is invalid for get and has',
    run({ store }) {
      for (const bad of ['', 'sha256:abc', `sha1:${'a'.repeat(40)}`, `sha256:${'A'.repeat(64)}`, '../../etc/passwd']) {
        const got = store.get(bad);
        assert.ok(!got.ok, JSON.stringify(bad));
        assert.equal(got.error.kind, 'invalid', JSON.stringify(bad));
        const has = store.has(bad);
        assert.ok(!has.ok, JSON.stringify(bad));
        assert.equal(has.error.kind, 'invalid', JSON.stringify(bad));
      }
    },
  },
  {
    name: 'publishes a descriptor for the artifact-store port that declares put, get and has and the content-addressed rule',
    run({ store }) {
      const descriptor = store.descriptor;
      assert.equal(descriptor.port, 'artifact-store');
      assert.notEqual(descriptor.adapter, '');
      for (const capability of ['put', 'get', 'has', 'contentAddressed']) assert.equal(descriptor.capabilities[capability], true, capability);
    },
  },
];

// The blob directory layout of the LocalArtifactStore (`<dataRoot>/artifacts/<2 hex>/<64 hex>`), shared by the runners whose adapter keeps its blobs there: the
// local store itself and the fake-remote store, whose "remote" is a local store under a root of its own.
export function directoryStore(store: ArtifactStore, dataRoot: string): StoreUnderTest {
  const blobs = (): string[] => {
    const found: string[] = [];
    const root = join(dataRoot, 'artifacts');
    if (!existsSync(root)) return found;
    for (const shard of readdirSync(root)) {
      for (const name of readdirSync(join(root, shard))) if (/^[0-9a-f]{64}$/.test(name)) found.push(join(root, shard, name));
    }
    return found;
  };
  return {
    store,
    blobCount: () => blobs().length,
    tamper(digest) {
      const file = blobs().find((path) => path.endsWith(digest.slice('sha256:'.length)));
      assert.ok(file !== undefined, `blob ${digest} is on disk`);
      const size = statSync(file).size;
      writeFileSync(file, Buffer.alloc(size, 0x58));
    },
  };
}

export interface ArtifactContractOptions {
  skip?: string | false;
}

// Registers every case against a store the factory makes. The factory is called once per case, so a case never inherits the blobs of another.
export function runArtifactContract(make: () => StoreUnderTest, options: ArtifactContractOptions = {}): void {
  for (const contract of ARTIFACT_CASES) {
    it(contract.name, { skip: options.skip ?? false }, () => {
      contract.run(make());
    });
  }
}
