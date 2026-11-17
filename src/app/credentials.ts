// SKELETON for the RED run of plan 04-15: the planned name exists and resolves nothing.
import { err } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import type { CredentialProvider, SecretHandle } from '../ports/credential-provider.ts';
import type { Ledger } from '../ports/ledger.ts';
import type { Clock } from './deps.ts';

export interface CredentialDeps {
  ledger: Ledger;
  clock: Clock;
  profile: { profile: string };
  providers: Partial<Record<'keychain' | 'cmd' | 'delegated', CredentialProvider>>;
}

export interface CredentialContext {
  module: string;
  runId?: string;
  invocationId?: string;
}

export function resolveCredential(_deps: CredentialDeps, _ref: string, _purpose: string, _ctx: CredentialContext): Promise<Result<SecretHandle>> {
  return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
}
