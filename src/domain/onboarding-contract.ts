import { err } from './result.ts';
import type { Result } from './result.ts';

export const ONBOARDING_PRESET: Record<string, unknown> = {};
export function compileOnboardingContract(_input: any): Result<any> {
  return err({ kind: 'internal', cause: 'not implemented' });
}
export function contractDigest(_body: unknown): string {
  throw new Error('not implemented');
}
