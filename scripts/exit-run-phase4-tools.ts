// Skeleton for the RED commit of plan 04-35: every export of the tools exists and none is implemented yet.
const notYet = (): never => {
  throw new Error('not implemented');
};

export interface DryRunOptions {
  listPath: string;
  home: string;
  cloneRoot: string;
  perRepoCapUsd: number;
  expectedCount: number;
  activeRecordOf: (repoPath: string) => { profile: string; version: number; mappingMode: string; completeness: string; onboardedRevision: string } | undefined;
  clone: (url: string, dest: string, pin: string) => void;
}

export const authorizationProblems = notYet as unknown as (auth: unknown, state: { listSha256: string; spentUsd: number; ceilingUsd: number; spentByPlanUsd: number }) => string[];
export const authorizeRefusal = notYet as unknown as (io: { stdinTty: boolean; stdoutTty: boolean }) => string | undefined;
export const buildDryRun = notYet as unknown as (options: DryRunOptions) => {
  problems: string[];
  repositories: Array<{ id: string; path: string; sourceKind: string; expectedPath: string; profile: string; headIsPin: boolean; capUsd: number; existingMap?: { class: string }; state: { filesDigest: string; refsDigest: string; statusDigest: string } }>;
  spend: { projectedUsd: number; fits: boolean; spentUsd: number };
};
export const captureState = notYet as unknown as (repo: string) => Record<string, unknown>;
export const entryRefusal = notYet as unknown as (entry: Record<string, unknown>) => string | undefined;
export const judgeEntry = notYet as unknown as (entry: Record<string, unknown>) => string[];
export const loadList = notYet as unknown as (path: string) => { ok: true; list: { sha256: string; repositories: Array<{ pin: string }> } } | { ok: false; problems: string[] };
export const profileOf = notYet as unknown as (id: string, choice: string) => string;
export const projectionOf = notYet as unknown as (input: { spentUsd: number; ceilingUsd: number; perRepoCapUsd: number; count: number }) => { totalUsd: number; fits: boolean; headroomUsd: number };
export const sameState = notYet as unknown as (a: Record<string, unknown>, b: Record<string, unknown>) => boolean;
export const verifyEvidence = notYet as unknown as (evidence: Record<string, unknown>, list: { repositories: Array<{ id: string }> }) => { ok: boolean; problems: string[]; active: number };
export const writeEntry = notYet as unknown as (path: string, entry: Record<string, unknown>) => { ok: true } | { ok: false; reason: string };
