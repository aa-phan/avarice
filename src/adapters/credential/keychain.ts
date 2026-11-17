// KeychainProvider: resolves `keychain:<service>` from the macOS Keychain with `/usr/bin/security find-generic-password -s <service> -w`
// (SEC-2, ADR-009). The service name is the only argument that varies and the value arrives on stdout only, so no secret is ever in a
// process argument list (T-04-40). The command runs by argv (no shell) with an environment of PATH and HOME alone and a 5 s timeout;
// its stderr is discarded, never read or logged. Exit 44 is "item not found". The redactor is seeded before the handle is built.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CredentialProvider, SecretHandle } from '../../ports/credential-provider.ts';
import { sealValue, seedOnResolved } from './handle.ts';
import type { OnResolved } from './handle.ts';

export const SECURITY_TOOL = '/usr/bin/security';
export const KEYCHAIN_TIMEOUT_MS = 5_000;
// A keychain secret is a token or a password; a larger answer is not one.
const MAX_VALUE_BYTES = 16 * 1024;
const NOT_FOUND_EXIT = 44;

export interface KeychainProviderOptions {
  // A keychain file to search instead of the default search list (tests use a temporary keychain; production never sets it).
  keychainPath?: string;
  // The home directory `security` finds the default keychains under; defaults to the OS answer.
  home?: string;
  // Replaces the 5 s timeout. Only tests set it.
  timeoutMs?: number;
  // The hook that receives each resolved value before the handle is returned; defaults to seeding the process redactor.
  onResolved?: OnResolved;
}

export class KeychainProvider implements CredentialProvider {
  readonly #keychainPath: string | undefined;
  readonly #home: string;
  readonly #timeoutMs: number;
  readonly #onResolved: OnResolved;

  constructor(options: KeychainProviderOptions = {}) {
    this.#keychainPath = options.keychainPath;
    this.#home = options.home ?? homedir();
    this.#timeoutMs = options.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
    this.#onResolved = options.onResolved ?? seedOnResolved;
  }

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'keychain', version: '1', capabilities: { delegated: false }, offline: true };
  }

  resolve(name: string, _purpose: string): Promise<Result<SecretHandle>> {
    const argv = ['find-generic-password', '-s', name, '-w', ...(this.#keychainPath === undefined ? [] : [this.#keychainPath])];
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: Result<SecretHandle>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      let child;
      try {
        child = spawn(SECURITY_TOOL, argv, { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: this.#home }, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        resolve(err({ kind: 'unavailable', cause: 'the keychain tool could not be started' }));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let oversized = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(err({ kind: 'timeout', afterMs: this.#timeoutMs, sideEffect: 'none' }));
      }, this.#timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_VALUE_BYTES) {
          oversized = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.on('error', () => settle(err({ kind: 'unavailable', cause: 'the keychain tool could not be started' })));
      child.on('close', (code) => {
        if (oversized) {
          settle(err({ kind: 'invalid', field: 'value', reason: `the keychain item is larger than ${MAX_VALUE_BYTES} bytes` }));
        } else if (code === NOT_FOUND_EXIT) {
          settle(err({ kind: 'unavailable', cause: 'the keychain holds no item for that service' }));
        } else if (code !== 0) {
          settle(err({ kind: 'unavailable', cause: `the keychain could not be read (exit ${code === null ? 'signal' : code})` }));
        } else {
          // `security -w` ends the value with one newline.
          const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
          chunks.length = 0;
          settle(sealValue(value, this.#onResolved));
        }
      });
    });
  }
}
