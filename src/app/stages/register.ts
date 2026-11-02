// Register and preflight (docs/repository-onboarding.md "Stages"): resolve the git root, root commit, pin
// and uncommitted names through the StagingWorkspace port, register the project and create the onboarding
// in `discovered`. Plan 01-08 replaces the body of registerAndPreflight (wider preflight, prior-state
// detection, `repo add`); the signature and the shape of the stored request stay.
import { resolve } from 'node:path';
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
  const nowMs = deps.clock.nowMs();

  const project = deps.ledger.registerProject({
    projectId: deps.ids.next('proj_'),
    rootCommit: facts.rootCommit,
    repoPath: facts.gitRoot,
    remote: facts.remote ?? null,
    defaultBranch: facts.branch === '' ? null : facts.branch,
    nowMs,
  });
  if (!project.ok) return project;

  // Names only (T-01-66): uncommitted and untracked files stay in the user's checkout, unmapped.
  const notMapped = [...new Set([...facts.modified, ...facts.untracked])].sort();
  const request_: Record<string, unknown> = {
    repoPath: facts.gitRoot,
    policy: request.policy,
    promote: request.promote ?? 'none',
  };
  if (request.mode !== undefined) request_['mode'] = request.mode;
  if (request.budgetOverrides !== undefined) request_['budgetOverrides'] = request.budgetOverrides;

  const onboarding = deps.ledger.createOnboarding({
    onboardingId: deps.ids.next('onb_'),
    projectId: project.value.projectId,
    preflight: {
      request: request_,
      gitRoot: facts.gitRoot,
      rootCommit: facts.rootCommit,
      pin: facts.pin,
      branch: facts.branch,
      remote: facts.remote ?? null,
      notMapped,
    },
    nowMs,
  });
  if (!onboarding.ok) return onboarding;
  return ok({ projectId: project.value.projectId, onboardingId: onboarding.value.onboardingId });
}
