// The `knowledge` index step. Plan 01-18 builds it (the contained knowledge pass over the stable documents, merged
// into the code graph); until then it reports the index absent, which the record states and activation accepts
// (ONB-13). When it is built, its result is `{ graphDigest, knowledge }`, which activation folds into the graph entry.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import type { AppDeps } from '../deps.ts';
import type { IndexStepContext } from './index-steps.ts';

const NOT_BUILT = 'not-built-in-this-build';

export async function runKnowledgeStep(_deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.knowledge) return ok({ index: 'knowledge', status: 'disabled' });
  return ok({ index: 'knowledge', status: 'absent', reason: NOT_BUILT });
}
