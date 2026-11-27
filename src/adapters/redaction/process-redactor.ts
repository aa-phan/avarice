// The one Redactor of this process, shared by the event writers and the shell history (SEC-3, D-14). It imports only domain
// modules, so the lean hook entry can load it through the events module.
import { Redactor } from '../../domain/redactor.ts';
import type { Result } from '../../domain/result.ts';

export const processRedactor = new Redactor();

// Adds a credential value to what the process redacts from here on; a value shorter than the minimum is refused.
export function seedProcessRedactor(value: string): Result<void> {
  return processRedactor.seed(value);
}
