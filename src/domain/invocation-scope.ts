// Vendor-neutral write, read and command scope of one contained invocation (STUB: implemented in the GREEN step).
import type { OnboardingContract } from './onboarding-contract.ts';

export type InvocationPurpose = 'map' | 'intel' | 'knowledge';
export type BashStrategy = 'blanket-bash-hook-identity' | 'narrow-rules' | 'hook-allow';

export const INVOCATION_PURPOSES: Readonly<Record<InvocationPurpose, { writeDir: string; cwd: 'staging' | 'write-dir' }>> = {
  map: { writeDir: '', cwd: 'staging' },
  intel: { writeDir: '', cwd: 'staging' },
  knowledge: { writeDir: '', cwd: 'staging' },
};
export const ONBOARDING_BASH_STRATEGY = 'narrow-rules' as BashStrategy;
export const READ_ONLY_COMMANDS: readonly string[] = [];
export const GSD_READ_VERBS: Readonly<Record<InvocationPurpose, readonly string[]>> = { map: [], intel: [], knowledge: [] };
export const DENIED_COMMAND_PREFIXES: readonly string[] = [];
export const FIND_DENIED_ACTIONS: readonly string[] = [];

export interface WorkspaceShape {
  topLevelEntries: string[];
  planningEntries: string[];
  gitPaths: string[];
  repoReadAllow: string[];
}

export interface InvocationScope {
  purpose: InvocationPurpose;
  cwd: string;
  stagingPath: string;
  repoPath: string;
  dataRoot: string;
  writeRoots: string[];
  denyWrite: string[];
  denyRead: string[];
  denyReadGlobs: string[];
  allowRead: string[];
  readRoots: string[];
  commands: {
    strategy: BashStrategy;
    readOnly: string[];
    gsdReadVerbs: string[];
    deniedPrefixes: string[];
    preambleSha256?: string;
  };
  subagents: { total: number; concurrent: number };
  allowedDomains: string[];
}

export interface ScopeInput {
  purpose: InvocationPurpose;
  contract: Pick<OnboardingContract, 'files' | 'budgets'>;
  stagingPath: string;
  repoPath: string;
  dataRoot: string;
  home: string;
  workspace: WorkspaceShape;
  readRoots: readonly string[];
  strategy?: BashStrategy;
  preambleSha256?: string;
}

export function computeInvocationScope(input: ScopeInput): InvocationScope {
  return {
    purpose: input.purpose,
    cwd: '',
    stagingPath: '',
    repoPath: '',
    dataRoot: '',
    writeRoots: [],
    denyWrite: [],
    denyRead: [],
    denyReadGlobs: [],
    allowRead: [],
    readRoots: [],
    commands: { strategy: 'narrow-rules', readOnly: [], gsdReadVerbs: [], deniedPrefixes: [] },
    subagents: { total: 0, concurrent: 0 },
    allowedDomains: [],
  };
}
