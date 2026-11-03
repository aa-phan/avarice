// The `code-graph` index step. Task 2 of plan 01-14 builds it with the GraphTool; until then it reports the graph
// absent so the registry, the stored results and the record folding can be proven first.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import type { AppDeps } from '../deps.ts';
import type { IndexStepContext } from './index-steps.ts';

export async function runCodeGraphStep(_deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.codeGraph) return ok({ index: 'code-graph', status: 'disabled' });
  return ok({ index: 'code-graph', status: 'absent', reason: 'not-built-yet' });
}
