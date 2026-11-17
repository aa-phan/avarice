// The one SecretHandle of the credential adapters (SEC-2). The value lives in a private field: it is not a property, it is not in the
// string, JSON or inspect form, and it leaves the handle only as the argument of the function passed to use().
import { inspect } from 'node:util';
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { SecretHandle } from '../../ports/credential-provider.ts';
import { seedProcessRedactor } from '../redaction/process-redactor.ts';

export const HANDLE_PLACEHOLDER = '[SecretHandle]';

class ValueHandle implements SecretHandle {
  readonly #value: string;
  readonly delegatedTo?: string;

  constructor(value: string, delegatedTo?: string) {
    this.#value = value;
    if (delegatedTo !== undefined) this.delegatedTo = delegatedTo;
  }

  use<T>(fn: (value: string) => T): T {
    return fn(this.#value);
  }

  toJSON(): string {
    return HANDLE_PLACEHOLDER;
  }

  toString(): string {
    return HANDLE_PLACEHOLDER;
  }

  [inspect.custom](): string {
    return HANDLE_PLACEHOLDER;
  }
}

// Called by a provider with each resolved value, before the handle exists: the hook that seeds the process redactor. A refusal (a value
// under the minimum length) stops the resolution, so no handle holds a value the redactor cannot protect.
export type OnResolved = (value: string) => Result<void>;

export const seedOnResolved: OnResolved = seedProcessRedactor;

// A handle for a resolved value, after the redactor has been seeded with it. An unusable value is `invalid`; the error never holds it.
export function sealValue(value: string, onResolved: OnResolved): Result<SecretHandle> {
  const seeded = onResolved(value);
  if (!seeded.ok) return err({ kind: 'invalid', field: 'value', reason: 'the resolved credential is too short to be redacted safely (fewer than 8 characters)' });
  return ok(new ValueHandle(value));
}

// A handle that carries the name of the CLI that holds the credential and no value (`use` receives the empty string).
export function delegatedHandle(cli: string): SecretHandle {
  return new ValueHandle('', cli);
}
