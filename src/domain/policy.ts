// Skeleton: the evaluator arrives with the tracer's implementation.
import { ok } from './result.ts';
import type { Result } from './result.ts';
import type { ProfileClass } from './profile.ts';

export type PolicyEffect = 'allow' | 'deny' | 'require-approval';
export type PolicySourceKind = 'organization' | 'user' | 'repository';

export interface PolicyRule {
  id: string;
  action: string;
  when?: Record<string, string>;
  effect: PolicyEffect;
  approvalSource?: string;
}

export interface PolicyFile {
  schema: 1;
  rules: PolicyRule[];
}

export interface PolicySources {
  profileClass: ProfileClass;
  organization?: Result<PolicyFile> | 'absent';
  user?: PolicyFile;
  repository?: PolicyFile;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ruleId: string;
  rank: 1 | 2 | 3 | 4;
}

export const BUILTIN_POLICY: readonly unknown[] = [];

export function parsePolicyFile(_raw: unknown, _source: PolicySourceKind): Result<PolicyFile> {
  return ok({ schema: 1, rules: [] });
}

export function evaluatePolicy(_sources: PolicySources, _action: string, _params: Readonly<Record<string, string>>): PolicyDecision {
  return { effect: 'allow', ruleId: 'skeleton', rank: 2 };
}
