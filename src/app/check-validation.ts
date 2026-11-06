// Active validation of the declared checks (ONB-10, CON-8, T-02-45). A check named in the repository conventions is repository code: it is
// not run for evidence until it has been seen to behave. Each check runs once in a scratch validation clone at the pin, with the
// dependencies installed, writes allowed anywhere in that clone, and network only to an empty-allowlist proxy that records every attempt.
//
//   active        the check wrote only the paths it declares (`writes`) and made no network attempt; its exit status is not judged, because a
//                 check that fails at the pin is still a check (a pre-existing failure is a baseline fact, not a validation fact)
//   rejected      it wrote another path (`unexpected-write`, with the paths) or tried the network (`network`, with the hosts)
//   unavailable   the sandbox or the spawn failed, or the check timed out: nothing is known, so nothing is cached
//
// Verdicts are cached in the ledger per project, pin, the digest of that one check's spec and its name; a later run on the same pin
// reuses them, and a changed argv, env or writes re-validates that check only. A required check that is not active blocks the run
// before any invocation; a rejected optional check is left out and recorded. Detection of a network attempt that a check swallows
// is by proxy and by the sandbox's error text in the check's output: prevention is the sandbox, detection here is a second signal.
import { matchesAny } from '../domain/glob.ts';
import { err, ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { RunBlockedReason } from '../domain/run-lifecycle.ts';
import type { RunContract } from '../domain/run-contract.ts';
import type { RunRow } from '../ports/ledger.ts';
import { cachedVerdicts, canonical, sandboxSetup, verdictKey } from './checks.ts';
import type { AppDeps } from './deps.ts';

export const CHECK_VERDICTS = ['active', 'rejected', 'unavailable'] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];

export interface CheckVerdictDetail {
  // rejected: `unexpected-write` or `network`; unavailable: `sandbox-unavailable`, `spawn-error` or `timeout`.
  reason?: string;
  paths?: string[];
  hosts?: string[];
}

export interface CheckValidationOutcome {
  name: string;
  required: boolean;
  target: boolean;
  verdict: CheckVerdict;
  detail: CheckVerdictDetail;
  // The verdict came from the ledger, not from a run of the check.
  reused: boolean;
}

export interface ValidationReport {
  // In declared check order.
  outcomes: CheckValidationOutcome[];
  reused: number;
}

// The sandbox's own refusals and a resolver that cannot reach out, as they appear in a check's output.
const NETWORK_ERROR_TEXT = /ENOTFOUND|EAI_AGAIN|getaddrinfo|connect EPERM|ECONNREFUSED/;
const HOST_IN_TEXT = /(?:ENOTFOUND|getaddrinfo [A-Z_]+|EAI_AGAIN)\s+([a-z0-9][a-z0-9.-]*)/gi;
const MAX_PATHS = 20;
const MAX_HOSTS = 10;
const MAX_REASON_CHARS = 200;

function hostsInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(HOST_IN_TEXT)) found.add((match[1] as string).toLowerCase());
  return [...found].slice(0, MAX_HOSTS);
}

// What a validated check does to the clone: the paths that appeared or changed while it ran, minus the paths it declared.
function unexpectedWrites(before: readonly string[], after: readonly string[], writes: readonly string[]): string[] {
  const known = new Set(before);
  return after.filter((path) => !known.has(path) && !matchesAny(path, writes));
}

async function validateOne(deps: AppDeps, run: RunRow, contract: RunContract, spec: RunContract['execution']['checks'][number], clone: string): Promise<Result<{ verdict: CheckVerdict; detail: CheckVerdictDetail }>> {
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const sandbox = sandboxSetup(deps, run, clone);
  if (!sandbox.ok) return sandbox;
  // The empty-allowlist proxy is a detector: it records what a check tries to reach. When it cannot be started (a process that has no network
  // at all cannot even listen on loopback) the check runs with no network, not one loopback port, so nothing can leak and only the
  // detection narrows to the sandbox's error text in the check's output.
  const started = deps.egress === undefined ? undefined : await deps.egress.start({ allow: [] });
  const proxy = started?.ok === true ? started.value : undefined;
  try {
    const before = workspace.statusAll(clone);
    if (!before.ok) return before;
    const url = proxy === undefined ? undefined : `http://127.0.0.1:${proxy.port}`;
    const ran = await deps.executor.run({
      argv: spec.argv,
      cwd: clone,
      env: { ...spec.env, ...sandbox.value.env, ...(url !== undefined ? { HTTP_PROXY: url, HTTPS_PROXY: url, npm_config_proxy: url, npm_config_https_proxy: url } : {}) },
      timeoutMs: spec.timeoutSec * 1000,
      invocationId: deps.ids.next('inv_'),
      // Anywhere in the validation clone: what the check writes is what is being measured.
      writePaths: [clone, sandbox.value.scratch],
      denyReadPaths: sandbox.value.denyReadPaths,
      ...(proxy !== undefined ? { allowLoopbackPorts: [proxy.port] } : {}),
    });
    if (!ran.ok) {
      if (ran.error.kind === 'unavailable') return ok({ verdict: 'unavailable', detail: { reason: 'sandbox-unavailable' } });
      return ran;
    }
    if (ran.value.status === 'spawn_error') return ok({ verdict: 'unavailable', detail: { reason: 'spawn-error' } });
    if (ran.value.status === 'timed_out' || ran.value.status === 'cancelled') return ok({ verdict: 'unavailable', detail: { reason: 'timeout' } });

    const after = workspace.statusAll(clone);
    if (!after.ok) return after;
    const paths = unexpectedWrites(before.value, after.value, spec.writes);
    const attemptedHosts = (proxy?.attempts() ?? []).map((a) => a.host);
    const output = `${ran.value.stdout}\n${ran.value.stderr}`;
    const hosts = [...new Set([...attemptedHosts, ...hostsInText(output)])].slice(0, MAX_HOSTS);
    const network = attemptedHosts.length > 0 || NETWORK_ERROR_TEXT.test(output);
    if (paths.length > 0) {
      return ok({ verdict: 'rejected', detail: { reason: 'unexpected-write', paths: paths.slice(0, MAX_PATHS), ...(network ? { hosts } : {}) } });
    }
    if (network) return ok({ verdict: 'rejected', detail: { reason: 'network', hosts } });
    return ok({ verdict: 'active', detail: {} });
  } finally {
    await proxy?.close();
  }
}

// Validates every declared check that has no cached verdict, in declared order, and returns one outcome per declared check in that order. The
// validation clone is made only when a check needs it. `prepared` runs once after the clone exists and before the first check (the
// dependency install); a failure it returns is returned unchanged and nothing is validated.
export async function validateChecks(
  deps: AppDeps,
  run: RunRow,
  contract: RunContract,
  options: { prepared?: (clone: string) => Promise<Result<void>> } = {},
): Promise<Result<ValidationReport>> {
  const workspace = deps.runWorkspace;
  if (workspace === undefined) return err({ kind: 'internal', cause: 'the run workspace is not composed' });
  const cached = cachedVerdicts(deps, run, contract);
  if (!cached.ok) return cached;
  const required = new Set(contract.verification.requiredChecks);
  const targets = new Set(contract.verification.targetChecks);

  let clone: string | undefined;
  const outcomes: CheckValidationOutcome[] = [];
  for (const spec of contract.execution.checks) {
    const base = { name: spec.name, required: required.has(spec.name), target: targets.has(spec.name) };
    const known = cached.value.get(spec.name);
    if (known !== undefined) {
      outcomes.push({ ...base, verdict: known.verdict as CheckVerdict, detail: (typeof known.detail === 'object' && known.detail !== null ? known.detail : {}) as CheckVerdictDetail, reused: true });
      continue;
    }
    if (clone === undefined) {
      const project = deps.ledger.findProject({ projectId: run.projectId });
      if (!project.ok) return project;
      if (project.value === null) return err({ kind: 'not_found', ref: `project ${run.projectId}` });
      const prepared = workspace.prepareValidationClone({ repoPath: project.value.repoPath, workRoot: deps.profile.workRoot, runId: run.runId, pin: contract.workspace.baseRevision });
      if (!prepared.ok) return prepared;
      clone = canonical(prepared.value);
      if (options.prepared !== undefined) {
        const ready = await options.prepared(clone);
        if (!ready.ok) return ready;
      }
    }
    const judged = await validateOne(deps, run, contract, spec, clone);
    if (!judged.ok) return judged;
    // `unavailable` is not cached: nothing is known about the check, and the next run must look again.
    if (judged.value.verdict !== 'unavailable') {
      const recorded = deps.ledger.recordCheckValidation({
        projectId: run.projectId,
        baseRevision: contract.workspace.baseRevision,
        specDigest: verdictKey(spec),
        name: spec.name,
        verdict: judged.value.verdict,
        detail: judged.value.detail,
        nowMs: deps.clock.nowMs(),
      });
      // A concurrent run that validated the same check first has recorded the same fact; that is not an error.
      if (!recorded.ok && recorded.error.kind !== 'conflict') return recorded;
    }
    const event = deps.ledger.appendEvent({
      type: 'check.validated',
      runId: run.runId,
      data: { runId: run.runId, name: spec.name, verdict: judged.value.verdict, ...(judged.value.detail.reason !== undefined ? { reason: judged.value.detail.reason.slice(0, MAX_REASON_CHARS) } : {}) },
      nowMs: deps.clock.nowMs(),
    });
    if (!event.ok) return event;
    outcomes.push({ ...base, verdict: judged.value.verdict, detail: judged.value.detail, reused: false });
  }
  return ok({ outcomes, reused: outcomes.filter((o) => o.reused).length });
}

// How a check that is not active is reported to the owner and which block it is: a missing sandbox is a containment condition, everything
// else is the repository's own check misbehaving and a decision for the owner (class permission: the check wanted more than it declared).
export function blockingOf(outcome: CheckValidationOutcome): { reason: RunBlockedReason; issue: string } {
  const detail = outcome.detail;
  const kind = outcome.required ? 'required' : 'target';
  if (outcome.verdict === 'rejected') {
    const what =
      detail.reason === 'network'
        ? `tried to reach the network${detail.hosts !== undefined && detail.hosts.length > 0 ? ` (${detail.hosts.join(', ')})` : ''}`
        : `wrote outside its declared paths${detail.paths !== undefined ? ` (${detail.paths.slice(0, 5).join(', ')})` : ''}`;
    return { reason: 'decision', issue: `the ${kind} check ${outcome.name} ${what} during validation, so it was not activated` };
  }
  const reason = detail.reason ?? 'unknown';
  return {
    reason: reason === 'sandbox-unavailable' ? 'enforcement_failure' : 'decision',
    issue: `the ${kind} check ${outcome.name} could not be validated (${reason}), so it was not activated`,
  };
}
