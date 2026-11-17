// The CredentialProvider port (SEC-2, ADR-009; docs/contracts-and-state.md "CredentialProvider"). A provider is a broker: it resolves a
// reference at the moment of use from a store that already exists (the macOS Keychain, an approved helper, a vendor CLI) and keeps no
// secret value. The value reaches a caller only inside SecretHandle.use(fn), and no property, string or JSON form of a handle holds it.
import type { Result } from '../domain/result.ts';
import type { CapabilityDescriptor } from './capability.ts';

export interface SecretHandle {
  // Calls `fn` with the value and returns what it returns. A delegated handle has no value: `fn` receives the empty string.
  use<T>(fn: (value: string) => T): T;
  // The CLI that holds the credential, for a delegated handle (AVARICE never sees the value); absent otherwise.
  readonly delegatedTo?: string;
  // A fixed placeholder, so serializing a handle can never write the value.
  toJSON(): string;
}

export interface ResolveContext {
  // The invocation the command of a helper is recorded under; a provider that runs no command ignores it.
  invocationId?: string;
}

export interface CredentialProvider {
  readonly descriptor: CapabilityDescriptor;
  // `name` is the part of the reference after the scheme. `purpose` is the caller's stated reason; a provider never stores or logs it.
  // `unavailable` when the store cannot answer or has no such item, `denied` when the provider refuses the name, `invalid` when the
  // value is unusable (shorter than the redactor can seed).
  resolve(name: string, purpose: string, ctx?: ResolveContext): Promise<Result<SecretHandle>>;
}
