// Preflight classification (docs/repository-onboarding.md "Existing state and migration", ONB-6). RED stub:
// the facts types are final, the classification functions are replaced by the implementation.
import { ok } from './result.ts';
import type { Result } from './result.ts';
import type { OnboardingState } from './onboarding-lifecycle.ts';

export interface MapFileFacts {
  // Repository-relative path, for example `.planning/codebase/STACK.md`.
  path: string;
  // `last_mapped_commit` from the frontmatter of the committed file; null when absent or not a commit SHA.
  lastMappedCommit: string | null;
  // Most recent commit at or before the pin that introduced that stamp value into the file.
  stampCommit: string | null;
  // Most recent commit at or before the pin that touched the file.
  lastCommit: string | null;
}

export interface RepoFacts {
  gitRoot: string;
  rootCommit: string;
  remote?: string;
  pin: string;
  branch: string;
  defaultBranch: string | null;
  modified: string[];
  untracked: string[];
  planningFiles: string[];
  codebaseMapFiles: MapFileFacts[];
  submodules: string[];
  nestedRepos: string[];
  workspaceManifests: string[];
  instructionFiles: string[];
  adrDirs: string[];
  runtimes: string[];
  trackedFiles: number;
  trackedBytes: number;
}

export type ExistingMapClass = 'none' | 'stamped-complete' | 'stamped-partial' | 'unstamped' | 'unknown-format' | 'user-edited';

export const EXISTING_MAP_OUTCOME = 'isolated-regeneration';

export function classifyExistingMap(_facts: Pick<RepoFacts, 'codebaseMapFiles' | 'modified' | 'untracked'>): ExistingMapClass {
  return 'none';
}

export interface LedgerView {
  activeRecord: boolean;
  onboardings: ReadonlyArray<{ onboardingId: string; state: OnboardingState }>;
}

export interface PreflightRequest {
  promote?: string;
}

export interface PreflightClassification {
  findings: Record<string, unknown>;
  continueOnboardingId: string | null;
}

export function classifyPreflight(_facts: RepoFacts, _view: LedgerView, _request: PreflightRequest): Result<PreflightClassification> {
  return ok({ findings: {}, continueOnboardingId: null });
}
