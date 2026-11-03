// The `intel` index step. Plan 01-17 builds it (one contained invocation of the GSD intel refresh); until then it
// reports the index absent, which the record states and activation accepts (ONB-13).
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { IndexStepResult } from '../../domain/project-record.ts';
import type { AppDeps } from '../deps.ts';
import type { IndexStepContext } from './index-steps.ts';

const NOT_BUILT = 'not-built-in-this-build';

export async function runIntelStep(_deps: AppDeps, ctx: IndexStepContext): Promise<Result<IndexStepResult>> {
  if (!ctx.contract.body.indexes.intel) return ok({ index: 'intel', status: 'disabled' });
  return ok({ index: 'intel', status: 'absent', reason: NOT_BUILT });
}
