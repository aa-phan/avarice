// DelegatedProvider: `delegated:<cli>` means the named vendor CLI holds the credential and AVARICE never sees it (SEC-2, ADR-009). The
// provider only checks that the CLI is an executable file on PATH and returns a handle that names it and holds no value; use(fn) receives
// the empty string. A privileged step that needs the credential runs the CLI itself, under the CLI's own authentication (Phase 5 delivery).
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CredentialProvider, SecretHandle } from '../../ports/credential-provider.ts';
import { delegatedHandle } from './handle.ts';

export interface DelegatedProviderOptions {
  // The PATH searched for the CLI; defaults to this process's PATH.
  pathEnv?: string;
}

function onPath(cli: string, pathEnv: string): boolean {
  for (const dir of pathEnv.split(':')) {
    if (dir === '' || !isAbsolute(dir)) continue;
    const candidate = join(dir, cli);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      // not in this directory
    }
  }
  return false;
}

export class DelegatedProvider implements CredentialProvider {
  readonly #pathEnv: string | undefined;

  constructor(options: DelegatedProviderOptions = {}) {
    this.#pathEnv = options.pathEnv;
  }

  get descriptor(): CapabilityDescriptor {
    return { port: 'credential', adapter: 'delegated', version: '1', capabilities: { delegated: true }, offline: true };
  }

  resolve(name: string, _purpose: string): Promise<Result<SecretHandle>> {
    const pathEnv = this.#pathEnv ?? process.env['PATH'] ?? '';
    if (!onPath(name, pathEnv)) return Promise.resolve(err({ kind: 'unavailable', cause: `${name} was not found as an executable on PATH` }));
    return Promise.resolve(ok(delegatedHandle(name)));
  }
}
