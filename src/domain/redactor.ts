// The redactor behind the event and log boundaries (SEC-3, D-14). It applies the secret patterns AVARICE already
// scans documents with (findSecrets/redactSecrets in ./secret-patterns.ts), then every literal credential value seeded at
// run time, replacing each match with `[REDACTED:<kind>]`; a seeded literal is `[REDACTED:seeded]`. Digests, ULID-based
// IDs and repository paths match none of the patterns, so they pass through unchanged. Pure: no I/O, no clock.
import { err, ok } from './result.ts';
import type { Result } from './result.ts';
import { redactSecrets } from './secret-patterns.ts';

// A seeded literal shorter than this is refused: a short value is a common word, and redacting it everywhere would
// mangle the evidence it was meant to protect (RESEARCH A3). The credential resolver refuses such a value too.
export const MIN_SEEDED_SECRET_LENGTH = 8;

export const SEEDED_MARKER = '[REDACTED:seeded]';

export class Redactor {
  // Longest first, so a literal that contains another is found whole.
  private seeded: string[] = [];

  // Adds a literal to redact from now on. Seeding a value already seeded is a no-op.
  seed(value: string): Result<void> {
    if (value.length < MIN_SEEDED_SECRET_LENGTH) {
      return err({ kind: 'invalid', field: 'value', reason: `a seeded secret must be at least ${MIN_SEEDED_SECRET_LENGTH} characters (MIN_SEEDED_SECRET_LENGTH)` });
    }
    if (!this.seeded.includes(value)) this.seeded = [...this.seeded, value].sort((a, b) => b.length - a.length);
    return ok(undefined);
  }

  // The text with every secret-shaped string and every seeded literal replaced. Seeded matches that overlap are merged
  // into one marker, so neither literal leaves a fragment behind.
  redact(text: string): string {
    const patterned = redactSecrets(text);
    if (this.seeded.length === 0) return patterned;
    const spans: Array<[number, number]> = [];
    for (const literal of this.seeded) {
      for (let at = patterned.indexOf(literal); at !== -1; at = patterned.indexOf(literal, at + 1)) spans.push([at, at + literal.length]);
    }
    if (spans.length === 0) return patterned;
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let out = '';
    let cursor = 0;
    let [start, end] = spans[0] as [number, number];
    const flush = (): void => {
      out += patterned.slice(cursor, start) + SEEDED_MARKER;
      cursor = end;
    };
    for (const [from, to] of spans.slice(1)) {
      if (from <= end) {
        end = Math.max(end, to);
      } else {
        flush();
        start = from;
        end = to;
      }
    }
    flush();
    return out + patterned.slice(cursor);
  }
}

// A copy of `value` with every string leaf redacted. Object keys, numbers, booleans and null are kept, and the input is
// not changed. A value that is not an array or a plain object is returned as it is, so the canonical form the caller
// computes next refuses it exactly as before.
export function redactLeaves(value: unknown, redactor: Redactor): unknown {
  if (typeof value === 'string') return redactor.redact(value);
  if (Array.isArray(value)) return value.map((item: unknown) => redactLeaves(item, redactor));
  if (typeof value === 'object' && value !== null) {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactLeaves(item, redactor);
    return out;
  }
  return value;
}
