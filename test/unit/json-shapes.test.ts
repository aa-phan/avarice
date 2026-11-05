// Frozen shapes of every Phase 1 `--json` output (plan 02-02, D-19, success criterion 7).
// The four fixtures under test/fixtures/json-shapes/ were generated from the code as it stood before any renderer
// change (plan 02-02 Task 1, first commit). Each test produces the same output again and compares it with the
// fixture after normalize(), which replaces only volatile values: ULID-suffixed IDs, temp paths, ISO timestamps and
// SHA-1 and SHA-256 hex. Keys, key order, array order, types and every other value are compared exactly, so a
// restyled human renderer, or any change to a `--json` path, fails here.
//
// Regenerate (only on purpose, only for an intended shape change): AVARICE_SNAPSHOT_WRITE=1 node --test test/unit/json-shapes.test.ts
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDeps } from '../../src/cli/composition.ts';
import { main } from '../../src/cli/main.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';
import { EXPIRY_WAIT_MS, REPO_FILES, onboardingIdOf, runWithFault, sleepSync, statusCli } from '../helpers/fault-run.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { offlineAvailable } from '../helpers/offline.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { mixedTiersGraph } from '../fixtures/index-fixtures.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'json-shapes');
const WRITE = process.env['AVARICE_SNAPSHOT_WRITE'] === '1';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

const ID = /\b(?:proj|onb|run|inv|att|ckp|ev)_[0-9A-HJKMNP-TV-Z]{26}\b/g;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const SHA256 = /(?<![0-9a-fA-F])[0-9a-f]{64}(?![0-9a-fA-F])/g;
const SHA1 = /(?<![0-9a-fA-F])[0-9a-f]{40}(?![0-9a-fA-F])/g;

// Replaces the volatile values and nothing else. `tmpBases` are the temp directories this test created; both their
// given and their symlink-resolved forms are replaced, longest first.
export function normalize(text: string, tmpBases: readonly string[]): string {
  const forms = new Set<string>();
  for (const base of tmpBases) {
    forms.add(base);
    forms.add(realpathSync(base));
  }
  let out = text;
  for (const form of [...forms].sort((a, b) => b.length - a.length)) out = out.split(form).join('<tmp>');
  return out.replace(ID, '<id>').replace(ISO, '<iso>').replace(SHA256, '<sha256>').replace(SHA1, '<sha1>');
}

// Keys, key order, array lengths and value types of a JSON value, with no scalar values.
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (value !== null && typeof value === 'object') return Object.entries(value).map(([k, v]) => [k, shapeOf(v)]);
  return value === null ? 'null' : typeof value;
}

function compareWithFixture(name: string, rawText: string, tmpBases: readonly string[]): void {
  const normalized = normalize(rawText, tmpBases);
  assert.ok(!/\/var\/folders|\/private\/var/.test(normalized), `a temp path survived normalization:\n${normalized}`);
  // The normalized text is still the same JSON document: same keys, key order, array order and value types.
  assert.deepEqual(shapeOf(JSON.parse(normalized)), shapeOf(JSON.parse(rawText)));
  const path = join(FIXTURES, name);
  if (WRITE) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, normalized);
    return;
  }
  assert.equal(normalized, readFileSync(path, 'utf8'));
}

describe('normalize()', () => {
  const base = temp('shape-norm');
  it('replaces only IDs, temp paths, ISO timestamps, SHA-256 and SHA-1 hex', () => {
    const id = 'onb_01JABCDEFGHJKMNPQRSTVWXYZ0';
    const sha1 = 'a'.repeat(40);
    const sha256 = 'b'.repeat(64);
    const input = JSON.stringify({ id, at: '2026-11-05T10:26:49.714Z', rev: sha1, digest: sha256, dir: `${base}/work`, keep: 'staging', n: 7, short: '9f1cd8d' });
    const out = normalize(input, [base]);
    assert.deepEqual(JSON.parse(out), { id: '<id>', at: '<iso>', rev: '<sha1>', digest: '<sha256>', dir: '<tmp>/work', keep: 'staging', n: 7, short: '9f1cd8d' });
  });

  it('keeps key order and does not touch a 41-hex run or a 63-hex run', () => {
    const text = JSON.stringify({ b: 1, a: 2, x: 'c'.repeat(41), y: 'd'.repeat(63) });
    assert.equal(normalize(text, [base]), text);
  });
});

describe('Phase 1 --json shapes are frozen (D-19, success criterion 7)', () => {
  it('status --json on an empty profile', () => {
    const roots = makeRoots();
    cleanup.push(roots.base);
    const ran = runCli(['status', '--json'], { roots });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stderr, '');
    compareWithFixture('status-empty.json', ran.stdout, [roots.base]);
  });

  it('status --json on an onboarding killed at after-checkpoint:configure-gsd', () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);
    runWithFault(roots, repo, 'after-checkpoint:configure-gsd');
    // The killed supervisor's short lease must have expired, or the onboarding is not shown as interrupted.
    sleepSync(EXPIRY_WAIT_MS);
    assert.ok(onboardingIdOf(roots).startsWith('onb_'));
    const ran = statusCli(roots, '--json');
    assert.equal(ran.code, 0, ran.stderr);
    const parsed = JSON.parse(ran.stdout) as Array<{ interrupted?: unknown }>;
    assert.ok(parsed[0]?.interrupted !== undefined, 'the onboarding is shown as interrupted');
    compareWithFixture('status-interrupted.json', ran.stdout, [roots.base, repo.base]);
  });

  describe('with an active record', { skip: !offlineAvailable() }, () => {
    interface Onboarded {
      roots: CliRoots;
      repo: ScratchRepo;
      env: NodeJS.ProcessEnv;
      graphifyDir: string;
      staging: string;
    }
    let onboarded: Onboarded | undefined;

    async function active(): Promise<Onboarded> {
      if (onboarded !== undefined) return onboarded;
      const roots = makeRoots();
      const repo = makeScratchRepo({
        files: {
          ...REPO_FILES,
          'src/index.ts': 'export function answer(): number {\n  return helper();\n}\nexport function helper(): number {\n  return 42;\n}\n',
        },
      });
      const graphifyDir = temp('shape-graphify');
      cleanup.push(roots.base, repo.base);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
        AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
        AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
        AVARICE_GRAPHIFY_BIN: writeFakeGraphify(graphifyDir, 'ok'),
      };
      const composed = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
      assert.ok(composed.ok, 'composition');
      let staging: string;
      try {
        const started = startOnboarding(composed.value.deps, { repoPath: repo.path, policy: 'onboarding' });
        assert.ok(started.ok);
        const outcome = await runOnboarding(composed.value.deps, started.value.onboardingId);
        assert.ok(outcome.ok && outcome.value.state === 'active', 'the repository is onboarded');
        const row = composed.value.deps.ledger.getOnboarding(started.value.onboardingId);
        assert.ok(row.ok);
        staging = row.value.stagingWorktree as string;
      } finally {
        composed.value.close();
      }
      // The staging graph is replaced by a fixture, the way context.test.ts does, so `context` has graph nodes to cite.
      writeFileSync(join(staging, '.planning', 'graphs', 'graph.json'), JSON.stringify(mixedTiersGraph(repo.head)));
      onboarded = { roots, repo, env, graphifyDir, staging };
      return onboarded;
    }

    async function cli(o: Onboarded, argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
      let out = '';
      let err = '';
      const code = await main(argv, { env: o.env, executor: new SandboxedExecutor(), io: { out: (t) => void (out += t), err: (t) => void (err += t) } });
      return { code, out, err };
    }

    it('status --json with an active record', async () => {
      const o = await active();
      const ran = await cli(o, ['status', '--json']);
      assert.equal(ran.code, 0, ran.err);
      assert.equal(ran.err, '');
      const parsed = JSON.parse(ran.out) as Array<{ state: string; recordVersion: number | null }>;
      assert.equal(parsed[0]?.state, 'active');
      compareWithFixture('status-active.json', ran.out, [o.roots.base, o.repo.base, o.graphifyDir]);
    });

    it('context <term> --json with an active record', async () => {
      const o = await active();
      const ran = await cli(o, ['context', 'answer', '--json']);
      assert.equal(ran.code, 0, ran.err);
      compareWithFixture('context-active.json', ran.out, [o.roots.base, o.repo.base, o.graphifyDir]);
    });
  });
});
