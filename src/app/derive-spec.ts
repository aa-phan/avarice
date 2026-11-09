// RED stub: replaced in the GREEN commit.
import type { IndexFacts } from '../domain/run-contract.ts';
import type { AppDeps } from './deps.ts';

export async function collectIndexFacts(_deps: AppDeps, _projectId: string, _terms: readonly string[]): Promise<{ facts?: IndexFacts; note: string }> {
  return { note: 'index: not used (absent)' };
}
