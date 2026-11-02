// Plan 01-13 Task 2: the graph tool adapter against the real graphify 0.9.x, run through the sandboxed
// executor. Scratch repositories and temp directories only; no model is called, no network is used.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { SandboxedExecutor } from '../../src/adapters/exec/sandboxed-executor.ts';
import { GraphifyTool } from '../../src/adapters/graph/graphify.ts';
import type { CommandExecutor, CommandSpec } from '../../src/ports/command-executor.ts';
import { REPO_ROOT } from '../helpers/run-cli.ts';
import { checkoutSnapshot, makeScratchRepo } from '../helpers/scratch-repo.ts';
import type { ScratchRepo } from '../helpers/scratch-repo.ts';

const HOME = process.env['HOME'] ?? tmpdir();
const SYSTEM_PATH = '/usr/bin:/bin';

// graphify as the machine has it, or undefined (the real-tool tests then skip).
function findGraphify(): string | undefined {
  const fromEnv = process.env['AVARICE_GRAPHIFY_BIN'];
  const candidates = fromEnv !== undefined && fromEnv !== '' ? [fromEnv] : (process.env['PATH'] ?? '').split(delimiter).filter((d) => d !== '').map((d) => join(d, 'graphify'));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // next
    }
  }
  return undefined;
}
const GRAPHIFY = findGraphify();
const SANDBOX = existsSync('/usr/bin/sandbox-exec');
const REAL = GRAPHIFY !== undefined && SANDBOX;

const cleanup: string[] = [];
after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `avarice-${prefix}-`)));
  cleanup.push(dir);
  return dir;
}

const CODE = {
  'README.md': '# scratch\n',
  'src/a.ts': 'export function a(): number {\n  return b();\n}\nexport function b(): number {\n  return 1;\n}\n',
  'src/m.py': 'def f():\n    return g()\n\n\ndef g():\n    return 2\n',
};

function tool(executor: CommandExecutor = new SandboxedExecutor(), env: NodeJS.ProcessEnv = {}): GraphifyTool {
  return new GraphifyTool(executor, {
    env: { PATH: `${GRAPHIFY === undefined ? '' : join(GRAPHIFY, '..')}${delimiter}${SYSTEM_PATH}`, HOME, LANG: 'C', ...env },
    dataRoot: join(temp('graph-data'), 'data'),
    home: HOME,
  });
}

function recording(inner: CommandExecutor): { executor: CommandExecutor; specs: CommandSpec[] } {
  const specs: CommandSpec[] = [];
  return {
    specs,
    executor: {
      descriptor: inner.descriptor,
      run: (cmd, signal) => {
        specs.push(cmd);
        return inner.run(cmd, signal);
      },
    },
  };
}

describe('GraphifyTool.locate', { skip: !REAL }, () => {
  it('finds graphify from AVARICE_GRAPHIFY_BIN and reports its version', async () => {
    const located = await tool(new SandboxedExecutor(), { AVARICE_GRAPHIFY_BIN: GRAPHIFY as string }).locate();
    assert.ok(located.ok, JSON.stringify(located));
    assert.equal(located.value.bin, GRAPHIFY);
    assert.match(located.value.version, /^\d+\.\d+\.\d+/);
  });

  it('finds graphify on PATH when AVARICE_GRAPHIFY_BIN is not set', async () => {
    const located = await tool().locate();
    assert.ok(located.ok, JSON.stringify(located));
    assert.equal(located.value.bin, GRAPHIFY);
  });

  it('reports a missing binary as unavailable with reason graphify-missing', async () => {
    const bad = await tool(new SandboxedExecutor(), { AVARICE_GRAPHIFY_BIN: '/nonexistent/graphify' }).locate();
    assert.ok(!bad.ok);
    assert.equal(bad.error.kind, 'unavailable');
    assert.match((bad.error as { cause: string }).cause, /^graphify-missing/);

    const noPath = await new GraphifyTool(new SandboxedExecutor(), { env: { PATH: SYSTEM_PATH, HOME }, dataRoot: join(temp('d'), 'data'), home: HOME }).locate();
    assert.ok(!noPath.ok);
    assert.match((noPath.error as { cause: string }).cause, /^graphify-missing/);
  });
});

describe('GraphifyTool extract and cluster', { skip: !REAL }, () => {
  let repo: ScratchRepo;
  let outDir: string;
  before(() => {
    repo = makeScratchRepo({ files: CODE });
    cleanup.push(repo.base);
    outDir = join(temp('graph-out'), 'out');
  });

  it('extracts a code-only graph into outDir at the staging HEAD and adds nothing to the staging tree', async () => {
    const before = checkoutSnapshot(repo.path);
    const { executor, specs } = recording(new SandboxedExecutor());
    const built = await tool(executor).extractCode(repo.path, outDir);
    assert.ok(built.ok, JSON.stringify(built));
    assert.equal(built.value.graphFile, join(outDir, 'graphify-out', 'graph.json'));

    const graph = tool().readGraph(built.value.graphFile);
    assert.ok(graph.ok, JSON.stringify(graph));
    assert.equal(graph.value.builtAtCommit, repo.head);
    assert.ok(graph.value.nodes.length >= 4, `${graph.value.nodes.length} nodes`);
    assert.ok(graph.value.nodes.every((n) => n['file_type'] !== 'document'), 'code only: no document nodes');

    assert.deepEqual(checkoutSnapshot(repo.path), before, 'the staging tree is unchanged (digest, HEAD, status)');
    assert.equal(existsSync(join(repo.path, 'graphify-out')), false);

    assert.equal(specs.length, 1);
    const argv = specs[0]?.argv ?? [];
    assert.deepEqual(argv.slice(1), ['extract', repo.path, '--code-only', '--out', outDir, '--max-workers', '1']);
    assert.deepEqual(specs[0]?.writePaths, [outDir], 'only outDir is writable');
    assert.equal(specs[0]?.timeoutMs, 300_000);
    assert.equal(specs[0]?.cwd, repo.path);
  });

  it('clusters the extraction: rewrites graph.json, writes GRAPH_REPORT.md and keeps built_at_commit', async () => {
    const graphFile = join(outDir, 'graphify-out', 'graph.json');
    const before = readFileSync(graphFile, 'utf8');
    const { executor, specs } = recording(new SandboxedExecutor());
    const clustered = await tool(executor).cluster(outDir);
    assert.ok(clustered.ok, JSON.stringify(clustered));
    assert.equal(clustered.value.reportFile, join(outDir, 'graphify-out', 'GRAPH_REPORT.md'));
    assert.ok(existsSync(join(outDir, 'graphify-out', 'GRAPH_REPORT.md')));
    const graph = tool().readGraph(graphFile);
    assert.ok(graph.ok);
    assert.equal(graph.value.builtAtCommit, repo.head);
    assert.ok(readFileSync(graphFile, 'utf8').length > 0 && before.length > 0);
    assert.deepEqual(specs[0]?.argv.slice(1), ['cluster-only', outDir, '--no-label', '--no-viz']);
    assert.deepEqual(specs[0]?.writePaths, [outDir]);
    assert.equal(existsSync(join(outDir, 'graphify-out', 'graph.html')), false, '--no-viz');
  });

  it('install copies graph.json twice and the report into .planning/graphs and nothing else', () => {
    const staging = makeScratchRepo({ files: CODE });
    cleanup.push(staging.base);
    const installed = tool().install(staging.path, { graph: join(outDir, 'graphify-out', 'graph.json'), report: join(outDir, 'graphify-out', 'GRAPH_REPORT.md') });
    assert.ok(installed.ok, JSON.stringify(installed));
    const dir = join(staging.path, '.planning', 'graphs');
    assert.deepEqual(readdirSync(dir).sort(), ['GRAPH_REPORT.md', 'code-graph.json', 'graph.json']);
    assert.equal(readFileSync(join(dir, 'graph.json'), 'utf8'), readFileSync(join(outDir, 'graphify-out', 'graph.json'), 'utf8'));
    assert.equal(readFileSync(join(dir, 'code-graph.json'), 'utf8'), readFileSync(join(dir, 'graph.json'), 'utf8'));
    assert.deepEqual(readdirSync(join(staging.path, '.planning')), ['graphs']);
  });

  it('install refuses a .planning/graphs that is a symlink out of the tree and writes nothing through it', () => {
    const staging = makeScratchRepo({ files: CODE });
    cleanup.push(staging.base);
    const elsewhere = temp('elsewhere');
    mkdirSync(join(staging.path, '.planning'));
    symlinkSync(elsewhere, join(staging.path, '.planning', 'graphs'));
    const installed = tool().install(staging.path, { graph: join(outDir, 'graphify-out', 'graph.json'), report: join(outDir, 'graphify-out', 'GRAPH_REPORT.md') });
    assert.ok(!installed.ok);
    assert.equal(installed.error.kind, 'invalid');
    assert.deepEqual(readdirSync(elsewhere), []);
  });
});

describe('GraphifyTool without graphify or a sandbox', () => {
  it('refuses an outDir inside the staging tree', async () => {
    const staging = makeScratchRepo({ files: CODE });
    cleanup.push(staging.base);
    const { executor, specs } = recording(new SandboxedExecutor());
    const built = await tool(executor, GRAPHIFY === undefined ? {} : { AVARICE_GRAPHIFY_BIN: GRAPHIFY }).extractCode(staging.path, join(staging.path, 'graphify-out'));
    assert.ok(!built.ok);
    assert.equal(built.error.kind, 'invalid');
    assert.equal(specs.length, 0, 'nothing was run');
  });

  it('does not run graphify when the sandbox is unavailable', { skip: GRAPHIFY === undefined || !SANDBOX }, async () => {
    const staging = makeScratchRepo({ files: CODE });
    cleanup.push(staging.base);
    const out = join(temp('graph-out'), 'out');
    const built = await tool(new SandboxedExecutor({ sandboxExecPath: '/usr/bin/false' })).extractCode(staging.path, out);
    assert.ok(!built.ok);
    assert.equal(built.error.kind, 'unavailable');
    assert.match((built.error as { cause: string }).cause, /sandbox/);
    assert.equal(existsSync(join(out, 'graphify-out')), false);
  });

  it('readGraph parses graph.json, and refuses a file over 64 MiB and a file that is not JSON', () => {
    const dir = temp('read');
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ nodes: [{ id: 'a' }], links: [], built_at_commit: 'abc' }));
    const ok = tool().readGraph(join(dir, 'ok.json'));
    assert.ok(ok.ok);
    assert.equal(ok.value.builtAtCommit, 'abc');
    assert.equal(ok.value.nodes.length, 1);

    writeFileSync(join(dir, 'big.json'), '');
    truncateSync(join(dir, 'big.json'), 64 * 1024 * 1024 + 1);
    const big = tool().readGraph(join(dir, 'big.json'));
    assert.ok(!big.ok);

    writeFileSync(join(dir, 'bad.json'), 'not json');
    assert.ok(!tool().readGraph(join(dir, 'bad.json')).ok);
    assert.ok(!tool().readGraph(join(dir, 'missing.json')).ok);
  });

  it('declares the code-graph commands and never graphify update or merge-graphs', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'adapters', 'graph', 'graphify.ts'), 'utf8');
    assert.match(source, /code-only/);
    assert.match(source, /max-workers/);
    assert.equal(/'update'|merge-graphs/.test(source), false);
    const d = tool().descriptor;
    assert.equal(d.port, 'graph-tool');
    assert.equal(d.adapter, 'graphify');
    assert.equal(d.offline, true);
  });
});
