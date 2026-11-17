// The shared contract suite against the fake-remote adapters (plan 04-33; NFR-4), three seeds each, and what only a fake can show: the faults themselves.
// The case lists are the ones test/contract/local.test.ts runs against the local adapters. A failure reproduces from the seed in its describe name.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { ok } from '../../src/domain/result.ts';
import type { Result } from '../../src/domain/result.ts';
import type { CommandExecutor, CommandResult, CommandSpec } from '../../src/ports/command-executor.ts';
import { FakeRemoteArtifactStore } from '../helpers/fake-remote-artifact-store.ts';
import { FakeRemoteExecutor } from '../helpers/fake-remote-executor.ts';
import { SeededFaults, mulberry32 } from '../helpers/seeded-faults.ts';
import { makeScratchStaging, spec } from '../helpers/sandbox.ts';
import { directoryStore, runArtifactContract } from './artifact-store.cases.ts';
import { removeAll, runExecutorContract } from './command-executor.cases.ts';

const SEEDS = [42, 7, 1337] as const;
const SANDBOX = existsSync('/usr/bin/sandbox-exec');
const cleanup: string[] = [];
after(() => removeAll(cleanup));

for (const seed of SEEDS) {
  describe(`CommandExecutor contract: FakeRemoteExecutor (seed ${seed})`, () => {
    runExecutorContract(() => new FakeRemoteExecutor(new SandboxedExecutor(), new SeededFaults(seed)), cleanup, { skip: SANDBOX ? false : 'the sandbox is macOS-only' });
  });

  describe(`ArtifactStore contract: FakeRemoteArtifactStore (seed ${seed})`, () => {
    runArtifactContract(() => {
      const remoteRoot = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-contract-remote-')));
      cleanup.push(remoteRoot);
      return directoryStore(new FakeRemoteArtifactStore(remoteRoot, new SeededFaults(seed, { minLatencyMs: 1, maxLatencyMs: 5 })), remoteRoot);
    });
  });
}

// An executor behind the fake that counts how many times it was really asked to run each command, and appends to a file so a second run is visible on disk too.
class CountingExecutor implements CommandExecutor {
  readonly calls: string[] = [];
  private readonly inner: CommandExecutor = new SandboxedExecutor();
  get descriptor() {
    return this.inner.descriptor;
  }
  run(cmd: CommandSpec, signal?: AbortSignal): Promise<Result<CommandResult>> {
    this.calls.push(cmd.invocationId);
    return this.inner.run(cmd, signal);
  }
}

function appendCommand(root: string, id: string, marker: string): CommandSpec {
  return spec(root, ['sh', '-c', `echo ${id} >> ${marker}`], { invocationId: id, writePaths: [join(root, '.planning')] });
}

describe('FakeRemoteExecutor faults (T-04-90)', { skip: SANDBOX ? false : 'the sandbox is macOS-only' }, () => {
  it('a command whose response was dropped is never run twice: the retry is answered by invocation key', async () => {
    const staging = makeScratchStaging();
    cleanup.push(staging.base);
    const marker = join(staging.root, '.planning', 'ran.log');
    const inner = new CountingExecutor();
    // Every response is dropped: the client retries to its bound and never learns the end, and the command still ran exactly once.
    const faults = new SeededFaults(1, { dropP: 1, duplicateP: 0, minLatencyMs: 0, maxLatencyMs: 1 });
    const executor = new FakeRemoteExecutor(inner, faults, { maxAttempts: 4 });
    const result = await executor.run(appendCommand(staging.root, 'drop-all', marker));
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'timeout');
    assert.equal(result.error.kind === 'timeout' ? result.error.sideEffect : '', 'unknown', 'the client cannot say whether the command ran');
    assert.equal(faults.counts().drop, 4);
    assert.deepEqual(inner.calls, ['drop-all'], 'the real executor was asked once');
    assert.equal(readFileSync(marker, 'utf8'), 'drop-all\n', 'the command ran once');
  });

  it('with half of the responses dropped, every command still runs exactly once and its answer arrives', async () => {
    const staging = makeScratchStaging();
    cleanup.push(staging.base);
    const marker = join(staging.root, '.planning', 'ran.log');
    const inner = new CountingExecutor();
    const faults = new SeededFaults(99, { dropP: 0.5, duplicateP: 0, minLatencyMs: 0, maxLatencyMs: 1 });
    const executor = new FakeRemoteExecutor(inner, faults, { maxAttempts: 30 });
    const ids = Array.from({ length: 12 }, (_, i) => `cmd-${i}`);
    for (const id of ids) {
      const result = await executor.run(appendCommand(staging.root, id, marker));
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.value.status, 'passed');
    }
    assert.ok(faults.counts().drop > 0, 'the seed dropped something');
    assert.deepEqual(inner.calls, ids, 'one real run per command');
    assert.equal(readFileSync(marker, 'utf8'), `${ids.join('\n')}\n`, 'no command appended twice');
    const innerCalls = faults.events.filter((e) => e.kind === 'inner-call').map((e) => e.key);
    assert.equal(new Set(innerCalls).size, innerCalls.length, 'the call log holds unique invocation keys');
  });

  it('a duplicated response is discarded: one answer, one run', async () => {
    const staging = makeScratchStaging();
    cleanup.push(staging.base);
    const marker = join(staging.root, '.planning', 'ran.log');
    const inner = new CountingExecutor();
    const faults = new SeededFaults(5, { dropP: 0, duplicateP: 1, minLatencyMs: 0, maxLatencyMs: 1 });
    const executor = new FakeRemoteExecutor(inner, faults);
    const result = await executor.run(appendCommand(staging.root, 'dup', marker));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.exitCode, 0);
    assert.equal(faults.counts().duplicate, 1);
    assert.deepEqual(inner.calls, ['dup']);
    assert.equal(readFileSync(marker, 'utf8'), 'dup\n');
  });

  it('serializes the spec through JSON: a function or a cycle in it is refused, not run', async () => {
    const staging = makeScratchStaging();
    cleanup.push(staging.base);
    const inner = new CountingExecutor();
    const executor = new FakeRemoteExecutor(inner, new SeededFaults(1, { minLatencyMs: 0, maxLatencyMs: 1 }));
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const result = await executor.run({ ...spec(staging.root, ['true']), env: cyclic as unknown as Record<string, string> });
    assert.ok(!result.ok);
    assert.equal(result.error.kind, 'invalid');
    assert.deepEqual(inner.calls, []);
  });

  it('reports the inner adapter facts and says it is remote and which seed it drew from', () => {
    const descriptor = new FakeRemoteExecutor(new SandboxedExecutor(), new SeededFaults(42)).descriptor;
    assert.equal(descriptor.port, 'executor');
    assert.equal(descriptor.adapter, 'fake-remote-executor');
    assert.equal(descriptor.capabilities['remote'], true);
    assert.equal(descriptor.capabilities['cancel'], true);
    assert.equal(descriptor.attributes?.['enforcement'], 'enforced');
    assert.equal(descriptor.attributes?.['seed'], '42');
  });
});

describe('FakeRemoteArtifactStore faults', () => {
  const root = (): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'avarice-fake-store-')));
    cleanup.push(dir);
    return dir;
  };

  it('a put whose response was dropped is retried by digest and stores one blob', () => {
    const dir = root();
    const faults = new SeededFaults(11, { dropP: 0.5, duplicateP: 0, minLatencyMs: 0, maxLatencyMs: 1 });
    const store = new FakeRemoteArtifactStore(dir, faults, { maxAttempts: 40 });
    const subject = directoryStore(store, dir);
    const first = store.put(new TextEncoder().encode('once'), { kind: 'k' });
    assert.ok(first.ok);
    for (let i = 0; i < 20; i += 1) assert.deepEqual(store.put(new TextEncoder().encode('once'), { kind: 'k' }), first);
    assert.ok(faults.counts().drop > 0, 'the seed dropped something');
    assert.equal(subject.blobCount(), 1);
  });

  it('is unavailable, not wrong, when every attempt loses its response', () => {
    const dir = root();
    const store = new FakeRemoteArtifactStore(dir, new SeededFaults(1, { dropP: 1, minLatencyMs: 0, maxLatencyMs: 1 }));
    const put = store.put(new TextEncoder().encode('x'), { kind: 'k' });
    assert.ok(!put.ok);
    assert.equal(put.error.kind, 'unavailable');
    assert.equal(directoryStore(store, dir).blobCount(), 1, 'the remote did store it: only the answer was lost');
  });

  it('a duplicated response is discarded and the value is the same', () => {
    const dir = root();
    const faults = new SeededFaults(1, { dropP: 0, duplicateP: 1, minLatencyMs: 0, maxLatencyMs: 1 });
    const store = new FakeRemoteArtifactStore(dir, faults);
    const put = store.put(new TextEncoder().encode('twice'), { kind: 'k' });
    assert.ok(put.ok);
    assert.deepEqual(store.get(put.value.digest), ok(new TextEncoder().encode('twice')));
    assert.equal(faults.counts().duplicate, 2);
  });
});

describe('SeededFaults', () => {
  it('draws the same sequence from the same seed and a different one from another', () => {
    const draw = (seed: number): number[] => {
      const faults = new SeededFaults(seed);
      return Array.from({ length: 50 }, () => faults.latencyMs());
    };
    assert.deepEqual(draw(42), draw(42));
    assert.notDeepEqual(draw(42), draw(43));
    const next = mulberry32(1);
    const values = Array.from({ length: 1000 }, () => next());
    assert.ok(values.every((v) => v >= 0 && v < 1));
  });

  it('drops about 5% and duplicates about 2% by default, and keeps latency within its range', () => {
    const faults = new SeededFaults(2024);
    let drops = 0;
    let dups = 0;
    for (let i = 0; i < 20_000; i += 1) {
      if (faults.drop()) drops += 1;
      if (faults.duplicate()) dups += 1;
      const latency = faults.latencyMs();
      assert.ok(latency >= 5 && latency <= 30, `latency ${latency}`);
    }
    assert.ok(drops > 800 && drops < 1200, `drops ${drops}`);
    assert.ok(dups > 250 && dups < 550, `duplicates ${dups}`);
  });
});
