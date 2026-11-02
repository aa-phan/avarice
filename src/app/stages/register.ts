// Register and preflight (docs/repository-onboarding.md "Stages"): inspect the repository through the
// StagingWorkspace port (names only, committed content only), apply the ONB-6 rules against the ledger's view
// of the project, register the project and create the onboarding in `discovered`. `onboard` and `repo add`
// share this function. An onboarding of the same project that is still in `discovered` (left by `repo add`, or
// by a kill right after registration) is continued, not duplicated.
import { resolve } from 'node:path';
import { classifyPreflight } from '../../domain/preflight.ts';
import type { LedgerView } from '../../domain/preflight.ts';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { AppDeps } from '../deps.ts';

export interface OnboardRequest {
  repoPath: string;
  policy: string;
  mode?: string;
  promote?: string;
  budgetOverrides?: Readonly<Record<string, unknown>>;
}

export interface Registered {
  projectId: string;
  onboardingId: string;
}

export function registerAndPreflight(deps: AppDeps, request: OnboardRequest): Result<Registered> {
  const inspected = deps.staging.inspectRepo(resolve(request.repoPath));
  if (!inspected.ok) {
    const e = inspected.error;
    if (e.kind === 'internal' || e.kind === 'not_found') {
      return err({ kind: 'invalid', field: 'repoPath', reason: `cannot inspect ${request.repoPath} as a git repository (${e.kind === 'internal' ? e.cause : e.ref})` });
    }
    return inspected;
  }
  const facts = inspected.value;

  // What the ledger already knows about this project (same root commit and path).
  const known = deps.ledger.findProject({ rootCommit: facts.rootCommit, repoPath: facts.gitRoot });
  if (!known.ok) return known;
  let view: LedgerView = { activeRecord: false, onboardings: [] };
  if (known.value !== null) {
    const active = deps.ledger.getActiveRecord(known.value.projectId);
    if (!active.ok) return active;
    const onboardings = deps.ledger.listOnboardings(known.value.projectId);
    if (!onboardings.ok) return onboardings;
    view = {
      activeRecord: active.value !== null,
      onboardings: onboardings.value.map((row) => ({ onboardingId: row.onboardingId, state: row.state })),
    };
  }

  const classified = classifyPreflight(facts, view, request.promote === undefined ? {} : { promote: request.promote });
  if (!classified.ok) return classified;
  if (classified.value.continueOnboardingId !== null && known.value !== null) {
    return ok({ projectId: known.value.projectId, onboardingId: classified.value.continueOnboardingId });
  }

  const nowMs = deps.clock.nowMs();
  const project = deps.ledger.registerProject({
    projectId: deps.ids.next('proj_'),
    rootCommit: facts.rootCommit,
    repoPath: facts.gitRoot,
    remote: facts.remote ?? null,
    defaultBranch: facts.defaultBranch ?? (facts.branch === '' ? null : facts.branch),
    nowMs,
  });
  if (!project.ok) return project;

  const stored: Record<string, unknown> = {
    repoPath: facts.gitRoot,
    policy: request.policy,
    promote: request.promote ?? 'none',
  };
  if (request.mode !== undefined) stored['mode'] = request.mode;
  if (request.budgetOverrides !== undefined) stored['budgetOverrides'] = request.budgetOverrides;

  const onboarding = deps.ledger.createOnboarding({
    onboardingId: deps.ids.next('onb_'),
    projectId: project.value.projectId,
    preflight: {
      request: stored,
      gitRoot: facts.gitRoot,
      rootCommit: facts.rootCommit,
      pin: facts.pin,
      branch: facts.branch,
      remote: facts.remote ?? null,
      ...classified.value.findings,
    },
    nowMs,
  });
  if (!onboarding.ok) return onboarding;
  return ok({ projectId: project.value.projectId, onboardingId: onboarding.value.onboardingId });
}
