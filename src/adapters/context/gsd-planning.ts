// `gsd-planning` context adapter (skeleton: plan 04-26 task 2 RED).
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextRefreshQuery, ContextSource, ExternalRef, TokenBudget } from '../../ports/context-source.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';

export class GsdPlanningContext implements ContextSource {
  readonly descriptor: CapabilityDescriptor;

  constructor(_options: ContextAdapterOptions) {
    this.descriptor = {
      port: 'context-source',
      adapter: 'gsd-planning',
      version: '1',
      capabilities: { find: true, read: true, refresh: true },
      offline: true,
    };
  }

  async find(_query: ContextQuery, _budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    return err({ kind: 'internal', cause: 'gsd-planning find is not built yet' });
  }

  async read(_handles: readonly ContextHandle[], _budget: TokenBudget): Promise<Result<ContextItem[]>> {
    return err({ kind: 'internal', cause: 'gsd-planning read is not built yet' });
  }

  async refresh(ref: ExternalRef, _query: ContextRefreshQuery): Promise<Result<ExternalRef>> {
    return ok(ref);
  }
}
