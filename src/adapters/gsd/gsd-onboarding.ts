// GsdOnboardingAdapter (stub until the GREEN commit of plan 01-09 Task 1).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { GsdAppliedSetting, GsdCapabilitySnapshot, GsdDriftResult, GsdOnboarding, GsdProjectState, GsdStampResult } from '../../ports/gsd-onboarding.ts';
import type { LocatedGsd } from './locate.ts';

const NOT_IMPLEMENTED = err({ kind: 'internal', cause: 'not implemented' } as const);

export class GsdOnboardingAdapter implements GsdOnboarding {
  readonly descriptor: CapabilityDescriptor = { port: 'gsd-onboarding', adapter: 'gsd-onboarding', version: '0.0.0', capabilities: {}, offline: true };
  readonly located: LocatedGsd;
  constructor(located: LocatedGsd) {
    this.located = located;
  }
  inspect(): Result<GsdCapabilitySnapshot> {
    return NOT_IMPLEMENTED;
  }
  probeState(_staging: string): Promise<Result<GsdProjectState>> {
    return Promise.resolve(NOT_IMPLEMENTED);
  }
  configure(_staging: string, _settings: readonly (readonly [string, string])[]): Promise<Result<GsdAppliedSetting[]>> {
    return Promise.resolve(NOT_IMPLEMENTED);
  }
  stamp(_staging: string, _files?: readonly string[]): Promise<Result<GsdStampResult>> {
    return Promise.resolve(NOT_IMPLEMENTED);
  }
  checkDrift(_staging: string): Promise<Result<GsdDriftResult>> {
    return Promise.resolve(NOT_IMPLEMENTED);
  }
  initPlanning(): Result<never> {
    return err({ kind: 'unsupported', capability: 'init-planning', reducedMode: 'out of scope for Phase 1' });
  }
}
