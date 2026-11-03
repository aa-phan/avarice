// Plan 01-14 Task 2: the code-graph index step end to end. The map comes from the fake host; graphify is either a
// fake script (hermetic: every failure mode and every command AVARICE runs) or, where installed, the real tool on a
// scratch repository. GSD's `graphify status` and `graphify build snapshot` are the real verbs, run through the
// sandboxed executor. Scratch repositories and temp directories only; no model is called.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDeps } from '../../src/cli/composition.ts';
import { runOnboarding, startOnboarding } from '../../src/app/onboarding-service.ts';
import type { OnboardingOutcome } from '../../src/app/onboarding-service.ts';
import type { AppDeps } from '../../src/app/deps.ts';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { GraphifyTool } from '../../src/adapters/graph/graphify.ts';
import { sha256Hex } from '../../src/domain/digest.ts';
import type { CommandExecutor, CommandSpec } from '../../src/ports/command-executor.ts';
import { REPO_ROOT, makeRoots, runCli } from '../helpers/run-cli.ts';
import type { CliRoots } from '../helpers/run-cli.ts';
import { makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';
import { FakeAgentHost } from '../helpers/fake-agent-host.ts';
import { FAKE_GRAPH_EDGES, FAKE_GRAPH_NODES, writeFakeGraphify } from '../helpers/fake-graphify.ts';
import type { FakeGraphifyMode } from '../helpers/fake-graphify.ts';

const TEST_CLI = join(REPO_ROOT, 'test', 'helpers', 'test-cli.ts');
const REPO_FILES = {
  'README.md': '# scratch\n',
  'package.json': '{"name":"scratch"}\n',
  'src/index.ts': 'export function answer(): number {\n  return helper();\n}\nexport function helper(): number {\n  return 42;\n}\n',
  'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
  'docs/guide.md': '# guide\n',
};

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

function rows<T>(roots: CliRoots, sql: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(join(roots.AVARICE_DATA_ROOT, 'state.db'), { readOnly: true });
  try {
    return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({ ...r }) as T);
  } finally {
    db.close();
  }
}

interface RecordBody {
  revisions: { onboardedAt: string };
  indexes: {
    graph?: { path: string; codeGraphPath: string; digest: string; builtAtCommit: string; tool: string; freshness: string; nodes: Record<string, number>; edges: Record<string, number> };
    intel?: unknown;
    absent?: Array<{ index: string; reason: string }>;
  };
}

function recordOf(roots: CliRoots): RecordBody {
  const [record] = rows<{ body_json: string }>(roots, 'SELECT body_json FROM project_records ORDER BY version DESC LIMIT 1');
  assert.ok(record, 'an active record exists');
  return JSON.parse(record.body_json) as RecordBody;
}

function stagingOf(roots: CliRoots): string {
  const [onboarding] = rows<{ staging_worktree: string | null }>(roots, 'SELECT staging_worktree FROM onboardings');
  assert.ok(onboarding?.staging_worktree);
  return onboarding.staging_worktree;
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    found.push(join(dir, entry.name));
    if (entry.isDirectory()) walk(join(dir, entry.name), found);
  }
  return found;
}

function fakeBin(mode: FakeGraphifyMode = 'ok'): string {
  return writeFakeGraphify(temp('fake-graphify'), mode);
}

interface Run {
  roots: CliRoots;
  repo: ScratchRepo;
  outcome: OnboardingOutcome;
  specs: CommandSpec[];
  onboardingId: string;
}

interface RunOptions {
  graphifyBin: string;
  // Change a command before it runs (for example to shorten a timeout).
  limit?: (cmd: CommandSpec) => CommandSpec;
  // Replace parts of the dependencies after composition.
  wrap?: (deps: AppDeps) => AppDeps;
}

// Onboards a scratch repository in-process, with every command AVARICE runs recorded.
async function onboard(options: RunOptions): Promise<Run> {
  const roots = makeRoots();
  const repo = makeScratchRepo({ files: REPO_FILES });
  cleanup.push(roots.base, repo.base);
  const env = {
    ...process.env,
    AVARICE_CONFIG_HOME: roots.AVARICE_CONFIG_HOME,
    AVARICE_DATA_ROOT: roots.AVARICE_DATA_ROOT,
    AVARICE_WORK_ROOT: roots.AVARICE_WORK_ROOT,
    AVARICE_GRAPHIFY_BIN: options.graphifyBin,
  };
  const inner = new SandboxedExecutor();
  const specs: CommandSpec[] = [];
  const executor: CommandExecutor = {
    get descriptor() {
      return inner.descriptor;
    },
    run: (cmd, signal) => {
      specs.push(cmd);
      return inner.run(options.limit?.(cmd) ?? cmd, signal);
    },
  };
  const composed = createDeps(env, { host: new FakeAgentHost(), executor });
  assert.ok(composed.ok, 'composition');
  try {
    const deps = options.wrap?.(composed.value.deps) ?? composed.value.deps;
    const started = startOnboarding(deps, { repoPath: repo.path, policy: 'onboarding' });
    assert.ok(started.ok);
    const outcome = await runOnboarding(deps, started.value.onboardingId);
    assert.ok(outcome.ok, 'the run itself does not fail');
    return { roots, repo, outcome: outcome.value, specs, onboardingId: started.value.onboardingId };
  } finally {
    composed.value.close();
  }
}

const isGsd = (cmd: CommandSpec, ...verb: string[]): boolean => cmd.argv[1]?.endsWith('gsd-tools.cjs') === true && verb.every((v, i) => cmd.argv[2 + i] === v);
const isGraphify = (cmd: CommandSpec, sub: string): boolean => cmd.argv[0]?.endsWith('/graphify') === true && cmd.argv[1] === sub;

describe('the code-graph step with a graphify that works', () => {
  let run!: Run;
  before(async () => {
    run = await onboard({ graphifyBin: fakeBin() });
  });

  it('onboards to active', () => {
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
  });

  it('lists indexes.graph with path, digest, the onboarded revision as build commit, tool, freshness and node counts with no document nodes', () => {
    const record = recordOf(run.roots);
    const graph = record.indexes.graph;
    assert.ok(graph, 'the record lists the graph');
    assert.equal(graph.path, '.planning/graphs/graph.json');
    assert.equal(graph.codeGraphPath, '.planning/graphs/code-graph.json');
    assert.equal(graph.builtAtCommit, `git:${run.repo.head}`);
    assert.equal(graph.builtAtCommit, record.revisions.onboardedAt, 'the build commit is the onboarded revision');
    assert.equal(graph.tool, 'graphify@0.9.53');
    assert.equal(graph.freshness, 'fresh');
    assert.deepEqual(graph.nodes, FAKE_GRAPH_NODES);
    assert.equal(graph.nodes['document'], 0);
    assert.deepEqual(graph.edges, FAKE_GRAPH_EDGES);
    assert.match(graph.digest, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!(record.indexes.absent ?? []).some((a) => a.index === 'graph'), 'the graph is not also listed absent');
  });

  it('digests the installed graph.json byte for byte, and the ledger column follows the body', () => {
    const staging = stagingOf(run.roots);
    const bytes = readFileSync(join(staging, '.planning', 'graphs', 'graph.json'));
    assert.equal(recordOf(run.roots).indexes.graph?.digest, `sha256:${sha256Hex(bytes)}`);
    const [column] = rows<{ graph_commit: string | null }>(run.roots, 'SELECT graph_commit FROM project_records');
    assert.equal(column?.graph_commit, `git:${run.repo.head}`);
  });

  it('installs graph.json, code-graph.json and GRAPH_REPORT.md into staging .planning/graphs, plus the GSD snapshot, and nothing named graphify-out anywhere in staging', () => {
    const staging = stagingOf(run.roots);
    assert.deepEqual(readdirSync(join(staging, '.planning', 'graphs')).sort(), ['.last-build-snapshot.json', 'GRAPH_REPORT.md', 'code-graph.json', 'graph.json']);
    assert.deepEqual(walk(staging).filter((p) => p.split('/').includes('graphify-out')), [], 'no graphify-out/ in the staging tree');
    assert.equal(readFileSync(join(staging, '.planning', 'graphs', 'code-graph.json'), 'utf8'), readFileSync(join(staging, '.planning', 'graphs', 'graph.json'), 'utf8'));
  });

  it('builds the graph in {workRoot}/{onb}/graph-build/code, outside the staging tree', () => {
    const out = join(run.roots.AVARICE_WORK_ROOT, run.onboardingId, 'graph-build', 'code');
    assert.ok(existsSync(join(realpathSync(out), 'graphify-out', 'graph.json')), 'the build output lives under the work root');
    assert.ok(!realpathSync(out).startsWith(stagingOf(run.roots)), 'and not inside staging');
  });

  it('runs every command through the executor, in order: extract, cluster, GSD snapshot, GSD status, each with only the write path it needs', () => {
    const staging = realpathSync(stagingOf(run.roots));
    const build = run.specs.filter((c) => isGraphify(c, 'extract') || isGraphify(c, 'cluster-only') || isGsd(c, 'graphify'));
    assert.deepEqual(
      build.map((c) => (isGsd(c, 'graphify') ? `gsd graphify ${c.argv.slice(3).join(' ')}` : `graphify ${c.argv[1]}`)),
      ['graphify extract', 'graphify cluster-only', 'gsd graphify build snapshot', 'gsd graphify status'],
    );
    const out = realpathSync(join(run.roots.AVARICE_WORK_ROOT, run.onboardingId, 'graph-build', 'code'));
    assert.deepEqual(build[0]?.writePaths, [out]);
    assert.deepEqual(build[0]?.argv.slice(1, 3), ['extract', staging]);
    assert.ok(build[0]?.argv.includes('--code-only'));
    assert.deepEqual(build[1]?.writePaths, [out]);
    // The sandbox profile resolves every path itself; compare what the command was allowed to write, resolved.
    assert.deepEqual(build[2]?.writePaths.map((p) => realpathSync(p)), [join(staging, '.planning', 'graphs')]);
    assert.deepEqual(build[3]?.writePaths, [], 'the status verb writes nothing');
    assert.equal(build[0]?.timeoutMs, 300_000);
  });

  it('stores the step result and emits no index.absent event for the graph', () => {
    const [step] = rows<{ status: string; result_json: string }>(run.roots, "SELECT status, result_json FROM onboarding_steps WHERE step = 'index:code-graph'");
    assert.equal(step?.status, 'completed');
    assert.equal((JSON.parse(step?.result_json ?? '{}') as { status: string }).status, 'present');
    assert.equal(rows<{ n: number }>(run.roots, "SELECT count(*) AS n FROM events WHERE type = 'index.absent' AND data_json LIKE '%code-graph%'")[0]?.n, 0);
  });

  it('makes GSD itself report the graph present and not stale', () => {
    const status = runCli(['status'], { roots: run.roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /indexes: graph, intel absent/);
  });
});

describe('a graphify that is missing or fails never blocks activation (S-40, ONB-13)', () => {
  function absentOf(run: Run): Array<{ index: string; reason: string }> {
    return recordOf(run.roots).indexes.absent ?? [];
  }

  it('graphify missing: active, indexes.absent lists the graph with reason graphify-missing, and status says so', () => {
    const roots = makeRoots();
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(roots.base, repo.base);
    const r = runCli(['onboard', '--policy', 'onboarding', repo.path], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}', AVARICE_GRAPHIFY_BIN: '/nonexistent' } });
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /: active/);
    const record = recordOf(roots);
    assert.equal(record.indexes.graph, undefined);
    assert.deepEqual(record.indexes.absent?.filter((a) => a.index === 'graph'), [{ index: 'graph', reason: 'graphify-missing' }]);
    assert.ok(!existsSync(join(stagingOf(roots), '.planning', 'graphs', 'graph.json')), 'nothing was installed');
    assert.equal(rows<{ graph_commit: string | null }>(roots, 'SELECT graph_commit FROM project_records')[0]?.graph_commit, null);
    const event = rows<{ data_json: string }>(roots, "SELECT data_json FROM events WHERE type = 'index.absent' ORDER BY seq").map((e) => JSON.parse(e.data_json) as { index: string; reason: string });
    const finding = event.find((e) => e.index === 'code-graph') as { index: string; reason: string; detail?: string; onboardingId?: string } | undefined;
    assert.equal(finding?.reason, 'graphify-missing');
    assert.match(finding?.detail ?? '', /AVARICE_GRAPHIFY_BIN names no executable file/, 'the event says why');
    const status = runCli(['status'], { roots, entry: TEST_CLI, env: { AVARICE_FAKE_HOST: '{}' } });
    assert.match(status.stdout, /graph absent \(graphify-missing\)/);
  });

  for (const [mode, reason] of [
    ['extract-fails', 'extract-failed'],
    ['no-report', 'extract-failed'],
    ['invalid-json', 'invalid-graph'],
    ['documents', 'invalid-graph'],
    ['wrong-commit', 'invalid-graph'],
    ['no-commit', 'invalid-graph'],
  ] as const) {
    it(`graphify mode ${mode}: active, graph absent with reason ${reason}, and nothing installed`, async () => {
      const run = await onboard({ graphifyBin: fakeBin(mode) });
      assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
      assert.deepEqual(absentOf(run).filter((a) => a.index === 'graph'), [{ index: 'graph', reason }]);
      assert.equal(recordOf(run.roots).indexes.graph, undefined);
      assert.ok(!existsSync(join(stagingOf(run.roots), '.planning', 'graphs', 'graph.json')), 'an invalid graph is not installed');
      assert.ok(!run.specs.some((c) => isGsd(c, 'graphify')), 'GSD is not asked about a graph that was not installed');
    });
  }

  it('a graphify run past the executor timeout leaves the graph absent with reason timeout', async () => {
    const run = await onboard({
      graphifyBin: fakeBin('hang'),
      limit: (cmd) => (cmd.argv[1] === 'extract' ? { ...cmd, timeoutMs: 400 } : cmd),
    });
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    assert.deepEqual(absentOf(run).filter((a) => a.index === 'graph'), [{ index: 'graph', reason: 'timeout' }]);
  });

  it('a build commit that GSD reports stale after the install leaves the graph absent with reason stale-after-install', async () => {
    const run = await onboard({
      graphifyBin: fakeBin(),
      wrap: (deps) => {
        const gsd = deps.gsd;
        assert.ok(gsd);
        return {
          ...deps,
          gsd: {
            descriptor: gsd.descriptor,
            inspect: () => gsd.inspect(),
            probeState: (s) => gsd.probeState(s),
            configure: (s, settings) => gsd.configure(s, settings),
            stamp: (s, files) => gsd.stamp(s, files),
            checkDrift: (s) => gsd.checkDrift(s),
            graphifySnapshot: (s) => gsd.graphifySnapshot(s),
            intelValidate: (s) => gsd.intelValidate(s),
            intelDiff: (s) => gsd.intelDiff(s),
            intelStatus: (s) => gsd.intelStatus(s),
            intelQuery: (s, term) => gsd.intelQuery(s, term),
            graphifyQuery: (s, term, budget) => gsd.graphifyQuery(s, term, budget),
            graphifyStatus: async (s) => {
              const real = await gsd.graphifyStatus(s);
              return real.ok ? { ok: true, value: { ...real.value, stale: true, commitStale: true, commitsBehind: 3 } } : real;
            },
            initPlanning: () => gsd.initPlanning(),
          },
        };
      },
    });
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    assert.deepEqual(absentOf(run).filter((a) => a.index === 'graph'), [{ index: 'graph', reason: 'stale-after-install' }]);
  });
});

describe('the final scope check covers writes by an index step (T-01-67)', () => {
  it('a file written into staging while the graph is installed blocks activation with a containment.finding event', async () => {
    const run = await onboard({
      graphifyBin: fakeBin(),
      wrap: (deps) => ({
        ...deps,
        graph: {
          descriptor: deps.graph.descriptor,
          locate: () => deps.graph.locate(),
          extractCode: (s, o) => deps.graph.extractCode(s, o),
          cluster: (o) => deps.graph.cluster(o),
          readGraph: (f) => deps.graph.readGraph(f),
          install: (staging, files) => {
            writeFileSync(join(staging, 'rogue.txt'), 'written by an index step\n');
            return deps.graph.install(staging, files);
          },
          fileSizes: (s, p) => deps.graph.fileSizes(s, p),
          materializeCorpus: (s, p, m, pin, d) => deps.graph.materializeCorpus(s, p, m, pin, d),
          readSkillGraph: (s) => deps.graph.readSkillGraph(s),
          clusterMerged: (g, d) => deps.graph.clusterMerged(g, d),
          installMergedGraph: (s, f) => deps.graph.installMergedGraph(s, f),
        },
      }),
    });
    assert.equal(run.outcome.state, 'blocked');
    assert.equal(run.outcome.reason, 'enforcement_failure');
    assert.equal(rows<{ n: number }>(run.roots, 'SELECT count(*) AS n FROM project_records')[0]?.n, 0);
    const [finding] = rows<{ data_json: string }>(run.roots, "SELECT data_json FROM events WHERE type = 'containment.finding' ORDER BY seq");
    assert.deepEqual((JSON.parse(finding?.data_json ?? '{}') as { check: string; paths: string[] }).paths, ['rogue.txt']);
  });
});

describe('a build that was cut short does not leave files behind for the next one', () => {
  it('extractCode clears the previous graphify-out in its output directory, and only that', async () => {
    const repo = makeScratchRepo({ files: REPO_FILES });
    cleanup.push(repo.base);
    const outDir = join(temp('graph-out'), 'code');
    mkdirSync(join(outDir, 'graphify-out'), { recursive: true });
    writeFileSync(join(outDir, 'graphify-out', 'left-over.txt'), 'from a killed build\n');
    writeFileSync(join(outDir, 'keep.txt'), 'not graphify output\n');
    const tool = new GraphifyTool(new SandboxedExecutor(), { env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), AVARICE_GRAPHIFY_BIN: fakeBin() }, dataRoot: join(temp('graph-data'), 'data'), home: tmpdir() });
    const built = await tool.extractCode(repo.path, outDir);
    assert.ok(built.ok, built.ok ? '' : JSON.stringify(built.error));
    assert.deepEqual(readdirSync(join(outDir, 'graphify-out')), ['graph.json']);
    assert.ok(existsSync(join(outDir, 'keep.txt')));
  });
});

// graphify as the machine has it; the real-tool test skips without it.
function findGraphify(): string | undefined {
  const named = process.env['AVARICE_GRAPHIFY_BIN'];
  const candidates = named !== undefined && named !== '' ? [named] : (process.env['PATH'] ?? '').split(delimiter).filter((d) => d !== '').map((d) => join(d, 'graphify'));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isFile() || lstatSync(realpathSync(candidate)).isFile()) return realpathSync(candidate);
    } catch {
      // next
    }
  }
  return undefined;
}
const GRAPHIFY = findGraphify();

describe('with the real graphify on a scratch repository', { skip: GRAPHIFY === undefined || !existsSync('/usr/bin/sandbox-exec') }, () => {
  it('builds a code-only graph at the onboarded revision, installs it, and GSD reports it present and not stale', async () => {
    const run = await onboard({ graphifyBin: GRAPHIFY as string });
    assert.equal(run.outcome.state, 'active', run.outcome.message ?? '');
    const graph = recordOf(run.roots).indexes.graph;
    assert.ok(graph, `the record lists the graph (absent: ${JSON.stringify(recordOf(run.roots).indexes.absent)})`);
    assert.equal(graph.builtAtCommit, `git:${run.repo.head}`);
    assert.match(graph.tool, /^graphify@\d+\.\d+\.\d+/);
    assert.equal(graph.freshness, 'fresh');
    assert.ok((graph.nodes['code'] ?? 0) > 0, 'it has code nodes');
    assert.equal(graph.nodes['document'], 0, 'and no document nodes');
    const staging = stagingOf(run.roots);
    assert.deepEqual(walk(staging).filter((p) => p.split('/').includes('graphify-out')), []);
    for (const file of ['graph.json', 'code-graph.json', 'GRAPH_REPORT.md']) assert.ok(existsSync(join(staging, '.planning', 'graphs', file)), file);
  });
});
