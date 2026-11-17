// Resource bounds (plan 04-30; OPS-5, D-13; docs/operations-and-testing.md "Resource bounds"). Skeleton: the shapes and the defaults only.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export interface ResourceLimits {
  contextTokens: number;
  maxConcurrentChecks: number;
  artifactQuotaMiB: number;
  maxActiveRuns: number;
  maxEventRows: number;
  checkOutputBytes: number;
}

export const LIMIT_DEFAULTS: Readonly<ResourceLimits> = Object.freeze({
  contextTokens: 24_000,
  maxConcurrentChecks: 1,
  artifactQuotaMiB: 2048,
  maxActiveRuns: 20,
  maxEventRows: 500_000,
  checkOutputBytes: 5 * 1024 * 1024,
});

export function parseLimitsSection(_raw: unknown): Result<ResourceLimits> {
  return ok({ ...LIMIT_DEFAULTS });
}

export function effectivePackBudget(ceiling: number, _promptMax: number, _contractBytes: number, _overhead: number): number {
  return ceiling;
}
