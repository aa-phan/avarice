// Plan 04-26 (FR-3, FR-22, FR-18): the two missing local context adapters. `git-files` answers a scoped search and reads bounded snippets; `gsd-planning` returns
// sections of the planning files (task 2); the assembler confirms stale citations and the profile selects the sources (task 3). The pack tests run over a real
// onboarded scratch repository; the adapter tests run over scratch repositories directly. No model is called.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitFilesContext } from '../../src/adapters/context/git-files.ts';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import { queryContext } from '../../src/app/context.ts';
import type { ContextReport } from '../../src/app/context.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import type { ContextQuery } from '../../src/ports/context-source.ts';
import { makeRoots } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import { writeFakeGraphify } from '../helpers/fake-graphify.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// A 60-line file with the term on line 12, so a snippet has room on both sides and a window of 40 lines is a real bound.
const CHECKOUT = `${Array.from({ length: 11 }, (_, i) => `// checkout line ${i + 1}`).join('\n')}\nexport function handleCheckout(cart: string[]): number {\n${Array.from({ length: 47 }, (_, i) => `  const step${i + 1} = cart.length + ${i + 1};`).join('\n')}\n  return 1;\n}\n`;

const REPO_FILES: Record<string, string> = {
  'README.md': '# scratch\n',
  'src/index.ts': 'export const a = 1;\n',
  'src/pay/checkout.ts': CHECKOUT,
  'docs/notes.md': '# notes\nhandleCheckout is described here.\n',
  '.env': 'TOKEN=handleCheckout\n',
  'keys/server.pem': 'handleCheckout\n',
};

interface Onboarded {
  deps: AppDeps;
  close: () => void;
  repo: ScratchRepo;
  roots: CliRoots;
  env: NodeJS.ProcessEnv;
}

async function onboardedDeps(files: Record<string, string> = REPO_FILES, configSections?: Record<string, unknown>): Promise<Onboarded> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files });
  const bins = mkdtempSync(join(tmpdir(), 'avarice-ctx-adapters-'));
  cleanup.push(roots.base, repo.base, bins);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: writeFakeGraphify(bins, 'ok'),
  };
  const onboarding = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
  assert.ok(onboarding.ok, 'composition');
  try {
    const started = startOnboarding(onboarding.value.deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(onboarding.value.deps, started.value.onboardingId);
    assert.ok(outcome.ok && outcome.value.state === 'active', 'the repository is onboarded');
  } finally {
    onboarding.value.close();
  }
  void configSections;
  const composed = createDeps(env, {}, { readOnly: true, gsd: true });
  assert.ok(composed.ok);
  return { deps: composed.value.deps, close: composed.value.close, repo, roots, env };
}

async function ask(o: Onboarded, term: string, extra: Partial<Parameters<typeof queryContext>[1]> = {}): Promise<ContextReport> {
  const result = await queryContext(o.deps, { term, budget: 4000, ...extra });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

const gitItems = (report: ContextReport) => report.items.filter((i) => i.source === 'git-files');

function workspaceOf(repo: ScratchRepo): ContextQuery['workspace'] {
  return { stagingPath: repo.path, repoPath: repo.path };
}

function queryOf(repo: ScratchRepo, term: string, extra: Partial<ContextQuery> = {}): ContextQuery {
  return { term, workspace: workspaceOf(repo), indexRevision: `git:${repo.head}`, ...extra };
}

describe('tracer: a pack built with git-files finds a term by scoped search and reads a bounded snippet with a verbatim citation (FR-22, FR-3)', () => {
  it('cites src/pay/checkout.ts:12 with provider, kind, verbatim ID, revision and scope, and an excerpt of at most 40 lines', async () => {
    const o = await onboardedDeps();
    try {
      const report = await ask(o, 'handleCheckout');
      const hits = gitItems(report).filter((i) => i.ref.scope === 'src/pay/checkout.ts');
      assert.equal(hits.length, 1, JSON.stringify(report.items.map((i) => i.ref)));
      const [item] = hits;
      assert.ok(item);
      assert.equal(item.ref.provider, 'git-files');
      assert.equal(item.ref.kind, 'snippet');
      assert.equal(item.ref.id, 'src/pay/checkout.ts:12');
      assert.equal(item.ref.revision, `git:${o.repo.head}`);
      assert.equal(item.ref.scope, 'src/pay/checkout.ts');
      assert.equal(item.ref.freshness, 'fresh');
      assert.match(item.ref.retrievedAt, /^\d{4}-\d\d-\d\dT/);
      const lines = item.excerpt.split('\n');
      assert.ok(lines.length <= 40, `the snippet holds ${lines.length} lines`);
      assert.ok(lines.length > 10, 'a snippet is more than the hit line');
      assert.ok(item.excerpt.includes('export function handleCheckout'));
    } finally {
      o.close();
    }
  });

  it('never returns a hit outside the read scope: not a secret path by default, not a path outside a contract read list', async () => {
    const o = await onboardedDeps();
    try {
      const byDefault = gitItems(await ask(o, 'handleCheckout')).map((i) => i.ref.scope);
      assert.ok(!byDefault.includes('.env'), 'a secret-bearing file is out of scope');
      assert.ok(!byDefault.includes('keys/server.pem'), 'a key file is out of scope');
      assert.ok(byDefault.includes('docs/notes.md'), 'an ordinary tracked file is in scope');
      const scoped = gitItems(await ask(o, 'handleCheckout', { readScope: { read: ['src/**'], readExclude: [], secretGlobs: [] } })).map((i) => i.ref.scope);
      assert.deepEqual(scoped, ['src/pay/checkout.ts']);
    } finally {
      o.close();
    }
  });

  it('find returns handles with an estimate and no excerpt text', async () => {
    const o = await onboardedDeps();
    try {
      const source = new GitFilesContext({ nowMs: () => Date.parse('2026-11-17T00:00:00Z') });
      const found = await source.find(queryOf(o.repo, 'handleCheckout'), 4000);
      assert.ok(found.ok, JSON.stringify(found));
      assert.ok(found.value.length >= 1);
      for (const handle of found.value) {
        assert.ok(handle.estTokens > 0);
        assert.equal('excerpt' in handle, false, 'a handle carries no content');
        assert.match(handle.ref.id, /^.+:\d+$/);
      }
    } finally {
      o.close();
    }
  });
});
