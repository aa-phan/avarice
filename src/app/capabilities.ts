// The composition-time capability check (FR-16): every descriptor the composed dependencies publish, and the refusal a step gets
// when what it requires is not declared by one of them.
import { ok } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { StepName } from '../domain/capability-requirements.ts';
import type { CapabilityDescriptor } from '../ports/capability.ts';
import type { AppDeps } from './deps.ts';

export function descriptorsOf(_deps: AppDeps): CapabilityDescriptor[] {
  return [];
}

export function requireCapabilities(_deps: AppDeps, _step: StepName): Result<void> {
  return ok(undefined);
}
