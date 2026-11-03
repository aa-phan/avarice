// GraphifyTool: the GraphTool adapter for graphify 0.9.x (ONB-4, T-01-37). Every graphify command runs through
// the sandboxed CommandExecutor (no network) with exactly one writable path, the output directory, which lies
// outside the staging tree:
//   graphify extract {staging} --code-only --out {outDir} --max-workers 1
//   graphify cluster-only {outDir} --no-label --no-viz
// `extract --code-only` indexes code files only. `graphify update` is never used: it writes into the tree and
// indexes Markdown (research Pitfall 3). `--max-workers 1` keeps AST extraction single-process, which sandboxes
// require (spike). No command here calls a model. The graph is read back as plain JSON, and `install` copies
// three files into the staging `.planning/graphs/`.
// The knowledge pass (plan 01-18) adds no graphify command of its own: the skill runs in the host. `clusterMerged`
// writes AVARICE's merged graph outside staging and runs the same `cluster-only` on it; graphify's cross-repository
// merge command is never used (it prefixes node IDs and drops `built_at_commit`).
import { accessSync, constants, copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CommandExecutor, CommandResult } from '../../ports/command-executor.ts';
import type { CorpusDrop, KnowledgeManifest } from '../../domain/knowledge-corpus.ts';
import type { GraphBuild, GraphData, GraphInstallFiles, GraphTool, LocatedGraphTool, MergedGraphBuild } from '../../ports/graph-tool.ts';
import { realpathNearest } from '../fs/profile-paths.ts';
import { safeGitEnv } from '../git/safe-git.ts';
import { fileSizes, materializeCorpus, readSkillGraph } from './knowledge-corpus.ts';

// Operation budgets: a code extraction may take five minutes, the other graphify commands far less.
export const EXTRACT_TIMEOUT_MS = 300_000;
export const CLUSTER_TIMEOUT_MS = 120_000;
export const VERSION_TIMEOUT_MS = 15_000;
export const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
export const GRAPHIFY_BIN_ENV = 'AVARICE_GRAPHIFY_BIN';
const GRAPH_DIR = 'graphify-out';
const SYSTEM_PATH = ['/usr/bin', '/bin', '/opt/homebrew/bin'];
const PASSTHROUGH = ['HOME', 'LANG', 'TMPDIR'];

export interface GraphifyToolOptions {
  // Where AVARICE_GRAPHIFY_BIN and PATH are read from; defaults to this process's environment.
  env?: NodeJS.ProcessEnv;
  // Denied for reading, with the user's credential stores under `home`.
  dataRoot: string;
  home: string;
}

function isExecutable(path: string): boolean {
  try {
    if (!lstatSync(path).isFile() && !lstatSync(realpathSync(path)).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The graphify executable: AVARICE_GRAPHIFY_BIN when set (and then nothing else), else the first `graphify` on PATH.
export function findGraphifyBinary(env: NodeJS.ProcessEnv): string | undefined {
  const named = env[GRAPHIFY_BIN_ENV];
  const candidates = named !== undefined && named !== '' ? [named] : (env['PATH'] ?? '').split(delimiter).filter((d) => isAbsolute(d)).map((d) => join(d, 'graphify'));
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && isExecutable(candidate)) return realpathSync(candidate);
  }
  return undefined;
}

function missing(detail: string): Result<never> {
  return err({ kind: 'unavailable', cause: `graphify-missing: ${detail}` });
}

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function failure(what: string, result: CommandResult): Result<never> {
  if (result.status === 'timed_out' || result.status === 'cancelled') return err({ kind: 'timeout', afterMs: result.durationMs, sideEffect: 'unknown' });
  const reason = (result.stderr.trim().split('\n').filter((l) => l !== '').pop() ?? '').slice(0, 200);
  if (result.status === 'spawn_error') return err({ kind: 'unavailable', cause: `${what} could not run: ${result.stderr}` });
  return err({ kind: 'internal', cause: `${what} exited ${result.exitCode ?? result.signal ?? 'abnormally'}: ${reason}` });
}

export class GraphifyTool implements GraphTool {
  readonly descriptor: CapabilityDescriptor;
  readonly #executor: CommandExecutor;
  readonly #env: NodeJS.ProcessEnv;
  readonly #denyRead: readonly string[];
  #located: LocatedGraphTool | undefined;

  constructor(executor: CommandExecutor, options: GraphifyToolOptions) {
    this.#executor = executor;
    this.#env = options.env ?? process.env;
    this.#denyRead = [options.dataRoot, join(options.home, '.ssh'), join(options.home, '.aws'), join(options.home, '.config', 'gh')];
    this.descriptor = {
      port: 'graph-tool',
      adapter: 'graphify',
      version: '0.9',
      capabilities: { 'extract-code': true, cluster: true, 'knowledge-pass': true },
      // The path only (nothing is executed to build a descriptor); the version is read by `locate`.
      attributes: { binary: findGraphifyBinary(this.#env) ?? 'missing' },
      offline: true,
    };
  }

  #commandEnv(bin: string): Record<string, string> {
    const env: Record<string, string> = { ...safeGitEnv(this.#env) };
    for (const name of PASSTHROUGH) {
      const value = this.#env[name];
      if (value !== undefined && value !== '') env[name] = value;
    }
    env['PATH'] = [dirname(bin), ...SYSTEM_PATH].join(':');
    env['PYTHONDONTWRITEBYTECODE'] = '1';
    env['NO_COLOR'] = '1';
    return env;
  }

  async #run(bin: string, args: readonly string[], cwd: string, writePaths: readonly string[], timeoutMs: number, id: string): Promise<Result<CommandResult>> {
    return this.#executor.run({
      argv: [bin, ...args],
      cwd,
      env: this.#commandEnv(bin),
      timeoutMs,
      invocationId: `graphify:${id}`,
      writePaths,
      denyReadPaths: this.#denyRead,
    });
  }

  async locate(): Promise<Result<LocatedGraphTool>> {
    if (this.#located !== undefined) return ok(this.#located);
    const bin = findGraphifyBinary(this.#env);
    if (bin === undefined) {
      const named = this.#env[GRAPHIFY_BIN_ENV];
      return missing(named !== undefined && named !== '' ? `${GRAPHIFY_BIN_ENV} names no executable file (${named})` : 'no executable named graphify on PATH');
    }
    const ran = await this.#run(bin, ['--version'], realpathSync(tmpdir()), [], VERSION_TIMEOUT_MS, 'version');
    if (!ran.ok) return ran;
    if (ran.value.status !== 'passed') return failure('graphify --version', ran.value);
    const version = /\d+\.\d+\.\d+\S*/.exec(ran.value.stdout)?.[0];
    if (version === undefined) return err({ kind: 'internal', cause: `graphify --version printed no version (${ran.value.stdout.trim().slice(0, 80)})` });
    this.#located = { bin, version };
    return ok(this.#located);
  }

  async extractCode(stagingPath: string, outDir: string): Promise<Result<GraphBuild>> {
    if (!isAbsolute(stagingPath) || !isAbsolute(outDir)) return err({ kind: 'invalid', field: 'path', reason: 'the staging path and outDir must be absolute' });
    let staging: string;
    let out: string;
    try {
      staging = realpathSync(stagingPath);
      out = realpathNearest(outDir);
    } catch {
      return err({ kind: 'invalid', field: 'stagingPath', reason: 'the staging path cannot be resolved' });
    }
    if (inside(staging, out) || inside(out, staging)) {
      return err({ kind: 'invalid', field: 'outDir', reason: 'the output directory must be outside the staging tree, and the staging tree outside it' });
    }
    const located = await this.locate();
    if (!located.ok) return located;
    try {
      mkdirSync(out, { recursive: true });
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot create the graph output directory: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
    // A build that was cut short (a killed onboarding, resumed) must not leave its files behind for this one.
    try {
      rmSync(join(out, GRAPH_DIR), { recursive: true, force: true });
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot clear the previous graph output: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
    const ran = await this.#run(located.value.bin, ['extract', staging, '--code-only', '--out', out, '--max-workers', '1'], staging, [out], EXTRACT_TIMEOUT_MS, 'extract');
    if (!ran.ok) return ran;
    if (ran.value.status !== 'passed') return failure('graphify extract', ran.value);
    const graphFile = join(out, GRAPH_DIR, 'graph.json');
    try {
      if (!lstatSync(graphFile).isFile()) throw new Error('not a file');
    } catch {
      return err({ kind: 'internal', cause: 'graphify extract finished without writing graph.json' });
    }
    return ok({ outDir: out, graphFile });
  }

  async cluster(outDir: string): Promise<Result<GraphBuild>> {
    if (!isAbsolute(outDir)) return err({ kind: 'invalid', field: 'outDir', reason: 'must be an absolute path' });
    let out: string;
    try {
      out = realpathSync(outDir);
    } catch {
      return err({ kind: 'invalid', field: 'outDir', reason: 'does not exist' });
    }
    const graphFile = join(out, GRAPH_DIR, 'graph.json');
    if (!existsFile(graphFile)) return err({ kind: 'invalid', field: 'outDir', reason: 'holds no graphify-out/graph.json to cluster' });
    const located = await this.locate();
    if (!located.ok) return located;
    const ran = await this.#run(located.value.bin, ['cluster-only', out, '--no-label', '--no-viz'], out, [out], CLUSTER_TIMEOUT_MS, 'cluster');
    if (!ran.ok) return ran;
    if (ran.value.status !== 'passed') return failure('graphify cluster-only', ran.value);
    const reportFile = join(out, GRAPH_DIR, 'GRAPH_REPORT.md');
    if (!existsFile(reportFile)) return err({ kind: 'internal', cause: 'graphify cluster-only finished without writing GRAPH_REPORT.md' });
    return ok({ outDir: out, graphFile, reportFile });
  }

  readGraph(file: string): Result<GraphData> {
    let text: string;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile()) return err({ kind: 'invalid', field: 'file', reason: 'is not a regular file' });
      if (stat.size > MAX_GRAPH_BYTES) return err({ kind: 'invalid', field: 'file', reason: `is larger than ${MAX_GRAPH_BYTES} bytes` });
      text = readFileSync(file, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return code === 'ENOENT' ? err({ kind: 'not_found', ref: file }) : err({ kind: 'internal', cause: `cannot read the graph: ${code ?? 'error'}` });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return err({ kind: 'invalid', field: 'file', reason: 'is not JSON' });
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err({ kind: 'invalid', field: 'file', reason: 'is not a JSON object' });
    const doc = raw as Record<string, unknown>;
    const nodes = doc['nodes'];
    const links = doc['links'] ?? doc['edges'];
    if (!Array.isArray(nodes) || !Array.isArray(links)) return err({ kind: 'invalid', field: 'file', reason: 'has no nodes and links arrays' });
    const records = (list: unknown[]): Array<Record<string, unknown>> => list.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x));
    const built = doc['built_at_commit'];
    return ok({ builtAtCommit: typeof built === 'string' && built !== '' ? built : null, nodes: records(nodes), links: records(links), raw: doc });
  }

  install(stagingPath: string, files: GraphInstallFiles): Result<string[]> {
    for (const [field, source] of [['graph', files.graph], ['report', files.report]] as const) {
      if (!isAbsolute(source) || !existsFile(source)) return err({ kind: 'invalid', field, reason: 'must be an absolute path of a regular file' });
    }
    const dir = graphsDirOf(stagingPath);
    if (!dir.ok) return dir;
    try {
      const targets: Array<[string, string]> = [
        [files.graph, join(dir.value, 'graph.json')],
        [files.graph, join(dir.value, 'code-graph.json')],
        [files.report, join(dir.value, 'GRAPH_REPORT.md')],
      ];
      for (const [source, target] of targets) {
        rmSync(target, { force: true });
        copyFileSync(source, target, constants.COPYFILE_EXCL);
      }
      return ok(targets.map(([, target]) => target));
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot install the graph into .planning/graphs: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
  }

  fileSizes(stagingPath: string, paths: readonly string[]): Result<Record<string, number>> {
    return fileSizes(stagingPath, paths);
  }

  materializeCorpus(stagingPath: string, paths: readonly string[], manifestFile: string, pin: string, dropped: readonly CorpusDrop[] = []): Result<{ manifest: KnowledgeManifest }> {
    return materializeCorpus(stagingPath, paths, manifestFile, pin, dropped);
  }

  readSkillGraph(stagingPath: string): Result<GraphData> {
    return readSkillGraph(stagingPath, (file) => this.readGraph(file));
  }

  async clusterMerged(graph: Record<string, unknown>, workDir: string): Promise<Result<MergedGraphBuild>> {
    if (!isAbsolute(workDir)) return err({ kind: 'invalid', field: 'workDir', reason: 'must be an absolute path' });
    const built = graph['built_at_commit'];
    if (typeof built !== 'string' || built === '') return err({ kind: 'invalid', field: 'graph', reason: 'the merged graph has no built_at_commit' });
    let dir: string;
    try {
      dir = realpathNearest(workDir);
      mkdirSync(join(dir, GRAPH_DIR), { recursive: true });
      // A merge that was cut short (a killed onboarding, resumed) must not leave its files behind for this one.
      rmSync(join(dir, GRAPH_DIR), { recursive: true, force: true });
      mkdirSync(join(dir, GRAPH_DIR), { recursive: true });
      writeFileSync(join(dir, GRAPH_DIR, 'graph.json'), JSON.stringify(graph));
    } catch (e) {
      return err({ kind: 'internal', cause: `cannot write the merged graph: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
    const clustered = await this.cluster(dir);
    if (!clustered.ok) return clustered;
    if (clustered.value.reportFile === undefined) return err({ kind: 'internal', cause: 'graphify cluster-only wrote no report' });
    const read = this.readGraph(clustered.value.graphFile);
    if (!read.ok) return read;
    if (read.value.builtAtCommit !== built) return err({ kind: 'internal', cause: 'graphify cluster-only did not keep built_at_commit on the merged graph' });
    return ok({ outDir: clustered.value.outDir, graphFile: clustered.value.graphFile, reportFile: clustered.value.reportFile, graph: read.value });
  }

  installMergedGraph(stagingPath: string, files: GraphInstallFiles): Result<string[]> {
    for (const [field, source] of [['graph', files.graph], ['report', files.report]] as const) {
      if (!isAbsolute(source) || !existsFile(source)) return err({ kind: 'invalid', field, reason: 'must be an absolute path of a regular file' });
    }
    const dir = graphsDirOf(stagingPath);
    if (!dir.ok) return dir;
    const targets: Array<[string, string]> = [
      [files.graph, join(dir.value, 'graph.json')],
      [files.report, join(dir.value, 'GRAPH_REPORT.md')],
    ];
    const temps: string[] = [];
    try {
      // Each file is copied beside its target and renamed over it, so a failure leaves the code-only graph in place.
      for (const [source, target] of targets) {
        const temp = `${target}.tmp-${process.pid}`;
        temps.push(temp);
        rmSync(temp, { force: true });
        copyFileSync(source, temp, constants.COPYFILE_EXCL);
      }
      targets.forEach(([, target], index) => renameSync(temps[index] as string, target));
      return ok(targets.map(([, target]) => target));
    } catch (e) {
      for (const temp of temps) rmSync(temp, { force: true });
      return err({ kind: 'internal', cause: `cannot install the merged graph into .planning/graphs: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
    }
  }
}

// `.planning/graphs` inside staging, created when absent; never through a symlink (a repository can commit `.planning` or
// `.planning/graphs` as one).
function graphsDirOf(stagingPath: string): Result<string> {
  let staging: string;
  try {
    staging = realpathSync(stagingPath);
  } catch {
    return err({ kind: 'invalid', field: 'stagingPath', reason: 'cannot be resolved' });
  }
  const planning = join(staging, '.planning');
  const graphs = join(planning, 'graphs');
  try {
    for (const dir of [planning, graphs]) {
      let stat;
      try {
        stat = lstatSync(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          mkdirSync(dir);
          continue;
        }
        throw e;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) return err({ kind: 'invalid', field: 'stagingPath', reason: `${relative(staging, dir)} is a symlink or not a directory` });
    }
    if (!inside(staging, realpathSync(graphs))) return err({ kind: 'invalid', field: 'stagingPath', reason: '.planning/graphs resolves outside the staging tree' });
  } catch (e) {
    return err({ kind: 'internal', cause: `cannot prepare .planning/graphs: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
  }
  return ok(graphs);
}

function existsFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
