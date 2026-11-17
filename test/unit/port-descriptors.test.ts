// Plan 04-32 (FR-16, NFR-4): every adapter port declares a capability descriptor, every production adapter implements it, composition records
// the descriptor of every adapter it composes, and the artifact store is selected by configuration (the `artifacts` override) without
// leaving the redaction layer. The structural check reads the port files, so a new port that forgets its descriptor fails here.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { RedactingArtifactStore } from '../../src/adapters/fs/redacting-artifact-store.ts';
import { CloneStagingWorkspace } from '../../src/adapters/git/staging-clone.ts';
import { WorktreeStagingWorkspace } from '../../src/adapters/git/staging-worktree.ts';
import { CloneRunWorkspace } from '../../src/adapters/git/run-workspace.ts';
import type { CapabilityDescriptor } from '../../src/ports/capability.ts';
import { err, ok } from '../../src/domain/result.ts';
import { Redactor } from '../../src/domain/redactor.ts';
import type { Result } from '../../src/domain/result.ts';
import type { ArtifactMeta, ArtifactStore } from '../../src/ports/artifact-store.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import { profileEnv } from '../helpers/run-fixtures.ts';

const PORTS_DIR = join(import.meta.dirname, '../../src/ports');

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// Port files that are not adapter ports: the capability descriptor type itself, the ledger (the store every adapter's descriptor is recorded in),
// and the diagnostics probe (read-only facts about the machine, one implementation, never selected by configuration).
const NOT_ADAPTER_PORTS = new Set(['capability.ts', 'ledger.ts', 'diagnostics.ts']);

function adapterRows(dataRoot: string): Array<{ name: string; port: string; adapter: string; descriptor_json: string }> {
  const db = new DatabaseSync(join(dataRoot, 'state.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT name, port, adapter, descriptor_json FROM adapter_configs ORDER BY name').all() as Array<Record<string, unknown>>).map((r) => ({ ...r })) as Array<{
      name: string;
      port: string;
      adapter: string;
      descriptor_json: string;
    }>;
  } finally {
    db.close();
  }
}

describe('the artifact store descriptor (FR-16)', () => {
  it('LocalArtifactStore declares the local-fs adapter with put, get, has and contentAddressed, usable offline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-descr-'));
    cleanup.push(dir);
    const store = new LocalArtifactStore(dir);
    assert.ok((store as { descriptor?: unknown }).descriptor !== undefined, 'the store declares a descriptor');
    assert.equal(store.descriptor.port, 'artifact-store');
    assert.equal(store.descriptor.adapter, 'local-fs');
    assert.deepEqual(store.descriptor.capabilities, { put: true, get: true, has: true, contentAddressed: true });
    assert.equal(store.descriptor.offline, true);
  });

  it('RedactingArtifactStore forwards the inner descriptor and marks it redacted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'avarice-descr-'));
    cleanup.push(dir);
    const inner = new LocalArtifactStore(dir);
    const wrapped = new RedactingArtifactStore(inner, new Redactor());
    assert.equal(wrapped.descriptor.port, inner.descriptor.port);
    assert.equal(wrapped.descriptor.adapter, inner.descriptor.adapter);
    assert.deepEqual(wrapped.descriptor.capabilities, inner.descriptor.capabilities);
    assert.equal(wrapped.descriptor.attributes?.['redacted'], 'true');
    assert.equal(inner.descriptor.attributes?.['redacted'], undefined, 'the inner store is not marked');
  });
});

describe('composition records the artifact store (FR-16)', () => {
  it('a non-read-only composition records an adapter_configs row named artifacts with the redacted local-fs descriptor', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const composed = createDeps(profileEnv(roots));
    assert.ok(composed.ok, 'composition');
    composed.value.close();
    const row = adapterRows(roots.AVARICE_DATA_ROOT).find((r) => r.name === 'artifacts');
    assert.ok(row, 'an artifacts row exists');
    assert.equal(row.port, 'artifact-store');
    assert.equal(row.adapter, 'local-fs');
    const descriptor = JSON.parse(row.descriptor_json) as { attributes?: Record<string, string> };
    assert.equal(descriptor.attributes?.['redacted'], 'true');
  });

  it('a read-only composition records nothing', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const first = createDeps(profileEnv(roots));
    assert.ok(first.ok);
    first.value.close();
    const before = adapterRows(roots.AVARICE_DATA_ROOT).length;
    const second = createDeps(profileEnv(roots), {}, { readOnly: true });
    assert.ok(second.ok);
    second.value.close();
    assert.equal(adapterRows(roots.AVARICE_DATA_ROOT).length, before);
  });
});

// A store that keeps what it is given in memory, to see what reaches it.
class MemoryArtifactStore implements ArtifactStore {
  readonly descriptor = { port: 'artifact-store', adapter: 'memory', version: '1', capabilities: { put: true, get: true, has: true, contentAddressed: true }, offline: true };
  readonly puts: Array<{ bytes: Uint8Array; meta: ArtifactMeta }> = [];
  put(bytes: Uint8Array, meta: ArtifactMeta): Result<{ digest: string; size: number }> {
    this.puts.push({ bytes, meta });
    return ok({ digest: `sha256:${'0'.repeat(64)}`, size: bytes.length });
  }
  get(digest: string): Result<Uint8Array> {
    return err({ kind: 'not_found', ref: digest });
  }
  has(): Result<boolean> {
    return ok(false);
  }
}

describe('the artifacts override (NFR-4, T-04-88)', () => {
  it('createDeps uses the overriding store, wrapped in the redaction layer, and records its descriptor', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const memory = new MemoryArtifactStore();
    const composed = createDeps(profileEnv(roots), { artifacts: memory });
    assert.ok(composed.ok, 'composition');
    try {
      const { artifacts } = composed.value.deps;
      assert.ok(artifacts instanceof RedactingArtifactStore, 'an overriding store is wrapped like the local one');
      const text = 'manifest AKIAIOSFODNN7EXAMPLE\n';
      const put = artifacts.put(new TextEncoder().encode(text), { kind: 'knowledge-manifest' });
      assert.ok(put.ok);
      assert.equal(memory.puts.length, 1, 'the put reached the overriding store');
      const stored = new TextDecoder().decode((memory.puts[0] as { bytes: Uint8Array }).bytes);
      assert.doesNotMatch(stored, /AKIAIOSFODNN7EXAMPLE/, 'the overriding store never sees the secret');
      assert.equal(artifacts.descriptor.adapter, 'memory');
    } finally {
      composed.value.close();
    }
    const row = adapterRows(roots.AVARICE_DATA_ROOT).find((r) => r.name === 'artifacts');
    assert.equal(row?.adapter, 'memory');
  });
});

// A capability key is either a method the adapter has or one of the named extras the port documents (a rule or an identity, not a call).
function undeclaredMethods(adapter: { descriptor: CapabilityDescriptor }, extras: readonly string[]): string[] {
  return Object.keys(adapter.descriptor.capabilities).filter((key) => !extras.includes(key) && typeof (adapter as unknown as Record<string, unknown>)[key] !== 'function');
}

describe('the staging and run workspace descriptors (FR-16)', () => {
  it('both staging adapters declare the staging-workspace port under their strategy name, every capability a method, and are offline', () => {
    for (const [adapter, name] of [[new CloneStagingWorkspace(), 'clone'], [new WorktreeStagingWorkspace(), 'worktree']] as const) {
      assert.equal(adapter.descriptor.port, 'staging-workspace');
      assert.equal(adapter.descriptor.adapter, name);
      assert.equal(adapter.descriptor.attributes?.['strategy'], name);
      assert.equal(adapter.descriptor.offline, true);
      assert.equal(adapter.descriptor.capabilities['prepare'], true);
      assert.equal(adapter.descriptor.capabilities['commitPromotion'], true);
      assert.deepEqual(undeclaredMethods(adapter, []), [], `${name}: every capability names a method`);
    }
  });

  it('CloneRunWorkspace declares the run-workspace port with the handoff capability and every method', () => {
    const workspace = new CloneRunWorkspace();
    assert.equal(workspace.descriptor.port, 'run-workspace');
    assert.equal(workspace.descriptor.adapter, 'clone');
    assert.equal(workspace.descriptor.offline, true);
    assert.equal(workspace.descriptor.capabilities['handoff'], true);
    assert.equal(workspace.descriptor.capabilities['fetchIntoSource'], true);
    assert.deepEqual(undeclaredMethods(workspace, ['handoff']), []);
  });
});

// ---- structural: every adapter port file declares a descriptor ---------------------------------------------

// Ports whose descriptor lands in a later task of the plan; the structural cases for them are todo until then.
const PENDING = new Set(['run-source.ts', 'egress-proxy.ts']);

describe('every adapter port declares a capability descriptor (FR-16)', () => {
  const files = readdirSync(PORTS_DIR).filter((name) => name.endsWith('.ts'));

  it('the exempt list names only files that exist', () => {
    for (const name of NOT_ADAPTER_PORTS) assert.ok(files.includes(name), `${name} exists in src/ports`);
  });

  for (const file of files.filter((name) => !NOT_ADAPTER_PORTS.has(name))) {
    it(`${file} declares readonly descriptor: CapabilityDescriptor`, { todo: PENDING.has(file) ? 'declared by a later task of plan 04-32' : false }, () => {
      const text = readFileSync(join(PORTS_DIR, file), 'utf8');
      assert.match(text, /readonly descriptor: CapabilityDescriptor;/, `${file} must declare the descriptor`);
    });
  }
});
