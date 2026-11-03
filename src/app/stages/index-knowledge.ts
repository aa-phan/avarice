// The `knowledge` index step (ONB-14, S-39 knowledge part, S-45). AVARICE selects the stable documents, copies them into
// `{staging}/.avarice-knowledge/` with a manifest (source path, revision, SHA-256), and runs exactly one contained
// invocation of `/graphify .` with that directory as its working directory and only write root. Document nodes then join
// the code graph through AVARICE's own merge (one ID space), are validated, clustered and installed (see the second half of
// this file). Every failure is an absent index with a reason, never an error, and leaves `graph.json` the code-only graph:
// an index that fails never blocks activation.
import { join } from 'node:path';
import { sha256Hex } from '../../domain/digest.ts';
import { mergeKnowledgeGraph } from '../../domain/graph-merge.ts';
import { CORPUS_LIMITS, KNOWLEDGE_DIR, corpusSummary, knowledgeCandidates, selectKnowledgeCorpus } from '../../domain/knowledge-corpus.ts';
import type { KnowledgeManifest } from '../../domain/knowledge-corpus.ts';
import { validateKnowledgeGraph } from '../../domain/knowledge-validation.ts';
import { summarizeGraph } from '../../domain/graph-validation.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import { ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { GsdGraphStatus } from '../../ports/gsd-onboarding.ts';
import type { AppDeps } from '../deps.ts';
import { completeInvocation, prepareInvocation } from '../invocation.ts';
import type { IndexStepContext } from './index-steps.ts';
import { effectiveMappingMode, mapFileNamesFor } from './shared.ts';

const PROMPT = '/graphify .';
// The skill writes `graphify-out/` in its working directory; the host judges `progressed` by this staging-relative file.
const EXPECTED_GRAPH = `${KNOWLEDGE_DIR}/graphify-out/graph.json`;
const GRAPH_PATH = '.planning/graphs/graph.json';
const CODE_GRAPH_PATH = '.planning/graphs/code-graph.json';
// Matches the size the graph tool refuses to read.
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_DETAIL = 200;
const STORE = 'local';
const RETENTION = 'onboarding';

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);

function absent(reason: string, detail?: string): Result<IndexStepResult> {
  return ok({ index: 'knowledge', status: 'absent', reason, ...(detail !== undefined ? { detail: clip(detail) } : {}) });
}

function describeError(error: PortError): string {
  switch (error.kind) {
    case 'unavailable':
    case 'internal':
      return error.cause;
    case 'invalid':
      return `${error.field}: ${error.reason}`;
    case 'denied':
      return error.rule;
    case 'timeout':
      return `timed out after ${error.afterMs} ms`;
    case 'unsupported':
      return `unsupported: ${error.capability}`;
    default:
      return error.kind;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// Whether the code graph step left a present graph: document nodes need a graph to join, so without one no invocation is
// started (a model call that could not be used).
function codeGraphPresent(deps: AppDeps, onboardingId: string): Result<boolean> {
  const steps = deps.ledger.getStepResults(onboardingId);
  if (!steps.ok) return steps;
  const found = [...steps.value].reverse().find((s) => s.step === 'index:code-graph' && s.status === 'completed');
  return ok(found !== undefined && isObject(found.result) && found.result['status'] === 'present');
}

// Why a tool or GSD call failed: a timeout is `timeout`, a missing graphify is `graphify-missing`, anything else is
// `otherwise`, the reason of the stage the call belongs to.
function reasonOf(error: PortError, otherwise: string): string {
  if (error.kind === 'timeout') return 'timeout';
  if (error.kind === 'unavailable' && error.cause.startsWith('graphify-missing')) return 'graphify-missing';
  return otherwise;
}

// GSD sees the installed graph as present and fresh (the same judgment as the code-graph step).
function gsdSeesFreshGraph(status: GsdGraphStatus): string | undefined {
  if (status.disabled) return 'graphify is disabled in the staging GSD config';
  if (!status.exists) return 'GSD finds no graph in .planning/graphs';
  if (status.stale) return 'GSD reports the graph stale';
  if (status.commitStale === true) return `GSD reports the graph ${status.commitsBehind ?? 'some'} commit(s) behind HEAD`;
  return undefined;
}

// Puts the code-only graph back after a merged graph was installed and then rejected: the file the code-graph step built
// (still in its work directory) goes over graph.json and GRAPH_REPORT.md, `code-graph.json` is rewritten with the same bytes,
// and GSD's snapshot is taken again for it. Best effort: the answer says whether it worked.
async function restoreCodeOnly(deps: AppDeps, ctx: IndexStepContext): Promise<boolean> {
  const built = join(deps.profile.workRoot, ctx.row.onboardingId, 'graph-build', 'code', 'graphify-out');
  const installed = deps.graph.install(ctx.staging, { graph: join(built, 'graph.json'), report: join(built, 'GRAPH_REPORT.md') });
  if (!installed.ok) return false;
  if (deps.gsd !== undefined) await deps.gsd.graphifySnapshot(ctx.staging);
  return true;
}

export async function runKnowledgeStep(deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.knowledge) return ok({ index: 'knowledge', status: 'disabled' });
  const { staging, head, row, contract } = ctx;

  const present = codeGraphPresent(deps, row.onboardingId);
  if (!present.ok) return present;
  if (!present.value) return absent('graph-absent', 'there is no code graph for document nodes to join');

  // 1. Select. Candidates come from the pinned tree and the generated map; sizes from staging; the rules are the domain's.
  const tracked = deps.staging.listTracked(staging, head);
  if (!tracked.ok) return absent('invocation-failed', `cannot list the tracked files: ${describeError(tracked.error)}`);
  const mode = effectiveMappingMode(deps, row.onboardingId, contract.body);
  if (!mode.ok) return mode;
  const preflight = isObject(row.preflight) ? row.preflight : {};
  const adrDirs = Array.isArray(preflight['adrDirs']) ? preflight['adrDirs'].filter((d): d is string => typeof d === 'string') : [];
  const rules = { trackedPaths: tracked.value, mapFiles: mapFileNamesFor(mode.value), adrDirs, documentGlobs: contract.body.knowledge.documents };
  const sizes = deps.graph.fileSizes(staging, knowledgeCandidates(rules));
  if (!sizes.ok) return absent('invocation-failed', `cannot stat the corpus files: ${describeError(sizes.error)}`);
  const selection = selectKnowledgeCorpus({ ...rules, sizes: sizes.value, secretGlobs: contract.body.files.secretGlobs });

  // 2. Copy with a manifest, in the data root and as an artifact (never inside the corpus).
  const manifestFile = join(deps.profile.dataRoot, 'onboard', row.onboardingId, 'knowledge', 'manifest.json');
  const materialized = deps.graph.materializeCorpus(staging, selection.paths, manifestFile, head, selection.dropped);
  if (!materialized.ok) return absent('invocation-failed', `cannot build the corpus: ${describeError(materialized.error)}`);
  const manifest = materialized.value.manifest;
  const stored = deps.artifacts.put(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), { kind: 'knowledge-manifest', runId: contract.runId });
  if (!stored.ok) return stored;
  const recorded = deps.ledger.recordArtifact({
    digest: stored.value.digest,
    size: stored.value.size,
    kind: 'knowledge-manifest',
    runId: contract.runId,
    retention: RETENTION,
    store: STORE,
    nowMs: deps.clock.nowMs(),
  });
  if (!recorded.ok) return recorded;
  if (manifest.entries.length === 0) return absent('no-output', 'the corpus holds no document');

  // 3. One contained invocation. One subagent per 20 documents, at least one.
  const subagentsTotal = Math.max(1, Math.ceil(manifest.entries.length / CORPUS_LIMITS.documentsPerSubagent));
  const prepared = prepareInvocation(deps, row, 'knowledge', PROMPT, { expectedFiles: [EXPECTED_GRAPH], subagentsTotal });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) return absent('budget_exhausted', `the ${prepared.value.budget} budget is exhausted, so no knowledge invocation was started`);
  const { request } = prepared.value.prepared;

  const invoked = await deps.host.invoke(request, AbortSignal.timeout(Math.max(request.wallClockMs, 1)));
  // Settle first, whatever happened: the invocation ran, so its unit, its time and its cost are spent.
  const settled = completeInvocation(deps, prepared.value.prepared, invoked);
  if (!settled.ok) return absent('invocation-failed', describeError(settled.error));
  const o = settled.value;

  // A staging HEAD that moved is a containment finding, as in the map stage: the host may not move the branch.
  if (o.details?.headMoved === true) {
    const finding = deps.ledger.appendEvent({
      type: 'containment.finding',
      level: 'warn',
      runId: request.runId,
      invocationId: request.invocationId,
      data: { onboardingId: row.onboardingId, invocationId: request.invocationId, check: 'staging-head-moved' },
      nowMs: deps.clock.nowMs(),
    });
    if (!finding.ok) return finding;
    return absent('invocation-failed', 'the staging HEAD moved during the knowledge invocation');
  }
  const denials = deps.ledger.countBudgetDenials(request.runId, request.invocationId);
  if (!denials.ok) return denials;
  if (denials.value > 0 || o.kind === 'budget_exhausted') return absent('budget_exhausted', 'the knowledge invocation exhausted its budget');
  // Only these two endings are judged by what is in staging; a denied or failed run is not trusted.
  if (o.kind !== 'progressed' && o.kind !== 'inconclusive') return absent('invocation-failed', `the knowledge invocation ended ${o.kind}`);

  const skill = deps.graph.readSkillGraph(staging);
  if (!skill.ok) {
    return skill.error.kind === 'not_found' ? absent('no-output', 'the pass left no graphify-out/graph.json') : absent('validation-failed', describeError(skill.error));
  }

  return mergeAndInstall(deps, ctx, manifest, skill.value.raw);
}

// The second half: AVARICE merges the skill graph into the code graph (one ID space), validates the merge, has graphify
// cluster it, validates what came back, and only then replaces graph.json. Every refusal leaves graph.json the code-only
// graph byte for byte.
async function mergeAndInstall(deps: AppDeps, ctx: IndexStepContext, manifest: KnowledgeManifest, skillGraph: Record<string, unknown>): Promise<Result<IndexStepResult>> {
  const { staging, head, row } = ctx;

  const code = deps.graph.readGraph(join(staging, CODE_GRAPH_PATH));
  if (!code.ok) return absent('validation-failed', `the code graph cannot be read for the merge: ${describeError(code.error)}`);
  const { graph, stats } = mergeKnowledgeGraph({ code: code.value.raw, docs: skillGraph, manifest, onboardedRevision: head });
  const checked = validateKnowledgeGraph(graph, manifest, stats);
  if (!checked.valid) return absent('validation-failed', checked.problems.join('; '));

  // Outside the staging tree: {workRoot}/{onb}/graph-build/merged (staging is {workRoot}/{onb}/staging).
  const clustered = await deps.graph.clusterMerged(graph, join(deps.profile.workRoot, row.onboardingId, 'graph-build', 'merged'));
  if (!clustered.ok) return absent(reasonOf(clustered.error, 'cluster-failed'), describeError(clustered.error));
  // What graphify wrote back is what would be installed, so it is judged too.
  const rechecked = validateKnowledgeGraph(clustered.value.graph.raw, manifest, stats);
  if (!rechecked.valid) return absent('validation-failed', `after clustering: ${rechecked.problems.join('; ')}`);

  const installed = deps.graph.installMergedGraph(staging, { graph: clustered.value.graphFile, report: clustered.value.reportFile });
  if (!installed.ok) return absent('cluster-failed', `the merged graph cannot be installed: ${describeError(installed.error)}`);

  // From here graph.json is the merge: any further failure puts the code-only graph back.
  const rollback = async (reason: string, detail: string): Promise<Result<IndexStepResult>> => {
    const restored = await restoreCodeOnly(deps, ctx);
    return absent(reason, restored ? detail : `${detail}; the code-only graph could not be restored`);
  };
  const text = deps.staging.read(staging, GRAPH_PATH, MAX_GRAPH_BYTES);
  if (!text.ok || text.value === null) return rollback('cluster-failed', 'the installed merged graph cannot be read back');
  const graphDigest = `sha256:${sha256Hex(Buffer.from(text.value, 'utf8'))}`;

  if (deps.gsd === undefined) return rollback('stale-after-install', 'no GSD adapter to snapshot the merged graph');
  const snapshot = await deps.gsd.graphifySnapshot(staging);
  if (!snapshot.ok) return rollback(reasonOf(snapshot.error, 'stale-after-install'), describeError(snapshot.error));
  const status = await deps.gsd.graphifyStatus(staging);
  if (!status.ok) return rollback(reasonOf(status.error, 'stale-after-install'), describeError(status.error));
  const problem = gsdSeesFreshGraph(status.value);
  if (problem !== undefined) return rollback('stale-after-install', problem);

  const summary = summarizeGraph(clustered.value.graph.raw);
  return ok({
    index: 'knowledge',
    status: 'present',
    result: {
      graphDigest,
      // Counts of the merged file the digest is of: `document` is no longer zero.
      nodes: { document: 0, ...summary.nodesByFileType },
      edges: summary.edgesByConfidence,
      knowledge: {
        corpus: corpusSummary(manifest.entries.map((e) => e.sourcePath)),
        documentsCommit: `git:${head}`,
        documentNodes: stats.documentNodes,
        dropped: { dangling: stats.dropped.dangling, astDocument: stats.dropped.astDocument },
      },
    },
  });
}
