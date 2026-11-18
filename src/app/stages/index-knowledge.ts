// The `knowledge` index step (ONB-14, S-39 knowledge part, S-45), split in two by owner decision B of plan 01-19 (2026-11-03).
// AVARICE does every deterministic step itself: it selects the stable documents, copies them into `{staging}/.avarice-knowledge/`
// with a manifest (source path, revision, SHA-256), splits them into chunks (src/domain/knowledge-extraction.ts) and writes the
// chunk plan. Exactly one contained invocation then runs the model with NO shell, NO skill and NO subagent: it reads the chunked
// documents (Read, Glob, Grep, only under the corpus) and writes one extraction JSON per chunk (Write, only under
// `.avarice-knowledge/.extraction`). The prompt is fixed text and carries no repository text. Afterwards AVARICE assembles the
// chunk files, merges them into the code graph (one ID space, graph-merge.ts), validates (knowledge-validation.ts), has graphify
// cluster the merge and installs it (second half of this file). Every failure is an absent index with a reason, never an error,
// and leaves `graph.json` the code-only graph: an index that fails never blocks activation.
import { join } from 'node:path';
import { sha256Hex } from '../../domain/digest.ts';
import { mergeKnowledgeGraph, retainedKnowledge } from '../../domain/graph-merge.ts';
import type { RetainedKnowledge } from '../../domain/graph-merge.ts';
import { packDocuments } from '../../domain/chunk-packing.ts';
import { KNOWLEDGE_DIR, changedDocuments, corpusSummary, knowledgeCandidates, knowledgeChunkLimit, selectKnowledgeCorpus } from '../../domain/knowledge-corpus.ts';
import { CHUNK_PLAN_FILE, EXTRACTION_DIR_NAME, assembleExtraction, chunkOutputName, knowledgePrompt, outputPathOf, planExtractionChunks, subsetPlan } from '../../domain/knowledge-extraction.ts';
import type { KnowledgeManifest } from '../../domain/knowledge-corpus.ts';
import type { ExtractionPlan } from '../../domain/knowledge-extraction.ts';
import { RootRefusedError } from '../../domain/normalized-root.ts';
import { documentCoverage, validateKnowledgeGraph } from '../../domain/knowledge-validation.ts';
import { summarizeGraph } from '../../domain/graph-validation.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import { ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { GsdGraphStatus } from '../../ports/gsd-onboarding.ts';
import type { AppDeps } from '../deps.ts';
import { invocationCostCap } from '../budget.ts';
import { completeInvocation, prepareInvocation } from '../invocation.ts';
import { previousIndexesOf } from '../refresh.ts';
import type { IndexStepContext } from './index-steps.ts';
import { effectiveMappingMode, mapFileNamesFor } from './shared.ts';

const GRAPH_PATH = '.planning/graphs/graph.json';
const CODE_GRAPH_PATH = '.planning/graphs/code-graph.json';
// Matches the size the graph tool refuses to read.
const MAX_GRAPH_BYTES = 64 * 1024 * 1024;
const MAX_DETAIL = 200;
const STORE = 'local';
const RETENTION = 'onboarding';

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);

function absentStep(reason: string, detail?: string): IndexStepResult {
  return { index: 'knowledge', status: 'absent', reason, ...(detail !== undefined ? { detail: clip(detail) } : {}) };
}

function absent(reason: string, detail?: string): Result<IndexStepResult> {
  return ok(absentStep(reason, detail));
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

// ---------------------------------------------------------------------------------------------------------
// A refresh reuses the earlier pass (plan 04-17, ONB-15, S-47)
// ---------------------------------------------------------------------------------------------------------

// What the project's active record gives a refresh: nothing (a first pass), a reason the earlier pass cannot be used (the pass runs whole and says why), or the
// corpus manifest of the earlier pass and its merged graph. Both are read back and checked: the manifest by its artifact digest, the graph by the digest the record
// states, so what is reused is what AVARICE wrote and recorded (T-04-45).
type EarlierPass = { kind: 'none' } | { kind: 'whole'; reason: string } | { kind: 'base'; manifest: KnowledgeManifest; graph: Record<string, unknown> };

function manifestOf(value: unknown): KnowledgeManifest | undefined {
  if (!isObject(value) || value['schema'] !== 1 || typeof value['revision'] !== 'string' || !Array.isArray(value['entries'])) return undefined;
  const entries = value['entries'];
  if (!entries.every((e) => isObject(e) && typeof e['sourcePath'] === 'string' && typeof e['sha256'] === 'string' && typeof e['copyPath'] === 'string' && typeof e['revision'] === 'string')) return undefined;
  return { schema: 1, revision: value['revision'], entries: entries as KnowledgeManifest['entries'], excluded: Array.isArray(value['excluded']) ? (value['excluded'] as KnowledgeManifest['excluded']) : [] };
}

function loadEarlierPass(deps: AppDeps, ctx: IndexStepContext): Result<EarlierPass> {
  const previous = previousIndexesOf(deps, ctx.row.projectId);
  if (!previous.ok) return previous;
  if (previous.value === null) return ok({ kind: 'none' });
  const whole = (reason: string): Result<EarlierPass> => ok({ kind: 'whole', reason });
  const graph = previous.value.graph;
  if (graph === null || graph.knowledge === null) return whole('the active record holds no knowledge pass');
  const digest = graph.knowledge['manifestDigest'];
  if (typeof digest !== 'string') return whole('the active record names no corpus manifest');
  const bytes = deps.artifacts.get(digest);
  if (!bytes.ok) return whole(`the earlier corpus manifest cannot be read: ${describeError(bytes.error)}`);
  let manifest: KnowledgeManifest | undefined;
  try {
    manifest = manifestOf(JSON.parse(Buffer.from(bytes.value).toString('utf8')));
  } catch {
    manifest = undefined;
  }
  if (manifest === undefined) return whole('the earlier corpus manifest is not a manifest');
  const text = deps.staging.read(previous.value.stagingPath, graph.path, MAX_GRAPH_BYTES);
  if (!text.ok || text.value === null) return whole('the earlier merged graph cannot be read');
  if (`sha256:${sha256Hex(Buffer.from(text.value, 'utf8'))}` !== graph.digest) return whole('the earlier merged graph is not the one the record digests');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    return whole('the earlier merged graph is not JSON');
  }
  if (!isObject(parsed)) return whole('the earlier merged graph is not a JSON object');
  return ok({ kind: 'base', manifest, graph: parsed });
}

// A chunk an interrupted attempt of this onboarding extracted: the documents it covered and what the model wrote for them.
interface SalvagedChunk {
  revision: string;
  files: string;
  graph: { nodes: unknown[]; edges: unknown[] };
}

const MAX_PLAN_BYTES = 1024 * 1024;
const filesKey = (paths: readonly string[]): string => [...paths].sort().join('\u0000');

// The plan an earlier attempt left, only as far as it has the shape AVARICE writes (numbers in order, the output name its number gives).
function savedPlanOf(value: unknown): ExtractionPlan | undefined {
  if (!isObject(value) || value['schema'] !== 1 || typeof value['revision'] !== 'string' || !Array.isArray(value['chunks'])) return undefined;
  const chunks: ExtractionPlan['chunks'] = [];
  for (const chunk of value['chunks']) {
    if (!isObject(chunk) || typeof chunk['n'] !== 'number' || !Number.isInteger(chunk['n']) || chunk['n'] < 1 || chunk['n'] > 1000) return undefined;
    if (chunk['output'] !== `${EXTRACTION_DIR_NAME}/${chunkOutputName(chunk['n'])}` || typeof chunk['writePath'] !== 'string' || !Array.isArray(chunk['files'])) return undefined;
    const files: ExtractionPlan['chunks'][number]['files'] = [];
    for (const file of chunk['files']) {
      if (!isObject(file) || typeof file['path'] !== 'string' || typeof file['stem'] !== 'string' || typeof file['readPath'] !== 'string') return undefined;
      files.push({ path: file['path'], stem: file['stem'], readPath: file['readPath'] });
    }
    chunks.push({ n: chunk['n'], output: chunk['output'], writePath: chunk['writePath'], files });
  }
  return { schema: 1, revision: value['revision'], chunks };
}

// The chunks an interrupted attempt wrote and that are usable, read before the corpus is rebuilt (building it clears the directory). Nothing here is trusted
// more than a fresh answer: each chunk goes through the same assembly (JSON, an object, nodes and edges) and then the merge and its validation.
function readSalvage(deps: AppDeps, staging: string): SalvagedChunk[] {
  const text = deps.staging.read(staging, CHUNK_PLAN_FILE, MAX_PLAN_BYTES);
  if (!text.ok || text.value === null) return [];
  let plan: ExtractionPlan | undefined;
  try {
    plan = savedPlanOf(JSON.parse(text.value));
  } catch {
    return [];
  }
  if (plan === undefined) return [];
  const files = deps.graph.readExtractionFiles(staging, plan);
  if (!files.ok) return [];
  const out: SalvagedChunk[] = [];
  for (const chunk of plan.chunks) {
    const found = files.value[chunk.n];
    if (found === undefined) continue;
    const assembled = assembleExtraction({ ...plan, chunks: [chunk] }, { [chunk.n]: found });
    if (assembled.used.length === 1) out.push({ revision: plan.revision, files: filesKey(chunk.files.map((file) => file.path)), graph: assembled.graph });
  }
  return out;
}

// What a refresh keeps of the earlier pass: its merged graph and the repository paths of the documents it does not extract again.
interface Reuse {
  graph: Record<string, unknown>;
  keep: ReadonlySet<string>;
}

const MAX_OMITTED_AREAS = 50;
const roundUsd = (usd: number): number => Math.round(usd * 1e6) / 1e6;

// What the cost cap left out of the corpus, for the record: null when it left nothing out (then the record is what it was before the cap existed). The record names the
// cap the limit came from, the limit, the chunks the kept documents plan to, how many documents were kept and left out, and the areas of the ones left out (the
// directories, as the record states a corpus). Every left-out path is in the manifest's `excluded` list as `cost-cap`, and the manifest digest is of what was sent.
function corpusCapOf(dropped: readonly { path: string; reason: string }[], manifest: KnowledgeManifest, sizes: Readonly<Record<string, number>>, costCapUsd: number, chunkLimit: number): Record<string, unknown> | null {
  const omitted = dropped.filter((d) => d.reason === 'cost-cap').map((d) => d.path);
  if (omitted.length === 0) return null;
  const areas = corpusSummary(omitted);
  return {
    perInvocationCapUsd: roundUsd(costCapUsd),
    chunkLimit,
    chunks: packDocuments(manifest.entries.map((entry) => entry.sourcePath), sizes).length,
    documentsKept: manifest.entries.length,
    documentsOmitted: omitted.length,
    omitted: areas.slice(0, MAX_OMITTED_AREAS),
    ...(areas.length > MAX_OMITTED_AREAS ? { omittedMoreAreas: areas.length - MAX_OMITTED_AREAS } : {}),
  };
}

export async function runKnowledgeStep(deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.knowledge) return ok({ index: 'knowledge', status: 'disabled' });
  const { staging, head, row, contract } = ctx;

  const present = codeGraphPresent(deps, row.onboardingId);
  if (!present.ok) return present;
  if (!present.value) return absent('graph-absent', 'there is no code graph for document nodes to join');

  // 0. A refresh: the earlier pass of the project, and what an interrupted attempt of this onboarding already extracted.
  const earlier = loadEarlierPass(deps, ctx);
  if (!earlier.ok) return earlier;
  const salvage = earlier.value.kind === 'base' ? readSalvage(deps, staging) : [];

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
  // The corpus is capped by what one knowledge invocation can pay for (plan 04-35, owner ruling 2): the chunk limit comes from the cost cap that invocation would be
  // granted, and the documents that fall past it, in the priority order of the rules, are left out and recorded.
  const costCap = invocationCostCap(deps, row);
  if (!costCap.ok) return costCap;
  const chunkLimit = knowledgeChunkLimit(costCap.value);
  const selection = selectKnowledgeCorpus({ ...rules, sizes: sizes.value, secretGlobs: contract.body.files.secretGlobs, readGlobs: contract.body.files.read, limits: { maxChunks: chunkLimit } });

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
  const corpusCap = corpusCapOf(selection.dropped, manifest, sizes.value, costCap.value, chunkLimit);

  // 2b. A refresh extracts only what changed: the documents that are new, whose content digest differs from the earlier pass's, or that the earlier graph
  // has no document node for. Every other document is a cache hit and keeps the nodes the earlier pass made for it. The earlier manifest and graph are the
  // active record's, checked above; a refresh that cannot use them runs the whole pass and says why.
  let extract = manifest;
  let reuse: Reuse | null = null;
  let refresh: Record<string, unknown> | undefined = earlier.value.kind === 'whole' ? { mode: 'whole', reason: clip(earlier.value.reason) } : undefined;
  if (earlier.value.kind === 'base') {
    const covered = new Set(documentCoverage(earlier.value.graph, earlier.value.manifest).covered);
    const moved = new Set(changedDocuments(earlier.value.manifest, manifest).map((entry) => entry.sourcePath));
    const hits = manifest.entries.filter((entry) => !moved.has(entry.sourcePath) && covered.has(entry.sourcePath));
    const keep = new Set(hits.map((entry) => entry.sourcePath));
    extract = { ...manifest, entries: manifest.entries.filter((entry) => !keep.has(entry.sourcePath)) };
    reuse = { graph: earlier.value.graph, keep };
    refresh = { mode: 'incremental', changed: extract.entries.map((entry) => entry.sourcePath), cacheHits: hits.length };
    // The corpus the model reads holds the documents to extract and no other.
    if (extract.entries.length > 0 && extract.entries.length < manifest.entries.length) {
      const narrowed = deps.graph.materializeCorpus(staging, extract.entries.map((entry) => entry.sourcePath), join(deps.profile.dataRoot, 'onboard', row.onboardingId, 'knowledge', 'manifest.extract.json'), head);
      if (!narrowed.ok) return absent('invocation-failed', `cannot build the corpus of the changed documents: ${describeError(narrowed.error)}`);
      extract = narrowed.value.manifest;
    }
  }
  if (extract.entries.length === 0) {
    // Nothing changed: no invocation, no unit reserved. The document nodes are the earlier pass's, joined to the new code graph.
    return mergeAndInstall(deps, ctx, manifest, { nodes: [], edges: [] }, reuse, refresh, stored.value.digest, corpusCap);
  }

  // 3. The chunk plan: deterministic, from the manifest and the sizes. It is written beside the corpus for the model to read as
  // data; the prompt itself holds no repository text.
  // The corpus root is the knowledge invocation's cwd: the read-dir `.avarice-knowledge` of the same staging path (computeInvocationScope),
  // so every readPath lies under the read confine; the production-path test of plan 01-26 pins it.
  // planExtractionChunks refuses a corpus root that is not a normalized absolute path by throwing a RootRefusedError (WR-01); that is an
  // absent index, never a crash. It is defence in depth: staging is a realpath, so the guard cannot fire on the production path. Only
  // that refusal is caught: any other throw is a defect in the planner and propagates (the stage records it as a `step-error`) rather
  // than hiding behind a quiet `invocation-failed` (IN-04).
  const corpusRoot = join(staging, KNOWLEDGE_DIR);
  let plan: ExtractionPlan;
  try {
    plan = planExtractionChunks(extract, sizes.value, corpusRoot);
  } catch (cause) {
    if (!(cause instanceof RootRefusedError)) throw cause;
    return absent('invocation-failed', `cannot plan the extraction: ${cause.message}`);
  }

  // A resumed refresh does not ask again for a chunk an interrupted attempt of this onboarding wrote and that is usable: the chunk is recognized by the
  // revision and the documents it covers, and only the others go to the model (ONB-15). A first pass never salvages.
  const salvaged = new Map<number, SalvagedChunk>();
  for (const chunk of plan.chunks) {
    const key = filesKey(chunk.files.map((file) => file.path));
    const found = salvage.find((s) => s.revision === plan.revision && s.files === key);
    if (found !== undefined) salvaged.set(chunk.n, found);
  }
  let asked: ExtractionPlan;
  try {
    asked = salvaged.size === 0 ? plan : subsetPlan(plan, new Set(plan.chunks.filter((chunk) => !salvaged.has(chunk.n)).map((chunk) => chunk.n)), corpusRoot);
  } catch (cause) {
    if (!(cause instanceof RootRefusedError)) throw cause;
    return absent('invocation-failed', `cannot plan the extraction: ${cause.message}`);
  }
  if (refresh !== undefined && salvaged.size > 0) refresh = { ...refresh, salvagedChunks: salvaged.size };

  // The answers of the model, and the chunks that were already there. With every chunk salvaged nothing is asked.
  let fresh: ReturnType<typeof assembleExtraction> | null = null;
  if (asked.chunks.length > 0) {
    const answered = await askModel(deps, ctx, asked);
    if (!answered.ok) return answered;
    if ('stop' in answered.value) return ok(answered.value.stop);
    fresh = answered.value.assembled;
  }

  // 5. AVARICE reads back what the model wrote and assembles it. No chunk file at all is `no-output`; files that are not usable, or
  // fewer usable chunks than half the plan, are `validation-failed`; otherwise the usable chunks go on. A usable chunk says nothing
  // about coverage: that is judged on the merged graph, per document (validateKnowledgeGraph), and that is the authority on whether the
  // pass covered enough. The half-the-plan chunk gate below is deliberately kept as a coarser early exit, not a second coverage rule: it
  // stops a pass whose output is mostly unusable before the merge and graphify's cluster run are paid for, and it is the only place
  // that can say why chunks were skipped (the merged graph knows nothing of chunk files). Passing it proves nothing; the per-document
  // check still runs on what passes. docs/repository-onboarding.md states both outcomes.
  const kept = [...salvaged.values()];
  if (kept.length + (fresh?.present ?? 0) === 0) return absent('no-output', 'the pass wrote no chunk file');
  const usable = kept.length + (fresh?.used.length ?? 0);
  const half = Math.ceil(plan.chunks.length / 2);
  if (usable < half) {
    const reasons = (fresh?.skipped ?? []).map((s) => `chunk ${s.n}: ${s.reason}`).slice(0, 5).join('; ');
    return absent('validation-failed', `${usable} of ${plan.chunks.length} chunks were usable (at least ${half} are needed): ${reasons}`);
  }
  const extraction = { nodes: [...kept.flatMap((chunk) => chunk.graph.nodes), ...(fresh?.graph.nodes ?? [])], edges: [...kept.flatMap((chunk) => chunk.graph.edges), ...(fresh?.graph.edges ?? [])] };

  return mergeAndInstall(deps, ctx, manifest, extraction, reuse, refresh, stored.value.digest, corpusCap);
}

// 4. One contained invocation for the chunks of `plan`: no shell, no skill, no subagent. The host judges `progressed` by the chunk files. The answer is the
// assembled chunk files, or an absent index with the reason the invocation did not give one.
async function askModel(deps: AppDeps, ctx: IndexStepContext, plan: ExtractionPlan): Promise<Result<{ assembled: ReturnType<typeof assembleExtraction> } | { stop: IndexStepResult }>> {
  const { staging, row } = ctx;
  const stop = (reason: string, detail?: string): Result<{ stop: IndexStepResult }> => ok({ stop: absentStep(reason, detail) });
  const planned = deps.graph.writeExtractionPlan(staging, plan);
  if (!planned.ok) return stop('invocation-failed', `cannot write the extraction plan: ${describeError(planned.error)}`);

  const prepared = prepareInvocation(deps, row, 'knowledge', knowledgePrompt(plan), { expectedFiles: plan.chunks.map((chunk) => outputPathOf(chunk)) });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) return stop('budget_exhausted', `the ${prepared.value.budget} budget is exhausted, so no knowledge invocation was started`);
  const { request } = prepared.value.prepared;

  const invoked = await deps.host.invoke(request, AbortSignal.timeout(Math.max(request.wallClockMs, 1)));
  // Settle first, whatever happened: the invocation ran, so its unit, its time and its cost are spent.
  const settled = completeInvocation(deps, prepared.value.prepared, invoked);
  if (!settled.ok) return stop('invocation-failed', describeError(settled.error));
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
    return stop('invocation-failed', 'the staging HEAD moved during the knowledge invocation');
  }
  const denials = deps.ledger.countBudgetDenials(request.runId, request.invocationId);
  if (!denials.ok) return denials;
  if (denials.value > 0 || o.kind === 'budget_exhausted') return stop('budget_exhausted', 'the knowledge invocation exhausted its budget');
  // Only these two endings are judged by what is in staging; a denied or failed run is not trusted.
  if (o.kind !== 'progressed' && o.kind !== 'inconclusive') return stop('invocation-failed', `the knowledge invocation ended ${o.kind}`);

  const files = deps.graph.readExtractionFiles(staging, plan);
  if (!files.ok) return stop('validation-failed', describeError(files.error));
  return ok({ assembled: assembleExtraction(plan, files.value) });
}

// The second half: AVARICE merges the assembled extraction into the code graph (one ID space), validates the merge, has graphify
// cluster it, validates what came back, and only then replaces graph.json. Every refusal leaves graph.json the code-only
// graph byte for byte. The record's corpus names the documents that have a document node in the installed (clustered) graph, and states
// how many the corpus held and how many got no node.
//
// A refresh (`reuse`) adds the nodes and edges of the unchanged documents from the earlier merged graph to what the model extracted for the changed ones, so the
// merge sees one skill graph and validates per manifest document as ever. `manifestDigest` is the artifact digest of the manifest of the whole corpus; the record
// keeps it so that the next refresh can tell which documents are new.
async function mergeAndInstall(
  deps: AppDeps,
  ctx: IndexStepContext,
  manifest: KnowledgeManifest,
  extraction: { nodes: unknown[]; edges: unknown[] },
  reuse: Reuse | null,
  refresh: Record<string, unknown> | undefined,
  manifestDigest: string,
  corpusCap: Record<string, unknown> | null,
): Promise<Result<IndexStepResult>> {
  const { staging, head, row } = ctx;

  const code = deps.graph.readGraph(join(staging, CODE_GRAPH_PATH));
  if (!code.ok) return absent('validation-failed', `the code graph cannot be read for the merge: ${describeError(code.error)}`);
  let docs: Record<string, unknown> = extraction;
  let retained: RetainedKnowledge | null = null;
  if (reuse !== null) {
    const codeIds = new Set(code.value.nodes.flatMap((node) => (typeof node['id'] === 'string' ? [node['id']] : [])));
    retained = retainedKnowledge(reuse.graph, reuse.keep, codeIds);
    docs = { nodes: [...extraction.nodes, ...retained.nodes], edges: [...extraction.edges, ...retained.edges] };
  }
  const { graph, stats } = mergeKnowledgeGraph({ code: code.value.raw, docs, manifest, onboardedRevision: head });
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
        corpus: corpusSummary(rechecked.coverage.covered),
        documentsCommit: `git:${head}`,
        documentsExpected: rechecked.coverage.expected,
        documentNodes: stats.documentNodes,
        dropped: { dangling: stats.dropped.dangling, astDocument: stats.dropped.astDocument, unread: rechecked.coverage.unread.length },
        manifestDigest,
        ...(corpusCap !== null ? { corpusCap } : {}),
      },
      ...(refresh !== undefined ? { refresh: { ...refresh, ...(retained !== null ? { retainedNodes: retained.nodes.length, retainedEdges: retained.edges.length, droppedEdges: retained.droppedEdges } : {}) } } : {}),
    },
  });
}
