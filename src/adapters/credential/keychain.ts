// SKELETON for the RED run of plan 04-15: the planned name exists and resolves nothing.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CredentialProvider, SecretHandle } from '../../ports/credential-provider.ts';

export interface KeychainProviderOptions {
  // A keychain file to search instead of the default search list (tests use a temporary keychain).
  keychainPath?: string;
}

export class KeychainProvider implements CredentialProvider {
  constructor(_options: KeychainProviderOptions = {}) {}

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'keychain', version: '1', capabilities: { delegated: false }, offline: true };
  }

  resolve(_name: string, _purpose: string): Promise<Result<SecretHandle>> {
    return Promise.resolve(err({ kind: 'internal', cause: 'not implemented' }));
  }
}
