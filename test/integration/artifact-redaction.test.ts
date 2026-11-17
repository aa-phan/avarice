// SEC-3 / D-14 (plan 04-18, T-04-49): every text artifact kind except the map documents and the map snapshots is redacted before it is
// stored, and the stored digest is of the redacted bytes. A source scan lists the kinds the code stores, so a new kind cannot be added
// without deciding whether it is redacted.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalArtifactStore } from '../../src/adapters/fs/artifact-store.ts';
import { REDACTED_TEXT_KINDS, RedactingArtifactStore } from '../../src/adapters/fs/redacting-artifact-store.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import { Redactor } from '../../src/domain/redactor.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { REPO_ROOT, makeRoots } from '../helpers/run-cli.ts';

// Built from parts so this file holds no complete secret-shaped literal.
const AWS_KEY = `AKIA${'IOSFODNN7EXAMPLE'}`;
const MAP_KINDS = ['map-document', 'map-snapshot'];

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function store(): { redacting: RedactingArtifactStore; inner: LocalArtifactStore } {
  const dataRoot = mkdtempSync(join(tmpdir(), 'avarice-redacting-store-'));
  cleanup.push(dataRoot);
  const inner = new LocalArtifactStore(dataRoot);
  return { redacting: new RedactingArtifactStore(inner, new Redactor()), inner };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function must<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  assert.ok(result.ok, JSON.stringify(result.ok ? null : result.error));
  return result.value;
}

describe('tracer: the redacting artifact store redacts a text artifact before it is stored (SEC-3, T-04-49)', () => {
  it('stores a context pack with an AWS key ID as [REDACTED:aws-key], returns the digest of the stored bytes, and reads back the redacted bytes', () => {
    const { redacting, inner } = store();
    const text = `# pack\nthe key is ${AWS_KEY}\n`;
    const put = must(redacting.put(encode(text), { kind: 'context-pack', runId: 'run_1' }));
    const redacted = '# pack\nthe key is [REDACTED:aws-key]\n';
    assert.equal(put.digest, `sha256:${sha256Hex(redacted)}`, 'the digest is of the redacted bytes');
    assert.equal(put.size, Buffer.byteLength(redacted));
    assert.equal(decode(must(redacting.get(put.digest))), redacted);
    assert.equal(decode(must(inner.get(put.digest))), redacted, 'the inner store holds the redacted bytes');
    assert.equal(must(redacting.has(put.digest)), true);
    assert.equal(must(inner.has(`sha256:${sha256Hex(text)}`)), false, 'the unredacted bytes were never stored');
  });
});

describe('RedactingArtifactStore', () => {
  it('stores a map document and a map snapshot byte for byte', () => {
    const { redacting } = store();
    const text = `map text with ${AWS_KEY}\n`;
    for (const kind of MAP_KINDS) {
      const put = must(redacting.put(encode(text), { kind, runId: 'run_1' }));
      assert.equal(put.digest, `sha256:${sha256Hex(text)}`, kind);
      assert.equal(decode(must(redacting.get(put.digest))), text, kind);
    }
  });

  it('stores a non-UTF-8 payload of a text kind unchanged', () => {
    const { redacting } = store();
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, ...encode(AWS_KEY)]);
    const put = must(redacting.put(bytes, { kind: 'check-output', runId: 'run_1' }));
    assert.equal(put.digest, `sha256:${sha256Hex(bytes)}`);
    assert.deepEqual([...must(redacting.get(put.digest))], [...bytes]);
  });

  it('stores text with nothing to redact byte for byte, including a byte order mark', () => {
    const { redacting } = store();
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode('plain text\n')]);
    const put = must(redacting.put(bytes, { kind: 'check-output', runId: 'run_1' }));
    assert.equal(put.digest, `sha256:${sha256Hex(bytes)}`);
  });

  it('redacts every kind it lists, and leaves a kind it does not list as given', () => {
    const { redacting } = store();
    assert.ok(REDACTED_TEXT_KINDS.length > 0, 'the list is not empty');
    for (const kind of REDACTED_TEXT_KINDS) {
      const put = must(redacting.put(encode(`${kind}: ${AWS_KEY}`), { kind }));
      assert.equal(decode(must(redacting.get(put.digest))), `${kind}: [REDACTED:aws-key]`, kind);
    }
    const other = must(redacting.put(encode(`unlisted ${AWS_KEY}`), { kind: 'unlisted-kind' }));
    assert.equal(decode(must(redacting.get(other.digest))), `unlisted ${AWS_KEY}`);
  });

  it('lists the kinds the transcript, check, knowledge and quick-record writers use, and never a map kind', () => {
    for (const kind of ['transcript', 'transcript-summary', 'check-output', 'test-inventory', 'knowledge-manifest', 'gsd-quick-record', 'context-pack']) {
      assert.ok(REDACTED_TEXT_KINDS.includes(kind), kind);
    }
    for (const kind of MAP_KINDS) assert.ok(!REDACTED_TEXT_KINDS.includes(kind), kind);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

// The artifact kind of every `artifacts.put(` call in src: a string literal, or a constant named in the call and defined as a string
// literal in the same file.
function storedKinds(): Map<string, string[]> {
  const kinds = new Map<string, string[]>();
  for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/artifacts\.put\([\s\S]{0,400}?\{\s*kind:\s*(\w+|'[^']+')/g)) {
      const raw = match[1] as string;
      let kind: string | undefined;
      if (raw.startsWith("'")) kind = raw.slice(1, -1);
      else kind = new RegExp(`const ${raw}\\s*=\\s*'([^']+)'`).exec(text)?.[1];
      assert.ok(kind !== undefined, `${file}: the kind ${raw} is not a string literal or a constant of the file`);
      kinds.set(kind, [...(kinds.get(kind) ?? []), file.slice(REPO_ROOT.length + 1)]);
    }
  }
  return kinds;
}

describe('the artifact kinds the code stores (source scan)', () => {
  it('every kind stored through artifacts.put is a map kind or is in REDACTED_TEXT_KINDS', () => {
    const kinds = storedKinds();
    assert.ok(kinds.size >= 7, `the scan found the call sites (${[...kinds.keys()].join(', ')})`);
    for (const [kind, files] of kinds) {
      assert.ok(MAP_KINDS.includes(kind) || REDACTED_TEXT_KINDS.includes(kind), `artifact kind ${kind} (${files.join(', ')}) is neither a map kind nor in REDACTED_TEXT_KINDS: decide whether it is redacted`);
    }
    for (const kind of MAP_KINDS) assert.ok(kinds.has(kind), `the scan sees the map kind ${kind}`);
  });
});

describe('composition', () => {
  it('builds deps.artifacts as a RedactingArtifactStore that redacts a text kind before it is stored', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const composed = createDeps({
      ...process.env,
      AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
      AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
      AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
      AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
    });
    assert.ok(composed.ok, 'composition');
    try {
      const { artifacts } = composed.value.deps;
      assert.ok(artifacts instanceof RedactingArtifactStore, 'the composed store is the redacting store');
      const put = must(artifacts.put(encode(`manifest ${AWS_KEY}\n`), { kind: 'knowledge-manifest', runId: 'run_1' }));
      const hex = put.digest.replace('sha256:', '');
      const onDisk = readFileSync(join(roots.AVARICE_DATA_ROOT, 'artifacts', hex.slice(0, 2), hex), 'utf8');
      assert.equal(onDisk, 'manifest [REDACTED:aws-key]\n');
    } finally {
      composed.value.close();
    }
  });
});
