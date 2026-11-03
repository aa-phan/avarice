// `context {term}` (FR-20): placeholder until the index-first assembler lands.
import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { AppDeps } from './deps.ts';

export const DEFAULT_CONTEXT_BUDGET = 4000;
export const MAX_CONTEXT_BUDGET = 100_000;

export interface ContextRequest {
  projectId?: string;
  term: string;
  budget: number;
}

export interface ContextReport {
  term: string;
  budget: number;
  usedTokens: number;
  project: { projectId: string; repoPath: string; recordVersion: number; onboardedRevision: string };
  items: unknown[];
  omitted: unknown[];
  notes: string[];
}

export async function queryContext(_deps: AppDeps, _request: ContextRequest): Promise<Result<ContextReport>> {
  return err({ kind: 'internal', cause: 'context is not implemented' });
}

export function renderContext(_report: ContextReport): string {
  return '';
}
