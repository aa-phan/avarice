// Spec derivation at start (plan 03-17; D-07 stage 1, RC-7, S-50): before the start transaction the start command reads the onboarded indexes
// for the files and symbols each item names, hands them to the compiler, and prints one line per item with every derived field marked. The
// indexes are the real graph reader over a graph file the fixture writes; nothing here calls a model.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { collectIndexFacts } from '../../src/app/derive-spec.ts';
import { createDeps } from '../../src/cli/composition.ts';
import type { BriefItem } from '../../src/domain/brief.ts';
import type { RunContract } from '../../src/domain/run-contract.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FakeIntelHost } from '../helpers/fake-intel-host.ts';
import { makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliResult, CliRoots } from '../helpers/run-cli.ts';
import { offlineAvailable } from '../helpers/offline.ts';
import {
  ITEMS_BRIEF_ACCEPTANCE,
  RUN_CONVENTIONS,
  commitConventions,
  ledgerRows,
  makeRunRepo,
  onboardRunRepo,
  onboardRunRepoWithIndexes,
  writeItemsBrief,
} from '../helpers/run-fixtures.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

// A brief of three items with no sizes and no spec: A names a file and a symbol the graph knows, B names nothing, C depends on B.
const ITEMS: readonly BriefItem[] = [
  { id: 'A', title: 'Collapse repeated dashes in `slugify` of `src/slug.ts`', dependsOn: [], acceptance: ['AC1'] },
  { id: 'B', title: 'Trim leading and trailing dashes', dependsOn: [], acceptance: ['AC2'] },
  { id: 'C', title: 'Cover the slug rules with a test', dependsOn: ['B'], acceptance: ['AC3'] },
];

interface Fixture {
  roots: CliRoots;
  repo: ScratchRepo;
}

// An onboarded repository with conventions committed after the pin; with indexes the graph has a node `slugify` in src/slug.ts.
async function fixture(options: { indexes: boolean }): Promise<Fixture> {
  const roots = makeRoots();
  const repo = makeRunRepo();
  cleanup.push(roots.base, repo.base);
  if (options.indexes) await onboardRunRepoWithIndexes(roots, repo, 'slugify');
  else onboardRunRepo(roots, repo);
  commitConventions(repo, RUN_CONVENTIONS);
  return { roots, repo };
}

function start(f: Fixture, items: readonly BriefItem[]): CliResult {
  const brief = writeItemsBrief(join(f.roots.base, 'briefs'), items, ITEMS_BRIEF_ACCEPTANCE.slice(0, items.length));
  return runCli(['start', '--brief', brief, '--policy', 'routine'], { roots: f.roots, cwd: f.repo.path });
}

const runIdOf = (stdout: string): string => {
  const match = /^run (run_[0-9A-Z]{26}): contract_ready/.exec(stdout.split('\n')[0] ?? '');
  assert.ok(match, `the first line names the run, got ${JSON.stringify(stdout.split('\n')[0])}`);
  return match[1] as string;
};

function contractOf(f: Fixture, runId: string): RunContract {
  const [row] = ledgerRows<{ body_json: string }>(f.roots, 'SELECT body_json FROM contracts WHERE run_id = ? ORDER BY version DESC', runId);
  return JSON.parse(row?.body_json as string) as RunContract;
}

describe('start derives item specs from the indexes and shows them before the run starts (S-50, tracer)', { skip: !offlineAvailable() }, () => {
  it('stores A with the file and symbol the graph knows, B with the write set, every size medium, and names the derived fields', async () => {
    const f = await fixture({ indexes: true });
    const r = start(f, ITEMS);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const contract = contractOf(f, runIdOf(r.stdout));
    const [a, b, c] = contract.intent.workItems;
    assert.deepEqual(a?.spec.files, ['src/slug.ts']);
    assert.deepEqual(a?.spec.symbols, ['slugify']);
    assert.deepEqual(b?.spec.files, ['src/**', 'test/**'], 'B names nothing, so its files are the write set');
    assert.deepEqual(b?.spec.symbols, []);
    assert.deepEqual(contract.intent.workItems.map((i) => i.size), ['medium', 'medium', 'medium']);
    for (const item of [a, b, c]) {
      assert.ok(item?.spec.derived.includes('size') && item.spec.derived.includes('files') && item.spec.derived.includes('symbols'), `${item?.id} names its derived fields: ${item?.spec.derived.join(',')}`);
    }
  });

  it('prints one line per item, with size, model, dependencies and spec files, each derived field marked', async () => {
    const f = await fixture({ indexes: true });
    const r = start(f, ITEMS);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const lines = r.stdout.split('\n');
    assert.ok(lines.includes('item A: medium (derived), sonnet (from size); files src/slug.ts (derived); symbols slugify (derived)'), r.stdout);
    assert.ok(lines.includes('item B: medium (derived), sonnet (from size); files src/**, test/** (derived)'), r.stdout);
    assert.ok(lines.includes('item C: medium (derived), sonnet (from size); depends on B; files src/**, test/** (derived)'), r.stdout);
    assert.ok(lines.includes('index: used (1 file, 1 symbol)'), r.stdout);
    assert.ok(!lines.some((l) => l.startsWith('model:')), 'the single model line of Phase 2 is gone: each item line carries its model');
  });

  it('shows an explicit spec without the derived marker', async () => {
    const f = await fixture({ indexes: true });
    const items: readonly BriefItem[] = [{ id: 'A', title: 'Collapse repeated dashes', dependsOn: [], size: 'small', acceptance: ['AC1'], spec: { files: ['src/slug.ts'], symbols: ['slugify'] } }];
    const r = start(f, items);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.ok(r.stdout.split('\n').includes('item A: small, haiku (from size); files src/slug.ts; symbols slugify'), r.stdout);
  });
});

describe('an index that is absent never blocks a start (S-50)', () => {
  it('starts, derives from the brief and the write set, and says the index was not used', async () => {
    const f = await fixture({ indexes: false });
    const r = start(f, ITEMS);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const contract = contractOf(f, runIdOf(r.stdout));
    assert.deepEqual(contract.intent.workItems[0]?.spec.files, ['src/**', 'test/**']);
    assert.ok(r.stdout.split('\n').includes('index: not used (absent)'), r.stdout);
  });
});

describe('derivation only reads the indexes (RC-7 concurrency)', { skip: !offlineAvailable() }, () => {
  it('collectIndexFacts returns the files and symbols the item terms match and writes nothing to the ledger', async () => {
    const f = await fixture({ indexes: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AVARICE_CONFIG_HOME: f.roots.AVARICE_CONFIG_HOME,
      AVARICE_DATA_ROOT: f.roots.AVARICE_DATA_ROOT,
      AVARICE_WORK_ROOT: f.roots.AVARICE_WORK_ROOT,
      AVARICE_CLAUDE_BIN: '/nonexistent/avarice-test-has-no-claude',
    };
    const composed = createDeps(env, { host: new FakeIntelHost(new FakeAgentHost(), {}) });
    assert.ok(composed.ok, 'composition');
    const snapshot = (): string => {
      const db = new DatabaseSync(join(f.roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true, timeout: 5000 });
      try {
        const counts = ['runs', 'contracts', 'work_items', 'events', 'run_steps'].map((t) => `${t}=${(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n}`);
        return counts.join(',');
      } finally {
        db.close();
      }
    };
    try {
      const projects = composed.value.deps.ledger.listProjects();
      assert.ok(projects.ok && projects.value[0] !== undefined);
      const before = snapshot();
      const found = await collectIndexFacts(composed.value.deps, projects.value[0].projectId, ['slugify', 'src/slug.ts']);
      assert.deepEqual(found.facts, { files: ['src/slug.ts'], symbolsByFile: { 'src/slug.ts': ['slugify'] } });
      assert.equal(found.note, 'index: used (1 file, 1 symbol)');
      assert.equal(snapshot(), before, 'no run, contract, item, event or step was written');
      const none = await collectIndexFacts(composed.value.deps, projects.value[0].projectId, ['nothingNamedThis']);
      assert.equal(none.facts, undefined);
      assert.equal(snapshot(), before);
    } finally {
      composed.value.close();
    }
  });

  it('a graph file the reader cannot parse is not used and never throws', async () => {
    const f = await fixture({ indexes: true });
    const staging = ledgerRows<{ staging_worktree: string }>(f.roots, 'SELECT staging_worktree FROM onboardings')[0]?.staging_worktree as string;
    writeFileSync(join(staging, '.planning', 'graphs', 'graph.json'), '{ not json');
    const r = start(f, ITEMS);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /^index: not used \((absent|unreadable)\)$/m);
  });
});
