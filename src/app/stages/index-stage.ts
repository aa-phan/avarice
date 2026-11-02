// Index steps for `planning_ready`. The index registry (code graph, intel, knowledge) arrives in plan
// 01-14; until then the stage only commits the checkpoint that names activation, so the kill point
// `after-checkpoint:activate` exists and the record is built only after it.
import { ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { OnboardingRow } from '../../ports/ledger.ts';
import type { Stage, StageContext } from './stage.ts';

export const indexStage: Stage = (ctx: StageContext, _row: OnboardingRow): Result<void> => {
  const checkpoint = ctx.checkpoint('activate');
  return checkpoint.ok ? ok(undefined) : checkpoint;
};
