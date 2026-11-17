// SKELETON for the RED run of Task 2 of plan 04-15: the planned name exists and resolves nothing.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CommandExecutor } from '../../ports/command-executor.ts';
import type { CredentialProvider, SecretHandle } from '../../ports/credential-provider.ts';
import type { OnResolved } from './handle.ts';

export const HELPER_ENV_NAMES: readonly string[] = ['PATH', 'HOME'];

export interface CmdProviderOptions {
  executor: CommandExecutor;
  helpers: Readonly<Record<string, string>>;
  cwd: string;
  home?: string;
  timeoutMs?: number;
  onResolved?: OnResolved;
}

export class CmdProvider implements CredentialProvider {
  constructor(_options: CmdProviderOptions) {}

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'cmd', version: '1', capabilities: { delegated: false }, offline: true };
  }

  resolve(_name: string, _purpose: string): Promise<Result<SecretHandle>> {
    return Promise.resolve(err({ kind: 'unavailable', cause: 'not implemented' }));
  }
}
