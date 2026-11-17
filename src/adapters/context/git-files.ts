// `git-files` context adapter (skeleton: plan 04-26 task 1 RED).
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { ContextHandle, ContextItem, ContextQuery, ContextRefreshQuery, ExternalRef, GitFilesSource, TokenBudget } from '../../ports/context-source.ts';
import type { ContextAdapterOptions } from './gsd-intel.ts';

export class GitFilesContext implements GitFilesSource {
  readonly descriptor: CapabilityDescriptor;

  constructor(_options: ContextAdapterOptions) {
    this.descriptor = {
      port: 'context-source',
      adapter: 'git-files',
      version: '1',
      capabilities: { find: true, read: true, refresh: true },
      offline: true,
    };
  }

  async find(_query: ContextQuery, _budget: TokenBudget): Promise<Result<ContextHandle[]>> {
    return err({ kind: 'internal', cause: 'git-files find is not built yet' });
  }

  async read(_handles: readonly ContextHandle[], _budget: TokenBudget): Promise<Result<ContextItem[]>> {
    return err({ kind: 'internal', cause: 'git-files read is not built yet' });
  }

  async refresh(ref: ExternalRef, _query: ContextRefreshQuery): Promise<Result<ExternalRef>> {
    return ok(ref);
  }

  pathExists(_workspace: ContextQuery['workspace'], _path: string): boolean | undefined {
    return undefined;
  }
}
