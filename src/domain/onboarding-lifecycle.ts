import { ok } from './result.ts';
import type { Result } from './result.ts';

export const ONBOARDING_STATES: readonly string[] = [];
export type OnboardingState = string;
export type BlockedReason = string;
export const TRANSITIONS: ReadonlyArray<readonly [OnboardingState, OnboardingState]> = [];
export const NEXT_ACTIONS: Readonly<Record<string, readonly string[]>> = {};
export function assertTransition(_from: OnboardingState, _to: OnboardingState): Result<void> {
  return ok(undefined);
}
export function isStopState(_s: OnboardingState): boolean {
  return false;
}
