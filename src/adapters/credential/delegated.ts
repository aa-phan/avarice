// SKELETON for the RED run of Task 2 of plan 04-15: the planned name exists and resolves nothing.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CredentialProvider, SecretHandle } from '../../ports/credential-provider.ts';

export interface DelegatedProviderOptions {
  pathEnv?: string;
}

export class DelegatedProvider implements CredentialProvider {
  constructor(_options: DelegatedProviderOptions = {}) {}

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'delegated', version: '1', capabilities: { delegated: true }, offline: true };
  }

  resolve(_name: string, _purpose: string): Promise<Result<SecretHandle>> {
    return Promise.resolve(err({ kind: 'unavailable', cause: 'not implemented' }));
  }
}
