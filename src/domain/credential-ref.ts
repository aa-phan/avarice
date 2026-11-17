// Credential references as pure rules (SEC-2, ADR-009, D-17). SKELETON for the RED run of plan 04-15: the planned names exist and refuse nothing.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export type ProviderName = 'keychain' | 'cmd' | 'delegated';

export interface CredentialRef {
  provider: ProviderName;
  name: string;
}

export function parseCredentialRef(_text: string): Result<CredentialRef> {
  return ok({ provider: 'keychain', name: '' });
}
