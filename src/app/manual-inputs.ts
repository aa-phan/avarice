// Manual equivalents for every integration (plan 04-27; FR-19, FR-18; docs/enterprise-adaptation.md "Manual modes"). Where an integration is prohibited the owner brings its
// output in by hand: a document excerpt (`context add`), a CI log or a review (`evidence add`), the URL of a pull request opened in the web UI (`pr record`), and the comment
// to paste into a tracker (`comment --print`). Everything here is offline and writes only the ledger and the artifact store: no network, no repository, no host.
//
// What is recorded keeps where it came from: the source text the owner gave, the digest of the file, who recorded it and when. A text is stored through the artifact
// store, which redacts the kinds `manual-context` and `manual-evidence` before they are hashed, and a file that is not valid UTF-8 is refused here because the store
// could not redact it. A provider's own identifiers (a pull request's owner, repository and number) are kept verbatim. Manual evidence is never measured by AVARICE, so it
// is recorded as `inconclusive`, on a revision no gate judges, and never satisfies a gate (Phase 5 decides how review and CI feedback enter a new attempt, FR-10).
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { sha256Hex } from '../domain/digest.ts';
import type { EvidenceStatus } from '../domain/evidence.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { redactSecrets } from '../domain/secret-patterns.ts';
import type { ExternalRef } from '../ports/context-source.ts';
import { printable } from './context.ts';
import type { AppDeps } from './deps.ts';
import { getRunStatuses } from './run-status.ts';

// The reference a pasted excerpt leaves in task_refs: the provider names where it came from, the ID is the source text the owner gave (verbatim), the revision is the
// digest of the file's bytes and the scope is the file's name.
export const MANUAL_CONTEXT_PROVIDER = 'manual-context';
export const MANUAL_CONTEXT_KIND = 'excerpt';
export const MANUAL_CONTEXT_ARTIFACT = 'manual-context';
export const MANUAL_EVIDENCE_ARTIFACT = 'manual-evidence';
// A pull request recorded by URL: GitHub's own provider name (an enterprise host serves the same shape), and the kind it is.
export const PULL_REQUEST_PROVIDER = 'github';
export const PULL_REQUEST_KIND = 'pull-request';

// The references a resume does not refresh against a source: they were recorded by hand and name no live index (resume-refs.ts keeps them as recorded).
export const LEDGER_ONLY_REFS: ReadonlyArray<{ provider: string; kind: string }> = [
  { provider: MANUAL_CONTEXT_PROVIDER, kind: MANUAL_CONTEXT_KIND },
  { provider: PULL_REQUEST_PROVIDER, kind: PULL_REQUEST_KIND },
];

// An excerpt is at most one pack's worth of text (the pack is 4000 tokens, estimated as characters / 4): a longer one could never enter a pack.
export const MANUAL_CONTEXT_MAX_BYTES = 16_000;
// A pasted CI log or review: stored whole, so larger, but still bounded.
export const MANUAL_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;
export const SOURCE_MAX_CHARS = 200;
export const REF_MAX_CHARS = 500;
export const EVIDENCE_KINDS = ['ci', 'review', 'manual'] as const;
export type ManualEvidenceKind = (typeof EVIDENCE_KINDS)[number];

const STORE = 'local';
const RUN_RETENTION = 'run';
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const invalid = (field: string, reason: string): Result<never> => err({ kind: 'invalid', field, reason });
const fileDigestOf = (bytes: Uint8Array): string => `sha256:${sha256Hex(bytes)}`;

// A regular file of at most `maxBytes`, read whole. A failure carries the operating system's code (`ENOENT`, `EACCES`) or `NOT_FILE` / `TOO_LARGE`, so the command can say which.
export function readInputFile(path: string, maxBytes: number): { ok: true; bytes: Uint8Array } | { ok: false; reason: string } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY);
  } catch (e) {
    return { ok: false, reason: `cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: 'is not a regular file' };
    if (stat.size > maxBytes) return { ok: false, reason: `is larger than ${maxBytes} bytes` };
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    return { ok: true, bytes: buffer.subarray(0, offset) };
  } catch (e) {
    return { ok: false, reason: `cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})` };
  } finally {
    closeSync(fd);
  }
}

// The text a file holds, or why it cannot be stored: empty, not UTF-8 (the artifact store redacts text only), or over the bound.
function textOf(label: string, bytes: Uint8Array, maxBytes: number): Result<string> {
  if (bytes.length === 0) return invalid('file', `${label} is empty`);
  if (bytes.length > maxBytes) return invalid('file', `${label} is larger than ${maxBytes} bytes`);
  try {
    const text = strictUtf8.decode(bytes);
    return text.trim() === '' ? invalid('file', `${label} holds only whitespace`) : ok(text);
  } catch {
    return invalid('file', `${label} is not valid UTF-8, so it cannot be stored redacted`);
  }
}

// A short line of owner-given text (the source of an excerpt, the reference of evidence): non-empty, bounded, no control, zero-width or bidirectional character.
function lineOf(field: string, value: string, max: number): Result<string> {
  if (value.trim() === '') return invalid(field, `${field} is empty`);
  if (value.length > max) return invalid(field, `${field} is longer than ${max} characters`);
  if (CONTROL.test(value)) return invalid(field, `${field} holds a control character`);
  return ok(value);
}

// A text stored as an artifact of a run (redacted by the store for the manual kinds): its digest is the digest of what was stored.
function storeText(deps: AppDeps, runId: string, kind: string, bytes: Uint8Array, nowMs: number): Result<{ digest: string; size: number }> {
  const stored = deps.artifacts.put(bytes, { kind, runId });
  if (!stored.ok) return stored;
  const recorded = deps.ledger.recordArtifact({ digest: stored.value.digest, size: stored.value.size, kind, runId, retention: RUN_RETENTION, store: STORE, nowMs });
  return recorded.ok ? ok(stored.value) : recorded;
}

// ---- context add ---------------------------------------------------------------------------------------------------------------------------------------------

// The step that keeps what an excerpt's reference does not hold: the digest of the stored (redacted) bytes, the digest of the file as given, who recorded it. One step per
// source, so a second add of the same source replaces it and the pack reads the latest.
const STEP_PREFIX = 'manual-context:';
const stepOf = (source: string): string => `${STEP_PREFIX}${sha256Hex(source).slice(0, 16)}`;

export interface ManualContextInput {
  runId: string;
  // The file's own name (its base name), kept as the scope of the reference.
  fileName: string;
  bytes: Uint8Array;
  // The owner's words for where the text came from: `<title> rev <n>`. Kept verbatim as the reference's ID.
  source: string;
  // Who recorded it (the OS user the command ran as).
  by: string;
  nowMs: number;
}

export interface ManualContextRecorded {
  ref: ExternalRef;
  // sha256 of the file as given, and of the bytes the artifact store kept after redaction.
  fileDigest: string;
  artifactDigest: string;
  // The same source with the same file was recorded before: nothing was written.
  duplicate: boolean;
}

// Records a pasted excerpt as a reference of the run: stored redacted, cited by its source and the digest of the file, and offered to the run's next pack as an untrusted item.
// The same file under the same source twice is one reference; a new file under the same source replaces the earlier one.
export function recordManualContext(deps: AppDeps, input: ManualContextInput): Result<ManualContextRecorded> {
  const run = deps.ledger.getRun(input.runId);
  if (!run.ok) return run;
  const source = lineOf('source', input.source, SOURCE_MAX_CHARS);
  if (!source.ok) return source;
  const name = lineOf('file', input.fileName, SOURCE_MAX_CHARS);
  if (!name.ok) return name;
  const text = textOf('the excerpt', input.bytes, MANUAL_CONTEXT_MAX_BYTES);
  if (!text.ok) return text;

  const fileDigest = fileDigestOf(input.bytes);
  const existing = deps.ledger.listTaskRefs(input.runId);
  if (!existing.ok) return existing;
  const held = existing.value.find((r) => r.provider === MANUAL_CONTEXT_PROVIDER && r.kind === MANUAL_CONTEXT_KIND && r.id === source.value);
  const steps = deps.ledger.getRunSteps(input.runId);
  if (!steps.ok) return steps;
  const kept = steps.value.find((s) => s.step === stepOf(source.value));
  const keptDigest = typeof kept?.result === 'object' && kept.result !== null ? (kept.result as Record<string, unknown>)['artifactDigest'] : undefined;
  if (held !== undefined && held.revision === fileDigest && typeof keptDigest === 'string') {
    return ok({ ref: held, fileDigest, artifactDigest: keptDigest, duplicate: true });
  }

  const stored = storeText(deps, input.runId, MANUAL_CONTEXT_ARTIFACT, input.bytes, input.nowMs);
  if (!stored.ok) return stored;
  const step = deps.ledger.recordRunStep(input.runId, {
    step: stepOf(source.value),
    attempt: 1,
    status: 'completed',
    result: { source: source.value, file: name.value, fileDigest, artifactDigest: stored.value.digest, size: stored.value.size, recordedBy: input.by },
    nowMs: input.nowMs,
    completedAtMs: input.nowMs,
  });
  if (!step.ok) return step;
  // The reference is written last: a reference always has its artifact and its step, so a pack never reads half of one.
  const ref: ExternalRef = {
    provider: MANUAL_CONTEXT_PROVIDER,
    kind: MANUAL_CONTEXT_KIND,
    id: source.value,
    revision: fileDigest,
    retrievedAt: new Date(input.nowMs).toISOString(),
    scope: name.value,
    freshness: 'fresh',
  };
  const written = deps.ledger.recordTaskRefs(input.runId, [ref]);
  if (!written.ok) return written;
  const event = deps.ledger.appendEvent({
    type: 'manual.context_recorded',
    runId: input.runId,
    data: { runId: input.runId, source: source.value, file: name.value, fileDigest, artifactDigest: stored.value.digest, recordedBy: input.by },
    nowMs: input.nowMs,
  });
  if (!event.ok) return event;
  return ok({ ref, fileDigest, artifactDigest: stored.value.digest, duplicate: false });
}

// One manual excerpt as the pack offers it.
export interface ManualPackItem {
  ref: ExternalRef;
  title: string;
  excerpt: string;
  estTokens: number;
}

export interface ManualPackItems {
  items: ManualPackItem[];
  notes: string[];
}

// The excerpts the owner recorded for a run, read from their artifacts, in the order of the references (provider, kind, ID), first-fit within `budget` tokens (characters / 4):
// an excerpt that does not fit is left out with a note, and a smaller one after it may still fit. An excerpt whose artifact cannot be read is left out with a note, never
// an error: the run goes on without it. The text is redacted again on the way out, so a credential the profile learned after the excerpt was stored does not reach a prompt.
export function manualPackItems(deps: AppDeps, runId: string, budget: number): Result<ManualPackItems> {
  const refs = deps.ledger.listTaskRefs(runId);
  if (!refs.ok) return refs;
  const mine = refs.value.filter((r) => r.provider === MANUAL_CONTEXT_PROVIDER && r.kind === MANUAL_CONTEXT_KIND);
  if (mine.length === 0) return ok({ items: [], notes: [] });
  const steps = deps.ledger.getRunSteps(runId);
  if (!steps.ok) return steps;
  const redact = deps.redact ?? redactSecrets;
  const items: ManualPackItem[] = [];
  const notes: string[] = [];
  let left = budget;
  for (const ref of mine) {
    const step = steps.value.find((s) => s.step === stepOf(ref.id));
    const digest = typeof step?.result === 'object' && step.result !== null ? (step.result as Record<string, unknown>)['artifactDigest'] : undefined;
    const bytes = typeof digest === 'string' ? deps.artifacts.get(digest) : undefined;
    if (bytes === undefined || !bytes.ok) {
      notes.push(`the excerpt "${printable(ref.id)}" is recorded but its stored text cannot be read; it is not in the pack`);
      continue;
    }
    let excerpt: string;
    try {
      excerpt = redact(strictUtf8.decode(bytes.value));
    } catch {
      notes.push(`the excerpt "${printable(ref.id)}" is not valid UTF-8; it is not in the pack`);
      continue;
    }
    const estTokens = Math.ceil(excerpt.length / 4);
    if (estTokens > left) {
      notes.push(`the excerpt "${printable(ref.id)}" (~${estTokens} tokens) did not fit the pack budget and was left out`);
      continue;
    }
    left -= estTokens;
    items.push({ ref, title: ref.id, excerpt, estTokens });
  }
  return ok({ items, notes });
}

// ---- evidence add --------------------------------------------------------------------------------------------------------------------------------------------

export interface ManualEvidenceInput {
  runId: string;
  kind: string;
  fileName: string;
  bytes: Uint8Array;
  // Where the evidence lives (a CI run's URL, a review's link, a ticket key); optional.
  ref?: string;
  by: string;
  nowMs: number;
}

export interface ManualEvidenceRecorded {
  evidenceId: string;
  kind: ManualEvidenceKind;
  artifactDigest: string;
  fileDigest: string;
}

export const isEvidenceKind = (kind: string): kind is ManualEvidenceKind => (EVIDENCE_KINDS as readonly string[]).includes(kind);

// Records a CI log, a review or a manual note as one evidence row of the run's latest attempt. AVARICE did not measure it, so it is `inconclusive`, independent of the run
// (`external`), and sits on a revision (`manual:` plus the digest of the file) that no gate judges: it satisfies no gate and replaces no earlier row. A second add is a
// second row. A run with no attempt has nothing to attach it to (not_found).
export function recordManualEvidence(deps: AppDeps, input: ManualEvidenceInput): Result<ManualEvidenceRecorded> {
  const run = deps.ledger.getRun(input.runId);
  if (!run.ok) return run;
  if (!isEvidenceKind(input.kind)) return invalid('kind', `an evidence kind is one of ${EVIDENCE_KINDS.join(', ')}`);
  const name = lineOf('file', input.fileName, SOURCE_MAX_CHARS);
  if (!name.ok) return name;
  const ref = input.ref === undefined ? ok(undefined) : lineOf('ref', input.ref, REF_MAX_CHARS);
  if (!ref.ok) return ref;
  const text = textOf('the evidence file', input.bytes, MANUAL_EVIDENCE_MAX_BYTES);
  if (!text.ok) return text;

  const attempts = deps.ledger.listRunAttempts(input.runId);
  if (!attempts.ok) return attempts;
  const attempt = attempts.value.at(-1);
  if (attempt === undefined) return err({ kind: 'not_found', ref: `an attempt of run ${input.runId} to attach the evidence to` });
  const contract = deps.ledger.getRunContract(input.runId);
  if (!contract.ok) return contract;
  if (contract.value === null) return err({ kind: 'not_found', ref: `the contract of run ${input.runId}` });

  const fileDigest = fileDigestOf(input.bytes);
  const stored = storeText(deps, input.runId, MANUAL_EVIDENCE_ARTIFACT, input.bytes, input.nowMs);
  if (!stored.ok) return stored;
  const status: EvidenceStatus = 'inconclusive';
  const row = deps.ledger.recordEvidence({
    attemptId: attempt.attemptId,
    kind: input.kind,
    name: `${input.kind}:${name.value}`,
    status,
    revision: `manual:${fileDigest}`,
    clean: false,
    treeDigest: fileDigest.slice('sha256:'.length),
    environment: { source: 'manual', ...(ref.value !== undefined ? { ref: ref.value } : {}), recordedBy: input.by, file: name.value, fileDigest, size: input.bytes.length },
    contractVersion: contract.value.version,
    policyRevision: contract.value.policyRevision,
    independence: 'external',
    acceptance: [],
    artifactDigest: stored.value.digest,
    nowMs: input.nowMs,
  });
  if (!row.ok) return row;
  return ok({ evidenceId: row.value.evidenceId, kind: input.kind, artifactDigest: stored.value.digest, fileDigest });
}

// ---- pr record -----------------------------------------------------------------------------------------------------------------------------------------------

const OWNER_OR_REPO = /^[A-Za-z0-9._-]+$/;
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]{0,8})\/?$/;
const ONLY_DOTS = /^\.+$/;

export interface PullRequestParts {
  host: string;
  owner: string;
  repository: string;
  number: number;
}

// The parts of a pull request URL, kept as written: `https://<host>/<owner>/<repository>/pull/<number>` and nothing else. A URL that carries credentials, another scheme,
// another path or a segment that is not a name is refused; a query and a fragment are dropped (they are not part of what identifies the pull request).
export function parsePullRequestUrl(text: string): Result<PullRequestParts & { scope: string }> {
  const line = lineOf('url', text, REF_MAX_CHARS);
  if (!line.ok) return line;
  let url: URL;
  try {
    url = new URL(line.value);
  } catch {
    return invalid('url', 'a pull request is given as its URL: https://<host>/<owner>/<repository>/pull/<number>');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return invalid('url', 'a pull request URL is http or https');
  if (url.username !== '' || url.password !== '') return invalid('url', 'a pull request URL carries no credentials');
  const match = PULL_PATH.exec(url.pathname);
  if (match === null) return invalid('url', 'the path of a pull request URL is /<owner>/<repository>/pull/<number>');
  const [, owner, repository, number] = match as unknown as [string, string, string, string];
  for (const segment of [owner, repository]) {
    if (!OWNER_OR_REPO.test(segment) || ONLY_DOTS.test(segment)) return invalid('url', `${segment} is not an owner or repository name`);
  }
  return ok({ host: url.host, owner, repository, number: Number(number), scope: `${url.protocol}//${url.host}/${owner}/${repository}/pull/${number}` });
}

export interface PullRequestRecorded {
  ref: ExternalRef;
  parts: PullRequestParts;
  duplicate: boolean;
}

// Records a pull request the owner opened in the web UI as a reference of the run: the provider `github` (an enterprise host serves the same shape), the kind
// `pull-request`, the ID `<owner>/<repository>#<number>` as the host wrote them and the URL as the scope. Ledger only: nothing is fetched, so nothing says whether the
// pull request exists or what state it is in.
export function recordPullRequest(deps: AppDeps, input: { runId: string; url: string; by: string; nowMs: number }): Result<PullRequestRecorded> {
  const run = deps.ledger.getRun(input.runId);
  if (!run.ok) return run;
  const parsed = parsePullRequestUrl(input.url);
  if (!parsed.ok) return parsed;
  const { scope, ...parts } = parsed.value;
  const id = `${parts.owner}/${parts.repository}#${parts.number}`;
  const existing = deps.ledger.listTaskRefs(input.runId);
  if (!existing.ok) return existing;
  const held = existing.value.find((r) => r.provider === PULL_REQUEST_PROVIDER && r.kind === PULL_REQUEST_KIND && r.id === id && r.scope === scope);
  if (held !== undefined) return ok({ ref: held, parts, duplicate: true });
  const ref: ExternalRef = { provider: PULL_REQUEST_PROVIDER, kind: PULL_REQUEST_KIND, id, retrievedAt: new Date(input.nowMs).toISOString(), scope, freshness: 'fresh' };
  const written = deps.ledger.recordTaskRefs(input.runId, [ref]);
  if (!written.ok) return written;
  const event = deps.ledger.appendEvent({
    type: 'manual.pr_recorded',
    runId: input.runId,
    data: { runId: input.runId, host: parts.host, owner: parts.owner, repository: parts.repository, number: parts.number, recordedBy: input.by },
    nowMs: input.nowMs,
  });
  if (!event.ok) return event;
  return ok({ ref, parts, duplicate: false });
}

// ---- comment --print -----------------------------------------------------------------------------------------------------------------------------------------

// The body of a tracker comment for the owner to paste, built only from ledger rows: the run, its state, its items' states, the checks that passed with the revision each
// passed at, and the decisions still open. It writes nothing and posts nothing.
export function renderComment(deps: AppDeps, runId: string): Result<string> {
  const run = deps.ledger.getRun(runId);
  if (!run.ok) return run;
  const statuses = getRunStatuses(deps.ledger, run.value.projectId, deps.clock.nowMs());
  if (!statuses.ok) return statuses;
  const status = statuses.value.find((s) => s.runId === runId);
  if (status === undefined) return err({ kind: 'not_found', ref: `status of run ${runId}` });
  const lines: string[] = [`AVARICE run ${printable(status.runId)}: ${printable(status.title)}`];
  lines.push(`state: ${printable(status.state)}${status.reason !== null ? ` (${printable(status.reason)})` : ''}`);
  const items = status.items ?? [];
  if (items.length === 0) lines.push('items: none');
  else lines.push('items:', ...items.map((i) => `- ${printable(i.itemId)}: ${printable(i.state)}`));
  const passed = status.evidence.filter((e) => e.status === 'passed');
  if (passed.length === 0) lines.push('checks passed: none');
  else lines.push('checks passed:', ...passed.map((e) => `- ${printable(e.name)} passed at ${printable(e.revision)}`));
  const open = (status.decisions ?? []).filter((d) => d.state === 'open');
  if (open.length === 0) lines.push('open decisions: none');
  else lines.push('open decisions:', ...open.map((d) => `- ${printable(d.decisionId)} (${printable(d.class)})${d.affectedItems.length > 0 ? ` affects ${d.affectedItems.map(printable).join(', ')}` : ''}`));
  return ok(`${(deps.redact ?? redactSecrets)(lines.join('\n'))}\n`);
}
