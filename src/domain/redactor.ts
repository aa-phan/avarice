// The process redactor's domain type (SEC-3, D-14). Interface only for now: redaction is added with the tracer's GREEN step.
import { ok } from './result.ts';
import type { Result } from './result.ts';

export const MIN_SEEDED_SECRET_LENGTH = 8;

export class Redactor {
  seed(_value: string): Result<void> {
    return ok(undefined);
  }

  redact(text: string): string {
    return text;
  }
}

export function redactLeaves(value: unknown, _redactor: Redactor): unknown {
  return value;
}
