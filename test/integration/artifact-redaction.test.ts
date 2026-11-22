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

// The text between the parenthesis that opens at `open` and its closing parenthesis, skipping string and template literals.
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === '\\') i += 1;
    } else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`an unbalanced call at offset ${open}`);
}

// The top-level, comma-separated parts of an argument or parameter list.
function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i] as string;
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < list.length && list[i] !== ch; i += 1) if (list[i] === '\\') i += 1;
    } else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  const last = list.slice(from).trim();
  if (last !== '') parts.push(last);
  return parts;
}

// A kind written as a string literal, or as a constant defined as a string literal in the file or in another file of src.
function kindOf(expression: string, text: string, allText: string[]): string | undefined {
  const literal = /^'([^']+)'$/.exec(expression);
  if (literal !== null) return literal[1];
  if (!/^\w+$/.test(expression)) return undefined;
  const definition = new RegExp(`const ${expression}\\s*(?::\\s*string\\s*)?=\\s*'([^']+)'`);
  for (const source of [text, ...allText]) {
    const found = definition.exec(source);
    if (found !== null) return found[1];
  }
  return undefined;
}

interface PutCall {
  // The call's options argument as it is written.
  written: string;
  // The kinds the call can store, as far as the scan resolved them; empty when any of them was not resolved.
  kinds: string[];
}

// Every `artifacts.put(` call of a file, with the kinds it resolves. `{ kind: X }` names the kind in the call. The shorthand `{ kind, runId }` passes the parameter `kind`
// of the enclosing function, so its kinds are the arguments that the function's call sites in the file pass for that parameter.
function putCalls(text: string, allText: string[]): PutCall[] {
  const calls: PutCall[] = [];
  for (const match of text.matchAll(/\bartifacts\.put\(/g)) {
    const at = match.index ?? 0;
    const options = topLevelParts(balanced(text, at + match[0].length - 1))[1] ?? '';
    const named = /^\{\s*kind\s*:\s*(\w+|'[^']+')\s*[,}]/.exec(options);
    if (named !== null) {
      const kind = kindOf(named[1] as string, text, allText);
      calls.push({ written: options, kinds: kind === undefined ? [] : [kind] });
      continue;
    }
    const head = [...text.slice(0, at).matchAll(/\bfunction\s+(\w+)\s*\(/g)].pop();
    if (!/^\{\s*kind\s*[,}]/.test(options) || head === undefined) {
      calls.push({ written: options, kinds: [] });
      continue;
    }
    const name = head[1] as string;
    const headAt = head.index ?? 0;
    const params = topLevelParts(balanced(text, headAt + head[0].length - 1)).map((part) => part.split(':')[0]?.trim());
    const position = params.indexOf('kind');
    const kinds: string[] = [];
    for (const site of text.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
      const siteAt = site.index ?? 0;
      if (siteAt === headAt + head[0].indexOf(name)) continue;
      const argument = position < 0 ? undefined : topLevelParts(balanced(text, siteAt + site[0].length - 1))[position];
      const kind = argument === undefined ? undefined : kindOf(argument, text, allText);
      // One call site the scan cannot read leaves the whole call unresolved: the scan must not report a kind it did not read.
      if (kind === undefined) {
        kinds.length = 0;
        break;
      }
      kinds.push(kind);
    }
    calls.push({ written: options, kinds });
  }
  return calls;
}

// The artifact kind of every `artifacts.put(` call in src, and the calls the scan could not resolve. A file whose calls the scan read fewer of than the file holds is unresolved.
function storedKinds(): { kinds: Map<string, string[]>; unresolved: string[] } {
  const files = sourceFiles(join(REPO_ROOT, 'src'));
  const texts = files.map((file) => readFileSync(file, 'utf8'));
  const kinds = new Map<string, string[]>();
  const unresolved: string[] = [];
  files.forEach((file, index) => {
    const text = texts[index] as string;
    const name = file.slice(REPO_ROOT.length + 1);
    const calls = putCalls(text, texts);
    const held = [...text.matchAll(/\bartifacts\.put\(/g)].length;
    if (calls.length !== held) unresolved.push(`${name}: the scan resolved ${calls.length} of ${held} artifacts.put calls`);
    for (const call of calls) {
      if (call.kinds.length === 0) unresolved.push(`${name}: the kind of artifacts.put(..., ${call.written}) was not resolved`);
      for (const kind of call.kinds) kinds.set(kind, [...(kinds.get(kind) ?? []), name]);
    }
  });
  return { kinds, unresolved };
}

describe('the artifact kinds the code stores (source scan)', () => {
  it('resolves the kind of every artifacts.put call in src, the shorthand { kind, runId } calls included', () => {
    assert.deepEqual(storedKinds().unresolved, [], 'every call is read and its kind is a string literal, a constant, or the arguments of the helper that passes it');
  });

  it('every kind stored through artifacts.put is a map kind or is in REDACTED_TEXT_KINDS', () => {
    const { kinds } = storedKinds();
    // The kinds the code stores today: eight named in their calls and five passed through storeText and storeOutput. A scan that stops reading a call site fails here.
    const stored = [...MAP_KINDS, 'check-output', 'test-inventory', 'gsd-quick-record', 'knowledge-manifest', 'transcript', 'transcript-summary', 'manual-context', 'manual-evidence', 'restricted-plan', 'restricted-patch', 'restricted-decisions'];
    for (const kind of stored) assert.ok(kinds.has(kind), `the scan sees the kind ${kind} (it found ${[...kinds.keys()].join(', ')})`);
    assert.ok(kinds.size >= stored.length, `the scan found ${kinds.size} distinct kinds, the code stores at least ${stored.length}`);
    for (const [kind, files] of kinds) {
      assert.ok(MAP_KINDS.includes(kind) || REDACTED_TEXT_KINDS.includes(kind), `artifact kind ${kind} (${files.join(', ')}) is neither a map kind nor in REDACTED_TEXT_KINDS: decide whether it is redacted`);
    }
  });

  it('reads the kinds a shorthand call passes through its helper, and leaves a call unresolved when a call site cannot be read', () => {
    const helper = 'function store(deps, runId, kind, bytes) {\n  return deps.artifacts.put(bytes, { kind, runId });\n}\n';
    const read = putCalls(`${helper}store(deps, id, SHARED, b);\nstore(deps, id, 'other-kind', b);\nconst SHARED = 'shared-kind';\n`, []);
    assert.deepEqual(read.map((call) => call.kinds), [['shared-kind', 'other-kind']]);
    const blind = putCalls(`${helper}store(deps, id, computed(), b);\n`, []);
    assert.deepEqual(blind.map((call) => call.kinds), [[]]);
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
