// The profile's resource limits as the application layer reads them (plan 04-30; OPS-5, D-13): the `limits` section of the profile config, parsed by the pure rule in
// src/domain/resource-bounds.ts. A command that can refuse (`start`, `context`) reads it with `profileLimits` and reports a section it cannot use. Code that enforces a bound
// where a refusal would only hide the real work (a check's output cap, the pack budget of a run that is already going) reads it with `limitsOrDefaults`: a section that
// cannot be used leaves the documented defaults in force, never an unbounded resource, and `start` and `doctor` are where the owner is told.
import { LIMIT_DEFAULTS, parseLimitsSection } from '../domain/resource-bounds.ts';
import type { ResourceLimits } from '../domain/resource-bounds.ts';
import type { Result } from '../domain/result.ts';
import type { AppDeps } from './deps.ts';

export function profileLimits(deps: Pick<AppDeps, 'profile'>): Result<ResourceLimits> {
  return parseLimitsSection(deps.profile.config.sections.limits);
}

export function limitsOrDefaults(deps: Pick<AppDeps, 'profile'>): ResourceLimits {
  const parsed = profileLimits(deps);
  return parsed.ok ? parsed.value : { ...LIMIT_DEFAULTS };
}
