// The `code-graph` index step (ONB-13, S-39 code part). With the GraphTool, outside the staging tree: extract the
// code (no model), cluster, read the graph back and validate it; then install `graph.json`, `code-graph.json` and
// `GRAPH_REPORT.md` into staging `.planning/graphs/`, have GSD write its diff snapshot and require GSD to report
// the graph present and not stale. Every failure is an absent index with a reason, never an error: an index that
// fails never blocks activation. The build is stamped with `git:` and the staging HEAD, the onboarded revision.
import { join } from 'node:path';
import { sha256Hex } from '../../domain/digest.ts';
import { summarizeGraph, validateCodeGraph } from '../../domain/graph-validation.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import { ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { GsdGraphStatus } from '../../ports/gsd-onboarding.ts';
import type { AppDeps } from '../deps.ts';
import type { IndexStepContext } from './index-steps.ts';

const GRAPH_PATH = '.planning/graphs/graph.json';
const CODE_GRAPH_PATH = '.planning/graphs/code-graph.json';
// Matches the size the graph tool refuses to read.
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_DETAIL = 200;

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);

function absent(reason: string, detail?: string): Result<IndexStepResult> {
  return ok({ index: 'code-graph', status: 'absent', reason, ...(detail !== undefined ? { detail: clip(detail) } : {}) });
}

function describeError(error: PortError): string {
  switch (error.kind) {
    case 'unavailable':
    case 'internal':
      return error.cause;
    case 'invalid':
      return `${error.field}: ${error.reason}`;
    case 'timeout':
      return `timed out after ${error.afterMs} ms`;
    default:
      return error.kind;
  }
}

// Why a tool or GSD call failed: a timeout is `timeout`, a missing graphify is `graphify-missing`, and anything else
// is `otherwise`, the reason of the stage the call belongs to.
function reasonOf(error: PortError, otherwise: string): string {
  if (error.kind === 'timeout') return 'timeout';
  if (error.kind === 'unavailable' && error.cause.startsWith('graphify-missing')) return 'graphify-missing';
  return otherwise;
}

// GSD sees the installed graph as present and fresh: it exists, it is not too old or flagged by an auto-update
// failure, and its build commit is not behind HEAD. An unknown comparison (null) is not evidence of staleness.
function gsdSeesFreshGraph(status: GsdGraphStatus): string | undefined {
  if (status.disabled) return 'graphify is disabled in the staging GSD config';
  if (!status.exists) return 'GSD finds no graph in .planning/graphs';
  if (status.stale) return 'GSD reports the graph stale';
  if (status.commitStale === true) return `GSD reports the graph ${status.commitsBehind ?? 'some'} commit(s) behind HEAD`;
  return undefined;
}

export async function runCodeGraphStep(deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.codeGraph) return ok({ index: 'code-graph', status: 'disabled' });
  const { staging, head } = ctx;

  const located = await deps.graph.locate();
  if (!located.ok) return absent(reasonOf(located.error, 'extract-failed'), describeError(located.error));

  // Outside the staging tree: {workRoot}/{onb}/graph-build/code (staging is {workRoot}/{onb}/staging).
  const outDir = join(deps.profile.workRoot, ctx.row.onboardingId, 'graph-build', 'code');
  const extracted = await deps.graph.extractCode(staging, outDir);
  if (!extracted.ok) return absent(reasonOf(extracted.error, 'extract-failed'), describeError(extracted.error));
  const clustered = await deps.graph.cluster(extracted.value.outDir);
  if (!clustered.ok) return absent(reasonOf(clustered.error, 'extract-failed'), describeError(clustered.error));
  if (clustered.value.reportFile === undefined) return absent('extract-failed', 'cluster wrote no report');

  const read = deps.graph.readGraph(clustered.value.graphFile);
  if (!read.ok) return absent(reasonOf(read.error, 'invalid-graph'), describeError(read.error));
  const validation = validateCodeGraph(read.value.raw, head);
  if (!validation.valid) return absent('invalid-graph', validation.problems.join('; '));

  const installed = deps.graph.install(staging, { graph: clustered.value.graphFile, report: clustered.value.reportFile });
  if (!installed.ok) return absent(reasonOf(installed.error, 'extract-failed'), describeError(installed.error));

  // What the record digests is what GSD and later runs read: the file as installed in staging.
  const text = deps.staging.read(staging, GRAPH_PATH, MAX_GRAPH_BYTES);
  if (!text.ok || text.value === null) return absent('extract-failed', 'the installed graph cannot be read back');
  const digest = `sha256:${sha256Hex(Buffer.from(text.value, 'utf8'))}`;

  if (deps.gsd === undefined) return absent('stale-after-install', 'no GSD adapter to snapshot the graph');
  const snapshot = await deps.gsd.graphifySnapshot(staging);
  if (!snapshot.ok) return absent(reasonOf(snapshot.error, 'stale-after-install'), describeError(snapshot.error));
  const status = await deps.gsd.graphifyStatus(staging);
  if (!status.ok) return absent(reasonOf(status.error, 'stale-after-install'), describeError(status.error));
  const problem = gsdSeesFreshGraph(status.value);
  if (problem !== undefined) return absent('stale-after-install', problem);

  const summary = summarizeGraph(read.value.raw);
  return ok({
    index: 'code-graph',
    status: 'present',
    result: {
      path: GRAPH_PATH,
      codeGraphPath: CODE_GRAPH_PATH,
      digest,
      builtAtCommit: `git:${head}`,
      tool: `graphify@${located.value.version}`,
      freshness: 'fresh',
      // `document` is always listed: a code-only graph has none, and the record says so.
      nodes: { document: 0, ...summary.nodesByFileType },
      edges: summary.edgesByConfidence,
    },
  });
}
