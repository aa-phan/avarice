// The `intel` index step (ONB-13, S-39 intel part): one contained invocation of the intel purpose, which runs GSD's own
// `gsd-intel-updater` agent in the form spike S0-D proved (`claude -p --agent gsd-intel-updater "focus: full; project
// root: ."` with the agent in the generated --agents file; GSD 1.17.0 ships no intel workflow file to call instead).
// The agent writes the five intel documents and its snapshot under `.planning/intel`, and nothing else is allowed to.
// AVARICE writes none of it. It accepts the result only when GSD's own verbs agree: `intel validate` passes and
// `intel diff` reports no file changed since the refresh. Every failure is an absent index with a reason, never an
// error: an index that fails never blocks activation. The index is stamped with `git:` and the staging HEAD, the
// onboarded revision.
import { sha256Hex } from '../../domain/digest.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import { ok } from '../../domain/result.ts';
import type { PortError, Result } from '../../domain/result.ts';
import type { AppDeps } from '../deps.ts';
import { completeInvocation, prepareInvocation } from '../invocation.ts';
import type { IndexStepContext } from './index-steps.ts';

const INTEL_DIR = '.planning/intel';
export const INTEL_DOCUMENTS = ['file-roles.json', 'api-map.json', 'dependency-graph.json', 'arch-decisions.json', 'stack.json'] as const;
const SNAPSHOT = '.last-refresh.json';
const AGENT = 'gsd-intel-updater';
// The S0-D form: the agent is started directly in the staging root, so the root is `.`.
const PROMPT = 'focus: full; project root: .';
// Far above what the agent's output budget allows (about 3000 tokens a file); a larger file is not read.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL = 200;

const clip = (text: string): string => (text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`);

function absent(reason: string, detail?: string): Result<IndexStepResult> {
  return ok({ index: 'intel', status: 'absent', reason, ...(detail !== undefined ? { detail: clip(detail) } : {}) });
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

export async function runIntelStep(deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.intel) return ok({ index: 'intel', status: 'disabled' });
  const { staging, head, row } = ctx;
  const gsd = deps.gsd;
  if (gsd === undefined) return absent('invocation-failed', 'no GSD adapter to validate the intel');

  // Reserve the invocation and prepare its request (scope, session ID, step `launch:intel` recorded as started). Its
  // write set then enters the check before activation by that step.
  const prepared = prepareInvocation(deps, row, 'intel', PROMPT, { agentName: AGENT, expectedFiles: INTEL_DOCUMENTS.map((name) => `${INTEL_DIR}/${name}`) });
  if (!prepared.ok) return prepared;
  if (!prepared.value.granted) return absent('budget_exhausted', `the ${prepared.value.budget} budget is exhausted, so no intel invocation was started`);
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
    return absent('invocation-failed', 'the staging HEAD moved during the intel invocation');
  }
  const denials = deps.ledger.countBudgetDenials(request.runId, request.invocationId);
  if (!denials.ok) return denials;
  if (denials.value > 0 || o.kind === 'budget_exhausted') return absent('budget_exhausted', 'the intel invocation exhausted its budget');
  // Only these two endings are judged by what is in staging; the others never are (a denied or failed run is not
  // retried and not trusted). An unknown ending (the wall clock) may still have left valid files.
  if (o.kind !== 'progressed' && o.kind !== 'inconclusive') return absent('invocation-failed', `the intel invocation ended ${o.kind}`);

  const validation = await gsd.intelValidate(staging);
  if (!validation.ok) return absent('validate-failed', `intel validate did not run: ${describeError(validation.error)}`);
  if (validation.value.disabled) return absent('validate-failed', 'intel is disabled in the staging GSD config');
  if (!validation.value.valid) return absent('validate-failed', validation.value.errors.join('; '));

  const diff = await gsd.intelDiff(staging);
  if (!diff.ok) return absent('validate-failed', `intel diff did not run: ${describeError(diff.error)}`);
  if (diff.value.disabled) return absent('validate-failed', 'intel is disabled in the staging GSD config');
  if (diff.value.noBaseline) return absent('diff-changed', 'the refresh left no snapshot to compare the files with');
  const moved = [...diff.value.changed, ...diff.value.added, ...diff.value.removed];
  if (moved.length > 0) return absent('diff-changed', `changed since the refresh: ${moved.join(', ')}`);

  // What the record digests is what GSD and later runs read: the files as they are in staging, sorted by name.
  const names = [...INTEL_DOCUMENTS, SNAPSHOT].sort();
  const lines: string[] = [];
  for (const name of names) {
    const text = deps.staging.read(staging, `${INTEL_DIR}/${name}`, MAX_FILE_BYTES);
    if (!text.ok) return absent('validate-failed', `${name} cannot be read back: ${describeError(text.error)}`);
    if (text.value === null) return absent('validate-failed', `${name} is not in staging`);
    lines.push(`${name} sha256:${sha256Hex(text.value)}`);
  }
  return ok({
    index: 'intel',
    status: 'present',
    result: {
      path: `${INTEL_DIR}/`,
      digest: `sha256:${sha256Hex(`${lines.join('\n')}\n`)}`,
      refreshedAtCommit: `git:${head}`,
      freshness: 'fresh',
      files: INTEL_DOCUMENTS.length,
    },
  });
}
